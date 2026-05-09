"""Process raw inbound email stored by SES in S3: extract PDF, parse statement.

SES receipt rules deliver matching mail to the inbound bucket; S3 invokes this
Lambda on new objects under ``hillmarton-raw/``. The first PDF attachment is
copied into the admin assets bucket and parsed with the same OpenRouter path
as ``POST /finance/hillmarton/parse-statement``.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.parse
import uuid
from email import policy
from email.parser import BytesParser
from typing import Any

import boto3

from handler import _ParseStatementError, execute_parse_statement

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3 = boto3.client("s3")

INBOUND_PREFIX = "hillmarton-raw/"


def _sanitize_filename(name: str) -> str:
    base = os.path.basename((name or "").strip() or "statement.pdf")
    if not base.lower().endswith(".pdf"):
        base = f"{base}.pdf"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", base)[:180]
    return safe or "statement.pdf"


def extract_first_pdf_attachment(raw: bytes) -> tuple[bytes, str] | None:
    """Return ``(pdf_bytes, safe_filename)`` for the first PDF part, if any."""
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        if part.get_content_type() != "application/pdf":
            continue
        payload = part.get_payload(decode=True)
        if not isinstance(payload, (bytes, bytearray)) or len(payload) == 0:
            continue
        fn = part.get_filename() or "statement.pdf"
        return bytes(payload), _sanitize_filename(fn)
    return None


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    inbound_bucket = os.environ.get("INBOUND_MAIL_BUCKET_NAME", "").strip()
    assets_bucket = os.environ.get("ASSETS_BUCKET_NAME", "").strip()
    house = os.environ.get("INBOUND_FINANCE_HOUSE", "hillmarton").strip().lower()
    user_sub = os.environ.get("INBOUND_AUDIT_USER_SUB", "inbound-email").strip()
    max_pdf = int(os.environ.get("ASSET_MAX_BYTES", str(20 * 1024 * 1024)))

    if not inbound_bucket or not assets_bucket:
        logger.error(
            json.dumps(
                {"tag": "inbound_mail_misconfigured", "reason": "missing_bucket_env"}
            )
        )
        return {"ok": False, "reason": "misconfigured"}

    request_id = getattr(context, "aws_request_id", None) or "unknown"

    for record in event.get("Records") or []:
        if record.get("eventSource") != "aws:s3":
            continue
        raw_key = urllib.parse.unquote_plus(
            record.get("s3", {}).get("object", {}).get("key", "")
        )
        src_bucket = record.get("s3", {}).get("bucket", {}).get("name", "")
        if src_bucket != inbound_bucket or not raw_key.startswith(INBOUND_PREFIX):
            logger.info(
                json.dumps(
                    {
                        "tag": "inbound_mail_skip",
                        "reason": "wrong_bucket_or_prefix",
                        "key": raw_key[:512],
                    }
                )
            )
            continue

        try:
            obj = _s3.get_object(Bucket=inbound_bucket, Key=raw_key)
            body = obj["Body"].read()
        except Exception as exc:  # noqa: BLE001 — log any S3 read failure
            logger.error(
                json.dumps(
                    {
                        "tag": "inbound_mail_read_failed",
                        "key": raw_key[:512],
                        "error": str(exc)[:500],
                    }
                )
            )
            continue

        extracted = extract_first_pdf_attachment(body)
        if extracted is None:
            logger.warning(
                json.dumps(
                    {
                        "tag": "inbound_mail_no_pdf",
                        "key": raw_key[:512],
                        "size": len(body),
                    }
                )
            )
            continue

        pdf_bytes, safe_name = extracted
        if len(pdf_bytes) > max_pdf:
            logger.warning(
                json.dumps(
                    {
                        "tag": "inbound_mail_pdf_too_large",
                        "key": raw_key[:512],
                        "bytes": len(pdf_bytes),
                        "max": max_pdf,
                    }
                )
            )
            continue

        dest_key = f"inbound/{house}/{uuid.uuid4().hex}/{safe_name}"
        try:
            _s3.put_object(
                Bucket=assets_bucket,
                Key=dest_key,
                Body=pdf_bytes,
                ContentType="application/pdf",
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                json.dumps(
                    {
                        "tag": "inbound_mail_put_asset_failed",
                        "dest": dest_key[:512],
                        "error": str(exc)[:500],
                    }
                )
            )
            continue

        stub_event: dict[str, Any] = {
            "requestContext": {"requestId": request_id},
            "inboundMail": {"rawKey": raw_key, "sourceBucket": inbound_bucket},
        }
        try:
            result = execute_parse_statement(
                house=house,
                s3_key=dest_key,
                user_sub=user_sub,
                request_id=request_id,
                event=stub_event,
            )
        except _ParseStatementError as exc:
            logger.warning(
                json.dumps(
                    {
                        "tag": "inbound_mail_parse_failed",
                        "house": house,
                        "dest": dest_key[:512],
                        "status": exc.status,
                        "message": exc.message[:500],
                    }
                )
            )
            continue

        try:
            _s3.delete_object(Bucket=inbound_bucket, Key=raw_key)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                json.dumps(
                    {
                        "tag": "inbound_mail_raw_delete_failed",
                        "key": raw_key[:512],
                        "error": str(exc)[:300],
                    }
                )
            )

        logger.info(
            json.dumps(
                {
                    "tag": "inbound_mail_parsed",
                    "house": house,
                    "dest": dest_key[:512],
                    "addedLines": result.get("addedLines"),
                }
            )
        )

    return {"ok": True}
