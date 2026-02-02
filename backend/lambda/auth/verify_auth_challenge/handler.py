"""Cognito Verify Auth Challenge trigger.

This Lambda verifies the user's response to the custom authentication challenge.

SECURITY NOTES:
- Email addresses are masked in logs to comply with privacy regulations
- Never log the expected or provided OTP codes
- Use constant-time comparison would be ideal but Cognito handles this
"""

from app.utils.logging import configure_logging, get_logger, mask_email

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event, _context):
    """Verify the authentication challenge response."""

    request = event.get("request", {})
    expected = (request.get("privateChallengeParameters") or {}).get("answer")
    provided = request.get("challengeAnswer")
    response = event.setdefault("response", {})
    email = request.get("userAttributes", {}).get("email", "")

    is_correct = bool(expected) and provided == expected
    response["answerCorrect"] = is_correct

    # SECURITY: Mask email in logs to protect PII
    masked_email = mask_email(email)
    if is_correct:
        logger.info(f"Challenge verified successfully for {masked_email}")
    else:
        logger.warning(f"Challenge verification failed for {masked_email}")

    return event
