"""Database connection helpers for Lambda runtime."""

from __future__ import annotations

import base64
import json
import os
from typing import Any
from urllib.parse import quote_plus

import boto3

_SECRET_CACHE: dict[str, dict[str, Any]] = {}


def get_database_url() -> str:
    """Resolve the database URL from env or Secrets Manager."""

    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return database_url

    secret_arn = os.getenv("DATABASE_SECRET_ARN")
    if not secret_arn:
        raise RuntimeError("DATABASE_URL or DATABASE_SECRET_ARN is required")

    secret = _get_secret(secret_arn)
    username = (
        os.getenv("DATABASE_USERNAME") or secret.get("username") or secret.get("user")
    )
    password = secret.get("password")
    host = os.getenv("DATABASE_HOST") or secret.get("host")
    if _use_iam_auth():
        host = os.getenv("DATABASE_PROXY_ENDPOINT") or host
    port = os.getenv("DATABASE_PORT") or secret.get("port") or 5432
    database = (
        secret.get("dbname")
        or secret.get("database")
        or os.getenv("DATABASE_NAME")
        or "siutindei"
    )

    if not username or not host:
        raise RuntimeError("Secret is missing database connection fields")

    use_iam_auth = _use_iam_auth()
    if not use_iam_auth and not password:
        raise RuntimeError("Password is required for non-IAM authentication")

    if use_iam_auth:
        token = _generate_iam_token(host, int(port), str(username))
        return (
            "postgresql+psycopg://"
            f"{quote_plus(str(username))}:{quote_plus(token)}"
            f"@{host}:{port}/{database}?sslmode=require"
        )

    return (
        "postgresql+psycopg://"
        f"{quote_plus(str(username))}:{quote_plus(str(password))}"
        f"@{host}:{port}/{database}?sslmode=require"
    )


def _get_secret(secret_arn: str) -> dict[str, Any]:
    """Fetch a secret from AWS Secrets Manager."""

    if secret_arn in _SECRET_CACHE:
        return _SECRET_CACHE[secret_arn]

    client = boto3.client("secretsmanager")
    response = client.get_secret_value(SecretId=secret_arn)
    secret_str = response.get("SecretString")
    if not secret_str and response.get("SecretBinary"):
        secret_str = base64.b64decode(response["SecretBinary"]).decode("utf-8")

    if not secret_str:
        raise RuntimeError("Secret value is empty")

    secret_payload = json.loads(secret_str)
    _SECRET_CACHE[secret_arn] = secret_payload
    return secret_payload


def _use_iam_auth() -> bool:
    """Return True if IAM auth is enabled."""

    return str(os.getenv("DATABASE_IAM_AUTH", "")).lower() in {"1", "true", "yes"}


def _generate_iam_token(host: str, port: int, username: str) -> str:
    """Generate an IAM auth token for RDS Proxy."""

    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION")
    if not region:
        raise RuntimeError("AWS_REGION is required for IAM auth")

    client = boto3.client("rds", region_name=region)
    return client.generate_db_auth_token(
        DBHostname=host, Port=port, DBUsername=username
    )
