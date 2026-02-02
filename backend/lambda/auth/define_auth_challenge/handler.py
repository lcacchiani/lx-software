"""Cognito Define Auth Challenge trigger.

This Lambda determines whether to issue tokens, fail authentication,
or continue with a custom challenge based on the session history.
"""

import os

from app.utils.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event, _context):
    """Define the authentication challenge flow."""

    max_attempts = int(os.getenv("MAX_CHALLENGE_ATTEMPTS", "3"))
    session = event.get("request", {}).get("session", []) or []
    response = event.setdefault("response", {})
    username = (
        event.get("request", {}).get("userAttributes", {}).get("email", "unknown")
    )

    logger.debug(
        f"Define auth challenge for {username}",
        extra={"session_length": len(session), "max_attempts": max_attempts},
    )

    if session:
        last = session[-1]
        if last.get("challengeName") == "CUSTOM_CHALLENGE" and last.get(
            "challengeResult"
        ):
            logger.info(f"Auth successful for {username}")
            response["issueTokens"] = True
            response["failAuthentication"] = False
            return event

        if len(session) >= max_attempts:
            logger.warning(f"Max auth attempts reached for {username}")
            response["issueTokens"] = False
            response["failAuthentication"] = True
            return event

    logger.debug(f"Issuing custom challenge for {username}")
    response["issueTokens"] = False
    response["failAuthentication"] = False
    response["challengeName"] = "CUSTOM_CHALLENGE"
    return event
