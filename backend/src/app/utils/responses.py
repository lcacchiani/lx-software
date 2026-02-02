"""Shared response utilities for Lambda handlers."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any
from typing import Optional

from pydantic import BaseModel


def json_response(
    status_code: int,
    body: Any,
    headers: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """Create a JSON API Gateway response.

    Args:
        status_code: HTTP status code.
        body: Response body (dict, Pydantic model, or dataclass).
        headers: Optional additional headers to include.

    Returns:
        API Gateway response dictionary.
    """
    response_headers = {
        "Content-Type": "application/json",
        "X-Content-Type-Options": "nosniff",
    }

    if headers:
        response_headers.update(headers)

    payload = _serialize_body(body)

    return {
        "statusCode": status_code,
        "headers": response_headers,
        "body": json.dumps(payload, default=str),
    }


def _serialize_body(body: Any) -> Any:
    """Serialize response body to JSON-compatible format.

    Args:
        body: The body to serialize.

    Returns:
        JSON-serializable representation of the body.
    """
    if isinstance(body, BaseModel):
        if hasattr(body, "model_dump"):
            return body.model_dump()
        return body.dict()

    if hasattr(body, "__dataclass_fields__"):
        return asdict(body)

    return body


def error_response(
    status_code: int,
    message: str,
    detail: Optional[str] = None,
) -> dict[str, Any]:
    """Create an error response.

    Args:
        status_code: HTTP status code.
        message: Error message.
        detail: Optional additional detail.

    Returns:
        API Gateway response dictionary.
    """
    body: dict[str, Any] = {"error": message}
    if detail:
        body["detail"] = detail

    return json_response(status_code, body)
