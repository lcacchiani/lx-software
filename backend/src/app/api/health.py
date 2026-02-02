"""Health check endpoint for monitoring and alerting.

This module provides health check functionality that can be used
by load balancers, monitoring systems, and deployment pipelines.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass
class HealthCheck:
    """Result of a single health check."""

    name: str
    healthy: bool
    latency_ms: Optional[float] = None
    error: Optional[str] = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        result: dict[str, Any] = {
            "name": self.name,
            "healthy": self.healthy,
        }
        if self.latency_ms is not None:
            result["latency_ms"] = round(self.latency_ms, 2)
        if self.error:
            result["error"] = self.error
        if self.details:
            result["details"] = self.details
        return result


@dataclass
class HealthStatus:
    """Overall health status of the service."""

    healthy: bool
    checks: list[HealthCheck]
    version: str
    environment: str

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "healthy": self.healthy,
            "version": self.version,
            "environment": self.environment,
            "checks": [check.to_dict() for check in self.checks],
        }


def check_health(include_details: bool = False) -> HealthStatus:
    """Perform all health checks and return overall status.

    Args:
        include_details: Whether to include detailed check information.

    Returns:
        HealthStatus with results of all checks.
    """
    checks = [
        _check_database(),
        _check_configuration(),
    ]

    overall_healthy = all(check.healthy for check in checks)

    return HealthStatus(
        healthy=overall_healthy,
        checks=checks if include_details else [],
        version=os.getenv("APP_VERSION", "unknown"),
        environment=os.getenv("ENVIRONMENT", "unknown"),
    )


def _check_database() -> HealthCheck:
    """Check database connectivity and response time."""
    start_time = time.perf_counter()

    try:
        from app.db.engine import get_engine

        engine = get_engine(use_cache=True)
        with Session(engine) as session:
            result = session.execute(text("SELECT 1"))
            result.fetchone()

        latency_ms = (time.perf_counter() - start_time) * 1000

        return HealthCheck(
            name="database",
            healthy=True,
            latency_ms=latency_ms,
            details={"connection": "ok"},
        )
    except Exception as e:
        latency_ms = (time.perf_counter() - start_time) * 1000
        return HealthCheck(
            name="database",
            healthy=False,
            latency_ms=latency_ms,
            error=str(e),
        )


def _check_configuration() -> HealthCheck:
    """Check that required configuration is present."""
    required_vars = [
        "DATABASE_SECRET_ARN",
        "DATABASE_NAME",
    ]

    optional_vars = [
        "DATABASE_PROXY_ENDPOINT",
        "DATABASE_IAM_AUTH",
    ]

    missing = [var for var in required_vars if not os.getenv(var)]
    present_optional = [var for var in optional_vars if os.getenv(var)]

    if missing:
        return HealthCheck(
            name="configuration",
            healthy=False,
            error=f"Missing required variables: {', '.join(missing)}",
        )

    return HealthCheck(
        name="configuration",
        healthy=True,
        details={
            "required": "all present",
            "optional_configured": present_optional,
        },
    )


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda handler for health check endpoint.

    Args:
        event: API Gateway event.
        context: Lambda context.

    Returns:
        API Gateway response with health status.
    """
    from app.utils.responses import json_response

    # Check if detailed info is requested (only for internal calls)
    include_details = (event.get("queryStringParameters", {}) or {}).get(
        "details"
    ) == "true"

    status = check_health(include_details=include_details)

    # Return 200 for healthy, 503 for unhealthy
    status_code = 200 if status.healthy else 503

    return json_response(status_code, status.to_dict())
