"""Executive Board ``stores`` tools: App Store Connect and Google Play.

Reads (downloads, installs, crashes, ratings, review text/status) are cached
under ``BOARD#…#cache`` and refreshed by the hourly ``board_cache`` schedule.
Writes: reply to a customer review (CMO may ``act``); release-notes drafts
always stay in Approvals (plan §4).

App Store Connect JWTs are ES256, signed in this Lambda from the
``AppStoreConnectKey`` secret. Play uses a service-account JWT exchanged
for an access token.

Plan: docs/architecture/executive-board-tools-plan.md §4 ``stores``.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

from admin_runtime import _get_secretsmanager_client
import board_pii
import board_store
from contract_constants import BOARD_STORES_CACHE_TTL_HOURS, BOARD_STORES_LIST_MAX
from http_common import _log_event, _utc_iso_z
from openrouter_client import read_secret_string

ASC_ORIGIN = "https://api.appstoreconnect.apple.com"
PLAY_ORIGIN = "https://androidpublisher.googleapis.com"
PLAY_REPORTING_ORIGIN = "https://playdeveloperreporting.googleapis.com"
PLAY_TOKEN_URL = "https://oauth2.googleapis.com/token"
PLAY_SCOPES = (
    "https://www.googleapis.com/auth/androidpublisher "
    "https://www.googleapis.com/auth/playdeveloperreporting"
)
HTTP_TIMEOUT_SECONDS = 12
METRICS_CACHE = "stores:metrics"
CRASHES_CACHE = "stores:crashes"
RATINGS_CACHE = "stores:ratings"

_asc_creds: dict[str, str] | None = None
_asc_creds_checked = False
_play_creds: dict[str, str] | None = None
_play_creds_checked = False
_play_token: tuple[str, float] | None = None


class StoresError(RuntimeError):
    """User-facing App Store Connect / Play failure."""


def reset_caches_for_tests() -> None:
    global _asc_creds, _asc_creds_checked, _play_creds, _play_creds_checked, _play_token
    _asc_creds = None
    _asc_creds_checked = False
    _play_creds = None
    _play_creds_checked = False
    _play_token = None


def _secret_json(env_plain: str, env_arn: str) -> dict[str, Any]:
    plain = (os.environ.get(env_plain) or "").strip()
    if plain:
        try:
            parsed = json.loads(plain)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    arn = (os.environ.get(env_arn) or "").strip()
    if not arn:
        return {}
    raw = (read_secret_string(_get_secretsmanager_client(), arn) or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _asc_secret() -> dict[str, str]:
    global _asc_creds, _asc_creds_checked
    if _asc_creds_checked:
        return _asc_creds or {}
    _asc_creds_checked = True
    raw = _secret_json("APP_STORE_CONNECT_KEY", "APP_STORE_CONNECT_KEY_SECRET_ARN")
    key_id = str(raw.get("keyId") or raw.get("kid") or "").strip()
    issuer = str(raw.get("issuerId") or raw.get("iss") or "").strip()
    pem = str(raw.get("privateKey") or raw.get("p8") or raw.get("key") or "").strip()
    app_id = str(raw.get("appId") or raw.get("app_id") or os.environ.get("APP_STORE_CONNECT_APP_ID") or "").strip()
    token = (os.environ.get("APP_STORE_CONNECT_TOKEN") or "").strip()
    _asc_creds = {
        "keyId": key_id,
        "issuerId": issuer,
        "privateKey": pem,
        "appId": app_id,
        "token": token,
    }
    return _asc_creds


def _play_secret() -> dict[str, str]:
    global _play_creds, _play_creds_checked
    if _play_creds_checked:
        return _play_creds or {}
    _play_creds_checked = True
    raw = _secret_json("GOOGLE_PLAY_SERVICE_ACCOUNT", "GOOGLE_PLAY_SERVICE_ACCOUNT_SECRET_ARN")
    email = str(raw.get("client_email") or raw.get("clientEmail") or "").strip()
    pem = str(raw.get("private_key") or raw.get("privateKey") or "").strip()
    package = str(
        raw.get("packageName")
        or raw.get("package_name")
        or os.environ.get("GOOGLE_PLAY_PACKAGE_NAME")
        or ""
    ).strip()
    token = (os.environ.get("GOOGLE_PLAY_ACCESS_TOKEN") or "").strip()
    _play_creds = {
        "clientEmail": email,
        "privateKey": pem,
        "packageName": package,
        "token": token,
    }
    return _play_creds


def apple_configured() -> bool:
    creds = _asc_secret()
    if creds.get("token"):
        return True
    return bool(creds.get("keyId") and creds.get("issuerId") and creds.get("privateKey"))


def play_configured() -> bool:
    creds = _play_secret()
    if creds.get("token"):
        return True
    return bool(creds.get("clientEmail") and creds.get("privateKey"))


def configured() -> bool:
    return apple_configured() or play_configured()


def apple_app_id() -> str:
    return _asc_secret().get("appId") or ""


def play_package() -> str:
    return _play_secret().get("packageName") or ""


def status_summary() -> dict[str, Any]:
    return {
        "configured": configured(),
        "appleConfigured": apple_configured(),
        "playConfigured": play_configured(),
        "appleAppIdSet": bool(apple_app_id()),
        "playPackageSet": bool(play_package()),
        "cacheTtlHours": BOARD_STORES_CACHE_TTL_HOURS,
    }


# ---------------------------------------------------------------------------
# JWT (ES256 / RS256) signed in-process via openssl
# ---------------------------------------------------------------------------

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _der_ecdsa_to_jose(der: bytes, size: int = 32) -> bytes:
    if not der or der[0] != 0x30:
        raise StoresError("invalid ECDSA signature")
    idx = 2 if der[1] < 0x80 else 3

    def read_int(i: int) -> tuple[bytes, int]:
        if i >= len(der) or der[i] != 0x02:
            raise StoresError("invalid ECDSA INTEGER")
        ln = der[i + 1]
        raw = der[i + 2 : i + 2 + ln]
        raw = raw.lstrip(b"\x00") or b"\x00"
        return raw.rjust(size, b"\x00")[-size:], i + 2 + ln

    r, idx = read_int(idx)
    s, _ = read_int(idx)
    return r + s


def sign_jwt(header: dict[str, Any], payload: dict[str, Any], pem: str) -> str:
    """Sign a JWT. ES256 (App Store Connect) or RS256 (Play) via openssl."""
    alg = str(header.get("alg") or "")
    if alg not in ("ES256", "RS256"):
        raise StoresError(f"unsupported JWT alg {alg}")
    signing_input = (
        f"{_b64url(json.dumps(header, separators=(',', ':')).encode())}."
        f"{_b64url(json.dumps(payload, separators=(',', ':')).encode())}"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as handle:
        handle.write(pem if pem.endswith("\n") else pem + "\n")
        key_path = handle.name
    try:
        proc = subprocess.run(  # noqa: S603 - openssl dgst; key is a temp file we wrote
            ["openssl", "dgst", "-sha256", "-sign", key_path],
            input=signing_input.encode(),
            capture_output=True,
            check=False,
        )
    finally:
        try:
            os.unlink(key_path)
        except OSError:
            pass
    if proc.returncode != 0:
        raise StoresError(f"JWT sign failed: {(proc.stderr or b'').decode('utf-8', 'replace')[:200]}")
    sig = proc.stdout
    if alg == "ES256":
        sig = _der_ecdsa_to_jose(sig)
    return f"{signing_input}.{_b64url(sig)}"


def asc_token() -> str:
    creds = _asc_secret()
    if creds.get("token"):
        return creds["token"]
    if not apple_configured():
        raise StoresError("AppStoreConnectKey is not configured.")
    now = int(time.time())
    return sign_jwt(
        {"alg": "ES256", "kid": creds["keyId"], "typ": "JWT"},
        {"iss": creds["issuerId"], "iat": now, "exp": now + 20 * 60, "aud": "appstoreconnect-v1"},
        creds["privateKey"],
    )


def play_access_token() -> str:
    global _play_token
    creds = _play_secret()
    if creds.get("token"):
        return creds["token"]
    if _play_token and _play_token[1] > time.time() + 30:
        return _play_token[0]
    if not play_configured():
        raise StoresError("GooglePlayServiceAccount is not configured.")
    now = int(time.time())
    assertion = sign_jwt(
        {"alg": "RS256", "typ": "JWT"},
        {
            "iss": creds["clientEmail"],
            "scope": PLAY_SCOPES,
            "aud": PLAY_TOKEN_URL,
            "iat": now,
            "exp": now + 3600,
        },
        creds["privateKey"],
    )
    data = http_json(
        "POST",
        PLAY_TOKEN_URL,
        form={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        },
    )
    token = str(data.get("access_token") or "")
    if not token:
        raise StoresError("Google did not return an access_token")
    expires = now + int(data.get("expires_in") or 3600)
    _play_token = (token, float(expires))
    return token


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _urlopen(req: urlrequest.Request, timeout: float | None = None) -> Any:
    return urlrequest.urlopen(req, timeout=timeout or HTTP_TIMEOUT_SECONDS)


def http_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    form: dict[str, str] | None = None,
) -> dict[str, Any]:
    hdrs = dict(headers or {})
    data: bytes | None = None
    if form is not None:
        data = urlparse.urlencode(form).encode()
        hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded")
    elif body is not None:
        data = json.dumps(body).encode()
        hdrs.setdefault("Content-Type", "application/json")
    req = urlrequest.Request(url, data=data, headers=hdrs, method=method)
    try:
        with _urlopen(req) as resp:
            raw = resp.read()
    except urlerror.HTTPError as exc:
        err = exc.read().decode("utf-8", "replace")[:300]
        raise StoresError(f"{method} {url.split('?', 1)[0]} failed ({exc.code}): {err}") from exc
    except urlerror.URLError as exc:
        raise StoresError(f"{method} {url.split('?', 1)[0]} failed: {exc.reason}") from exc
    if not raw:
        return {}
    try:
        parsed = json.loads(raw.decode())
    except json.JSONDecodeError as exc:
        raise StoresError("store API returned non-JSON") from exc
    if isinstance(parsed, dict):
        return parsed
    return {"data": parsed}


def asc(method: str, path: str, *, params: dict[str, Any] | None = None, body: dict[str, Any] | None = None) -> dict[str, Any]:
    url = ASC_ORIGIN + path
    if params:
        url += "?" + urlparse.urlencode({k: v for k, v in params.items() if v is not None})
    return http_json(
        method,
        url,
        headers={"Authorization": f"Bearer {asc_token()}", "Accept": "application/json"},
        body=body,
    )


def play(method: str, path: str, *, params: dict[str, Any] | None = None, body: dict[str, Any] | None = None) -> dict[str, Any]:
    url = (PLAY_ORIGIN if path.startswith("/androidpublisher") else PLAY_REPORTING_ORIGIN) + path
    if params:
        url += "?" + urlparse.urlencode({k: v for k, v in params.items() if v is not None})
    return http_json(
        method,
        url,
        headers={"Authorization": f"Bearer {play_access_token()}", "Accept": "application/json"},
        body=body,
    )


def _mask(text: str) -> str:
    return board_pii.EMAIL_RE.sub("contact#hidden", board_pii.PHONE_RE.sub("phone#hidden", text or ""))


def _limit(args: dict[str, Any]) -> int:
    try:
        n = int(args.get("limit") or 10)
    except (TypeError, ValueError):
        n = 10
    return max(1, min(n, BOARD_STORES_LIST_MAX))


def _want_store(args: dict[str, Any], name: str) -> bool:
    store = str(args.get("store") or "both").strip().lower()
    return store in ("", "both", name, "apple" if name == "apple" else name)


def _cached(table: Any, name: str) -> dict[str, Any] | None:
    hit = board_store.get_cache(table, name)
    if not hit:
        return None
    payload = hit.get("payload")
    if not isinstance(payload, dict):
        return None
    return {**payload, "cached": True, "fetchedAt": hit.get("fetchedAt")}


def _store(table: Any, name: str, payload: dict[str, Any]) -> dict[str, Any]:
    doc = board_store.put_cache(
        table,
        name,
        payload,
        ttl_seconds=BOARD_STORES_CACHE_TTL_HOURS * 3600,
    )
    return {**payload, "cached": False, "fetchedAt": doc.get("fetchedAt")}


def _read(table: Any, name: str, fetcher: Any) -> dict[str, Any]:
    cached = _cached(table, name)
    if cached:
        return cached
    return _store(table, name, fetcher())


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def fetch_asc_metrics() -> dict[str, Any]:
    app_id = apple_app_id()
    if not app_id:
        raise StoresError("APP_STORE_CONNECT_APP_ID is not set.")
    app = asc("GET", f"/v1/apps/{app_id}", params={"fields[apps]": "name,bundleId"})
    attrs = (app.get("data") or {}).get("attributes") or {}
    versions = asc("GET", f"/v1/apps/{app_id}/appStoreVersions", params={"limit": "1"})
    ver_rows = versions.get("data") or []
    ver_attrs = (ver_rows[0].get("attributes") or {}) if ver_rows else {}
    reviews = list_asc_reviews(BOARD_STORES_LIST_MAX)
    ratings = [int(r["rating"]) for r in reviews if r.get("rating") is not None]
    avg = round(sum(ratings) / len(ratings), 2) if ratings else None
    downloads: Any = None
    try:
        sales = asc(
            "GET",
            "/v1/salesReports",
            params={"filter[frequency]": "DAILY", "filter[reportType]": "SALES", "filter[reportSubType]": "SUMMARY"},
        )
        downloads = {"available": True, "note": "salesReports requested", "keys": list(sales.keys())[:6]}
    except StoresError as exc:
        downloads = {"available": False, "note": str(exc)[:160]}
    return {
        "store": "apple",
        "appId": app_id,
        "name": attrs.get("name"),
        "bundleId": attrs.get("bundleId"),
        "latestVersion": ver_attrs.get("versionString"),
        "versionState": ver_attrs.get("appStoreState"),
        "averageRating": avg,
        "reviewCount": len(reviews),
        "downloads": downloads,
        "installs": downloads,
    }


def fetch_play_metrics() -> dict[str, Any]:
    package = play_package()
    if not package:
        raise StoresError("GOOGLE_PLAY_PACKAGE_NAME is not set.")
    reviews = list_play_reviews(BOARD_STORES_LIST_MAX)
    ratings = [int(r["rating"]) for r in reviews if r.get("rating") is not None]
    avg = round(sum(ratings) / len(ratings), 2) if ratings else None
    installs: Any = None
    try:
        data = play(
            "POST",
            f"/v1beta1/apps/{package}/errorCountMetricSet:query",
            body={"timelineSpec": {"aggregationPeriod": "DAILY"}},
        )
        installs = {"available": True, "reporting": "errorCountMetricSet", "keys": list(data.keys())[:6]}
    except StoresError as exc:
        installs = {"available": False, "note": str(exc)[:160]}
    return {
        "store": "play",
        "packageName": package,
        "averageRating": avg,
        "reviewCount": len(reviews),
        "downloads": installs,
        "installs": installs,
    }


def fetch_metrics() -> dict[str, Any]:
    apple: dict[str, Any] = {}
    google: dict[str, Any] = {}
    if apple_configured():
        try:
            apple = fetch_asc_metrics()
        except StoresError as exc:
            apple = {"error": str(exc)[:200]}
    if play_configured():
        try:
            google = fetch_play_metrics()
        except StoresError as exc:
            google = {"error": str(exc)[:200]}
    if not apple and not google:
        raise StoresError("Neither App Store Connect nor Google Play is configured.")
    return {"apple": apple, "play": google}


def fetch_crashes() -> dict[str, Any]:
    apple: dict[str, Any] = {}
    google: dict[str, Any] = {}
    if apple_configured() and apple_app_id():
        try:
            data = asc(
                "GET",
                f"/v1/apps/{apple_app_id()}/perfPowerMetrics",
                params={"filter[deviceTypes]": "ALL", "filter[metricTypes]": "HANG"},
            )
            apple = {"count": len(data.get("data") or data.get("productData") or []), "rawKeys": list(data.keys())[:8]}
        except StoresError as exc:
            apple = {"error": str(exc)[:200]}
    if play_configured() and play_package():
        try:
            data = play(
                "POST",
                f"/v1beta1/apps/{play_package()}/crashRateMetricSet:query",
                body={"timelineSpec": {"aggregationPeriod": "DAILY"}},
            )
            google = {"keys": list(data.keys())[:8], "rows": (data.get("rows") or [])[:5]}
        except StoresError as exc:
            google = {"error": str(exc)[:200]}
    return {"apple": apple, "play": google}


def fetch_ratings() -> dict[str, Any]:
    metrics = fetch_metrics()
    apple = metrics.get("apple") or {}
    google = metrics.get("play") or {}
    return {
        "apple": {"averageRating": apple.get("averageRating"), "reviewCount": apple.get("reviewCount")},
        "play": {"averageRating": google.get("averageRating"), "reviewCount": google.get("reviewCount")},
    }


def list_asc_reviews(limit: int) -> list[dict[str, Any]]:
    app_id = apple_app_id()
    if not app_id:
        return []
    data = asc(
        "GET",
        f"/v1/apps/{app_id}/customerReviews",
        params={"limit": str(limit), "include": "response", "sort": "-createdDate"},
    )
    out: list[dict[str, Any]] = []
    for row in data.get("data") or []:
        attrs = row.get("attributes") or {}
        body = _mask(str(attrs.get("body") or ""))
        out.append(
            {
                "store": "apple",
                "reviewId": row.get("id"),
                "rating": attrs.get("rating"),
                "title": _mask(str(attrs.get("title") or "")),
                "body": body,
                "reviewer": _mask(str(attrs.get("reviewerNickname") or "")),
                "createdAt": attrs.get("createdDate"),
                "territory": attrs.get("territory"),
                "responseState": "replied" if (row.get("relationships") or {}).get("response") else "unreplied",
            }
        )
    return out


def list_play_reviews(limit: int) -> list[dict[str, Any]]:
    package = play_package()
    if not package:
        return []
    data = play(
        "GET",
        f"/androidpublisher/v3/applications/{package}/reviews",
        params={"maxResults": str(limit)},
    )
    out: list[dict[str, Any]] = []
    for row in data.get("reviews") or []:
        comments = row.get("comments") or []
        user = next((c.get("userComment") or {} for c in comments if c.get("userComment")), {})
        dev = next((c.get("developerComment") or {} for c in comments if c.get("developerComment")), None)
        out.append(
            {
                "store": "play",
                "reviewId": row.get("reviewId"),
                "rating": user.get("starRating"),
                "title": "",
                "body": _mask(str(user.get("text") or "")),
                "reviewer": _mask(str(row.get("authorName") or "")),
                "createdAt": ((user.get("lastModified") or {}).get("seconds")),
                "territory": row.get("reviewerLanguage"),
                "responseState": "replied" if dev else "unreplied",
            }
        )
    return out


def refresh_caches(table: Any) -> dict[str, str]:
    notes: dict[str, str] = {}
    if not configured():
        return {"stores:metrics": "skipped"}
    for name, fn in (
        (METRICS_CACHE, fetch_metrics),
        (CRASHES_CACHE, fetch_crashes),
        (RATINGS_CACHE, fetch_ratings),
    ):
        try:
            _store(table, name, fn())
            notes[name] = "ok"
        except StoresError as exc:
            notes[name] = str(exc)[:200]
            _log_event("warning", tag="board_stores_refresh_failed", key=name, error=str(exc)[:200])
    return notes


def op_metrics(ctx: Any, _args: dict[str, Any]) -> dict[str, Any]:
    if not configured():
        raise StoresError("App Store Connect and Google Play secrets are not configured.")
    return _read(ctx.table, METRICS_CACHE, fetch_metrics)


def op_crashes(ctx: Any, _args: dict[str, Any]) -> dict[str, Any]:
    if not configured():
        raise StoresError("App Store Connect and Google Play secrets are not configured.")
    return _read(ctx.table, CRASHES_CACHE, fetch_crashes)


def op_ratings(ctx: Any, _args: dict[str, Any]) -> dict[str, Any]:
    if not configured():
        raise StoresError("App Store Connect and Google Play secrets are not configured.")
    return _read(ctx.table, RATINGS_CACHE, fetch_ratings)


def op_list_reviews(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    if not configured():
        raise StoresError("App Store Connect and Google Play secrets are not configured.")
    limit = _limit(args)
    reviews: list[dict[str, Any]] = []
    if _want_store(args, "apple") and apple_configured():
        reviews.extend(list_asc_reviews(limit))
    if _want_store(args, "play") and play_configured():
        reviews.extend(list_play_reviews(limit))
    reviews = reviews[:limit]
    return {"reviews": reviews, "count": len(reviews)}


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def op_reply_review(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    store = str(args.get("store") or "").strip().lower()
    review_id = str(args.get("reviewId") or "").strip()
    message = str(args.get("message") or "").strip()
    if store not in ("apple", "play") or not review_id or not message:
        raise StoresError("store (apple|play), reviewId and message are required")
    if store == "apple":
        data = asc(
            "POST",
            "/v1/customerReviewResponses",
            body={
                "data": {
                    "type": "customerReviewResponses",
                    "attributes": {"responseBody": message},
                    "relationships": {"review": {"data": {"type": "customerReviews", "id": review_id}}},
                }
            },
        )
        return {"ok": True, "store": "apple", "reviewId": review_id, "responseId": (data.get("data") or {}).get("id")}
    package = play_package()
    if not package:
        raise StoresError("GOOGLE_PLAY_PACKAGE_NAME is not set.")
    data = play(
        "POST",
        f"/androidpublisher/v3/applications/{package}/reviews/{review_id}:reply",
        body={"replyText": message},
    )
    return {"ok": True, "store": "play", "reviewId": review_id, "result": data.get("result") or data}


def op_draft_release_notes(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    store = str(args.get("store") or "both").strip().lower()
    notes = str(args.get("notes") or "").strip()
    version = str(args.get("version") or "").strip()
    locale = str(args.get("locale") or "en-GB").strip()
    reason = str(args.get("reason") or "").strip()
    if not notes:
        raise StoresError("notes are required")
    now = _utc_iso_z(datetime.now(timezone.utc))
    title = f"Release notes draft ({store} {version or 'next'})".strip()
    doc = {
        "actionId": board_store.new_id(),
        "title": title[:200],
        "detail": f"{notes}\n\n{reason}"[:800],
        "persona": getattr(ctx, "persona_id", "") or "cmo",
        "priority": "next",
        "effort": "S",
        "metric": "Release notes approved",
        "dependsOn": [],
        "status": "open",
        "note": "",
        "meetingId": getattr(ctx, "meeting_id", "") or "",
        "source": "tool",
        "reaffirmedByMeetingIds": [],
        "dueAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    board_store.put_action(ctx.table, doc)
    draft = {"store": store, "version": version, "locale": locale, "notes": notes, "actionId": doc["actionId"]}
    if ctx.table is not None:
        board_store.put_cache(ctx.table, "stores:release_notes_draft", draft, ttl_seconds=BOARD_STORES_CACHE_TTL_HOURS * 3600)
    return {"ok": True, "drafted": True, "published": False, **draft}


def act_guard_release_notes(_ctx: Any, _args: dict[str, Any]) -> str | None:
    return "release notes stay in Approvals; they are never published automatically"


def owner_preview_message(_ctx: Any, args: dict[str, Any], *, op: str) -> dict[str, Any]:
    store = str(args.get("store") or "")
    review_id = str(args.get("reviewId") or "")
    return {
        "kind": "stores",
        "from": store or "stores",
        "to": [review_id] if review_id else [],
        "cc": [],
        "subject": op,
        "text": str(args.get("message") or args.get("notes") or args.get("reason") or ""),
        "threadId": review_id,
        "sendEnabled": configured(),
    }


def digest_for_context(table: Any) -> dict[str, Any]:
    if table is None:
        return {}
    hit = _cached(table, METRICS_CACHE)
    if not hit:
        return {}
    apple = hit.get("apple") or {}
    google = hit.get("play") or {}
    return {
        "appleRating": apple.get("averageRating"),
        "playRating": google.get("averageRating"),
        "appleReviews": apple.get("reviewCount"),
        "playReviews": google.get("reviewCount"),
        "fetchedAt": hit.get("fetchedAt"),
    }
