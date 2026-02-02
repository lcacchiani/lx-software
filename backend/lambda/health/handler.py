"""Lambda entrypoint for health check endpoint."""

from __future__ import annotations

from typing import Any
from typing import Mapping

from app.api.health import lambda_handler as _handler


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Delegate to health check handler."""
    return _handler(dict(event), context)
