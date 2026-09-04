"""Executive Board ``meta`` tools: Facebook Page, Instagram, WhatsApp Cloud API.

Webhook (``GET/POST /webhooks/meta``) is the first unauthenticated admin-API
route: Meta's verify handshake plus ``X-Hub-Signature-256``. Inbound payloads
are masked and stored under ``BOARD#…#meta#``; no LLM work happens here.

Writes execute after approval, or at ``act`` when the global mode allows it
and the call is inside caps / allow-lists (T7). WhatsApp ``act`` is honoured
only inside the 24-hour customer-service window and only for allow-listed
recipients; otherwise the call is downgraded to propose. Ad writes that would
breach the owner-set daily or monthly spend caps are forced to propose.

Plan: docs/architecture/executive-board-tools-plan.md §5.3.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest
from urllib.parse import parse_qs

from admin_runtime import _get_secretsmanager_client
import board_deadline
import board_mail
import board_pii
import board_store
from contract_constants import (
    BOARD_META_ADS_DAILY_CAP_USD,
    BOARD_META_ADS_MONTHLY_CAP_USD,
    BOARD_META_LIST_MAX,
)
from http_common import _log_event, _utc_iso_z
from openrouter_client import read_secret_string

GRAPH_ORIGIN = "https://graph.facebook.com/v21.0"
HTTP_TIMEOUT_SECONDS = 12
HTTP_TIMEOUT_SLOW_SECONDS = 25
WINDOW_HOURS = 24

_token_cache: str | None = None
_token_checked = False
_app_secret_cache: str | None = None
_app_secret_checked = False


class MetaError(RuntimeError):
    """User-facing Meta / webhook failure."""


def configured() -> bool:
    return bool(
        (os.environ.get("META_BOARD_TOKEN") or "").strip()
        or (os.environ.get("META_BOARD_TOKEN_SECRET_ARN") or "").strip()
    )


def verify_token() -> str:
    return (os.environ.get("META_VERIFY_TOKEN") or "").strip()


def page_id() -> str:
    return (os.environ.get("META_PAGE_ID") or "").strip()


def ig_user_id() -> str:
    return (os.environ.get("META_IG_USER_ID") or "").strip()


def wa_phone_id() -> str:
    return (os.environ.get("META_WA_PHONE_NUMBER_ID") or "").strip()


def waba_id() -> str:
    return (os.environ.get("META_WABA_ID") or "").strip()


def ad_account_id() -> str:
    raw = (os.environ.get("META_AD_ACCOUNT_ID") or "").strip()
    if raw and not raw.startswith("act_"):
        return f"act_{raw}"
    return raw


def ads_daily_cap_usd() -> float:
    raw = (os.environ.get("META_ADS_DAILY_CAP_USD") or "").strip()
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return float(BOARD_META_ADS_DAILY_CAP_USD)


def ads_monthly_cap_usd() -> float:
    raw = (os.environ.get("META_ADS_MONTHLY_CAP_USD") or "").strip()
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return float(BOARD_META_ADS_MONTHLY_CAP_USD)


def ads_caps(settings: dict[str, Any] | None = None) -> tuple[float, float]:
    """Owner-set caps from settings, else env / contract defaults."""
    daily = ads_daily_cap_usd()
    monthly = ads_monthly_cap_usd()
    raw = ((settings or {}).get("tools") or {}).get("spendCaps")
    if isinstance(raw, dict):
        normalized = board_store.normalize_spend_caps(raw)
        if "metaAdsDailyUsd" in raw:
            daily = normalized["metaAdsDailyUsd"]
        if "metaAdsMonthlyUsd" in raw:
            monthly = normalized["metaAdsMonthlyUsd"]
    return daily, monthly


def graph_month_spend() -> float:
    aid = ad_account_id()
    if not aid or not board_token():
        return 0.0
    try:
        data = graph(
            "GET",
            f"{aid}/insights",
            params={"fields": "spend", "date_preset": "this_month", "level": "account"},
        )
    except MetaError:
        return 0.0
    rows = data.get("data") or []
    if not rows:
        return 0.0
    try:
        return float(rows[0].get("spend") or 0)
    except (TypeError, ValueError):
        return 0.0


def ads_spend_snapshot(table: Any, settings: dict[str, Any] | None = None) -> dict[str, float]:
    recorded = board_store.load_ads_spend(table) if table is not None else {"dailyUsd": 0.0, "monthlyUsd": 0.0}
    graph_month = graph_month_spend()
    daily_cap, monthly_cap = ads_caps(settings)
    recorded_daily = float(recorded.get("dailyUsd") or 0.0)
    recorded_month = float(recorded.get("monthlyUsd") or 0.0)
    return {
        "recordedDailyUsd": recorded_daily,
        "recordedMonthlyUsd": recorded_month,
        "graphMonthlyUsd": graph_month,
        "dailyUsd": recorded_daily,
        "monthlyUsd": recorded_month + graph_month,
        "dailyCapUsd": daily_cap,
        "monthlyCapUsd": monthly_cap,
    }


def reset_caches_for_tests() -> None:
    global _token_cache, _token_checked, _app_secret_cache, _app_secret_checked
    _token_cache = None
    _token_checked = False
    _app_secret_cache = None
    _app_secret_checked = False


def _secret(env_plain: str, env_arn: str) -> str:
    plain = (os.environ.get(env_plain) or "").strip()
    if plain:
        return plain
    arn = (os.environ.get(env_arn) or "").strip()
    if not arn:
        return ""
    return (read_secret_string(_get_secretsmanager_client(), arn) or "").strip()


def board_token() -> str:
    global _token_cache, _token_checked
    if _token_checked:
        return _token_cache or ""
    _token_checked = True
    _token_cache = _secret("META_BOARD_TOKEN", "META_BOARD_TOKEN_SECRET_ARN")
    return _token_cache or ""


def app_secret() -> str:
    global _app_secret_cache, _app_secret_checked
    if _app_secret_checked:
        return _app_secret_cache or ""
    _app_secret_checked = True
    _app_secret_cache = _secret("META_APP_SECRET", "META_APP_SECRET_SECRET_ARN")
    return _app_secret_cache or ""


def status_summary(table: Any) -> dict[str, Any]:
    threads = board_store.list_meta_threads(table) if table is not None else []
    unread = sum(1 for t in threads if t.get("unread"))
    return {
        "configured": configured(),
        "pageSet": bool(page_id()),
        "whatsappSet": bool(wa_phone_id()),
        "threadCount": len(threads),
        "unreadCount": unread,
        "adsDailyCapUsd": ads_caps(None)[0],
        "adsMonthlyCapUsd": ads_caps(None)[1],
    }


# ---------------------------------------------------------------------------
# Graph API
# ---------------------------------------------------------------------------

def _urlopen(req: urlrequest.Request, timeout: float | None = None) -> Any:
    return urlrequest.urlopen(req, timeout=board_deadline.remaining(timeout or HTTP_TIMEOUT_SECONDS))


def graph(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
    timeout: float | None = None,
) -> dict[str, Any]:
    token = board_token()
    if not token:
        raise MetaError("MetaBoardToken is not configured.")
    query = dict(params or {})
    query["access_token"] = token
    url = f"{GRAPH_ORIGIN}/{path.lstrip('/')}?{urlparse.urlencode(query, doseq=True)}"
    data = None
    headers = {"User-Agent": "lxsoftware-board-meta"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urlrequest.Request(url, data=data, method=method.upper(), headers=headers)
    try:
        with _urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise MetaError(f"Meta Graph {exc.code}: {detail or exc.reason}") from exc
    except urlerror.URLError as exc:
        raise MetaError(f"Meta Graph unreachable: {exc.reason}") from exc
    if not raw:
        return {}
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise MetaError("Meta Graph returned non-JSON") from exc
    return parsed if isinstance(parsed, dict) else {"data": parsed}


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------

def _raw_body(event: dict[str, Any]) -> bytes:
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        import base64

        return base64.b64decode(raw)
    return raw.encode("utf-8") if isinstance(raw, str) else bytes(raw)


def _header(event: dict[str, Any], name: str) -> str:
    headers = event.get("headers") or {}
    wanted = name.lower()
    for key, value in headers.items():
        if str(key).lower() == wanted:
            return str(value or "")
    return ""


def verify_signature(event: dict[str, Any], body: bytes) -> bool:
    secret = app_secret()
    if not secret:
        return False
    header = _header(event, "X-Hub-Signature-256")
    if not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header[7:], expected)


def handle_http(event: dict[str, Any], method: str) -> dict[str, Any]:
    """Unauthenticated Meta webhook. GET = verify handshake; POST = ingest."""
    if method == "GET":
        qs = parse_qs(event.get("rawQueryString") or "")
        params = event.get("queryStringParameters") or {}
        mode = (qs.get("hub.mode") or [params.get("hub.mode") or ""])[0]
        token = (qs.get("hub.verify_token") or [params.get("hub.verify_token") or ""])[0]
        challenge = (qs.get("hub.challenge") or [params.get("hub.challenge") or ""])[0]
        expected = verify_token()
        if mode == "subscribe" and expected and hmac.compare_digest(str(token), expected):
            return {"statusCode": 200, "headers": {"Content-Type": "text/plain"}, "body": str(challenge)}
        return {"statusCode": 403, "headers": {"Content-Type": "text/plain"}, "body": "forbidden"}

    if method != "POST":
        return {"statusCode": 405, "headers": {"Content-Type": "application/json"}, "body": json.dumps({"message": "Method not allowed"})}

    body = _raw_body(event)
    if not verify_signature(event, body):
        _log_event("warning", tag="board_meta_webhook_bad_sig")
        return {"statusCode": 403, "headers": {"Content-Type": "application/json"}, "body": json.dumps({"message": "invalid signature"})}
    try:
        payload = json.loads(body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return {"statusCode": 400, "headers": {"Content-Type": "application/json"}, "body": json.dumps({"message": "invalid json"})}
    ingested = ingest_webhook(board_store.records_table(), payload if isinstance(payload, dict) else {})
    return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps({"ok": True, **ingested})}


def ingest_webhook(table: Any, payload: dict[str, Any]) -> dict[str, Any]:
    """Store masked inbound messages. Must stay well under Meta's 20 s ack."""
    obj = str(payload.get("object") or "")
    entries = payload.get("entry") or []
    stored = 0
    pseud = board_pii.Pseudonymizer(table)
    now = _utc_iso_z(datetime.now(timezone.utc))
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        channel = "whatsapp" if obj == "whatsapp_business_account" else ("instagram" if obj == "instagram" else "page")
        for msg in _iter_inbound(entry, channel=channel):
            _store_inbound(table, pseud, msg, received_at=now)
            stored += 1
    pseud.save()
    _log_event("info", tag="board_meta_ingested", stored=stored, object=obj)
    return {"stored": stored}


