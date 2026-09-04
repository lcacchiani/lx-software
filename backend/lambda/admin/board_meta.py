"""Executive Board ``meta`` tools: Facebook Page, Instagram, WhatsApp Cloud API.

Webhook (``GET/POST /webhooks/meta``) is the first unauthenticated admin-API
route: Meta's verify handshake plus ``X-Hub-Signature-256``. Inbound payloads
are masked and stored under ``BOARD#…#meta#``; no LLM work happens here.

Writes execute only after approval (T5 is read + propose). WhatsApp ``act``
is honoured only inside the 24-hour customer-service window and only for
allow-listed recipients; otherwise the call is downgraded to propose.

Plan: docs/architecture/executive-board-tools-plan.md §5.3.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest
from urllib.parse import parse_qs

from admin_runtime import _get_secretsmanager_client
import board_mail
import board_pii
import board_store
from contract_constants import BOARD_META_ADS_MONTHLY_CAP_USD, BOARD_META_LIST_MAX
from http_common import _log_event, _utc_iso_z
from openrouter_client import read_secret_string

GRAPH_ORIGIN = "https://graph.facebook.com/v21.0"
HTTP_TIMEOUT_SECONDS = 12
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


def ad_account_id() -> str:
    raw = (os.environ.get("META_AD_ACCOUNT_ID") or "").strip()
    if raw and not raw.startswith("act_"):
        return f"act_{raw}"
    return raw


def ads_monthly_cap_usd() -> float:
    raw = (os.environ.get("META_ADS_MONTHLY_CAP_USD") or "").strip()
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return float(BOARD_META_ADS_MONTHLY_CAP_USD)


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
        "adsMonthlyCapUsd": ads_monthly_cap_usd(),
    }


# ---------------------------------------------------------------------------
# Graph API
# ---------------------------------------------------------------------------

def _urlopen(req: urlrequest.Request, timeout: float | None = None) -> Any:
    return urlrequest.urlopen(req, timeout=timeout or HTTP_TIMEOUT_SECONDS)


def graph(method: str, path: str, *, params: dict[str, Any] | None = None, body: dict[str, Any] | None = None) -> dict[str, Any]:
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
        with _urlopen(req) as resp:
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
    data = graph("GET", f"{pid}/insights", params={"metric": metric, "period": "day"})
    rows = (data.get("data") or [])[: BOARD_META_LIST_MAX]
    return {"pageId": pid, "insights": rows, "count": len(rows)}


def op_ig_insights(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    iid = str(args.get("igUserId") or ig_user_id())
    if not iid:
        raise MetaError("META_IG_USER_ID is not set.")
    metric = str(args.get("metric") or "impressions,reach,profile_views")
    data = graph("GET", f"{iid}/insights", params={"metric": metric, "period": "day"})
    rows = (data.get("data") or [])[: BOARD_META_LIST_MAX]
    return {"igUserId": iid, "insights": rows, "count": len(rows)}


def op_list_comments(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    pid = str(args.get("pageId") or page_id())
    if not pid:
        raise MetaError("META_PAGE_ID is not set.")
    data = graph("GET", f"{pid}/feed", params={"fields": "id,message,comments.limit(10){from,message,created_time}", "limit": min(int(args.get("limit") or 10), BOARD_META_LIST_MAX)})
    posts = []
    for post in (data.get("data") or [])[: BOARD_META_LIST_MAX]:
        comments = ((post.get("comments") or {}).get("data") or [])
        posts.append(
            {
                "id": post.get("id"),
                "message": _mask_for_model(str(post.get("message") or "")),
                "comments": [
                    {"id": c.get("id"), "from": "contact#hidden", "message": _mask_for_model(str(c.get("message") or ""))}
                    for c in comments
                ],
            }
        )
    return {"posts": posts, "count": len(posts)}


def op_list_dms(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    return _list_stored(ctx.table, channel="page", limit=int(args.get("limit") or 20))


def op_list_whatsapp(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    return _list_stored(ctx.table, channel="whatsapp", limit=int(args.get("limit") or 20))


def op_ad_spend(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    aid = str(args.get("adAccountId") or ad_account_id())
    if not aid:
        raise MetaError("META_AD_ACCOUNT_ID is not set.")
    data = graph(
        "GET",
        f"{aid}/insights",
        params={"fields": "spend,impressions,clicks,actions", "date_preset": "this_month", "level": "account"},
    )
    rows = data.get("data") or []
    spend = 0.0
    if rows:
        try:
            spend = float(rows[0].get("spend") or 0)
        except (TypeError, ValueError):
            spend = 0.0
    return {"adAccountId": aid, "spendUsd": spend, "capUsd": ads_monthly_cap_usd(), "rows": rows[:5]}


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


def _mask_for_model(text: str) -> str:
    return board_pii.EMAIL_RE.sub("contact#hidden", board_pii.PHONE_RE.sub("phone#hidden", text))


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


def op_create_ad_set(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    aid = str(args.get("adAccountId") or ad_account_id())
    name = str(args.get("name") or "").strip()
    try:
        daily = float(args.get("dailyBudgetUsd"))
    except (TypeError, ValueError) as exc:
        raise MetaError("dailyBudgetUsd must be a number") from exc
    if not aid or not name or daily <= 0:
        raise MetaError("adAccountId, name and a positive dailyBudgetUsd are required")
    monthly = daily * 30
    cap = ads_monthly_cap_usd()
    if monthly > cap:
        raise MetaError(f"dailyBudgetUsd * 30 ({monthly:.2f}) exceeds the monthly ads cap of USD {cap:.2f}")
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
    return {"ok": True, "adSetId": data.get("id"), "dailyBudgetUsd": daily, "status": "PAUSED"}


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


def act_guard_ad_set(_ctx: Any, args: dict[str, Any]) -> str | None:
    try:
        daily = float(args.get("dailyBudgetUsd"))
    except (TypeError, ValueError):
        return "dailyBudgetUsd must be a number"
    if daily * 30 > ads_monthly_cap_usd():
        return f"the proposed monthly spend exceeds the USD {ads_monthly_cap_usd():.0f} cap"
    return None


def _recipient_allowed(settings: dict[str, Any], value: str) -> bool:
    if "@" in value:
        return board_mail.recipient_allowed(settings, value)
    entries = (settings.get("tools") or {}).get("allowList") or []
    digits = board_pii.normalize_phone(value)
    return any(board_pii.normalize_phone(str(e)) == digits for e in entries if isinstance(e, str))


def owner_preview_message(_ctx: Any, args: dict[str, Any], *, op: str) -> dict[str, Any]:
    to = args.get("to") or args.get("recipientId") or args.get("providerEmail") or args.get("parentEmail")
    return {
        "kind": "email" if "@" in str(to or "") else "meta",
        "from": "whatsapp" if "whatsapp" in op else ("instagram" if "story" in op else "facebook"),
        "to": [str(to)] if to else [],
        "cc": [],
        "subject": str(args.get("name") or args.get("template") or op),
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
