"""Lambda entrypoint for admin CRUD APIs."""

from __future__ import annotations

from typing import Any
from typing import Mapping

from app.api.admin import lambda_handler as _handler


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Delegate to admin CRUD handler."""

    return _handler(event, context)
