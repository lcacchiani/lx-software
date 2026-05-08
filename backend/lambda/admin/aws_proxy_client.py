"""Invoke the out-of-VPC AWS/HTTP proxy Lambda from in-VPC handler code.

Set ``AWS_PROXY_FUNCTION_ARN`` on the caller Lambda (CDK wires this). Uses the
VPC Lambda endpoint — no public internet required on the caller.
"""

from __future__ import annotations

import json
import os
from typing import Any

import boto3

_lambda_client: Any = None


def _client():
    global _lambda_client
    if _lambda_client is None:
        _lambda_client = boto3.client("lambda")
    return _lambda_client


def _proxy_arn() -> str:
    arn = (os.environ.get("AWS_PROXY_FUNCTION_ARN") or "").strip()
    if not arn:
        raise RuntimeError("AWS_PROXY_FUNCTION_ARN is not configured")
    return arn


def _invoke(payload: dict[str, Any]) -> dict[str, Any]:
    resp = _client().invoke(
        FunctionName=_proxy_arn(),
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode(),
    )
    raw = resp["Payload"].read()
    body = json.loads(raw)
    if resp.get("FunctionError"):
        raise RuntimeError(str(body))
    err = body.get("error")
    if err:
        raise RuntimeError(f"{err.get('code')}: {err.get('message')}")
    return body.get("result", {})


def aws_via_proxy(service: str, action: str, params: dict[str, Any]) -> dict[str, Any]:
    """Run an allow-listed boto3 call via the proxy (snake_case ``action``)."""
    return _invoke(
        {"type": "aws", "service": service, "action": action, "params": params}
    )


def http_via_proxy(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: str | None = None,
    timeout: int = 10,
) -> dict[str, Any]:
    """GET/POST to an allow-listed HTTPS URL via the proxy."""
    return _invoke(
        {
            "type": "http",
            "method": method,
            "url": url,
            "headers": headers or {},
            "body": body,
            "timeout": timeout,
        }
    )
