"""Pre Token Generation: inject admin group for allow-listed emails (federated + native)."""

from __future__ import annotations

import os
from typing import Any


def _norm_email(value: str | None) -> str:
    return (value or "").strip().lower()


def _allowlist() -> set[str]:
    raw = os.environ.get("ADMIN_EMAIL_ALLOWLIST", "")
    return {_norm_email(x) for x in raw.split(",") if _norm_email(x)}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    attrs = (event.get("request") or {}).get("userAttributes") or {}
    email = _norm_email(attrs.get("email"))
    allow = _allowlist()
    if email and email in allow:
        event.setdefault("response", {})
        event["response"]["claimsOverrideDetails"] = {
            "groupOverrideDetails": {
                "groupsToOverride": ["admin"],
                "iamRolesToOverride": [],
                "preferredRole": None,
            }
        }
    return event
