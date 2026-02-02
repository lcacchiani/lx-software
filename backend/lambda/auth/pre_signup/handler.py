"""Cognito Pre Sign-up trigger.

This Lambda handles pre-signup validation and auto-confirmation.

SECURITY NOTES:
- Email addresses are masked in logs to comply with privacy regulations
- Never log passwords or sensitive user data
"""

from app.utils.logging import configure_logging, get_logger, mask_email

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event, _context):
    """Handle pre-signup trigger."""

    request = event.get("request", {})
    response = event.setdefault("response", {})
    user_attributes = request.get("userAttributes", {})
    email = user_attributes.get("email", "")

    # SECURITY: Mask email in logs to protect PII
    logger.info(f"Pre-signup for {mask_email(email)}")

    # Auto-confirm the user (we verify via custom auth challenge)
    response["autoConfirmUser"] = True
    response["autoVerifyEmail"] = True

    return event
