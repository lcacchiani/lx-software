"""Shared boto clients and admin API constants."""

from __future__ import annotations

import logging
from typing import Any

import boto3

from contract_constants import (
    ASSET_TYPES,
    DEFAULT_FINANCE_CURRENCY,
    EXPENSE_RECORD_CATEGORIES,
    FINANCE_ACCOUNT_TYPES,
    FINANCE_HOUSE_KEYS,
    FINANCE_LINE_TYPES,
    INCOME_RECORD_CATEGORIES,
    INVESTMENT_RECORD_CATEGORIES,
    LEDGER_RECORD_AMOUNT_PERIODS,
    MAX_ACCOUNT_DESCRIPTION_LEN,
    MAX_FINANCE_DESCRIPTION,
    MAX_FINANCE_LINES,
    MAX_INVESTMENT_CRYPTO_CURRENCY_LEN,
    MAX_INVESTMENT_PROVIDER_LEN,
    MAX_INVESTMENT_TICKER_LEN,
    MAX_LEDGER_RECORDS,
    MAX_PENSION_DESCRIPTION_LEN,
    MAX_SOURCE_ASSET_KEY_LEN,
    MAX_SOURCE_ASSET_KEYS_PER_LINE,
    SUPPORTED_FINANCE_CURRENCIES,
)

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

