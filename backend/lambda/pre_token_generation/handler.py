"""Pre Token Generation: inject admin group for allow-listed emails (federated + native)."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _norm_email(value: str | None) -> str:
    return (value or "").strip().lower()


def _allowlist() -> set[str]:
    raw = os.environ.get("ADMIN_EMAIL_ALLOWLIST", "")
    return {_norm_email(x) for x in raw.split(",") if _norm_email(x)}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    attrs = (event.get("request") or {}).get("userAttributes") or {}
    email = _norm_email(attrs.get("email"))
    allow = _allowlist()
    matched = bool(email) and email in allow
    logger.info(
        json.dumps(
            {
                "tag": "pre_token_generation",
                "trigger_source": event.get("triggerSource"),
                "user_pool_id": event.get("userPoolId"),
                "username": event.get("userName"),
                "email": email,
                "email_verified": attrs.get("email_verified"),
                "allowlist_size": len(allow),
                "matched_admin": matched,
            }
        )
    )
    if matched:
        event.setdefault("response", {})
        event["response"]["claimsOverrideDetails"] = {
            "groupOverrideDetails": {
                "groupsToOverride": ["admin"],
                "iamRolesToOverride": [],
                "preferredRole": None,
            }
        }
    return event
