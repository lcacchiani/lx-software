"""Passwordless Cognito custom auth helpers."""

from __future__ import annotations

import logging
import os
import secrets
import string
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import boto3

logger = logging.getLogger(__name__)


def _build_login_link(base_url: str, email: str, code: str) -> Optional[str]:
    if not base_url:
        return None
    parsed = urlparse(base_url)
    query = dict(parse_qsl(parsed.query))
    query.update({"email": email, "code": code})
    return urlunparse(parsed._replace(query=urlencode(query)))


def _generate_code(length: int = 6) -> str:
    # Use cryptographically secure random for OTP generation
    digits = string.digits
    return "".join(secrets.choice(digits) for _ in range(length))


def send_sign_in_email(email: str, code: str) -> None:
    from_address = os.getenv("SES_FROM_ADDRESS", "")
    if not from_address:
        logger.warning("SES_FROM_ADDRESS not set; skipping email send.")
        return

    base_url = os.getenv("LOGIN_LINK_BASE_URL", "")
    login_link = _build_login_link(base_url, email, code)

    subject = "Your Siu Tin Dei sign-in link"
    lines = [
        "Use the code below to finish signing in:",
        "",
        code,
    ]
    if login_link:
        lines.extend(
            [
                "",
                "Or tap this link to continue:",
                login_link,
            ]
        )
    lines.append("")
    lines.append("If you did not request this, you can ignore this email.")

    boto3.client("ses").send_email(
        Source=from_address,
        Destination={"ToAddresses": [email]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {"Text": {"Data": "\n".join(lines), "Charset": "UTF-8"}},
        },
    )


def build_challenge(code_length: int = 6) -> dict:
    code = _generate_code(length=code_length)
    return {"code": code}
