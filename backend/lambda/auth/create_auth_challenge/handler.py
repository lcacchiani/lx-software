"""Cognito Create Auth Challenge trigger.

This Lambda creates a custom authentication challenge by generating
an OTP code and sending it via email.

SECURITY NOTES:
- OTP codes are generated using cryptographically secure random (secrets module)
- Email addresses are masked in logs to comply with privacy regulations
- Never log OTP codes or passwords
"""

from app.auth.passwordless import build_challenge, send_sign_in_email
from app.utils.logging import configure_logging, get_logger, mask_email

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event, _context):
    """Create a custom authentication challenge."""

    request = event.get("request", {})
    response = event.setdefault("response", {})

    if request.get("challengeName") != "CUSTOM_CHALLENGE":
        return event

    user_attributes = request.get("userAttributes") or {}
    email = user_attributes.get("email", "")
    challenge = build_challenge()
    code = challenge["code"]

    # SECURITY: Mask email in logs to protect PII
    logger.info(f"Creating auth challenge for {mask_email(email)}")

    if email:
        try:
            send_sign_in_email(email, code)
            # SECURITY: Don't log success with email - already logged above
            logger.info("Challenge email sent successfully")
        except Exception as exc:
            # SECURITY: Log error type but not full details which may contain PII
            logger.error(f"Failed to send challenge email: {type(exc).__name__}")
            raise

    response["publicChallengeParameters"] = {"email": email}
    response["privateChallengeParameters"] = {"answer": code}
    response["challengeMetadata"] = "EMAIL_OTP"
    return event
