"""Centralized database engine management.

This module provides a unified interface for creating and managing
SQLAlchemy engines with settings appropriate for Lambda execution.
"""

from __future__ import annotations

import os
from typing import Any
from typing import Optional

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

from app.db.connection import get_database_url

# Module-level engine cache for connection reuse across Lambda invocations
_ENGINE_CACHE: dict[str, Engine] = {}


def get_engine(
    use_cache: bool = True,
    pool_class: Optional[type] = None,
) -> Engine:
    """Get or create a SQLAlchemy engine.

    For IAM authentication, a new engine is always created since
    auth tokens expire. For password authentication, the engine
    is cached and reused across invocations.

    Args:
        use_cache: Whether to use the engine cache (ignored for IAM auth).
        pool_class: Override the connection pool class.

    Returns:
        A configured SQLAlchemy engine.
    """
    use_iam_auth = _use_iam_auth()

    # IAM auth tokens expire, so don't cache the engine
    if use_iam_auth:
        use_cache = False
        pool_class = NullPool

    cache_key = "default"
    if use_cache and cache_key in _ENGINE_CACHE:
        return _ENGINE_CACHE[cache_key]

    database_url = get_database_url()
    pool_settings = _get_pool_settings(use_iam_auth, pool_class)

    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        connect_args=_get_connect_args(),
        **pool_settings,
    )

    if use_cache:
        _ENGINE_CACHE[cache_key] = engine

    return engine


def clear_engine_cache() -> None:
    """Clear the engine cache.

    Useful for testing or when connection settings change.
    """
    _ENGINE_CACHE.clear()


def _use_iam_auth() -> bool:
    """Return True if IAM authentication is enabled."""
    return str(os.getenv("DATABASE_IAM_AUTH", "")).lower() in {"1", "true", "yes"}


def _get_connect_args() -> dict[str, str]:
    """Return connection arguments for the database driver."""
    sslmode = os.getenv("DATABASE_SSLMODE", "require")
    return {"sslmode": sslmode}


def _get_pool_settings(
    use_iam_auth: bool,
    pool_class: Optional[type],
) -> dict[str, Any]:
    """Return connection pool settings tuned for Lambda.

    For IAM auth or when NullPool is specified, disable pooling.
    Otherwise, use minimal pool settings suitable for Lambda's
    execution model.

    Args:
        use_iam_auth: Whether IAM authentication is being used.
        pool_class: Optional pool class override.

    Returns:
        Dictionary of pool configuration options.
    """
    if use_iam_auth or pool_class == NullPool:
        return {"poolclass": NullPool}

    return {
        "pool_size": int(os.getenv("DB_POOL_SIZE", "1")),
        "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "0")),
        "pool_recycle": int(os.getenv("DB_POOL_RECYCLE", "300")),
        "pool_timeout": int(os.getenv("DB_POOL_TIMEOUT", "30")),
    }
