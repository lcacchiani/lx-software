"""Shared boto clients and admin API constants."""

from __future__ import annotations

import logging

import boto3

ADMIN_GROUP = "admin"
RECORD_PK_PREFIX = "RECORD#"
PARSE_JOB_PK_PREFIX = "PARSE_JOB#"
ALLOWED_UPLOAD_CONTENT_TYPES = frozenset({"application/pdf"})

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3 = boto3.client("s3")
_ddb = boto3.resource("dynamodb")
_secretsmanager = None
_lambda_client = None
