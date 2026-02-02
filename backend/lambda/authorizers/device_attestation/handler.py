"""API Gateway request authorizer for device attestation.

This Lambda validates device attestation tokens for mobile API requests,
ensuring only legitimate app instances can access the API.

SECURITY NOTES:
- In production, ATTESTATION_FAIL_CLOSED should be "true" to deny requests
  when attestation is not configured.
- Setting ATTESTATION_FAIL_CLOSED to "false" is only for development/testing.
"""

from __future__ import annotations

import os
from typing import Any, Dict

from app.auth.attestation import is_attestation_enabled, verify_attestation_token
from app.utils.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


def _is_fail_closed() -> bool:
    """Return True if fail-closed mode is enabled (production default)."""
    return os.getenv("ATTESTATION_FAIL_CLOSED", "true").lower() in {"1", "true", "yes"}


def _get_header(headers: Dict[str, Any], name: str) -> str:
    """Get a header value case-insensitively."""

    for key, value in headers.items():
        if key.lower() == name.lower():
            return str(value)
    return ""


def _policy(
    effect: str,
    method_arn: str,
    principal_id: str,
    context: Dict[str, Any],
) -> Dict[str, Any]:
    """Build an IAM policy document for API Gateway."""

    return {
        "principalId": principal_id,
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": "execute-api:Invoke",
                    "Effect": effect,
                    "Resource": method_arn,
                }
            ],
        },
        "context": context,
    }


def lambda_handler(event, _context):
    """Authorize requests based on device attestation token."""

    headers = event.get("headers") or {}
    method_arn = event.get("methodArn", "")
    token = _get_header(headers, "x-device-attestation")

    # SECURITY: Check if attestation is configured
    if not is_attestation_enabled():
        if _is_fail_closed():
            # Production mode: Deny all requests when attestation is not configured
            logger.warning(
                "Device attestation not configured but fail-closed mode is enabled. "
                "Denying request. Configure ATTESTATION_JWKS_URL or set "
                "ATTESTATION_FAIL_CLOSED=false for development."
            )
            return _policy(
                "Deny",
                method_arn,
                "unconfigured",
                {"reason": "attestation_not_configured"},
            )
        else:
            # Development mode: Allow requests without attestation (explicit opt-in)
            logger.info(
                "Device attestation disabled (development mode), allowing request"
            )
            return _policy(
                "Allow", method_arn, "bypass", {"bypass": "true", "mode": "development"}
            )

    # Require token when attestation is enabled
    if not token:
        logger.warning("Missing device attestation token")
        return _policy("Deny", method_arn, "anonymous", {"reason": "missing_token"})

    try:
        decoded = verify_attestation_token(token)

        # Handle bypass mode (for testing) - only works when attestation returns bypass
        if decoded.get("bypass"):
            logger.info("Device attestation bypassed via token")
            return _policy("Allow", method_arn, "bypass", {"bypass": "true"})

        principal = decoded.get("sub", "device")
        logger.info(f"Device attestation verified for principal: {principal[:8]}***")
        return _policy("Allow", method_arn, principal, {"attested": "true"})

    except Exception as exc:
        # SECURITY: Don't expose detailed error messages to clients
        logger.warning(f"Device attestation failed: {type(exc).__name__}")
        return _policy("Deny", method_arn, "invalid", {"reason": "verification_failed"})
