"""Lambda entrypoint for activity search."""

from __future__ import annotations

from typing import Any
from typing import Mapping

from app.api.activities_search import lambda_handler as _handler


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Delegate to the activity search handler."""

    return _handler(event, context)
