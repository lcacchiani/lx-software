"""Structured logging utilities for Lambda functions.

This module provides JSON-formatted logging with request context,
suitable for CloudWatch Logs Insights queries.

SECURITY NOTES:
- Use mask_email() when logging email addresses to comply with privacy regulations
- Use mask_pii() for other personally identifiable information
- Never log passwords, tokens, or secrets
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import traceback
from contextvars import ContextVar
from datetime import datetime
from datetime import timezone
from typing import Any
from typing import MutableMapping
from typing import Optional


def mask_email(email: str) -> str:
    """Mask an email address for safe logging.

    SECURITY: Email addresses are PII and should not be logged in plain text.
    This function masks the email while preserving enough info for debugging.

    Args:
        email: The email address to mask.

    Returns:
        A masked version like "jo***@***.com" or a hash for very short emails.

    Examples:
        >>> mask_email("john.doe@example.com")
        'jo***@***.com'
        >>> mask_email("a@b.co")
        'a***@***.co'
    """
    if not email or "@" not in email:
        return "***"

    local, domain = email.rsplit("@", 1)
    domain_parts = domain.rsplit(".", 1)

    # Show first 2 chars of local part (or 1 if short)
    visible_local = local[:2] if len(local) > 2 else local[:1]

    # Show TLD only
    tld = domain_parts[-1] if len(domain_parts) > 1 else ""

    return f"{visible_local}***@***.{tld}" if tld else f"{visible_local}***@***"


def mask_pii(value: str, visible_chars: int = 4) -> str:
    """Mask a PII value for safe logging.

    SECURITY: Use this for any personally identifiable information.

    Args:
        value: The value to mask.
        visible_chars: Number of characters to show at the start.

    Returns:
        A masked version showing only the first few characters.
    """
    if not value:
        return "***"
    if len(value) <= visible_chars:
        return value[0] + "***"
    return value[:visible_chars] + "***"


def hash_for_correlation(value: str) -> str:
    """Generate a short hash for log correlation without exposing PII.

    SECURITY: Use this when you need to correlate logs across requests
    without logging the actual PII value.

    Args:
        value: The value to hash (e.g., email address).

    Returns:
        A short hash suitable for log correlation.
    """
    return hashlib.sha256(value.encode()).hexdigest()[:12]


# Context variables for request tracking
request_id: ContextVar[str] = ContextVar("request_id", default="")
correlation_id: ContextVar[str] = ContextVar("correlation_id", default="")


class StructuredLogFormatter(logging.Formatter):
    """JSON formatter for structured logging.

    Produces log entries compatible with CloudWatch Logs Insights,
    including request context and exception details.
    """

    def format(self, record: logging.LogRecord) -> str:
        """Format a log record as JSON."""
        log_data: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Add request context if available
        req_id = request_id.get()
        if req_id:
            log_data["request_id"] = req_id

        corr_id = correlation_id.get()
        if corr_id:
            log_data["correlation_id"] = corr_id

        # Add source location for debug/error logs
        if record.levelno >= logging.DEBUG:
            log_data["source"] = {
                "file": record.filename,
                "line": record.lineno,
                "function": record.funcName,
            }

        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else None,
                "message": str(record.exc_info[1]) if record.exc_info[1] else None,
                "traceback": traceback.format_exception(*record.exc_info),
            }

        # Add extra fields from the record
        if hasattr(record, "extra") and isinstance(record.extra, dict):
            log_data["extra"] = record.extra

        return json.dumps(log_data, default=str)


class ContextLogger(logging.LoggerAdapter):
    """Logger adapter that automatically includes context variables."""

    def process(
        self,
        msg: str,
        kwargs: MutableMapping[str, Any],
    ) -> tuple[str, MutableMapping[str, Any]]:
        """Process log message to include extra context."""
        extra = kwargs.get("extra", {})

        # Add any context passed to the adapter
        if self.extra:
            extra.update(self.extra)

        kwargs["extra"] = extra
        return msg, kwargs


def configure_logging(level: Optional[str] = None) -> None:
    """Configure structured logging for Lambda execution.

    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR). Defaults to
               LOG_LEVEL environment variable or INFO.
    """
    log_level: str = level or os.getenv("LOG_LEVEL") or "INFO"

    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Add structured handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredLogFormatter())
    root_logger.addHandler(handler)

    # Reduce noise from libraries
    logging.getLogger("boto3").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


def get_logger(name: str, **extra: Any) -> ContextLogger:
    """Get a context-aware logger.

    Args:
        name: Logger name (typically __name__).
        **extra: Additional context to include in all log messages.

    Returns:
        A ContextLogger instance.
    """
    logger = logging.getLogger(name)
    return ContextLogger(logger, extra)


def set_request_context(
    req_id: Optional[str] = None,
    corr_id: Optional[str] = None,
) -> None:
    """Set request context for logging.

    Call this at the start of each Lambda invocation to set
    context that will be included in all log messages.

    Args:
        req_id: AWS request ID from Lambda context.
        corr_id: Correlation ID for distributed tracing.
    """
    if req_id:
        request_id.set(req_id)
    if corr_id:
        correlation_id.set(corr_id)


def clear_request_context() -> None:
    """Clear request context after Lambda invocation."""
    request_id.set("")
    correlation_id.set("")


def log_lambda_event(
    logger: ContextLogger,
    event: dict[str, Any],
    include_body: bool = False,
) -> None:
    """Log Lambda event details at DEBUG level.

    Args:
        logger: The logger to use.
        event: The Lambda event dictionary.
        include_body: Whether to include the request body (may contain PII).
    """
    log_data = {
        "http_method": event.get("httpMethod"),
        "path": event.get("path"),
        "query_params": event.get("queryStringParameters"),
    }

    if include_body and event.get("body"):
        log_data["body_length"] = len(event.get("body", ""))

    logger.debug("Lambda event received", extra={"event": log_data})


def log_response(
    logger: ContextLogger,
    status_code: int,
    duration_ms: Optional[float] = None,
) -> None:
    """Log Lambda response details.

    Args:
        logger: The logger to use.
        status_code: HTTP status code of the response.
        duration_ms: Request duration in milliseconds.
    """
    log_data: dict[str, Any] = {"status_code": status_code}
    if duration_ms is not None:
        log_data["duration_ms"] = round(duration_ms, 2)

    level = logging.INFO if status_code < 400 else logging.WARNING
    logger.log(level, "Lambda response", extra={"response": log_data})
