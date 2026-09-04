"""RDS Data API client for the siutindei Aurora cluster.

Used by ``board_receivables`` and ``board_product``. No VPC: IAM auth against
the cluster ARN + DB secret imported as stack parameters. When those are
blank the board tools return a clear "not configured" error.
"""

from __future__ import annotations

import os
from typing import Any, Callable

import boto3
from botocore.exceptions import ClientError

from http_common import _log_event

_executor: Callable[[str, list[dict[str, Any]] | None], list[dict[str, Any]]] | None = None


class DataApiError(RuntimeError):
    """User-facing Data API failure."""


def configured() -> bool:
    return bool(
        (os.environ.get("SIUTINDEI_CLUSTER_ARN") or "").strip()
        and (os.environ.get("SIUTINDEI_DB_SECRET_ARN") or "").strip()
    )


def cluster_arn() -> str:
    return (os.environ.get("SIUTINDEI_CLUSTER_ARN") or "").strip()


def secret_arn() -> str:
    return (os.environ.get("SIUTINDEI_DB_SECRET_ARN") or "").strip()


def database_name() -> str:
    return (os.environ.get("SIUTINDEI_DB_NAME") or "siutindei").strip() or "siutindei"


def set_executor_for_tests(fn: Callable[[str, list[dict[str, Any]] | None], list[dict[str, Any]]] | None) -> None:
    global _executor
    _executor = fn


def _param(name: str, value: Any) -> dict[str, Any]:
    if value is None:
        return {"name": name, "value": {"isNull": True}}
    if isinstance(value, bool):
        return {"name": name, "value": {"booleanValue": value}}
    if isinstance(value, int) and not isinstance(value, bool):
        return {"name": name, "value": {"longValue": value}}
    if isinstance(value, float):
        return {"name": name, "value": {"doubleValue": value}}
    return {"name": name, "value": {"stringValue": str(value)}}


def params(**kwargs: Any) -> list[dict[str, Any]]:
    return [_param(k, v) for k, v in kwargs.items()]


def _unwrap_field(field: dict[str, Any]) -> Any:
    if "isNull" in field:
        return None
    for key in ("stringValue", "longValue", "doubleValue", "booleanValue", "uuidValue"):
        if key in field:
            return field[key]
    return None


def _rows_from_rds(resp: dict[str, Any]) -> list[dict[str, Any]]:
    meta = resp.get("columnMetadata") or []
    names = [str(c.get("name") or f"c{i}") for i, c in enumerate(meta)]
    out: list[dict[str, Any]] = []
    for record in resp.get("records") or []:
        row: dict[str, Any] = {}
        for i, field in enumerate(record):
            name = names[i] if i < len(names) else f"c{i}"
            row[name] = _unwrap_field(field) if isinstance(field, dict) else field
        out.append(row)
    return out


def execute(sql: str, parameters: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    if _executor is not None:
        return _executor(sql, parameters)
    if not configured():
        raise DataApiError(
            "siutindei Data API is not configured. Set SiutindeiClusterArn and "
            "SiutindeiDbSecretArn and apply scripts/siutindei/receivables.sql."
        )
    client = boto3.client("rds-data")
    kwargs: dict[str, Any] = {
        "resourceArn": cluster_arn(),
        "secretArn": secret_arn(),
        "database": database_name(),
        "sql": sql,
        "includeResultMetadata": True,
    }
    if parameters:
        kwargs["parameters"] = parameters
    try:
        resp = client.execute_statement(**kwargs)
    except ClientError as exc:
        raise DataApiError(f"Data API: {exc.response.get('Error', {}).get('Message', exc)}") from exc
    rows = _rows_from_rds(resp)
    _log_event("info", tag="board_data_api", rows=len(rows))
    return rows
