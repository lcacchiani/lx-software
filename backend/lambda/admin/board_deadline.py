"""Per-tool-call deadline shared with the HTTP clients a tool op uses.

``board_tools._invoke_op`` runs each op on a worker thread with a wall-clock
budget. Returning early to the model is not enough on its own: the worker
would keep an HTTP request open until its own timeout. The op's deadline is
therefore published in a :class:`contextvars.ContextVar` (copied into the
worker) and every ``urlopen`` in the board connectors clamps its socket
timeout to the time left, so the thread ends shortly after the op does.
"""

from __future__ import annotations

import contextvars
import time
from typing import Any

_DEADLINE: contextvars.ContextVar[float] = contextvars.ContextVar("board_tool_deadline", default=0.0)

# Never hand urllib a zero/negative timeout; a tiny floor still fails fast.
MIN_TIMEOUT_SECONDS = 0.5


def set_deadline(seconds: float) -> contextvars.Token[float]:
    """Publish a deadline ``seconds`` from now; returns a token for :func:`reset`."""
    return _DEADLINE.set(time.monotonic() + max(0.0, float(seconds)))


def reset(token: contextvars.Token[float]) -> None:
    _DEADLINE.reset(token)


def remaining(default: float | None) -> float | None:
    """Clamp ``default`` (a client's own timeout) to the time left on the current op."""
    deadline = _DEADLINE.get()
    if not deadline:
        return default
    left = deadline - time.monotonic()
    ceiling = float(default) if default else left
    return max(MIN_TIMEOUT_SECONDS, min(ceiling, left))


def bind_context(fn: Any) -> Any:
    """Wrap ``fn`` so it runs under a copy of the *caller's* context on another thread."""
    snapshot = contextvars.copy_context()

    def _run(*args: Any, **kwargs: Any) -> Any:
        return snapshot.run(fn, *args, **kwargs)

    return _run
