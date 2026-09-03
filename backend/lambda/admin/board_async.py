"""Executive Board: fire-and-forget self-invocation of AdminApiFn."""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from typing import Any

from admin_runtime import _get_lambda_client


def invoke_async(payload: dict[str, Any], *, fallback: Callable[[dict[str, Any]], None]) -> None:
    """Invoke this Lambda asynchronously; run ``fallback`` inline when no function name is known.

    The inline fallback keeps unit tests and local runs deterministic.
    """
    fn_name = (
        (os.environ.get("PARSE_WORKER_FUNCTION_NAME") or "").strip()
        or (os.environ.get("AWS_LAMBDA_FUNCTION_NAME") or "").strip()
    )
    if not fn_name:
        fallback(payload)
        return
    _get_lambda_client().invoke(
        FunctionName=fn_name,
        InvocationType="Event",
        Payload=json.dumps(payload).encode("utf-8"),
    )
