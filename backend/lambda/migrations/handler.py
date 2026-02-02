"""Lambda handler to run Alembic migrations and seed data.

SECURITY NOTES:
- Database credentials are never logged
- Only safe connection metadata (host, port, database name) is logged
- Uses structured logging for CloudWatch integration
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any
from typing import Mapping
from urllib.parse import urlparse

import psycopg
from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url

from app.db.connection import get_database_url
from app.utils.cfn_response import send_cfn_response
from app.utils.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Handle CloudFormation custom resource events for migrations."""

    request_type = event.get("RequestType")
    physical_id = str(event.get("PhysicalResourceId") or "migrations")

    if request_type == "Delete":
        logger.info("Delete request received, skipping migrations")
        data = {"status": "skipped"}
        send_cfn_response(event, context, "SUCCESS", data, physical_id)
        return {"PhysicalResourceId": physical_id, "Data": data}

    try:
        database_url = get_database_url()

        # SECURITY: Log connection details without password for debugging
        parsed = urlparse(database_url)
        logger.info(
            f"Connecting to database: host={parsed.hostname}, port={parsed.port}, "
            f"user={parsed.username}, database={parsed.path.lstrip('/')}"
        )

        _run_with_retry(_run_migrations, database_url)

        run_seed = _truthy(event.get("ResourceProperties", {}).get("RunSeed"))
        if run_seed:
            seed_path = os.getenv(
                "SEED_FILE_PATH",
                "/var/task/db/seed/seed_data.sql",
            )
            _run_with_retry(_run_seed, database_url, seed_path)

        logger.info("Migrations completed successfully")
        data = {"status": "ok"}
        send_cfn_response(event, context, "SUCCESS", data, physical_id)
        return {"PhysicalResourceId": physical_id, "Data": data}
    except Exception:
        logger.error("Migrations failed", exc_info=True)
        data = {"status": "failed"}
        send_cfn_response(
            event,
            context,
            "FAILED",
            data,
            physical_id,
            "Migrations failed",
        )
        return {"PhysicalResourceId": physical_id, "Data": data}


def _run_migrations(database_url: str) -> None:
    """Run Alembic migrations to the latest head."""

    config = Config()
    config.set_main_option("script_location", "/var/task/db/alembic")
    config.set_main_option("sqlalchemy.url", _escape_config(database_url))
    command.upgrade(config, "head")


def _run_seed(database_url: str, seed_path: str) -> None:
    """Run seed SQL if the file exists."""

    path = Path(seed_path)
    if not path.exists():
        return

    sql = path.read_text(encoding="utf-8")
    if not sql.strip():
        return

    with _psycopg_connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql)
        connection.commit()


def _run_with_retry(func: Any, *args: Any) -> None:
    """Retry migration operations to wait for DB readiness."""

    max_attempts = 10
    delay = 5.0
    last_error: Exception | None = None
    for attempt in range(max_attempts):
        try:
            func(*args)
            return
        except Exception as exc:  # pragma: no cover - best effort retry
            error_type = type(exc).__name__
            # SECURITY: Log error type but be careful with error messages that may contain secrets
            logger.warning(
                f"Attempt {attempt + 1}/{max_attempts} failed ({error_type})",
                extra={"attempt": attempt + 1, "max_attempts": max_attempts},
            )
            last_error = exc
            if attempt < max_attempts - 1:
                logger.info(f"Retrying in {delay:.1f} seconds...")
                time.sleep(delay)
                delay = min(delay * 1.5, 30.0)  # Cap at 30 seconds
    if last_error:
        raise last_error


def _escape_config(value: str) -> str:
    """Escape percent signs for configparser interpolation."""

    return value.replace("%", "%%")


def _psycopg_connect(database_url: str) -> psycopg.Connection:
    """Connect using keyword args to avoid DSN parsing issues."""

    try:
        url = make_url(database_url)
    except Exception:
        url = make_url(f"postgresql://{database_url}")

    connect_kwargs: dict[str, Any] = {
        "user": url.username,
        "password": url.password,
        "host": url.host,
        "port": url.port,
        "dbname": url.database,
    }
    sslmode = url.query.get("sslmode")
    if sslmode:
        connect_kwargs["sslmode"] = sslmode

    return psycopg.connect(**{k: v for k, v in connect_kwargs.items() if v is not None})


def _truthy(value: Any) -> bool:
    """Return True for common truthy values."""

    if value is None:
        return False
    if isinstance(value, bool):
        return value
    return str(value).lower() in {"1", "true", "yes", "y"}
