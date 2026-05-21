#!/usr/bin/env python3
"""Split monolithic handler.py into modules with shared runtime imports."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "backend" / "lambda" / "admin" / "handler.py"
OUT = ROOT / "backend" / "lambda" / "admin"

RUNTIME = '''"""Shared boto clients and admin API constants."""

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

'''

IMPORTS_STD = """from __future__ import annotations

import base64
import binascii
import json
import os
import time
import uuid
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import parse_qs, quote

from botocore.exceptions import ClientError

import runtime
from runtime import (
    ADMIN_GROUP,
    ALLOWED_UPLOAD_CONTENT_TYPES,
    FINANCE_HOUSE_KEYS,
    PARSE_JOB_PK_PREFIX,
    RECORD_PK_PREFIX,
    logger,
)

"""

CHUNKS: list[tuple[str, int, int, str]] = [
    ("admin_runtime.py", 74, 87, "import runtime\nfrom runtime import _lambda_client, _secretsmanager\n"),
    ("assets.py", 88, 243, IMPORTS_STD + "from http_common import _audit, _json_response, _log_event, _parse_json_body, _request_id\nfrom ddb_convert import _from_ddb, _to_ddb\n"),
    (
        "http_common.py",
        244,
        371,
        IMPORTS_STD
        + "from contract_constants import DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTAGES\n"
        + "from ddb_convert import _from_ddb_nested, _to_ddb_nested\n",
    ),
    ("ddb_convert.py", 372, 395, IMPORTS_STD),
    (
        "finance_store.py",
        396,
        2624,
        IMPORTS_STD
        + "from contract_constants import (\n"
        "    DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTAGES,\n"
        "    DEFAULT_FINANCE_CURRENCY,\n"
        "    EXPENSE_RECORD_CATEGORIES,\n"
        "    FINANCE_ACCOUNT_TYPES,\n"
        "    FINANCE_HOUSE_KEYS,\n"
        "    FINANCE_LINE_TYPES,\n"
        "    INCOME_RECORD_CATEGORIES,\n"
        "    INVESTMENT_RECORD_CATEGORIES,\n"
        "    LEDGER_RECORD_AMOUNT_PERIODS,\n"
        "    MAX_ACCOUNT_DESCRIPTION_LEN,\n"
        "    MAX_FINANCE_DESCRIPTION,\n"
        "    MAX_FINANCE_LINES,\n"
        "    MAX_INVESTMENT_CRYPTO_CURRENCY_LEN,\n"
        "    MAX_INVESTMENT_PROVIDER_LEN,\n"
        "    MAX_INVESTMENT_TICKER_LEN,\n"
        "    MAX_LEDGER_RECORDS,\n"
        "    MAX_PENSION_DESCRIPTION_LEN,\n"
        "    MAX_SOURCE_ASSET_KEY_LEN,\n"
        "    MAX_SOURCE_ASSET_KEYS_PER_LINE,\n"
        "    SUPPORTED_FINANCE_CURRENCIES,\n"
        ")\n"
        + "from ddb_convert import _from_ddb, _from_ddb_nested, _to_ddb, _to_ddb_nested\n"
        + "from http_common import _audit, _json_response, _log_event, _utc_iso_z\n",
    ),
    ("proxies.py", 2625, 2911, IMPORTS_STD + "from http_common import _json_response, _log_event\n"),
    (
        "parse_jobs.py",
        2912,
        3210,
        IMPORTS_STD
        + "from contract_constants import (\n"
        "    PARSE_JOB_STALE_SECONDS_DEFAULT,\n"
        "    PARSE_JOB_STUCK_SECONDS_DEFAULT,\n"
        "    PARSE_JOB_TTL_SECONDS_DEFAULT,\n"
        ")\n"
        + "from ddb_convert import _from_ddb, _from_ddb_nested, _to_ddb, _to_ddb_nested\n"
        + "from finance_store import _load_finance_house\n"
        + "from http_common import _json_response, _log_event, _utc_iso_z\n"
        + "from parse_statement import execute_parse_statement\n",
    ),
    (
        "dispatch.py",
        3211,
        3790,
        IMPORTS_STD
        + "from contract_constants import (\n"
        "    DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTAGES,\n"
        "    EXPENSE_RECORD_CATEGORIES,\n"
        "    FINANCE_HOUSE_KEYS,\n"
        "    INCOME_RECORD_CATEGORIES,\n"
        ")\n"
        + "from assets import (\n"
        "    _asset_delete_response,\n"
        "    _asset_download_presigned_response,\n"
        "    _is_allowed_upload_content_type,\n"
        ")\n"
        + "from ddb_convert import _from_ddb, _from_ddb_nested, _to_ddb, _to_ddb_nested\n"
        + "from finance_store import (\n"
        "    _build_allocation_records_for_response,\n"
        "    _finance_ddb_key,\n"
        "    _finance_sheet_ddb_key,\n"
        "    _load_accounts_records,\n"
        "    _load_allocation_stored_records,\n"
        "    _load_existing_expense_income_allocation_percentages,\n"
        "    _load_finance_expenses_ledger_with_allocation,\n"
        "    _load_finance_house,\n"
        "    _load_finance_sheet,\n"
        "    _load_investment_records,\n"
        "    _load_pension_records,\n"
        "    _load_savings_records,\n"
        "    _merge_accounts_last_updated,\n"
        "    _merge_allocation_stored_last_updated,\n"
        "    _merge_investment_last_updated,\n"
        "    _merge_pension_last_updated,\n"
        "    _normalize_accounts_sheet_payload,\n"
        "    _normalize_allocations_sheet_payload,\n"
        "    _normalize_finance_payload,\n"
        "    _normalize_investment_sheet_payload,\n"
        "    _normalize_ledger_sheet_payload,\n"
        "    _normalize_pension_sheet_payload,\n"
        "    _normalize_savings_sheet_payload,\n"
        "    _path_finance_house,\n"
        "    _sanitize_expense_income_allocation_percentages,\n"
        "    _validate_record_pk,\n"
        "    _enrich_scan_items_asset_meta,\n"
        ")\n"
        + "from http_common import (\n"
        "    _audit,\n"
        "    _claims,\n"
        "    _decode_cursor,\n"
        "    _encode_cursor,\n"
        "    _json_response,\n"
        "    _log_event,\n"
        "    _parse_json_body,\n"
        "    _require_admin,\n"
        "    _request_id,\n"
        "    _route,\n"
        "    _utc_iso_z,\n"
        ")\n"
        + "from parse_jobs import (\n"
        "    _finalize_stuck_processing_job,\n"
        "    _parse_job_key,\n"
        "    _parse_job_public_doc,\n"
        "    _path_finance_parse_job,\n"
        "    enqueue_parse_statement_async_job,\n"
        ")\n"
        + "from parse_statement import _path_finance_house_for_parse, _statement_basename_already_imported\n"
        + "from proxies import _proxy_finance_quotes, _proxy_fx_v2_rates\n",
    ),
    (
        "parse_statement.py",
        3792,
        4060,
        IMPORTS_STD
        + "from contract_constants import FINANCE_HOUSE_KEYS\n"
        + "from ddb_convert import _from_ddb, _from_ddb_nested, _to_ddb, _to_ddb_nested\n"
        + "from finance_store import (\n"
        "    _finance_ddb_key,\n"
        "    _line_source_asset_keys_raw,\n"
        "    _load_finance_house,\n"
        "    _persist_asset_meta_after_parse,\n"
        "    _sanitize_finance_house,\n"
        "    _validated_line_source_asset_keys,\n"
        ")\n"
        + "from http_common import _log_event, _utc_iso_z\n"
        + "from parse_jobs import _invoke_parse_statement_worker\n",
    ),
]


def extract(path: Path, start: int, end: int) -> str:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    return "".join(lines[start - 1 : end])


def patch_runtime_refs(text: str) -> str:
    return (
        text.replace("_s3.", "runtime._s3.")
        .replace("_ddb.", "runtime._ddb.")
        .replace("global _lambda_client", "global runtime._lambda_client")
        .replace("global _secretsmanager", "global runtime._secretsmanager")
        .replace("_lambda_client is None", "runtime._lambda_client is None")
        .replace("_secretsmanager is None", "runtime._secretsmanager is None")
        .replace("_lambda_client =", "runtime._lambda_client =")
        .replace("_secretsmanager =", "runtime._secretsmanager =")
        .replace("return _lambda_client", "return runtime._lambda_client")
        .replace("return _secretsmanager", "return runtime._secretsmanager")
        .replace("boto3.client(\"lambda\")", "boto3.client(\"lambda\")")
    )


def main() -> None:
    (OUT / "runtime.py").write_text(RUNTIME, encoding="utf-8")
    for filename, start, end, header in CHUNKS:
        chunk = patch_runtime_refs(extract(SRC, start, end))
        if filename == "finance_store.py":
            chunk = chunk.replace(
                "DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTAGES: dict[str, float] = {\n"
                '    "taxOnIncomePercent": 0.0,\n'
                '    "investmentOnIncomePercent": 0.0,\n'
                '    "savingOnIncomePercent": 0.0,\n'
                "}\n\n\n",
                "",
            )
        if filename == "parse_jobs.py":
            chunk = chunk.replace(
                'int(os.environ.get("PARSE_JOB_STALE_SECONDS", "150"))',
                'int(os.environ.get("PARSE_JOB_STALE_SECONDS", PARSE_JOB_STALE_SECONDS_DEFAULT))',
            )
            chunk = chunk.replace(
                'float(os.environ.get("PARSE_JOB_STUCK_SECONDS", "240"))',
                'float(os.environ.get("PARSE_JOB_STUCK_SECONDS", PARSE_JOB_STUCK_SECONDS_DEFAULT))',
            )
            chunk = chunk.replace(
                'int(os.environ.get("PARSE_JOB_TTL_SECONDS", str(7 * 24 * 3600)))',
                'int(os.environ.get("PARSE_JOB_TTL_SECONDS", PARSE_JOB_TTL_SECONDS_DEFAULT))',
            )
        (OUT / filename).write_text(
            f'"""Admin API: {filename.replace(".py", "").replace("_", " ")}."""\n\n' + header + chunk,
            encoding="utf-8",
        )
        print(f"wrote {filename}")

    facade = '''"""Admin HTTP API — Lambda entrypoint and backward-compatible re-exports."""

from __future__ import annotations

from contract_constants import DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTAGES
from dispatch import lambda_handler

from assets import (  # noqa: F401
    _asset_delete_response,
    _asset_download_presigned_response,
    _is_allowed_upload_content_type,
    _normalize_public_asset_key,
)
from finance_store import (  # noqa: F401
    _build_allocation_records_for_response,
    _derived_expense_rows_from_tagged_income,
    _load_investment_records,
    _merge_accounts_last_updated,
    _merge_allocation_stored_last_updated,
    _merge_investment_last_updated,
    _merge_pension_last_updated,
    _normalize_accounts_sheet_payload,
    _normalize_allocations_sheet_payload,
    _normalize_finance_payload,
    _normalize_investment_sheet_payload,
    _normalize_ledger_sheet_payload,
    _normalize_pension_sheet_payload,
    _normalize_savings_sheet_payload,
    _sanitize_accounts_records_list,
    _sanitize_expense_income_allocation_percentages,
    _sanitize_investment_records_list,
    _sanitize_ledger_records_list,
    _sanitize_pension_records_list,
    _sanitize_savings_records_list,
)
from http_common import _groups_include_admin, _utc_iso_z  # noqa: F401
from parse_jobs import _path_finance_parse_job  # noqa: F401
from parse_statement import (  # noqa: F401
    _path_finance_house_for_parse,
    _statement_basename_already_imported,
    execute_parse_statement,
    enqueue_parse_statement_async_job,
)
from proxies import (  # noqa: F401
    _normalize_finance_quote_symbol,
    _normalize_yahoo_price_currency,
    _parse_finance_quotes_query,
    _parse_fx_v2_rates_query,
)

__all__ = [
    "DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTAGES",
    "lambda_handler",
    "execute_parse_statement",
    "enqueue_parse_statement_async_job",
]
'''
    (OUT / "handler.py").write_text(facade, encoding="utf-8")
    print("handler.py facade ready")


if __name__ == "__main__":
    # Backup original once
    backup = OUT / "handler.monolith.py"
    if not backup.exists():
        backup.write_text(SRC.read_text(encoding="utf-8"), encoding="utf-8")
    main()