def _iter_inbound(entry: dict[str, Any], *, channel: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    messaging = entry.get("messaging") or entry.get("standby") or []
    for item in messaging:
        if not isinstance(item, dict):
            continue
        message = item.get("message") or {}
        if not isinstance(message, dict):
            continue
        sender = (item.get("sender") or {}).get("id") or (item.get("from") or {}).get("id") or ""
        text = str(message.get("text") or message.get("body") or "")
        mid = str(message.get("mid") or message.get("id") or board_store.new_id())
        ts = item.get("timestamp") or entry.get("time") or int(time.time() * 1000)
        out.append(
            {
                "channel": channel,
                "threadKey": str(sender or mid),
                "senderId": str(sender),
                "messageId": mid,
                "text": text,
                "timestampMs": int(ts) if str(ts).isdigit() else int(time.time() * 1000),
            }
        )
    for change in entry.get("changes") or []:
        if not isinstance(change, dict):
            continue
        value = change.get("value") or {}
        if not isinstance(value, dict):
            continue
        if change.get("field") in ("messages", "whatsapp_business_account"):
            for m in value.get("messages") or []:
                if not isinstance(m, dict):
                    continue
                sender = str((m.get("from") or value.get("contacts", [{}])[0].get("wa_id") if value.get("contacts") else "") or "")
                text = str((m.get("text") or {}).get("body") or m.get("body") or "")
                mid = str(m.get("id") or board_store.new_id())
                out.append(
                    {
                        "channel": "whatsapp",
                        "threadKey": sender or mid,
                        "senderId": sender,
                        "messageId": mid,
                        "text": text,
                        "timestampMs": int(m.get("timestamp") or time.time()),
                    }
                )
        if change.get("field") in ("comments", "feed"):
            comment = value.get("comment") or value
            text = str(comment.get("message") or comment.get("text") or "")
            cid = str(comment.get("id") or board_store.new_id())
            sender = str(comment.get("from", {}).get("id") or comment.get("from") or "")
            out.append(
                {
                    "channel": "instagram" if channel == "instagram" else "page",
                    "threadKey": f"comment:{cid}",
                    "senderId": sender,
                    "messageId": cid,
                    "text": text,
                    "timestampMs": int(time.time() * 1000),
                    "kind": "comment",
                }
            )
    return out


def _store_inbound(table: Any, pseud: board_pii.Pseudonymizer, msg: dict[str, Any], *, received_at: str) -> None:
    thread_id = hashlib.sha256(f"{msg.get('channel')}:{msg.get('threadKey')}".encode()).hexdigest()[:20]
    text = str(msg.get("text") or "")
    masked = pseud.mask_text(text)
    ts_ms = int(msg.get("timestampMs") or 0)
    received = received_at
    if ts_ms > 10_000_000_000:
        received = _utc_iso_z(datetime.fromtimestamp(ts_ms / 1000, timezone.utc))
    elif ts_ms > 1_000_000_000:
        received = _utc_iso_z(datetime.fromtimestamp(ts_ms, timezone.utc))
    existing = board_store.get_meta_thread(table, thread_id) or {}
    board_store.put_meta_thread(
        table,
        {
            "threadId": thread_id,
            "channel": msg.get("channel"),
            "kind": msg.get("kind") or "message",
            "senderId": msg.get("senderId"),
            "lastTextMasked": masked[:240],
            "lastMessageAt": received,
            "lastInboundAt": received,
            "unread": True,
            "messageCount": int(existing.get("messageCount") or 0) + 1,
        },
    )
    board_store.put_meta_message(
        table,
        {
            "threadId": thread_id,
            "messageId": str(msg.get("messageId")),
            "receivedAt": received,
            "direction": "in",
            "textMasked": masked[:4000],
            "channel": msg.get("channel"),
        },
    )


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def op_page_insights(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    pid = str(args.get("pageId") or page_id())
    if not pid:
        raise MetaError("META_PAGE_ID is not set.")
    metric = str(args.get("metric") or "page_impressions,page_engaged_users")
    data = graph(
        "GET",
        f"{pid}/insights",
        params={"metric": metric, "period": "day"},
        timeout=HTTP_TIMEOUT_SLOW_SECONDS,
    )
    rows = (data.get("data") or [])[: BOARD_META_LIST_MAX]
    return {"pageId": pid, "insights": rows, "count": len(rows)}


def op_ig_insights(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    iid = str(args.get("igUserId") or ig_user_id())
    if not iid:
        raise MetaError("META_IG_USER_ID is not set.")
    metric = str(args.get("metric") or "impressions,reach,profile_views")
    data = graph(
        "GET",
        f"{iid}/insights",
        params={"metric": metric, "period": "day"},
        timeout=HTTP_TIMEOUT_SLOW_SECONDS,
    )
    rows = (data.get("data") or [])[: BOARD_META_LIST_MAX]
    return {"igUserId": iid, "insights": rows, "count": len(rows)}


def op_list_comments(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    pid = str(args.get("pageId") or page_id())
    if not pid:
        raise MetaError("META_PAGE_ID is not set.")
    data = graph(
        "GET",
        f"{pid}/feed",
        params={"fields": "id,message,comments.limit(10){from,message,created_time}", "limit": min(int(args.get("limit") or 10), BOARD_META_LIST_MAX)},
        timeout=HTTP_TIMEOUT_SLOW_SECONDS,
    )
    table = getattr(ctx, "table", None)
    pseud = board_pii.Pseudonymizer(table, own_domains=board_mail.own_domains()) if table is not None else None
    posts = []
    for post in (data.get("data") or [])[: BOARD_META_LIST_MAX]:
        comments = ((post.get("comments") or {}).get("data") or [])
        posts.append(
            {
                "id": post.get("id"),
                "message": _mask_text(str(post.get("message") or ""), pseud),
                "comments": [
                    {
                        "id": c.get("id"),
                        "from": _mask_sender(c.get("from"), pseud),
                        "message": _mask_text(str(c.get("message") or ""), pseud),
                    }
                    for c in comments
                ],
            }
        )
    if pseud is not None:
        pseud.save()
    return {"posts": posts, "count": len(posts)}


def op_list_dms(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    return _list_stored(ctx.table, channel="page", limit=int(args.get("limit") or 20))


def op_list_whatsapp(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    return _list_stored(ctx.table, channel="whatsapp", limit=int(args.get("limit") or 20))


def op_ad_spend(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    aid = str(args.get("adAccountId") or ad_account_id())
    if not aid:
        raise MetaError("META_AD_ACCOUNT_ID is not set.")
    data = graph(
        "GET",
        f"{aid}/insights",
        params={"fields": "spend,impressions,clicks,actions", "date_preset": "this_month", "level": "account"},
        timeout=HTTP_TIMEOUT_SLOW_SECONDS,
    )
    rows = data.get("data") or []
    spend = 0.0
    if rows:
        try:
            spend = float(rows[0].get("spend") or 0)
        except (TypeError, ValueError):
            spend = 0.0
    daily_cap, monthly_cap = ads_caps(getattr(ctx, "settings", None))
    snapshot = ads_spend_snapshot(getattr(ctx, "table", None), getattr(ctx, "settings", None))
    return {
        "adAccountId": aid,
        "spendUsd": spend,
        "capUsd": monthly_cap,
        "dailyCapUsd": daily_cap,
        "recordedDailyUsd": snapshot["recordedDailyUsd"],
        "recordedMonthlyUsd": snapshot["recordedMonthlyUsd"],
        "rows": rows[:5],
    }


def _list_stored(table: Any, *, channel: str, limit: int) -> dict[str, Any]:
    threads = [t for t in board_store.list_meta_threads(table) if t.get("channel") == channel]
    threads = threads[: max(1, min(limit, BOARD_META_LIST_MAX))]
    return {
        "threads": [
            {
                "threadId": t.get("threadId"),
                "lastTextMasked": t.get("lastTextMasked"),
                "lastMessageAt": t.get("lastMessageAt"),
                "unread": bool(t.get("unread")),
                "inWindow": _in_window(t),
            }
            for t in threads
        ],
        "count": len(threads),
    }


def _mask_text(text: str, pseud: board_pii.Pseudonymizer | None) -> str:
    if pseud is not None:
        return pseud.mask_text(text)
    return board_pii.EMAIL_RE.sub("contact#hidden", board_pii.PHONE_RE.sub("phone#hidden", text))


def _mask_sender(raw: Any, pseud: board_pii.Pseudonymizer | None) -> str:
    """Alias a Graph ``from`` object. Display names never reach the model."""
    if isinstance(raw, dict):
        ident = str(raw.get("id") or "")
        display = str(raw.get("name") or raw.get("username") or "")
    else:
        ident, display = str(raw or ""), ""
    if not ident and not display:
        return "contact#unknown"
    if pseud is None:
        return "contact#hidden"
    if ident:
        return pseud.alias_for_external("fb", ident, display=display)
    return pseud.alias_for_external("fbname", display, display=display)


def _mask_for_model(text: str) -> str:
    return _mask_text(text, None)


def resolve_waba_id() -> str:
    explicit = waba_id()
    if explicit:
        return explicit
    phone = wa_phone_id()
    if not phone:
        raise MetaError("META_WABA_ID or META_WA_PHONE_NUMBER_ID is not set.")
    data = graph("GET", phone, params={"fields": "whatsapp_business_account"}, timeout=HTTP_TIMEOUT_SLOW_SECONDS)
    account = data.get("whatsapp_business_account")
    if isinstance(account, dict) and account.get("id"):
        return str(account["id"])
    if isinstance(account, str) and account:
        return account
    raise MetaError("Could not resolve the WhatsApp Business Account id from the phone-number id.")


def op_list_whatsapp_templates(_ctx: Any, _args: dict[str, Any]) -> dict[str, Any]:
    account = resolve_waba_id()
    data = graph(
        "GET",
        f"{account}/message_templates",
        params={"fields": "name,status,language,category", "limit": BOARD_META_LIST_MAX},
        timeout=HTTP_TIMEOUT_SLOW_SECONDS,
    )
    rows = []
    for row in (data.get("data") or [])[: BOARD_META_LIST_MAX]:
        if not isinstance(row, dict):
            continue
        rows.append(
            {
                "name": row.get("name"),
                "status": row.get("status"),
                "language": row.get("language"),
                "category": row.get("category"),
            }
        )
    return {"wabaId": account, "templates": rows, "count": len(rows)}


def _in_window(thread: dict[str, Any]) -> bool:
    raw = str(thread.get("lastInboundAt") or "")
    if not raw:
        return False
    try:
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return False
    return datetime.now(timezone.utc) - ts <= timedelta(hours=WINDOW_HOURS)


# ---------------------------------------------------------------------------
# Writes (execute after approval)
# ---------------------------------------------------------------------------

def op_propose_post(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    pid = str(args.get("pageId") or page_id())
    message = str(args.get("message") or "").strip()
    if not pid or not message:
        raise MetaError("pageId and message are required")
    data = graph("POST", f"{pid}/feed", body={"message": message})
    return {"ok": True, "postId": data.get("id"), "pageId": pid}


def op_propose_story(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    iid = str(args.get("igUserId") or ig_user_id())
    caption = str(args.get("caption") or "").strip()
    image_url = str(args.get("imageUrl") or "").strip()
    if not iid or not image_url:
        raise MetaError("igUserId and imageUrl are required")
    created = graph("POST", f"{iid}/media", body={"image_url": image_url, "caption": caption, "media_type": "STORIES"})
    creation_id = created.get("id")
    if not creation_id:
        raise MetaError("Instagram did not return a creation id")
    published = graph("POST", f"{iid}/media_publish", body={"creation_id": creation_id})
    return {"ok": True, "mediaId": published.get("id"), "igUserId": iid}


def op_reply_comment(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    comment_id = str(args.get("commentId") or "").strip()
    message = str(args.get("message") or "").strip()
    if not comment_id or not message:
        raise MetaError("commentId and message are required")
    data = graph("POST", f"{comment_id}/comments", body={"message": message})
    return {"ok": True, "commentId": data.get("id"), "parent": comment_id}


def op_reply_dm(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    recipient = str(args.get("recipientId") or "").strip()
    message = str(args.get("message") or "").strip()
    pid = str(args.get("pageId") or page_id())
    if not recipient or not message or not pid:
        raise MetaError("recipientId, message and pageId are required")
    data = graph("POST", f"{pid}/messages", body={"recipient": {"id": recipient}, "message": {"text": message}})
    return {"ok": True, "messageId": data.get("message_id"), "recipientId": recipient}


def op_reply_whatsapp(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    to = str(args.get("to") or "").strip()
    message = str(args.get("message") or "").strip()
    phone = wa_phone_id()
    if not to or not message or not phone:
        raise MetaError("to, message and META_WA_PHONE_NUMBER_ID are required")
    payload: dict[str, Any] = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": message},
    }
    if args.get("template"):
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {"name": str(args["template"]), "language": {"code": str(args.get("language") or "en")}},
        }
    data = graph("POST", f"{phone}/messages", body=payload)
    return {"ok": True, "messageId": (data.get("messages") or [{}])[0].get("id"), "to": to}


def _parse_daily_budget(args: dict[str, Any]) -> float:
    try:
        daily = float(args.get("dailyBudgetUsd"))
    except (TypeError, ValueError) as exc:
        raise MetaError("dailyBudgetUsd must be a number") from exc
    if daily <= 0:
        raise MetaError("dailyBudgetUsd must be positive")
    return daily


def _parse_boost_days(args: dict[str, Any]) -> int:
    raw = args.get("days", 7)
    try:
        days = int(raw)
    except (TypeError, ValueError) as exc:
        raise MetaError("days must be an integer") from exc
    if days < 1 or days > 30:
        raise MetaError("days must be between 1 and 30")
    return days


def _object_story_id(post_id: str) -> str:
    if "_" in post_id:
        return post_id
    pid = page_id()
    return f"{pid}_{post_id}" if pid else post_id


def _record_ads_commitment(ctx: Any, *, daily: float, days: int) -> None:
    table = getattr(ctx, "table", None)
    if table is None:
        return
    board_store.record_ads_spend(table, daily_usd=daily, monthly_usd=daily * days)


def op_create_ad_set(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    aid = str(args.get("adAccountId") or ad_account_id())
    name = str(args.get("name") or "").strip()
    daily = _parse_daily_budget(args)
    if not aid or not name:
        raise MetaError("adAccountId, name and a positive dailyBudgetUsd are required")
    monthly = daily * 30
    if daily > board_store.ADS_DAILY_CAP_MAX:
        raise MetaError(f"dailyBudgetUsd exceeds the hard daily ceiling of USD {board_store.ADS_DAILY_CAP_MAX:.0f}")
    if monthly > board_store.ADS_MONTHLY_CAP_MAX:
        raise MetaError(
            f"dailyBudgetUsd * 30 ({monthly:.2f}) exceeds the hard monthly ceiling of USD {board_store.ADS_MONTHLY_CAP_MAX:.0f}"
        )
    data = graph(
        "POST",
        f"{aid}/adsets",
        body={
            "name": name,
            "daily_budget": int(round(daily * 100)),
            "billing_event": "IMPRESSIONS",
            "optimization_goal": "REACH",
            "status": "PAUSED",
            "campaign_id": str(args.get("campaignId") or ""),
        },
    )
    _record_ads_commitment(ctx, daily=daily, days=30)
    return {"ok": True, "adSetId": data.get("id"), "dailyBudgetUsd": daily, "status": "PAUSED"}


def op_boost_post(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    post_id = str(args.get("postId") or "").strip()
    daily = _parse_daily_budget(args)
    days = _parse_boost_days(args)
    aid = str(args.get("adAccountId") or ad_account_id())
    if not post_id or not aid:
        raise MetaError("postId and META_AD_ACCOUNT_ID are required")
    monthly = daily * days
    if daily > board_store.ADS_DAILY_CAP_MAX:
        raise MetaError(f"dailyBudgetUsd exceeds the hard daily ceiling of USD {board_store.ADS_DAILY_CAP_MAX:.0f}")
    if monthly > board_store.ADS_MONTHLY_CAP_MAX:
        raise MetaError(
            f"dailyBudgetUsd * days ({monthly:.2f}) exceeds the hard monthly ceiling of USD {board_store.ADS_MONTHLY_CAP_MAX:.0f}"
        )
    story_id = _object_story_id(post_id)
    end = datetime.now(timezone.utc) + timedelta(days=days)
    campaign = graph(
        "POST",
        f"{aid}/campaigns",
        body={
            "name": f"Boost {post_id}"[:80],
            "objective": "OUTCOME_ENGAGEMENT",
            "status": "ACTIVE",
            "special_ad_categories": [],
        },
    )
    campaign_id = campaign.get("id")
    if not campaign_id:
        raise MetaError("Meta did not return a campaign id")
    adset = graph(
        "POST",
        f"{aid}/adsets",
        body={
            "name": f"Boost {post_id}"[:80],
            "campaign_id": campaign_id,
            "daily_budget": int(round(daily * 100)),
            "billing_event": "IMPRESSIONS",
            "optimization_goal": "POST_ENGAGEMENT",
            "status": "ACTIVE",
            "end_time": end.strftime("%Y-%m-%dT%H:%M:%S+0000"),
            "targeting": {"geo_locations": {"countries": ["HK"]}},
        },
    )
    adset_id = adset.get("id")
    if not adset_id:
        raise MetaError("Meta did not return an ad set id")
    ad = graph(
        "POST",
        f"{aid}/ads",
        body={
            "name": f"Boost {post_id}"[:80],
            "adset_id": adset_id,
            "status": "ACTIVE",
            "creative": {"object_story_id": story_id},
        },
    )
    _record_ads_commitment(ctx, daily=daily, days=days)
    return {
        "ok": True,
        "postId": post_id,
        "objectStoryId": story_id,
        "campaignId": campaign_id,
        "adSetId": adset_id,
        "adId": ad.get("id"),
        "dailyBudgetUsd": daily,
        "days": days,
        "status": "ACTIVE",
    }


def op_relay_lead(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    """Draft the provider hand-off and parent confirmation (email via board_mail)."""
    provider = str(args.get("providerEmail") or "").strip()
    parent = str(args.get("parentEmail") or "").strip()
    summary = str(args.get("summary") or args.get("reason") or "").strip()
    if not provider or not parent:
        raise MetaError("providerEmail and parentEmail are required")
    if not board_mail.sending_enabled():
        return {
            "ok": True,
            "sent": False,
            "note": "Mail sending is off; the hand-off is recorded as a board action only.",
            "providerEmail": provider,
            "parentEmail": parent,
        }
    handoff = board_mail.outgoing_plan(
        ctx.table,
        op="mail_send",
        args={
            "fromMailbox": "hello",
            "to": [provider],
            "subject": "New parent lead from siutindei",
            "body": summary or "A parent asked to be introduced. Please reply within one working day.",
        },
    )
    confirm = board_mail.outgoing_plan(
        ctx.table,
        op="mail_send",
        args={
            "fromMailbox": "hello",
            "to": [parent],
            "subject": "We have passed your request to the provider",
            "body": "Thanks — we have introduced you to the provider. They will contact you shortly.",
        },
    )
    r1 = board_mail.send_plan(ctx.table, handoff, sent_by=getattr(ctx, "persona_id", "coo"))
    r2 = board_mail.send_plan(ctx.table, confirm, sent_by=getattr(ctx, "persona_id", "coo"))
    return {"ok": True, "provider": r1, "parent": r2}


def act_guard_whatsapp(ctx: Any, args: dict[str, Any]) -> str | None:
    to = str(args.get("to") or "").strip()
    thread_id = str(args.get("threadId") or "").strip()
    if to and not _recipient_allowed(ctx.settings, to):
        return f"{to} is not on the allow-list"
    thread = board_store.get_meta_thread(ctx.table, thread_id) if thread_id else None
    if thread and not _in_window(thread) and not args.get("template"):
        return "the 24-hour WhatsApp customer-service window is closed; use a pre-approved template"
    if not thread and not args.get("template"):
        return "no open WhatsApp window for this recipient"
    return None


def act_guard_allow_list(ctx: Any, args: dict[str, Any], *, field: str) -> str | None:
    value = str(args.get(field) or "").strip()
    if not value:
        return f"{field} is required"
    if not _recipient_allowed(ctx.settings, value):
        return f"{value} is not on the allow-list"
    return None


def act_guard_relay(ctx: Any, args: dict[str, Any]) -> str | None:
    for field in ("providerEmail", "parentEmail"):
        reason = act_guard_allow_list(ctx, args, field=field)
        if reason:
            return reason
    return None


def _phone_digits(value: str) -> str:
    return re.sub(r"\D", "", board_pii.normalize_phone(value) or "")


def act_guard_ads(ctx: Any, args: dict[str, Any], *, days: int | None = None) -> str | None:
    try:
        daily = float(args.get("dailyBudgetUsd"))
    except (TypeError, ValueError):
        return "dailyBudgetUsd must be a number"
    if daily <= 0:
        return "dailyBudgetUsd must be positive"
    span = days
    if span is None:
        raw_days = args.get("days")
        if raw_days is None:
            span = 30
        else:
            try:
                span = int(raw_days)
            except (TypeError, ValueError):
                return "days must be an integer"
    if span < 1 or span > 30:
        return "days must be between 1 and 30"
    daily_cap, monthly_cap = ads_caps(getattr(ctx, "settings", None))
    monthly = daily * span
    if daily > daily_cap:
        return f"the daily budget exceeds the USD {daily_cap:.0f} daily cap"
    if monthly > monthly_cap:
        return f"the proposed monthly spend exceeds the USD {monthly_cap:.0f} cap"
    snapshot = ads_spend_snapshot(getattr(ctx, "table", None), getattr(ctx, "settings", None))
    if snapshot["dailyUsd"] + daily > daily_cap:
        return f"today's ads spend would exceed the USD {daily_cap:.0f} daily cap"
    if snapshot["monthlyUsd"] + monthly > monthly_cap:
        return f"this month's ads spend would exceed the USD {monthly_cap:.0f} cap"
    return None


def act_guard_ad_set(ctx: Any, args: dict[str, Any]) -> str | None:
    return act_guard_ads(ctx, args, days=30)


def act_guard_boost_post(ctx: Any, args: dict[str, Any]) -> str | None:
    if not str(args.get("postId") or "").strip():
        return "postId is required"
    return act_guard_ads(ctx, args)


def _recipient_allowed(settings: dict[str, Any], value: str) -> bool:
    if "@" in value:
        return board_mail.recipient_allowed(settings, value)
    entries = (settings.get("tools") or {}).get("allowList") or []
    digits = _phone_digits(value)
    if not digits:
        return False
    return any(_phone_digits(str(e)) == digits for e in entries if isinstance(e, str) and "@" not in str(e))


def owner_preview_message(_ctx: Any, args: dict[str, Any], *, op: str) -> dict[str, Any]:
    to = args.get("to") or args.get("recipientId") or args.get("providerEmail") or args.get("parentEmail")
    return {
        "kind": "email" if "@" in str(to or "") else "meta",
        "from": "whatsapp" if "whatsapp" in op else ("instagram" if "story" in op else "facebook"),
        "to": [str(to)] if to else [],
        "cc": [],
        "subject": str(args.get("name") or args.get("postId") or args.get("template") or op),
        "text": str(args.get("message") or args.get("caption") or args.get("summary") or args.get("reason") or ""),
        "threadId": str(args.get("threadId") or ""),
        "sendEnabled": configured(),
    }


def digest_for_context(table: Any) -> dict[str, Any]:
    if table is None:
        return {}
    threads = board_store.list_meta_threads(table)
    unread = sum(1 for t in threads if t.get("unread"))
    wa = sum(1 for t in threads if t.get("channel") == "whatsapp")
    return {"unread": unread, "threads": len(threads), "whatsappThreads": wa}
