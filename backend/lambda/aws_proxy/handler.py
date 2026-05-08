"""Allow-listed AWS API and HTTP proxy for Lambdas that run inside a private VPC.

Runs **outside** the VPC so callers can reach public AWS endpoints (for example
Cognito control-plane APIs) and external HTTPS URLs without a NAT gateway.

Invoke synchronously with payload::

    {"type": "aws", "service": "cognito-idp", "action": "list_users", "params": {...}}

or::

    {"type": "http", "method": "GET", "url": "https://...", ...}

Environment:
    ALLOWED_ACTIONS    Comma-separated ``service:action`` keys (see boto3 snake_case names).
    ALLOWED_HTTP_URLS  Comma-separated URL prefixes for outbound HTTP.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlparse

import boto3
from botocore.exceptions import ClientError

_ALLOWED_ACTIONS: set[str] | None = None
_ALLOWED_HTTP_URLS: list[str] | None = None
_HTTP_PROXY_USER_AGENT = "LXSoftwareAwsProxy/1.0"


def _allowed_actions() -> set[str]:
    global _ALLOWED_ACTIONS
    if _ALLOWED_ACTIONS is None:
        raw = os.getenv("ALLOWED_ACTIONS", "")
        _ALLOWED_ACTIONS = {a.strip() for a in raw.split(",") if a.strip()}
    return _ALLOWED_ACTIONS


def _allowed_http_prefixes() -> list[str]:
    global _ALLOWED_HTTP_URLS
    if _ALLOWED_HTTP_URLS is None:
        raw = os.getenv("ALLOWED_HTTP_URLS", "")
        _ALLOWED_HTTP_URLS = [u.strip() for u in raw.split(",") if u.strip()]
    return _ALLOWED_HTTP_URLS


def lambda_handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    req_type = event.get("type", "aws")
    if req_type == "http":
        return _handle_http(event)
    return _handle_aws(event)


def _handle_aws(event: Mapping[str, Any]) -> dict[str, Any]:
    service = str(event.get("service") or "")
    action = str(event.get("action") or "")
    params: dict[str, Any] = dict(event.get("params") or {})

    key = f"{service}:{action}"
    if key not in _allowed_actions():
        return {
            "error": {
                "code": "ActionNotAllowed",
                "message": f"{key} is not in the proxy allow-list",
            },
        }

    try:
        client = boto3.client(service)
        method = getattr(client, action, None)
        if method is None or not callable(method):
            return {
                "error": {
                    "code": "InvalidAction",
                    "message": f"{action} is not a valid method on {service}",
                },
            }
        result = method(**params)
        if isinstance(result, dict):
            result.pop("ResponseMetadata", None)
        return {"result": json.loads(json.dumps(result, default=str))}
    except ClientError as exc:
        err = exc.response.get("Error", {}) if exc.response else {}
        code = err.get("Code", type(exc).__name__)
        message = err.get("Message", str(exc))
        return {"error": {"code": code, "message": message}}
    except Exception as exc:
        return {"error": {"code": type(exc).__name__, "message": str(exc)}}


def _handle_http(event: Mapping[str, Any]) -> dict[str, Any]:
    import urllib.error
    import urllib.request

    method = (event.get("method") or "GET").upper()
    url = str(event.get("url") or "")
    headers: dict[str, str] = dict(event.get("headers") or {})
    body = event.get("body")
    timeout = min(int(event.get("timeout") or 10), 30)

    if not any(k.lower() == "user-agent" for k in headers):
        headers["User-Agent"] = _HTTP_PROXY_USER_AGENT

    if not url:
        return {"error": {"code": "MissingURL", "message": "url is required"}}

    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http"):
        return {
            "error": {
                "code": "InvalidURL",
                "message": "Only http and https URLs are allowed",
            },
        }

    prefixes = _allowed_http_prefixes()
    if not prefixes or not any(url.startswith(prefix) for prefix in prefixes):
        return {
            "error": {
                "code": "URLNotAllowed",
                "message": "URL is not in the proxy allow-list",
            },
        }

    try:
        encoded_body = body.encode("utf-8") if isinstance(body, str) else body
        req = urllib.request.Request(
            url,
            data=encoded_body if encoded_body else None,
            headers=headers,
            method=method,
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp_body = resp.read().decode("utf-8", errors="replace")
            resp_headers = (
                dict(resp.headers.items()) if hasattr(resp, "headers") else {}
            )
            return {
                "result": {
                    "status": resp.status,
                    "headers": resp_headers,
                    "body": resp_body,
                },
            }
    except urllib.error.HTTPError as exc:
        resp_body = ""
        try:
            resp_body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            resp_body = ""
        hdrs = dict(exc.headers.items()) if exc.headers else {}
        return {
            "result": {"status": exc.code, "headers": hdrs, "body": resp_body},
        }
    except Exception as exc:
        return {"error": {"code": type(exc).__name__, "message": str(exc)}}
