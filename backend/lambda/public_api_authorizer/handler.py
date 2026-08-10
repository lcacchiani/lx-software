"""HTTP API Lambda authorizer for the public read-only API key routes.

Validates the ``x-api-key`` header (``lxpk_<keyId>_<secret>``) against a
scrypt digest stored in the records DynamoDB table
(``pk = APIKEY#<keyId>``, ``sk = META``). Only the digest is ever persisted
or logged; the plaintext key is shown once at mint time (see
``scripts/manage-public-api-keys.py``).

Returns the API Gateway v2 "simple" authorizer response. The authorizer
result is cached by API Gateway keyed on the ``x-api-key`` header, so the
DynamoDB lookup / scrypt verify does not run on every request.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError

from api_key_crypto import ddb_key, parse_api_key, verify_secret

API_KEY_SCOPE_READ = "read"

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_ddb = boto3.resource("dynamodb")


def _deny() -> dict[str, Any]:
    return {"isAuthorized": False}


def _log(level: str, **fields: Any) -> None:
    line = json.dumps({k: v for k, v in fields.items() if v is not None}, default=str)
    if level == "warning":
        logger.warning(line)
    else:
        logger.info(line)


def _extract_api_key(event: dict[str, Any]) -> str | None:
    # HTTP API payload 2.0 lower-cases all header names.
    headers = event.get("headers") or {}
    raw = headers.get("x-api-key")
    if not isinstance(raw, str):
        return None
    key = raw.strip()
    return key or None


def _is_expired(expires_at: Any, now: datetime) -> bool:
    """True when ``expiresAt`` holds an ISO date/datetime in the past.

    An unparseable value fails closed (treated as expired) so a corrupted
    record can never grant indefinite access.
    """
    if expires_at in (None, ""):
        return False
    try:
        parsed = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
    except ValueError:
        return True
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed <= now


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    raw_key = _extract_api_key(event)
    request_id = (event.get("requestContext") or {}).get("requestId")
    if raw_key is None:
        _log("info", tag="public_api_key_denied", reason="missing_key", request_id=request_id)
        return _deny()

    parsed = parse_api_key(raw_key)
    if parsed is None:
        _log(
            "info",
            tag="public_api_key_denied",
            reason="malformed_key",
            request_id=request_id,
        )
        return _deny()

    key_id, secret = parsed
    table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
    try:
        res = table.get_item(Key=ddb_key(key_id))
    except ClientError as exc:
        _log(
            "warning",
            tag="public_api_key_denied",
            reason="ddb_error",
            error_code=exc.response.get("Error", {}).get("Code"),
            key_id=key_id,
            request_id=request_id,
        )
        return _deny()

    item = res.get("Item")
    if not item:
        _log(
            "info",
            tag="public_api_key_denied",
            reason="unknown_key",
            key_id=key_id,
            request_id=request_id,
        )
        return _deny()

    if item.get("keyId") != key_id:
        # Defense in depth: pk and attribute must agree.
        _log(
            "info",
            tag="public_api_key_denied",
            reason="key_id_mismatch",
            key_id=key_id,
            request_id=request_id,
        )
        return _deny()

    if item.get("revoked"):
        _log(
            "info",
            tag="public_api_key_denied",
            reason="revoked",
            key_id=key_id,
            request_id=request_id,
        )
        return _deny()

    if _is_expired(item.get("expiresAt"), datetime.now(timezone.utc)):
        _log(
            "info",
            tag="public_api_key_denied",
            reason="expired",
            key_id=key_id,
            request_id=request_id,
        )
        return _deny()

    if item.get("scope") != API_KEY_SCOPE_READ:
        _log(
            "info",
            tag="public_api_key_denied",
            reason="bad_scope",
            key_id=key_id,
            request_id=request_id,
        )
        return _deny()

    if not verify_secret(secret, item.get("secretHash")):
        _log(
            "info",
            tag="public_api_key_denied",
            reason="bad_secret",
            key_id=key_id,
            request_id=request_id,
        )
        return _deny()

    _log("info", tag="public_api_key_allowed", key_id=key_id, request_id=request_id)
    return {
        "isAuthorized": True,
        "context": {
            "keyId": key_id,
            "label": item.get("label"),
            "scope": API_KEY_SCOPE_READ,
        },
    }
