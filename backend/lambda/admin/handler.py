"""Admin HTTP API: dispatch by route; enforce admin Cognito group in Lambda."""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import time
import uuid
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import parse_qs, quote

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ADMIN_GROUP = "admin"
RECORD_PK_PREFIX = "RECORD#"
PARSE_JOB_PK_PREFIX = "PARSE_JOB#"
FINANCE_HOUSE_KEYS = frozenset({"hillmarton", "morrison"})
FINANCE_LINE_TYPES = frozenset({"income", "expenditure", "mortgage"})
SUPPORTED_FINANCE_CURRENCIES = frozenset(
    {"GBP", "HKD", "USD", "EUR", "CNY", "SGD", "AED"}
)
DEFAULT_FINANCE_CURRENCY = "HKD"
MAX_FINANCE_LINES = 5000
MAX_FINANCE_DESCRIPTION = 8000
MAX_SOURCE_ASSET_KEYS_PER_LINE = 20
MAX_SOURCE_ASSET_KEY_LEN = 1024
INCOME_RECORD_CATEGORIES = frozenset({"Salary", "Rent"})
EXPENSE_RECORD_CATEGORIES = frozenset(
    {
        "Utility",
        "Saving",
        "Investment",
        "Rent",
        "Mortgage",
        "Insurance",
        "Retirement",
        "Tax",
        "Amenities",
        "Helper",
        "Education",
    }
)
INVESTMENT_RECORD_CATEGORIES = frozenset(
    {"Real Estate", "Fixed Term Deposit", "ETF", "Crypto"}
)
ASSET_TYPES = frozenset({"Fixed", "Liquid"})
FINANCE_ACCOUNT_TYPES = frozenset(
    {"Bank Account", "Credit Card", "Debit Card"}
)
MAX_INVESTMENT_PROVIDER_LEN = 500
MAX_INVESTMENT_TICKER_LEN = 64
MAX_INVESTMENT_CRYPTO_CURRENCY_LEN = 120
MAX_LEDGER_RECORDS = 2000
LEDGER_RECORD_AMOUNT_PERIODS = frozenset({"month", "year"})
# Asset uploads accept any image/* type plus statement PDFs.
ALLOWED_UPLOAD_CONTENT_TYPES = frozenset({"application/pdf"})
_s3 = boto3.client("s3")
_ddb = boto3.resource("dynamodb")
_secretsmanager = None
_lambda_client = None


def _get_lambda_client() -> Any:
    global _lambda_client
    if _lambda_client is None:
        _lambda_client = boto3.client("lambda")
    return _lambda_client


def _get_secretsmanager_client() -> Any:
    global _secretsmanager
    if _secretsmanager is None:
        _secretsmanager = boto3.client("secretsmanager")
    return _secretsmanager


def _is_allowed_upload_content_type(content_type: str) -> bool:
    if not isinstance(content_type, str):
        return False
    ct = content_type.strip().lower()
    if ct.startswith("image/"):
        return True
    return ct in ALLOWED_UPLOAD_CONTENT_TYPES


def _normalize_public_asset_key(raw: Any) -> str | None:
    """Return a downloadable assets-bucket key, or None if invalid.

    Allows ``uploads/*`` (browser uploads) and ``inbound/{house}/{batch}/…``
    (SES → inbound-email Lambda). Other prefixes are rejected.
    """
    if raw is None:
        return None
    key = str(raw).strip()
    if not key or ".." in key:
        return None
    if key.startswith("uploads/"):
        return key
    if key.startswith("inbound/"):
        parts = key.split("/")
        if len(parts) < 4:
            return None
        house_seg = parts[1].strip().lower()
        if house_seg not in FINANCE_HOUSE_KEYS:
            return None
        batch = parts[2]
        if len(batch) != 32 or any(
            c not in "0123456789abcdef" for c in batch.lower()
        ):
            return None
        return key
    return None


def _asset_download_presigned_response(
    event: dict[str, Any],
    user_sub: str | None,
    raw_key: Any,
) -> dict[str, Any]:
    """Issue a presigned GET for a confirmed asset (GET ?key=… or POST JSON body).

    Any admin may download any confirmed ``uploads/*`` or ``inbound/*`` object
    so statement lines and the Assets page work across uploaders and email
    ingestion.
    """
    norm = _normalize_public_asset_key(raw_key)
    if norm is None:
        return _json_response(400, {"message": "key is required"})
    table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
    meta = table.get_item(Key={"pk": f"ASSET#{norm}", "sk": "META"})
    if "Item" not in meta:
        _log_event(
            "warning",
            tag="asset_download_url_rejected",
            reason="not_confirmed",
            sub=user_sub,
            key=norm[:512],
            request_id=_request_id(event),
        )
        return _json_response(404, {"message": "Asset not found"})
    bucket = os.environ["ASSETS_BUCKET_NAME"]
    try:
        head_dl = _s3.head_object(Bucket=bucket, Key=norm)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            _log_event(
                "warning",
                tag="asset_download_url_missing_object",
                sub=user_sub,
                key=norm[:512],
                s3_error_code=code,
                request_id=_request_id(event),
            )
            return _json_response(
                404, {"message": "Object not found in bucket"}
            )
        raise
    params: dict[str, Any] = {"Bucket": bucket, "Key": norm}
    ct_dl = head_dl.get("ContentType")
    if isinstance(ct_dl, str) and ct_dl.strip():
        params["ResponseContentType"] = ct_dl.strip()
    url = _s3.generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=300,
    )
    _log_event(
        "info",
        tag="asset_download_url_issued",
        sub=user_sub,
        key=norm[:512],
        expires_in_seconds=300,
        request_id=_request_id(event),
    )
    _audit(user_sub, "ASSET_DOWNLOAD_URL", norm, event)
    return _json_response(200, {"url": url, "expiresIn": 300})


def _asset_delete_response(
    event: dict[str, Any],
    user_sub: str | None,
    raw_key: Any,
) -> dict[str, Any]:
    """Remove a confirmed asset object from S3 and delete its META row.

    Same key rules and confirmation requirement as download URLs: only
    ``uploads/*`` or validated ``inbound/*`` keys with an existing ``ASSET#``
    META record may be deleted.
    """
    norm = _normalize_public_asset_key(raw_key)
    if norm is None:
        return _json_response(400, {"message": "key is required"})
    table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
    ddb_key = {"pk": f"ASSET#{norm}", "sk": "META"}
    meta = table.get_item(Key=ddb_key)
    if "Item" not in meta:
        _log_event(
            "warning",
            tag="asset_delete_rejected",
            reason="not_confirmed",
            sub=user_sub,
            key=norm[:512],
            request_id=_request_id(event),
        )
        return _json_response(404, {"message": "Asset not found"})
    bucket = os.environ["ASSETS_BUCKET_NAME"]
    try:
        _s3.delete_object(Bucket=bucket, Key=norm)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        _log_event(
            "warning",
            tag="asset_delete_s3_error",
            sub=user_sub,
            key=norm[:512],
            s3_error_code=code,
            request_id=_request_id(event),
        )
        raise
    table.delete_item(Key=ddb_key)
    _log_event(
        "info",
        tag="asset_delete_ok",
        sub=user_sub,
        key=norm[:512],
        request_id=_request_id(event),
    )
    _audit(user_sub, "ASSET_DELETE", norm, event)
    return _json_response(200, {"ok": True, "key": norm})


def _json_response(
    status_code: int, payload: dict[str, Any] | list[Any] | str
) -> dict[str, Any]:
    body = payload if isinstance(payload, str) else json.dumps(payload, default=str)
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": body,
    }


def _parse_json_body(event: dict[str, Any]) -> dict[str, Any]:
    try:
        return json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return {}


def _claims(event: dict[str, Any]) -> dict[str, Any]:
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )


def _groups_include_admin(claims: dict[str, Any]) -> bool:
    raw = claims.get("cognito:groups")
    if raw is None:
        return False
    if isinstance(raw, list):
        return ADMIN_GROUP in raw
    # API Gateway HTTP API JWT authorizer flattens array claims using Java-style
    # toString(), e.g. ["admin"] -> "[admin]" and ["viewer","admin"] -> "[viewer, admin]".
    # Strip the surrounding brackets before splitting on commas so we accept
    # both the bracketed form (HttpApi authorizer) and a plain comma-separated
    # string (REST API or local-decoded claims).
    s = str(raw).strip()
    if s.startswith("[") and s.endswith("]"):
        s = s[1:-1]
    parts = [p.strip() for p in s.split(",") if p.strip()]
    return ADMIN_GROUP in parts


def _require_admin(event: dict[str, Any]) -> dict[str, Any] | None:
    claims = _claims(event)
    if not _groups_include_admin(claims):
        return None
    return claims


def _route(event: dict[str, Any]) -> tuple[str, str]:
    http = event.get("requestContext", {}).get("http", {})
    return http.get("method", ""), http.get("path", "")


def _request_id(event: dict[str, Any]) -> str:
    return (
        event.get("requestContext", {})
        .get("requestId", "")
        or event.get("requestContext", {})
        .get("http", {})
        .get("requestId", "")
        or "unknown"
    )


def _audit(user_sub: str | None, action: str, target: str, event: dict[str, Any]) -> None:
    if not user_sub:
        return
    try:
        table = _ddb.Table(os.environ["AUDIT_LOG_TABLE_NAME"])
        ts = int(time.time() * 1000)
        table.put_item(
            Item={
                "pk": f"USER#{user_sub}",
                "sk": f"{ts}#{action}",
                "target": target,
                "requestId": _request_id(event),
            }
        )
    except ClientError:
        pass


def _log_event(level: str, **fields: Any) -> None:
    """Emit a single-line JSON log row.

    All non-`tag` fields are PII-safe scalars (sub, content type, S3 key,
    sizes, error codes, request id). Used by the asset upload + statement
    parse endpoints so a future "the upload silently failed" report can be
    diagnosed from CloudWatch alone, without needing the user's browser.
    """
    payload = {k: v for k, v in fields.items() if v is not None}
    line = json.dumps(payload, default=str)
    if level == "warning":
        logger.warning(line)
    elif level == "error":
        logger.error(line)
    else:
        logger.info(line)


def _decode_cursor(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        pad = "=" * ((4 - len(raw) % 4) % 4)
        blob = base64.urlsafe_b64decode(raw + pad)
        return json.loads(blob.decode("utf-8"))
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError):
        return None


def _utc_iso_z(dt: datetime) -> str:
    """Format an aware or naive datetime as UTC with millisecond precision."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    utc = dt.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _encode_cursor(key: dict[str, Any]) -> str:
    raw = json.dumps(key, separators=(",", ":"), default=str).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _to_ddb_nested(obj: Any) -> Any:
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_ddb_nested(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_ddb_nested(v) for v in obj]
    return obj


def _from_ddb_nested(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    if isinstance(obj, dict):
        return {k: _from_ddb_nested(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_from_ddb_nested(v) for v in obj]
    if isinstance(obj, (bytes, bytearray)):
        return base64.b64encode(obj).decode("ascii")
    return obj


def _default_finance_house() -> dict[str, Any]:
    return {
        "defaultCurrency": DEFAULT_FINANCE_CURRENCY,
        "float": {"amount": 0, "currency": DEFAULT_FINANCE_CURRENCY},
        "lines": [],
    }


def _line_source_asset_keys_raw(line: dict[str, Any]) -> list[str]:
    """Collect source S3 keys from ``sourceAssetKeys`` and legacy ``sourceAssetKey``."""
    keys: list[str] = []
    raw_arr = line.get("sourceAssetKeys")
    if isinstance(raw_arr, list):
        for x in raw_arr:
            if isinstance(x, str) and x.strip():
                keys.append(x.strip())
    legacy = line.get("sourceAssetKey")
    if isinstance(legacy, str) and legacy.strip():
        keys.append(legacy.strip())
    seen: set[str] = set()
    out: list[str] = []
    for k in keys:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _validated_line_source_asset_keys(raw: dict[str, Any], i: int) -> list[str]:
    """Strict validation for finance writes; merges legacy ``sourceAssetKey``."""
    if "sourceAssetKeys" in raw:
        sa = raw["sourceAssetKeys"]
        if sa is not None:
            if not isinstance(sa, list):
                raise ValueError(f"lines[{i}].sourceAssetKeys must be an array")
            for j, x in enumerate(sa):
                if not isinstance(x, str) or not x.strip():
                    raise ValueError(
                        f"lines[{i}].sourceAssetKeys[{j}] must be a non-empty string"
                    )
    if "sourceAssetKey" in raw:
        sk = raw["sourceAssetKey"]
        if sk is not None and (not isinstance(sk, str) or not sk.strip()):
            raise ValueError(
                f"lines[{i}].sourceAssetKey must be a non-empty string when provided"
            )
    return _line_source_asset_keys_raw(raw)


def _coerce_finance_currency_value(raw: Any, fallback: str) -> str:
    if not isinstance(raw, str) or not raw.strip():
        return fallback
    c = raw.strip().upper()[:3]
    if len(c) < 3 or c not in SUPPORTED_FINANCE_CURRENCIES:
        return fallback
    return c


def _sanitize_finance_house(stored: dict[str, Any]) -> dict[str, Any]:
    """Fill missing keys and coerce legacy currency strings for GET responses."""
    base = _default_finance_house()
    dc = _coerce_finance_currency_value(stored.get("defaultCurrency"), DEFAULT_FINANCE_CURRENCY)
    fl = stored.get("float")
    if isinstance(fl, dict):
        amt = fl.get("amount", 0)
        if not isinstance(amt, (int, float)) or isinstance(amt, bool):
            amt = 0
        cur = _coerce_finance_currency_value(fl.get("currency"), dc)
        float_out: dict[str, Any] = {"amount": float(amt), "currency": cur}
    else:
        float_out = dict(base["float"])
        float_out["currency"] = dc

    lines_out: list[dict[str, Any]] = []
    lines_raw = stored.get("lines")
    if isinstance(lines_raw, list):
        for raw in lines_raw:
            if not isinstance(raw, dict):
                continue
            cur_line = _coerce_finance_currency_value(raw.get("currency"), dc)
            row = dict(raw)
            row["currency"] = cur_line
            merged = _line_source_asset_keys_raw(row)
            row.pop("sourceAssetKey", None)
            row.pop("sourceAssetKeys", None)
            if merged:
                row["sourceAssetKeys"] = merged[:MAX_SOURCE_ASSET_KEYS_PER_LINE]
            lines_out.append(row)

    return {"defaultCurrency": dc, "float": float_out, "lines": lines_out}


def _require_supported_currency(raw: Any, field_label: str) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"{field_label} is required")
    c = raw.strip().upper()[:3]
    if len(c) < 3:
        raise ValueError(f"{field_label} must be a 3-letter ISO currency code")
    if c not in SUPPORTED_FINANCE_CURRENCIES:
        allowed = ", ".join(sorted(SUPPORTED_FINANCE_CURRENCIES))
        raise ValueError(f"{field_label} must be one of: {allowed}")
    return c


def _valid_iso_instant(s: str) -> bool:
    try:
        datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def _normalize_finance_payload(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("Body must be a JSON object")

    if "defaultCurrency" in body:
        default_currency = _require_supported_currency(
            body["defaultCurrency"], "defaultCurrency"
        )
    else:
        default_currency = DEFAULT_FINANCE_CURRENCY

    fl = body.get("float")
    if not isinstance(fl, dict):
        raise ValueError("float is required")
    amt = fl.get("amount")
    if not isinstance(amt, (int, float)) or isinstance(amt, bool):
        raise ValueError("float.amount must be a number")
    if abs(float(amt)) > 1e15:
        raise ValueError("float.amount out of range")
    cur = _require_supported_currency(
        fl.get("currency", default_currency), "float.currency"
    )

    lines_raw = body.get("lines")
    if not isinstance(lines_raw, list):
        raise ValueError("lines must be an array")
    if len(lines_raw) > MAX_FINANCE_LINES:
        raise ValueError(f"At most {MAX_FINANCE_LINES} lines allowed")

    lines_out: list[dict[str, Any]] = []
    for i, raw in enumerate(lines_raw):
        if not isinstance(raw, dict):
            raise ValueError(f"lines[{i}] must be an object")
        lid = raw.get("id")
        if not isinstance(lid, str) or not lid.strip():
            raise ValueError(f"lines[{i}].id is required")
        date_utc = raw.get("dateUtc")
        if not isinstance(date_utc, str) or not _valid_iso_instant(date_utc):
            raise ValueError(f"lines[{i}].dateUtc must be a valid ISO-8601 instant")
        typ = raw.get("type")
        if typ not in FINANCE_LINE_TYPES:
            raise ValueError(
                f"lines[{i}].type must be income, expenditure, or mortgage"
            )
        desc = raw.get("description")
        if not isinstance(desc, str) or not desc.strip():
            raise ValueError(f"lines[{i}].description is required")
        if len(desc) > MAX_FINANCE_DESCRIPTION:
            raise ValueError(f"lines[{i}].description is too long")

        for key in ("netAmount", "vat", "grossAmount"):
            val = raw.get(key)
            if not isinstance(val, (int, float)) or isinstance(val, bool):
                raise ValueError(f"lines[{i}].{key} must be a number")
            if abs(float(val)) > 1e15:
                raise ValueError(f"lines[{i}].{key} out of range")

        c = _require_supported_currency(
            raw.get("currency", default_currency), f"lines[{i}].currency"
        )

        line_out: dict[str, Any] = {
            "id": lid.strip(),
            "dateUtc": date_utc.strip(),
            "type": typ,
            "description": desc.strip(),
            "netAmount": float(raw["netAmount"]),
            "vat": float(raw["vat"]),
            "grossAmount": float(raw["grossAmount"]),
            "currency": c,
        }

        merged_keys = _validated_line_source_asset_keys(raw, i)
        if len(merged_keys) > MAX_SOURCE_ASSET_KEYS_PER_LINE:
            raise ValueError(
                f"lines[{i}] must have at most {MAX_SOURCE_ASSET_KEYS_PER_LINE} "
                "source asset keys"
            )
        for k in merged_keys:
            if len(k) > MAX_SOURCE_ASSET_KEY_LEN:
                raise ValueError(f"lines[{i}] source asset key is too long")
        if merged_keys:
            line_out["sourceAssetKeys"] = merged_keys

        lines_out.append(line_out)

    return {
        "defaultCurrency": default_currency,
        "float": {"amount": float(amt), "currency": cur},
        "lines": lines_out,
    }


def _sanitize_ledger_records_list(
    raw: Any,
    categories: frozenset[str],
    *,
    include_income_flags: bool = False,
    include_expense_flags: bool = False,
) -> list[dict[str, Any]]:
    """Best-effort coercion for GET responses (drops invalid rows)."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            continue
        cat = row.get("category")
        if cat not in categories:
            continue
        desc = row.get("description")
        if not isinstance(desc, str) or not desc.strip():
            continue
        amt = row.get("amount")
        if isinstance(amt, Decimal):
            amt_f = float(amt)
        elif isinstance(amt, (int, float)) and not isinstance(amt, bool):
            amt_f = float(amt)
        elif isinstance(amt, str):
            try:
                amt_f = float(amt)
            except ValueError:
                continue
        else:
            continue
        if abs(amt_f) > 1e15:
            continue
        cur = _coerce_finance_currency_value(
            row.get("currency"), DEFAULT_FINANCE_CURRENCY
        )
        d = desc.strip()
        if len(d) > MAX_FINANCE_DESCRIPTION:
            d = d[:MAX_FINANCE_DESCRIPTION]
        period_raw = row.get("amountPeriod")
        period = "year" if period_raw == "year" else "month"
        rec: dict[str, Any] = {
            "id": rid.strip(),
            "category": cat,
            "description": d,
            "amount": amt_f,
            "currency": cur,
            "amountPeriod": period,
        }
        rh = row.get("relatedHouse")
        if rh in FINANCE_HOUSE_KEYS:
            rec["relatedHouse"] = rh
        if include_income_flags:
            for fk in ("isTax", "isSaving", "isInvestment"):
                rec[fk] = row.get(fk) is True
        if include_expense_flags:
            rec["isAllocate"] = row.get("isAllocate") is True
        out.append(rec)
    return out


DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTAGES: dict[str, float] = {
    "taxOnIncomePercent": 0.0,
    "investmentOnIncomePercent": 0.0,
    "savingOnIncomePercent": 0.0,
}


def _sanitize_expense_income_allocation_percentages(raw: Any) -> dict[str, float]:
    """Coerce persisted expense-sheet allocation rates to 0–100 (inclusive)."""
    out = {**DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTAGES}
    if not isinstance(raw, dict):
        return out
    for key in (
        "taxOnIncomePercent",
        "investmentOnIncomePercent",
        "savingOnIncomePercent",
    ):
        val = raw.get(key, 0)
        if isinstance(val, Decimal):
            val = float(val)
        if isinstance(val, bool):
            continue
        if isinstance(val, (int, float)):
            v = float(val)
        elif isinstance(val, str):
            try:
                v = float(val)
            except ValueError:
                continue
        else:
            continue
        if v < 0.0:
            v = 0.0
        if v > 100.0:
            v = 100.0
        out[key] = v
    return out


def _normalize_ledger_sheet_payload(
    body: dict[str, Any],
    *,
    body_key: str,
    categories: frozenset[str],
) -> list[dict[str, Any]]:
    if not isinstance(body, dict):
        raise ValueError("Body must be a JSON object")
    raw = body.get(body_key)
    if not isinstance(raw, list):
        raise ValueError(f"{body_key} must be an array")
    if len(raw) > MAX_LEDGER_RECORDS:
        raise ValueError(f"At most {MAX_LEDGER_RECORDS} records allowed in {body_key}")
    allowed = ", ".join(sorted(categories))
    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise ValueError(f"{body_key}[{i}] must be an object")
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            raise ValueError(f"{body_key}[{i}].id is required")
        cat = row.get("category")
        if cat not in categories:
            raise ValueError(f"{body_key}[{i}].category must be one of: {allowed}")
        desc = row.get("description")
        if not isinstance(desc, str) or not desc.strip():
            raise ValueError(f"{body_key}[{i}].description is required")
        if len(desc) > MAX_FINANCE_DESCRIPTION:
            raise ValueError(f"{body_key}[{i}].description is too long")
        amt = row.get("amount")
        if isinstance(amt, Decimal):
            amt = float(amt)
        if not isinstance(amt, (int, float)) or isinstance(amt, bool):
            raise ValueError(f"{body_key}[{i}].amount must be a number")
        if abs(float(amt)) > 1e15:
            raise ValueError(f"{body_key}[{i}].amount out of range")
        cur = _require_supported_currency(
            row.get("currency", DEFAULT_FINANCE_CURRENCY),
            f"{body_key}[{i}].currency",
        )
        period_raw = row.get("amountPeriod", "month")
        if period_raw not in LEDGER_RECORD_AMOUNT_PERIODS:
            allowed_p = ", ".join(sorted(LEDGER_RECORD_AMOUNT_PERIODS))
            raise ValueError(
                f"{body_key}[{i}].amountPeriod must be one of: {allowed_p}"
            )
        period = str(period_raw)
        rec: dict[str, Any] = {
            "id": rid.strip(),
            "category": cat,
            "description": desc.strip(),
            "amount": float(amt),
            "currency": cur,
            "amountPeriod": period,
        }
        house_raw = row.get("relatedHouse")
        if house_raw is not None and house_raw != "":
            if not isinstance(house_raw, str) or house_raw not in FINANCE_HOUSE_KEYS:
                houses = ", ".join(sorted(FINANCE_HOUSE_KEYS))
                raise ValueError(
                    f"{body_key}[{i}].relatedHouse must be one of: {houses}"
                )
            rec["relatedHouse"] = house_raw
        if body_key == "incomeRecords":
            for fk in ("isTax", "isSaving", "isInvestment"):
                v = row.get(fk)
                if v is None:
                    rec[fk] = False
                elif isinstance(v, bool):
                    rec[fk] = v
                else:
                    raise ValueError(f"{body_key}[{i}].{fk} must be a boolean")
        if body_key == "expenseRecords":
            v = row.get("isAllocate")
            if v is None:
                rec["isAllocate"] = False
            elif isinstance(v, bool):
                rec["isAllocate"] = v
            else:
                raise ValueError(f"{body_key}[{i}].isAllocate must be a boolean")
        out.append(rec)
    return out


def _investment_non_empty_strip(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        s = str(raw).strip()
    elif isinstance(raw, str):
        s = raw.strip()
    else:
        return None
    return s if s else None


def _sanitize_investment_detail_str(raw: Any, max_len: int) -> str | None:
    s = _investment_non_empty_strip(raw)
    if s is None:
        return None
    if len(s) > max_len:
        return s[:max_len]
    return s


def _sanitize_investment_records_list(raw: Any) -> list[dict[str, Any]]:
    """Best-effort coercion for GET responses (drops invalid rows)."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            continue
        cat = row.get("category")
        if cat not in INVESTMENT_RECORD_CATEGORIES:
            continue
        at = row.get("assetType")
        if at not in ASSET_TYPES:
            continue
        prov = row.get("provider")
        if not isinstance(prov, str) or not prov.strip():
            continue
        p = prov.strip()
        if len(p) > MAX_INVESTMENT_PROVIDER_LEN:
            p = p[:MAX_INVESTMENT_PROVIDER_LEN]
        amt = row.get("principalAmount")
        if isinstance(amt, Decimal):
            amt_f = float(amt)
        elif isinstance(amt, (int, float)) and not isinstance(amt, bool):
            amt_f = float(amt)
        elif isinstance(amt, str):
            try:
                amt_f = float(amt)
            except ValueError:
                continue
        else:
            continue
        if amt_f != amt_f or abs(amt_f) > 1e15:
            continue
        cur = _coerce_finance_currency_value(
            row.get("currency"), DEFAULT_FINANCE_CURRENCY
        )
        item: dict[str, Any] = {
            "id": rid.strip(),
            "category": cat,
            "assetType": at,
            "provider": p,
            "principalAmount": amt_f,
            "currency": cur,
        }
        if cat == "Real Estate":
            rh = row.get("relatedHouse")
            if rh in FINANCE_HOUSE_KEYS:
                item["relatedHouse"] = rh
            cv = row.get("currentValue")
            if cv is not None and not isinstance(cv, bool):
                if isinstance(cv, Decimal):
                    cv_f = float(cv)
                elif isinstance(cv, (int, float)):
                    cv_f = float(cv)
                elif isinstance(cv, str):
                    s = cv.strip()
                    if not s:
                        cv_f = None
                    else:
                        try:
                            cv_f = float(s)
                        except ValueError:
                            cv_f = None
                else:
                    cv_f = None
                if cv_f is not None and cv_f == cv_f and abs(cv_f) <= 1e15:
                    item["currentValue"] = cv_f
        elif cat == "ETF":
            tk = _sanitize_investment_detail_str(
                row.get("ticker"), MAX_INVESTMENT_TICKER_LEN
            )
            if tk:
                item["ticker"] = tk
        elif cat == "Crypto":
            cc = _sanitize_investment_detail_str(
                row.get("cryptoCurrency"), MAX_INVESTMENT_CRYPTO_CURRENCY_LEN
            )
            if cc:
                item["cryptoCurrency"] = cc
        unit_raw = row.get("unit")
        if cat != "Real Estate" and unit_raw is not None and not isinstance(unit_raw, bool):
            if isinstance(unit_raw, Decimal):
                unit_f = float(unit_raw)
            elif isinstance(unit_raw, (int, float)):
                unit_f = float(unit_raw)
            elif isinstance(unit_raw, str):
                s = unit_raw.strip()
                if not s:
                    unit_f = None
                else:
                    try:
                        unit_f = float(s)
                    except ValueError:
                        unit_f = None
            else:
                unit_f = None
            if unit_f is not None and unit_f == unit_f and abs(unit_f) <= 1e15:
                item["unit"] = unit_f
        lu_raw = row.get("lastUpdated")
        if isinstance(lu_raw, str) and _is_calendar_date_string(lu_raw.strip()):
            item["lastUpdated"] = lu_raw.strip()
        out.append(item)
    return out


def _investment_row_signature(row: dict[str, Any]) -> tuple[Any, ...]:
    """Comparable fields for detecting edits (excludes id and lastUpdated)."""
    u = row.get("unit")
    if isinstance(u, Decimal):
        u_f: float | None = float(u)
    elif isinstance(u, (int, float)) and not isinstance(u, bool):
        u_f = float(u)
    else:
        u_f = None
    cv = row.get("currentValue")
    if isinstance(cv, Decimal):
        cv_f: float | None = float(cv)
    elif isinstance(cv, (int, float)) and not isinstance(cv, bool):
        cv_f = float(cv)
    else:
        cv_f = None
    return (
        row["category"],
        row["assetType"],
        row["provider"],
        float(row["principalAmount"]),
        row["currency"],
        row.get("relatedHouse"),
        row.get("ticker"),
        row.get("cryptoCurrency"),
        u_f,
        cv_f,
    )


def _merge_investment_last_updated(
    normalized: list[dict[str, Any]],
    existing: list[dict[str, Any]],
    *,
    today_iso: str | None = None,
) -> list[dict[str, Any]]:
    """Attach `lastUpdated` (UTC calendar date) per row: new/changed rows get today; unchanged keep prior."""
    today = today_iso or datetime.now(timezone.utc).date().isoformat()
    by_id = {r["id"]: r for r in existing}
    out: list[dict[str, Any]] = []
    for row in normalized:
        merged = dict(row)
        prev = by_id.get(merged["id"])
        if prev is None:
            merged["lastUpdated"] = today
        elif _investment_row_signature(prev) == _investment_row_signature(merged):
            lu = prev.get("lastUpdated")
            if isinstance(lu, str) and _is_calendar_date_string(lu):
                merged["lastUpdated"] = lu
        else:
            merged["lastUpdated"] = today
        out.append(merged)
    return out


def _normalize_investment_sheet_payload(body: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(body, dict):
        raise ValueError("Body must be a JSON object")
    raw = body.get("investmentRecords")
    if not isinstance(raw, list):
        raise ValueError("investmentRecords must be an array")
    if len(raw) > MAX_LEDGER_RECORDS:
        raise ValueError(
            f"At most {MAX_LEDGER_RECORDS} records allowed in investmentRecords"
        )
    allowed_cat = ", ".join(sorted(INVESTMENT_RECORD_CATEGORIES))
    allowed_at = ", ".join(sorted(ASSET_TYPES))
    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise ValueError(f"investmentRecords[{i}] must be an object")
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            raise ValueError(f"investmentRecords[{i}].id is required")
        cat = row.get("category")
        if cat not in INVESTMENT_RECORD_CATEGORIES:
            raise ValueError(
                f"investmentRecords[{i}].category must be one of: {allowed_cat}"
            )
        at = row.get("assetType")
        if at not in ASSET_TYPES:
            raise ValueError(
                f"investmentRecords[{i}].assetType must be one of: {allowed_at}"
            )
        prov = row.get("provider")
        if not isinstance(prov, str) or not prov.strip():
            raise ValueError(f"investmentRecords[{i}].provider is required")
        if len(prov.strip()) > MAX_INVESTMENT_PROVIDER_LEN:
            raise ValueError(f"investmentRecords[{i}].provider is too long")
        amt = row.get("principalAmount")
        if isinstance(amt, Decimal):
            amt = float(amt)
        if not isinstance(amt, (int, float)) or isinstance(amt, bool):
            raise ValueError(
                f"investmentRecords[{i}].principalAmount must be a number"
            )
        amt_f = float(amt)
        if amt_f != amt_f or abs(amt_f) > 1e15:
            raise ValueError(
                f"investmentRecords[{i}].principalAmount out of range"
            )
        cur = _require_supported_currency(
            row.get("currency", DEFAULT_FINANCE_CURRENCY),
            f"investmentRecords[{i}].currency",
        )
        rec: dict[str, Any] = {
            "id": rid.strip(),
            "category": cat,
            "assetType": at,
            "provider": prov.strip(),
            "principalAmount": amt_f,
            "currency": cur,
        }
        house_raw = row.get("relatedHouse")
        ticker_raw = row.get("ticker")
        crypto_raw = row.get("cryptoCurrency")
        current_value_raw = row.get("currentValue")

        def _reject_investment_detail_fields(*, allowed: frozenset[str]) -> None:
            checks: tuple[tuple[str, Any], ...] = (
                ("relatedHouse", house_raw),
                ("ticker", ticker_raw),
                ("cryptoCurrency", crypto_raw),
                ("currentValue", current_value_raw),
            )
            for field, raw in checks:
                if field in allowed:
                    continue
                if field == "relatedHouse":
                    if house_raw is not None and str(house_raw).strip() != "":
                        raise ValueError(
                            f"investmentRecords[{i}].relatedHouse is only allowed when "
                            "category is Real Estate"
                        )
                elif field == "currentValue":
                    if raw is None:
                        continue
                    if isinstance(raw, bool):
                        raise ValueError(
                            f"investmentRecords[{i}].currentValue is only allowed when "
                            "category is Real Estate"
                        )
                    if isinstance(raw, (int, float)):
                        raise ValueError(
                            f"investmentRecords[{i}].currentValue is only allowed when "
                            "category is Real Estate"
                        )
                    if isinstance(raw, Decimal):
                        raise ValueError(
                            f"investmentRecords[{i}].currentValue is only allowed when "
                            "category is Real Estate"
                        )
                    if isinstance(raw, str) and raw.strip() != "":
                        raise ValueError(
                            f"investmentRecords[{i}].currentValue is only allowed when "
                            "category is Real Estate"
                        )
                elif _investment_non_empty_strip(raw) is not None:
                    raise ValueError(
                        f"investmentRecords[{i}].{field} is only allowed when category "
                        "uses this field"
                    )

        if cat == "Real Estate":
            _reject_investment_detail_fields(
                allowed=frozenset({"relatedHouse", "currentValue"})
            )
            if house_raw is not None and str(house_raw).strip() != "":
                if not isinstance(house_raw, str) or house_raw not in FINANCE_HOUSE_KEYS:
                    houses = ", ".join(sorted(FINANCE_HOUSE_KEYS))
                    raise ValueError(
                        f"investmentRecords[{i}].relatedHouse must be one of: {houses}"
                    )
                rec["relatedHouse"] = house_raw
            cv_raw = row.get("currentValue")
            if cv_raw is not None and not (
                isinstance(cv_raw, str) and not cv_raw.strip()
            ):
                if isinstance(cv_raw, bool):
                    raise ValueError(
                        f"investmentRecords[{i}].currentValue must be a number"
                    )
                if isinstance(cv_raw, Decimal):
                    cv_f = float(cv_raw)
                elif isinstance(cv_raw, (int, float)):
                    cv_f = float(cv_raw)
                elif isinstance(cv_raw, str):
                    try:
                        cv_f = float(cv_raw.strip())
                    except ValueError as exc:
                        raise ValueError(
                            f"investmentRecords[{i}].currentValue must be a number"
                        ) from exc
                else:
                    raise ValueError(
                        f"investmentRecords[{i}].currentValue must be a number"
                    )
                if cv_f != cv_f or abs(cv_f) > 1e15:
                    raise ValueError(
                        f"investmentRecords[{i}].currentValue out of range"
                    )
                rec["currentValue"] = cv_f
        elif cat == "ETF":
            _reject_investment_detail_fields(allowed=frozenset({"ticker"}))
            if ticker_raw is not None and str(ticker_raw).strip() != "":
                if not isinstance(ticker_raw, str):
                    raise ValueError(
                        f"investmentRecords[{i}].ticker must be a string"
                    )
                t_st = ticker_raw.strip()
                if len(t_st) > MAX_INVESTMENT_TICKER_LEN:
                    raise ValueError(f"investmentRecords[{i}].ticker is too long")
                rec["ticker"] = t_st
        elif cat == "Crypto":
            _reject_investment_detail_fields(allowed=frozenset({"cryptoCurrency"}))
            if crypto_raw is not None and str(crypto_raw).strip() != "":
                if not isinstance(crypto_raw, str):
                    raise ValueError(
                        f"investmentRecords[{i}].cryptoCurrency must be a string"
                    )
                c_st = crypto_raw.strip()
                if len(c_st) > MAX_INVESTMENT_CRYPTO_CURRENCY_LEN:
                    raise ValueError(
                        f"investmentRecords[{i}].cryptoCurrency is too long"
                    )
                rec["cryptoCurrency"] = c_st
        elif cat == "Fixed Term Deposit":
            _reject_investment_detail_fields(allowed=frozenset())
        if cat != "Real Estate":
            unit_raw = row.get("unit")
            if unit_raw is not None and not (
                isinstance(unit_raw, str) and not unit_raw.strip()
            ):
                if isinstance(unit_raw, bool):
                    raise ValueError(f"investmentRecords[{i}].unit must be a number")
                if isinstance(unit_raw, Decimal):
                    uf = float(unit_raw)
                elif isinstance(unit_raw, (int, float)):
                    uf = float(unit_raw)
                elif isinstance(unit_raw, str):
                    try:
                        uf = float(unit_raw.strip())
                    except ValueError as exc:
                        raise ValueError(
                            f"investmentRecords[{i}].unit must be a number"
                        ) from exc
                else:
                    raise ValueError(f"investmentRecords[{i}].unit must be a number")
                if uf != uf or abs(uf) > 1e15:
                    raise ValueError(f"investmentRecords[{i}].unit out of range")
                rec["unit"] = uf
        out.append(rec)
    return out


def _load_investment_records(table: Any) -> list[dict[str, Any]]:
    res = table.get_item(Key=_finance_sheet_ddb_key("investments"))
    item = res.get("Item")
    if not item:
        return []
    payload = {k: v for k, v in item.items() if k not in ("pk", "sk")}
    nested = _from_ddb_nested(payload)
    if not isinstance(nested, dict):
        return []
    return _sanitize_investment_records_list(nested.get("records"))


def _sanitize_savings_records_list(raw: Any) -> list[dict[str, Any]]:
    """Best-effort coercion for GET responses (drops invalid rows)."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            continue
        dep = row.get("deposit")
        if not isinstance(dep, str) or not dep.strip():
            continue
        d = dep.strip()
        if len(d) > MAX_INVESTMENT_PROVIDER_LEN:
            d = d[:MAX_INVESTMENT_PROVIDER_LEN]
        amt = row.get("value")
        if isinstance(amt, Decimal):
            amt_f = float(amt)
        elif isinstance(amt, (int, float)) and not isinstance(amt, bool):
            amt_f = float(amt)
        elif isinstance(amt, str):
            try:
                amt_f = float(amt)
            except ValueError:
                continue
        else:
            continue
        if amt_f != amt_f or abs(amt_f) > 1e15:
            continue
        cur = _coerce_finance_currency_value(
            row.get("currency"), DEFAULT_FINANCE_CURRENCY
        )
        desc_raw = row.get("description")
        desc = ""
        if isinstance(desc_raw, str):
            desc = desc_raw.strip()
            if len(desc) > MAX_FINANCE_DESCRIPTION:
                desc = desc[:MAX_FINANCE_DESCRIPTION]
        at_raw = row.get("assetType")
        if at_raw in ASSET_TYPES:
            at = str(at_raw)
        else:
            at = "Fixed"
        out.append(
            {
                "id": rid.strip(),
                "deposit": d,
                "assetType": at,
                "description": desc,
                "value": amt_f,
                "currency": cur,
            }
        )
    return out


def _is_calendar_date_string(s: str) -> bool:
    """True if `s` is a valid ISO calendar date `YYYY-MM-DD`."""
    if not isinstance(s, str) or len(s) != 10:
        return False
    try:
        date.fromisoformat(s)
    except ValueError:
        return False
    return True


def _pension_row_signature(row: dict[str, Any]) -> tuple[str, str, float, str]:
    return (
        row["fund"],
        row["description"],
        float(row["value"]),
        row["currency"],
    )


def _merge_pension_last_updated(
    normalized: list[dict[str, Any]],
    existing: list[dict[str, Any]],
    *,
    today_iso: str | None = None,
) -> list[dict[str, Any]]:
    """Attach `lastUpdated` (UTC calendar date) per row: new/changed rows get today; unchanged keep prior."""
    today = today_iso or datetime.now(timezone.utc).date().isoformat()
    by_id = {r["id"]: r for r in existing}
    out: list[dict[str, Any]] = []
    for row in normalized:
        merged = dict(row)
        prev = by_id.get(merged["id"])
        if prev is None:
            merged["lastUpdated"] = today
        elif _pension_row_signature(prev) == _pension_row_signature(merged):
            lu = prev.get("lastUpdated")
            if isinstance(lu, str) and _is_calendar_date_string(lu):
                merged["lastUpdated"] = lu
        else:
            merged["lastUpdated"] = today
        out.append(merged)
    return out


def _account_row_signature(row: dict[str, Any]) -> tuple[str, str, int, float, str, float | None]:
    at = str(row["accountType"])
    last_stmt: float | None
    if at == "Credit Card":
        raw = row.get("lastStatementAmount", 0.0)
        if isinstance(raw, Decimal):
            last_stmt = float(raw)
        elif isinstance(raw, (int, float)) and not isinstance(raw, bool):
            last_stmt = float(raw)
        elif isinstance(raw, str):
            try:
                last_stmt = float(raw)
            except ValueError:
                last_stmt = 0.0
        else:
            last_stmt = 0.0
        if last_stmt != last_stmt or abs(last_stmt) > 1e15:
            last_stmt = 0.0
    else:
        last_stmt = None
    return (
        str(row.get("description", "")),
        at,
        int(row["billingCycleDay"]),
        float(row["recordedValue"]),
        str(row["currency"]),
        last_stmt,
    )


def _merge_accounts_last_updated(
    normalized: list[dict[str, Any]],
    existing: list[dict[str, Any]],
    *,
    today_iso: str | None = None,
) -> list[dict[str, Any]]:
    """Attach `lastUpdated` (UTC calendar date) when account fields change."""
    today = today_iso or datetime.now(timezone.utc).date().isoformat()
    by_id = {r["id"]: r for r in existing}
    out: list[dict[str, Any]] = []
    for row in normalized:
        merged = dict(row)
        prev = by_id.get(merged["id"])
        if prev is None:
            merged["lastUpdated"] = today
        elif _account_row_signature(prev) == _account_row_signature(merged):
            lu = prev.get("lastUpdated")
            if isinstance(lu, str) and _is_calendar_date_string(lu):
                merged["lastUpdated"] = lu
        else:
            merged["lastUpdated"] = today
        out.append(merged)
    return out


def _parse_account_billing_cycle_day(raw: Any, field_label: str) -> int:
    if isinstance(raw, bool):
        raise ValueError(f"{field_label} must be an integer from 1 to 31")
    if isinstance(raw, int):
        d = raw
    elif isinstance(raw, Decimal):
        as_int = int(raw)
        if Decimal(as_int) != raw:
            raise ValueError(f"{field_label} must be an integer from 1 to 31")
        d = as_int
    elif isinstance(raw, float):
        if not raw.is_integer():
            raise ValueError(f"{field_label} must be an integer from 1 to 31")
        d = int(raw)
    elif isinstance(raw, str):
        t = raw.strip()
        if not t:
            raise ValueError(f"{field_label} is required")
        try:
            d = int(t, 10)
        except ValueError as exc:
            raise ValueError(f"{field_label} must be an integer from 1 to 31") from exc
    else:
        raise ValueError(f"{field_label} must be an integer from 1 to 31")
    if d < 1 or d > 31:
        raise ValueError(f"{field_label} must be between 1 and 31")
    return d


def _ledger_row_monthly_amount(row: dict[str, Any]) -> float:
    amt = float(row["amount"])
    return amt / 12.0 if row.get("amountPeriod") == "year" else amt


_FINANCE_LEDGER_RELATED_HOUSE_LABELS: dict[str, str] = {
    "hillmarton": "32 Hillmarton",
    "morrison": "The Morrison",
}

_DERIVED_TAGGED_INCOME_SPECS: tuple[dict[str, str], ...] = (
    {
        "id_segment": "tax-on-income",
        "category": "Tax",
        "title": "Tax on Income",
        "income_flag": "isTax",
        "percent_key": "taxOnIncomePercent",
    },
    {
        "id_segment": "investment-on-income",
        "category": "Investment",
        "title": "Investments on Income",
        "income_flag": "isInvestment",
        "percent_key": "investmentOnIncomePercent",
    },
    {
        "id_segment": "saving-on-income",
        "category": "Saving",
        "title": "Savings on Income",
        "income_flag": "isSaving",
        "percent_key": "savingOnIncomePercent",
    },
)


def _sum_monthly_tagged_income_by_house_currency(
    income_rows: list[dict[str, Any]],
    house_key: str,
    income_flag: str,
) -> dict[str, float]:
    out: dict[str, float] = {}
    for r in income_rows:
        if r.get("amountPeriod") != "month" or r.get("relatedHouse") != house_key:
            continue
        if not r.get(income_flag):
            continue
        cur = str(r.get("currency") or DEFAULT_FINANCE_CURRENCY)
        amt = r.get("amount")
        if isinstance(amt, Decimal):
            amt_f = float(amt)
        elif isinstance(amt, (int, float)) and not isinstance(amt, bool):
            amt_f = float(amt)
        else:
            continue
        if amt_f != amt_f or abs(amt_f) > 1e15:
            continue
        out[cur] = out.get(cur, 0.0) + amt_f
    return out


def _sum_monthly_tagged_income_without_related_house_by_currency(
    income_rows: list[dict[str, Any]],
    income_flag: str,
) -> dict[str, float]:
    out: dict[str, float] = {}
    for r in income_rows:
        if r.get("amountPeriod") != "month" or not r.get(income_flag):
            continue
        rh = r.get("relatedHouse")
        if rh in FINANCE_HOUSE_KEYS:
            continue
        cur = str(r.get("currency") or DEFAULT_FINANCE_CURRENCY)
        amt = r.get("amount")
        if isinstance(amt, Decimal):
            amt_f = float(amt)
        elif isinstance(amt, (int, float)) and not isinstance(amt, bool):
            amt_f = float(amt)
        else:
            continue
        if amt_f != amt_f or abs(amt_f) > 1e15:
            continue
        out[cur] = out.get(cur, 0.0) + amt_f
    return out


def _derived_expense_rows_from_tagged_income(
    income_rows: list[dict[str, Any]],
    percents: dict[str, float],
) -> list[dict[str, Any]]:
    """Synthetic expense rows from allocation % × tagged monthly income (matches admin web)."""
    out: list[dict[str, Any]] = []
    houses_order = ("hillmarton", "morrison")
    for house_key in houses_order:
        house_label = _FINANCE_LEDGER_RELATED_HOUSE_LABELS.get(house_key, house_key)
        for spec in _DERIVED_TAGGED_INCOME_SPECS:
            pct = float(percents.get(spec["percent_key"], 0.0))
            if pct <= 0:
                continue
            by_ccy = _sum_monthly_tagged_income_by_house_currency(
                income_rows, house_key, spec["income_flag"]
            )
            for currency, base in by_ccy.items():
                if base <= 0:
                    continue
                amount = base * (pct / 100.0)
                if amount != amount or abs(amount) > 1e15 or amount == 0:
                    continue
                rid = f"__derived__{spec['id_segment']}__{house_key}__{currency}"
                out.append(
                    {
                        "id": rid,
                        "category": spec["category"],
                        "description": f"{spec['title']} ({house_label})",
                        "amount": amount,
                        "currency": currency,
                        "amountPeriod": "month",
                        "relatedHouse": house_key,
                    }
                )
    for spec in _DERIVED_TAGGED_INCOME_SPECS:
        pct = float(percents.get(spec["percent_key"], 0.0))
        if pct <= 0:
            continue
        by_ccy = _sum_monthly_tagged_income_without_related_house_by_currency(
            income_rows, spec["income_flag"]
        )
        for currency, base in by_ccy.items():
            if base <= 0:
                continue
            amount = base * (pct / 100.0)
            if amount != amount or abs(amount) > 1e15 or amount == 0:
                continue
            rid = f"__derived__{spec['id_segment']}__unallocated__{currency}"
            out.append(
                {
                    "id": rid,
                    "category": spec["category"],
                    "description": f"{spec['title']} (no related property)",
                    "amount": amount,
                    "currency": currency,
                    "amountPeriod": "month",
                }
            )
    return out


def _allocated_expense_ids_for_allocations(table: Any) -> frozenset[str]:
    """Real expense rows tagged Allocate plus synthetic derived allocation lines."""
    exp_rows, perc = _load_finance_expenses_ledger_with_allocation(table)
    inc = _load_finance_sheet(table, "income", INCOME_RECORD_CATEGORIES)
    derived = _derived_expense_rows_from_tagged_income(inc, perc)
    ids: set[str] = {
        str(r["id"]) for r in exp_rows if isinstance(r, dict) and r.get("isAllocate")
    }
    ids |= {str(r["id"]) for r in derived}
    return frozenset(ids)


_CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX = "__custom__"


def _is_custom_allocation_expense_id(eid: str) -> bool:
    if not isinstance(eid, str) or not eid.strip():
        return False
    s = eid.strip()
    if not s.startswith(_CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX):
        return False
    rest = s[len(_CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX) :].strip()
    if len(rest) < 32:
        return False
    try:
        uuid.UUID(rest)
    except ValueError:
        return False
    return True


def _sanitize_allocation_stored_list(raw: Any) -> list[dict[str, Any]]:
    """Coerce persisted allocation rows (linked expense/derived or custom)."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        eid_raw = row.get("expenseId")
        if not isinstance(eid_raw, str) or not eid_raw.strip():
            continue
        eid = eid_raw.strip()
        amt = row.get("accumulatedAmount")
        if isinstance(amt, Decimal):
            amt_f = float(amt)
        elif isinstance(amt, (int, float)) and not isinstance(amt, bool):
            amt_f = float(amt)
        elif isinstance(amt, str):
            try:
                amt_f = float(amt)
            except ValueError:
                continue
        else:
            continue
        if abs(amt_f) > 1e15:
            continue
        lu = row.get("lastUpdated")
        last_u: str | None = lu if isinstance(lu, str) and _is_calendar_date_string(lu) else None
        if _is_custom_allocation_expense_id(eid):
            desc_raw = row.get("description")
            if not isinstance(desc_raw, str) or not desc_raw.strip():
                continue
            d = desc_raw.strip()
            if len(d) > MAX_FINANCE_DESCRIPTION:
                d = d[:MAX_FINANCE_DESCRIPTION]
            cur = _coerce_finance_currency_value(
                row.get("currency"), DEFAULT_FINANCE_CURRENCY
            )
            rec: dict[str, Any] = {
                "expenseId": eid,
                "description": d,
                "currency": cur,
                "accumulatedAmount": amt_f,
            }
            if row.get("isIncome") is True:
                rec["isIncome"] = True
                aim = row.get("allocationIncomeMonthly")
                aim_f: float | None = None
                if isinstance(aim, Decimal):
                    aim_f = float(aim)
                elif isinstance(aim, (int, float)) and not isinstance(aim, bool):
                    aim_f = float(aim)
                elif isinstance(aim, str):
                    try:
                        aim_f = float(aim)
                    except ValueError:
                        aim_f = None
                if aim_f is not None and aim_f == aim_f and abs(aim_f) <= 1e15:
                    rec["allocationIncomeMonthly"] = aim_f
            if row.get("isPension") is True:
                rec["isPension"] = True
            if last_u is not None:
                rec["lastUpdated"] = last_u
            out.append(rec)
        else:
            rec = {"expenseId": eid, "accumulatedAmount": amt_f}
            if row.get("isIncome") is True:
                rec["isIncome"] = True
            if row.get("isPension") is True:
                rec["isPension"] = True
            if last_u is not None:
                rec["lastUpdated"] = last_u
            out.append(rec)
    return out


def _load_allocation_stored_records(table: Any) -> list[dict[str, Any]]:
    res = table.get_item(Key=_finance_sheet_ddb_key("allocations"))
    item = res.get("Item")
    if not item:
        return []
    payload = {k: v for k, v in item.items() if k not in ("pk", "sk")}
    nested = _from_ddb_nested(payload)
    if not isinstance(nested, dict):
        return []
    return _sanitize_allocation_stored_list(nested.get("records"))


def _custom_allocation_row_signature(row: dict[str, Any]) -> tuple[Any, ...]:
    desc = row.get("description")
    d = desc.strip() if isinstance(desc, str) else ""
    cur = str(row.get("currency") or DEFAULT_FINANCE_CURRENCY)
    inc = row.get("isIncome") is True
    aim: float | None = None
    if inc:
        raw = row.get("allocationIncomeMonthly")
        if isinstance(raw, Decimal):
            aim = float(raw)
        elif isinstance(raw, (int, float)) and not isinstance(raw, bool):
            aim = float(raw)
        elif isinstance(raw, str):
            try:
                aim = float(raw)
            except ValueError:
                aim = None
    return (d, cur, float(row.get("accumulatedAmount", 0.0)), inc, aim, row.get("isPension") is True)


def _merge_allocation_stored_last_updated(
    normalized: list[dict[str, Any]],
    existing: list[dict[str, Any]],
    *,
    today_iso: str | None = None,
) -> list[dict[str, Any]]:
    """Persisted shape: linked rows have expenseId + accumulatedAmount; custom rows add description + currency."""
    today = today_iso or datetime.now(timezone.utc).date().isoformat()
    by_id = {r["expenseId"]: r for r in existing}
    out: list[dict[str, Any]] = []
    for row in normalized:
        eid = row["expenseId"]
        amt = float(row["accumulatedAmount"])
        if _is_custom_allocation_expense_id(eid):
            desc = str(row.get("description", "")).strip()
            cur = _coerce_finance_currency_value(
                row.get("currency"), DEFAULT_FINANCE_CURRENCY
            )
            merged: dict[str, Any] = {
                "expenseId": eid,
                "description": desc,
                "currency": cur,
                "accumulatedAmount": amt,
            }
            if row.get("isIncome") is True:
                merged["isIncome"] = True
                aim_raw = row.get("allocationIncomeMonthly")
                if isinstance(aim_raw, Decimal):
                    merged["allocationIncomeMonthly"] = float(aim_raw)
                elif isinstance(aim_raw, (int, float)) and not isinstance(aim_raw, bool):
                    merged["allocationIncomeMonthly"] = float(aim_raw)
                elif isinstance(aim_raw, str):
                    try:
                        merged["allocationIncomeMonthly"] = float(aim_raw)
                    except ValueError:
                        pass
            if row.get("isPension") is True:
                merged["isPension"] = True
            prev = by_id.get(eid)
            if prev is None:
                merged["lastUpdated"] = today
            elif _custom_allocation_row_signature(prev) == _custom_allocation_row_signature(
                merged
            ):
                lu = prev.get("lastUpdated")
                if isinstance(lu, str) and _is_calendar_date_string(lu):
                    merged["lastUpdated"] = lu
            else:
                merged["lastUpdated"] = today
            out.append(merged)
        else:
            merged = {"expenseId": eid, "accumulatedAmount": amt}
            if row.get("isIncome") is True:
                merged["isIncome"] = True
            if row.get("isPension") is True:
                merged["isPension"] = True
            prev = by_id.get(eid)
            prev_inc = prev.get("isIncome") is True if prev else False
            new_inc = merged.get("isIncome") is True
            prev_pen = prev.get("isPension") is True if prev else False
            new_pen = merged.get("isPension") is True
            if prev is None:
                if amt != 0.0 or new_inc or new_pen:
                    merged["lastUpdated"] = today
            else:
                prev_amt = float(prev.get("accumulatedAmount", 0.0))
                amt_same = abs(prev_amt - amt) < 1e-9
                inc_same = prev_inc == new_inc
                pen_same = prev_pen == new_pen
                if amt_same and inc_same and pen_same:
                    lu = prev.get("lastUpdated")
                    if isinstance(lu, str) and _is_calendar_date_string(lu):
                        merged["lastUpdated"] = lu
                else:
                    merged["lastUpdated"] = today
            out.append(merged)
    return out


def _normalize_allocations_sheet_payload(
    body: dict[str, Any],
    allocated_expense_ids: frozenset[str],
) -> list[dict[str, Any]]:
    if not isinstance(body, dict):
        raise ValueError("Body must be a JSON object")
    raw = body.get("allocationRecords")
    if not isinstance(raw, list):
        raise ValueError("allocationRecords must be an array")
    if len(raw) > MAX_LEDGER_RECORDS:
        raise ValueError(
            f"At most {MAX_LEDGER_RECORDS} records allowed in allocationRecords"
        )
    seen: set[str] = set()
    linked_out: list[dict[str, Any]] = []
    custom_out: list[dict[str, Any]] = []
    linked_seen: set[str] = set()
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise ValueError(f"allocationRecords[{i}] must be an object")
        eid_raw = row.get("expenseId")
        if not isinstance(eid_raw, str) or not eid_raw.strip():
            raise ValueError(f"allocationRecords[{i}].expenseId is required")
        eid = eid_raw.strip()
        if eid in seen:
            raise ValueError(f"allocationRecords[{i}].expenseId is duplicated")
        seen.add(eid)
        amt_raw = row.get("accumulatedAmount")
        if isinstance(amt_raw, Decimal):
            amt_f = float(amt_raw)
        elif isinstance(amt_raw, (int, float)) and not isinstance(amt_raw, bool):
            amt_f = float(amt_raw)
        elif isinstance(amt_raw, str):
            try:
                amt_f = float(amt_raw)
            except ValueError as exc:
                raise ValueError(
                    f"allocationRecords[{i}].accumulatedAmount must be a number"
                ) from exc
        else:
            raise ValueError(
                f"allocationRecords[{i}].accumulatedAmount must be a number"
            )
        if abs(amt_f) > 1e15:
            raise ValueError(
                f"allocationRecords[{i}].accumulatedAmount out of range"
            )
        if _is_custom_allocation_expense_id(eid):
            desc = row.get("description")
            if not isinstance(desc, str) or not desc.strip():
                raise ValueError(
                    f"allocationRecords[{i}].description is required for custom allocations"
                )
            d = desc.strip()
            if len(d) > MAX_FINANCE_DESCRIPTION:
                raise ValueError(
                    f"allocationRecords[{i}].description is too long"
                )
            cur = _require_supported_currency(
                row.get("currency", DEFAULT_FINANCE_CURRENCY),
                f"allocationRecords[{i}].currency",
            )
            is_inc = row.get("isIncome") is True
            rec_c: dict[str, Any] = {
                "expenseId": eid,
                "description": d,
                "currency": cur,
                "accumulatedAmount": amt_f,
            }
            if is_inc:
                aim_raw = row.get("allocationIncomeMonthly")
                if isinstance(aim_raw, Decimal):
                    aim_f = float(aim_raw)
                elif isinstance(aim_raw, (int, float)) and not isinstance(aim_raw, bool):
                    aim_f = float(aim_raw)
                elif isinstance(aim_raw, str):
                    try:
                        aim_f = float(aim_raw)
                    except ValueError as exc:
                        raise ValueError(
                            f"allocationRecords[{i}].allocationIncomeMonthly must be a number"
                        ) from exc
                else:
                    raise ValueError(
                        f"allocationRecords[{i}].allocationIncomeMonthly is required when isIncome is true"
                    )
                if aim_f != aim_f or abs(aim_f) > 1e15:
                    raise ValueError(
                        f"allocationRecords[{i}].allocationIncomeMonthly out of range"
                    )
                if aim_f <= 0:
                    raise ValueError(
                        f"allocationRecords[{i}].allocationIncomeMonthly must be positive when isIncome is true"
                    )
                rec_c["isIncome"] = True
                rec_c["allocationIncomeMonthly"] = aim_f
            if row.get("isPension") is True:
                rec_c["isPension"] = True
            custom_out.append(rec_c)
        else:
            if eid not in allocated_expense_ids:
                raise ValueError(
                    f"allocationRecords[{i}].expenseId is not an allocated or derived allocation line"
                )
            linked_seen.add(eid)
            rec_l: dict[str, Any] = {"expenseId": eid, "accumulatedAmount": amt_f}
            if row.get("isIncome") is True:
                rec_l["isIncome"] = True
            if row.get("isPension") is True:
                rec_l["isPension"] = True
            linked_out.append(rec_l)
    if linked_seen != allocated_expense_ids:
        missing = allocated_expense_ids - linked_seen
        extra = linked_seen - allocated_expense_ids
        parts: list[str] = []
        if missing:
            parts.append(f"missing expenseIds: {', '.join(sorted(missing))}")
        if extra:
            parts.append(f"unexpected expenseIds: {', '.join(sorted(extra))}")
        raise ValueError(
            "allocationRecords must include exactly one entry per allocated expense "
            "and derived allocation line"
            + (f" ({'; '.join(parts)})" if parts else "")
        )
    return linked_out + custom_out


def _build_allocation_records_for_response(
    expense_rows: list[dict[str, Any]],
    stored: list[dict[str, Any]],
    income_rows: list[dict[str, Any]],
    expense_allocation_percents: dict[str, float],
) -> list[dict[str, Any]]:
    """Merge tagged expenses, derived lines, and custom allocation rows."""
    by_stored = {r["expenseId"]: r for r in stored}
    out: list[dict[str, Any]] = []

    def append_linked_allocation_row(er: dict[str, Any]) -> None:
        eid = str(er["id"])
        st = by_stored.get(eid, {})
        acc = float(st.get("accumulatedAmount", 0.0))
        lu = st.get("lastUpdated")
        last_u: str | None = lu if isinstance(lu, str) and _is_calendar_date_string(lu) else None
        row_out: dict[str, Any] = {
            "expenseId": eid,
            "description": er["description"],
            "monthlyAmount": _ledger_row_monthly_amount(er),
            "accumulatedAmount": acc,
            "currency": er["currency"],
            "isCustomAllocation": False,
        }
        rh = er.get("relatedHouse")
        if rh in FINANCE_HOUSE_KEYS:
            row_out["relatedHouse"] = rh
        if st.get("isIncome") is True:
            row_out["isIncome"] = True
        if st.get("isPension") is True:
            row_out["isPension"] = True
        if last_u is not None:
            row_out["lastUpdated"] = last_u
        out.append(row_out)

    for er in expense_rows:
        if not er.get("isAllocate"):
            continue
        append_linked_allocation_row(er)
    derived = _derived_expense_rows_from_tagged_income(
        income_rows, expense_allocation_percents
    )
    for er in derived:
        append_linked_allocation_row(er)
    for st in stored:
        eid = str(st.get("expenseId", ""))
        if not _is_custom_allocation_expense_id(eid):
            continue
        desc = st.get("description")
        if not isinstance(desc, str) or not desc.strip():
            continue
        cur = _coerce_finance_currency_value(
            st.get("currency"), DEFAULT_FINANCE_CURRENCY
        )
        acc = float(st.get("accumulatedAmount", 0.0))
        lu = st.get("lastUpdated")
        last_u: str | None = lu if isinstance(lu, str) and _is_calendar_date_string(lu) else None
        is_inc = st.get("isIncome") is True
        aim = 0.0
        if is_inc:
            raw_aim = st.get("allocationIncomeMonthly")
            if isinstance(raw_aim, Decimal):
                aim = float(raw_aim)
            elif isinstance(raw_aim, (int, float)) and not isinstance(raw_aim, bool):
                aim = float(raw_aim)
            elif isinstance(raw_aim, str):
                try:
                    aim = float(raw_aim)
                except ValueError:
                    aim = 0.0
            else:
                aim = 0.0
        row_out: dict[str, Any] = {
            "expenseId": eid,
            "description": desc.strip(),
            "monthlyAmount": 0.0,
            "accumulatedAmount": acc,
            "currency": cur,
            "isCustomAllocation": True,
        }
        if is_inc:
            row_out["isIncome"] = True
            row_out["allocationIncomeMonthly"] = aim
        if st.get("isPension") is True:
            row_out["isPension"] = True
        if last_u is not None:
            row_out["lastUpdated"] = last_u
        out.append(row_out)
    out.sort(key=lambda r: (str(r["description"]).lower(), str(r["expenseId"])))
    return out


def _sanitize_pension_records_list(raw: Any) -> list[dict[str, Any]]:
    """Best-effort coercion for GET responses (drops invalid rows)."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            continue
        fund = row.get("fund")
        if not isinstance(fund, str) or not fund.strip():
            continue
        f = fund.strip()
        if len(f) > MAX_INVESTMENT_PROVIDER_LEN:
            f = f[:MAX_INVESTMENT_PROVIDER_LEN]
        amt = row.get("value")
        if isinstance(amt, Decimal):
            amt_f = float(amt)
        elif isinstance(amt, (int, float)) and not isinstance(amt, bool):
            amt_f = float(amt)
        elif isinstance(amt, str):
            try:
                amt_f = float(amt)
            except ValueError:
                continue
        else:
            continue
        if amt_f != amt_f or abs(amt_f) > 1e15:
            continue
        cur = _coerce_finance_currency_value(
            row.get("currency"), DEFAULT_FINANCE_CURRENCY
        )
        desc_raw = row.get("description")
        d = ""
        if isinstance(desc_raw, str):
            d = desc_raw.strip()
            if len(d) > MAX_FINANCE_DESCRIPTION:
                d = d[:MAX_FINANCE_DESCRIPTION]
        entry: dict[str, Any] = {
            "id": rid.strip(),
            "fund": f,
            "description": d,
            "value": amt_f,
            "currency": cur,
        }
        lu_raw = row.get("lastUpdated")
        if isinstance(lu_raw, str) and _is_calendar_date_string(lu_raw.strip()):
            entry["lastUpdated"] = lu_raw.strip()
        out.append(entry)
    return out


def _sanitize_accounts_records_list(raw: Any) -> list[dict[str, Any]]:
    """Best-effort coercion for GET responses (drops invalid rows)."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            continue
        at_raw = row.get("accountType")
        if not isinstance(at_raw, str) or at_raw.strip() not in FINANCE_ACCOUNT_TYPES:
            continue
        account_type = at_raw.strip()
        try:
            bd = _parse_account_billing_cycle_day(row.get("billingCycleDay"), "billingCycleDay")
        except ValueError:
            continue
        amt = row.get("recordedValue")
        if isinstance(amt, Decimal):
            amt_f = float(amt)
        elif isinstance(amt, (int, float)) and not isinstance(amt, bool):
            amt_f = float(amt)
        elif isinstance(amt, str):
            try:
                amt_f = float(amt)
            except ValueError:
                continue
        else:
            continue
        if amt_f != amt_f or abs(amt_f) > 1e15:
            continue
        cur = _coerce_finance_currency_value(
            row.get("currency"), DEFAULT_FINANCE_CURRENCY
        )
        desc_raw = row.get("description", "")
        if desc_raw is None:
            desc_raw = ""
        if not isinstance(desc_raw, str):
            continue
        d = desc_raw.strip()
        if len(d) > MAX_FINANCE_DESCRIPTION:
            d = d[:MAX_FINANCE_DESCRIPTION]
        entry: dict[str, Any] = {
            "id": rid.strip(),
            "description": d,
            "accountType": account_type,
            "billingCycleDay": bd,
            "recordedValue": amt_f,
            "currency": cur,
        }
        if account_type == "Credit Card":
            lsa_raw = row.get("lastStatementAmount", 0.0)
            if isinstance(lsa_raw, Decimal):
                lsa_f = float(lsa_raw)
            elif isinstance(lsa_raw, (int, float)) and not isinstance(lsa_raw, bool):
                lsa_f = float(lsa_raw)
            elif isinstance(lsa_raw, str):
                try:
                    lsa_f = float(lsa_raw)
                except ValueError:
                    lsa_f = 0.0
            else:
                lsa_f = 0.0
            if lsa_f != lsa_f or abs(lsa_f) > 1e15:
                lsa_f = 0.0
            entry["lastStatementAmount"] = lsa_f
        lu_raw = row.get("lastUpdated")
        if isinstance(lu_raw, str) and _is_calendar_date_string(lu_raw.strip()):
            entry["lastUpdated"] = lu_raw.strip()
        out.append(entry)
    return out


def _normalize_accounts_sheet_payload(body: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(body, dict):
        raise ValueError("Body must be a JSON object")
    raw = body.get("accountRecords")
    if not isinstance(raw, list):
        raise ValueError("accountRecords must be an array")
    if len(raw) > MAX_LEDGER_RECORDS:
        raise ValueError(
            f"At most {MAX_LEDGER_RECORDS} records allowed in accountRecords"
        )
    allowed_at = ", ".join(sorted(FINANCE_ACCOUNT_TYPES))
    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise ValueError(f"accountRecords[{i}] must be an object")
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            raise ValueError(f"accountRecords[{i}].id is required")
        at_raw = row.get("accountType")
        if not isinstance(at_raw, str) or not at_raw.strip():
            raise ValueError(f"accountRecords[{i}].accountType is required")
        at_st = at_raw.strip()
        if at_st not in FINANCE_ACCOUNT_TYPES:
            raise ValueError(
                f"accountRecords[{i}].accountType must be one of: {allowed_at}"
            )
        bd = _parse_account_billing_cycle_day(
            row.get("billingCycleDay"), f"accountRecords[{i}].billingCycleDay"
        )
        amt = row.get("recordedValue")
        if isinstance(amt, Decimal):
            amt = float(amt)
        if not isinstance(amt, (int, float)) or isinstance(amt, bool):
            raise ValueError(f"accountRecords[{i}].recordedValue must be a number")
        amt_f = float(amt)
        if amt_f != amt_f or abs(amt_f) > 1e15:
            raise ValueError(f"accountRecords[{i}].recordedValue out of range")
        cur = _require_supported_currency(
            row.get("currency", DEFAULT_FINANCE_CURRENCY),
            f"accountRecords[{i}].currency",
        )
        desc_raw = row.get("description", "")
        if desc_raw is None:
            desc_raw = ""
        if not isinstance(desc_raw, str):
            raise ValueError(f"accountRecords[{i}].description must be a string")
        d = desc_raw.strip()
        if len(d) > MAX_FINANCE_DESCRIPTION:
            raise ValueError(f"accountRecords[{i}].description is too long")
        rec_out: dict[str, Any] = {
            "id": rid.strip(),
            "description": d,
            "accountType": at_st,
            "billingCycleDay": bd,
            "recordedValue": amt_f,
            "currency": cur,
        }
        if at_st == "Credit Card":
            lsa_raw = row.get("lastStatementAmount", 0.0)
            if isinstance(lsa_raw, Decimal):
                lsa_raw = float(lsa_raw)
            if not isinstance(lsa_raw, (int, float)) or isinstance(lsa_raw, bool):
                raise ValueError(
                    f"accountRecords[{i}].lastStatementAmount must be a number"
                )
            lsa_f = float(lsa_raw)
            if lsa_f != lsa_f or abs(lsa_f) > 1e15:
                raise ValueError(
                    f"accountRecords[{i}].lastStatementAmount out of range"
                )
            rec_out["lastStatementAmount"] = lsa_f
        out.append(rec_out)
    return out


def _normalize_savings_sheet_payload(body: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(body, dict):
        raise ValueError("Body must be a JSON object")
    raw = body.get("savingsRecords")
    if not isinstance(raw, list):
        raise ValueError("savingsRecords must be an array")
    if len(raw) > MAX_LEDGER_RECORDS:
        raise ValueError(
            f"At most {MAX_LEDGER_RECORDS} records allowed in savingsRecords"
        )
    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise ValueError(f"savingsRecords[{i}] must be an object")
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            raise ValueError(f"savingsRecords[{i}].id is required")
        dep = row.get("deposit")
        if not isinstance(dep, str) or not dep.strip():
            raise ValueError(f"savingsRecords[{i}].deposit is required")
        if len(dep.strip()) > MAX_INVESTMENT_PROVIDER_LEN:
            raise ValueError(f"savingsRecords[{i}].deposit is too long")
        amt = row.get("value")
        if isinstance(amt, Decimal):
            amt = float(amt)
        if not isinstance(amt, (int, float)) or isinstance(amt, bool):
            raise ValueError(f"savingsRecords[{i}].value must be a number")
        amt_f = float(amt)
        if amt_f != amt_f or abs(amt_f) > 1e15:
            raise ValueError(f"savingsRecords[{i}].value out of range")
        cur = _require_supported_currency(
            row.get("currency", DEFAULT_FINANCE_CURRENCY),
            f"savingsRecords[{i}].currency",
        )
        desc_raw = row.get("description", "")
        if desc_raw is None:
            desc_raw = ""
        if not isinstance(desc_raw, str):
            raise ValueError(f"savingsRecords[{i}].description must be a string")
        d = desc_raw.strip()
        if len(d) > MAX_FINANCE_DESCRIPTION:
            raise ValueError(f"savingsRecords[{i}].description is too long")
        allowed_at = ", ".join(sorted(ASSET_TYPES))
        at_raw = row.get("assetType")
        if at_raw is None or at_raw == "":
            at = "Fixed"
        elif not isinstance(at_raw, str):
            raise ValueError(f"savingsRecords[{i}].assetType must be a string")
        else:
            at_st = at_raw.strip()
            if not at_st:
                at = "Fixed"
            elif at_st not in ASSET_TYPES:
                raise ValueError(
                    f"savingsRecords[{i}].assetType must be one of: {allowed_at}"
                )
            else:
                at = at_st
        out.append(
            {
                "id": rid.strip(),
                "deposit": dep.strip(),
                "assetType": at,
                "description": d,
                "value": amt_f,
                "currency": cur,
            }
        )
    return out


def _normalize_pension_sheet_payload(body: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(body, dict):
        raise ValueError("Body must be a JSON object")
    raw = body.get("pensionRecords")
    if not isinstance(raw, list):
        raise ValueError("pensionRecords must be an array")
    if len(raw) > MAX_LEDGER_RECORDS:
        raise ValueError(
            f"At most {MAX_LEDGER_RECORDS} records allowed in pensionRecords"
        )
    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise ValueError(f"pensionRecords[{i}] must be an object")
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            raise ValueError(f"pensionRecords[{i}].id is required")
        fund = row.get("fund")
        if not isinstance(fund, str) or not fund.strip():
            raise ValueError(f"pensionRecords[{i}].fund is required")
        if len(fund.strip()) > MAX_INVESTMENT_PROVIDER_LEN:
            raise ValueError(f"pensionRecords[{i}].fund is too long")
        desc_raw = row.get("description", "")
        if desc_raw is None:
            desc_raw = ""
        if not isinstance(desc_raw, str):
            raise ValueError(f"pensionRecords[{i}].description must be a string")
        d = desc_raw.strip()
        if len(d) > MAX_FINANCE_DESCRIPTION:
            raise ValueError(f"pensionRecords[{i}].description is too long")
        amt = row.get("value")
        if isinstance(amt, Decimal):
            amt = float(amt)
        if not isinstance(amt, (int, float)) or isinstance(amt, bool):
            raise ValueError(f"pensionRecords[{i}].value must be a number")
        amt_f = float(amt)
        if amt_f != amt_f or abs(amt_f) > 1e15:
            raise ValueError(f"pensionRecords[{i}].value out of range")
        cur = _require_supported_currency(
            row.get("currency", DEFAULT_FINANCE_CURRENCY),
            f"pensionRecords[{i}].currency",
        )
        out.append(
            {
                "id": rid.strip(),
                "fund": fund.strip(),
                "description": d,
                "value": amt_f,
                "currency": cur,
            }
        )
    return out


def _load_savings_records(table: Any) -> list[dict[str, Any]]:
    res = table.get_item(Key=_finance_sheet_ddb_key("savings"))
    item = res.get("Item")
    if not item:
        return []
    payload = {k: v for k, v in item.items() if k not in ("pk", "sk")}
    nested = _from_ddb_nested(payload)
    if not isinstance(nested, dict):
        return []
    return _sanitize_savings_records_list(nested.get("records"))


def _load_pension_records(table: Any) -> list[dict[str, Any]]:
    res = table.get_item(Key=_finance_sheet_ddb_key("pension"))
    item = res.get("Item")
    if not item:
        return []
    payload = {k: v for k, v in item.items() if k not in ("pk", "sk")}
    nested = _from_ddb_nested(payload)
    if not isinstance(nested, dict):
        return []
    return _sanitize_pension_records_list(nested.get("records"))


def _load_accounts_records(table: Any) -> list[dict[str, Any]]:
    res = table.get_item(Key=_finance_sheet_ddb_key("accounts"))
    item = res.get("Item")
    if not item:
        return []
    payload = {k: v for k, v in item.items() if k not in ("pk", "sk")}
    nested = _from_ddb_nested(payload)
    if not isinstance(nested, dict):
        return []
    return _sanitize_accounts_records_list(nested.get("records"))


def _finance_ddb_key(house: str) -> dict[str, str]:
    return {"pk": f"FINANCE#house#{house}", "sk": "STATE"}


def _load_finance_house(table: Any, house: str) -> dict[str, Any]:
    res = table.get_item(Key=_finance_ddb_key(house))
    item = res.get("Item")
    if not item:
        return _default_finance_house()
    payload = {k: v for k, v in item.items() if k not in ("pk", "sk")}
    nested = _from_ddb_nested(payload)
    if not isinstance(nested, dict):
        return _default_finance_house()
    return _sanitize_finance_house(nested)


def _source_key_to_house_map(table: Any) -> dict[str, str]:
    """Map S3 object keys to finance house keys using imported statement lines."""
    out: dict[str, str] = {}
    for house in FINANCE_HOUSE_KEYS:
        data = _load_finance_house(table, house)
        for ln in data.get("lines") or []:
            if not isinstance(ln, dict):
                continue
            for raw_key in _line_source_asset_keys_raw(ln):
                out.setdefault(raw_key, house)
    return out


def _enrich_scan_items_asset_meta(
    items: list[dict[str, Any]],
    *,
    table: Any,
    bucket: str,
) -> list[dict[str, Any]]:
    """Augment ASSET# / META rows for admin list views.

    Older items may omit ``uploadedAt`` / ``house``; we recover ``house`` from
    finance statement lines and timestamps from S3 ``LastModified`` when needed.
    """
    asset_spans: list[tuple[int, str]] = []
    for idx, it in enumerate(items):
        pk = it.get("pk")
        sk = it.get("sk")
        if not isinstance(pk, str) or not pk.startswith("ASSET#"):
            continue
        if sk != "META":
            continue
        s3_key = pk.removeprefix("ASSET#")
        if not (
            s3_key.startswith("uploads/") or s3_key.startswith("inbound/")
        ):
            continue
        asset_spans.append((idx, s3_key))

    if not asset_spans:
        return items

    key_to_house: dict[str, str] = {}
    if any(
        not str(items[i].get("house") or "").strip() for i, _ in asset_spans
    ):
        key_to_house = _source_key_to_house_map(table)

    out = list(items)
    for idx, s3_key in asset_spans:
        merged = dict(out[idx])
        if not str(merged.get("house") or "").strip():
            inferred = key_to_house.get(s3_key)
            if inferred:
                merged["house"] = inferred
        if not str(merged.get("uploadedAt") or "").strip() and bucket:
            try:
                head = _s3.head_object(Bucket=bucket, Key=s3_key)
            except ClientError:
                head = {}
            lm = head.get("LastModified")
            if isinstance(lm, datetime):
                merged["uploadedAt"] = _utc_iso_z(lm)
        if not str(merged.get("fileName") or "").strip():
            merged["fileName"] = os.path.basename(s3_key)
        out[idx] = merged
    return out


def _persist_asset_meta_after_parse(
    *,
    table: Any,
    s3_key: str,
    house: str,
    head: dict[str, Any],
    file_name: str,
    request_id: str,
    owner_sub: str | None = None,
) -> None:
    """Ensure ASSET META reflects the house and timestamps after a successful import.

    Browser uploads call ``/assets/confirm`` first, so META usually exists and
    we merge. Inbound-email imports write PDFs directly under ``inbound/…``;
    when no META row exists yet, we create one (same visibility as confirm).
    """
    asset_pk = f"ASSET#{s3_key}"
    last_mod = head.get("LastModified")
    if isinstance(last_mod, datetime):
        uploaded_at = _utc_iso_z(last_mod)
    else:
        uploaded_at = _utc_iso_z(datetime.now(timezone.utc))
    size = int(head.get("ContentLength") or 0)
    etag = str(head.get("ETag") or "").strip().strip('"')
    try:
        table.update_item(
            Key={"pk": asset_pk, "sk": "META"},
            UpdateExpression=(
                "SET house = :house, "
                "uploadedAt = if_not_exists(uploadedAt, :ua), "
                "fileName = if_not_exists(fileName, :fn)"
            ),
            ExpressionAttributeValues={
                ":house": house,
                ":ua": uploaded_at,
                ":fn": file_name,
            },
            ConditionExpression="attribute_exists(pk)",
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code == "ConditionalCheckFailedException":
            item: dict[str, Any] = {
                "pk": asset_pk,
                "sk": "META",
                "house": house,
                "uploadedAt": uploaded_at,
                "fileName": file_name,
                "size": size,
                "s3Etag": etag,
                "note": (
                    "metadata from statement import (no prior /assets/confirm; "
                    "e.g. inbound email)"
                ),
            }
            if owner_sub:
                item["ownerSub"] = owner_sub
            table.put_item(Item=_to_ddb(item))
            _log_event(
                "info",
                tag="asset_meta_parse_created",
                key=s3_key[:512],
                house=house,
                request_id=request_id,
            )
            return
        raise


def _finance_sheet_ddb_key(sheet_slug: str) -> dict[str, str]:
    return {"pk": f"FINANCE#sheet#{sheet_slug}", "sk": "STATE"}


def _load_finance_sheet(
    table: Any, sheet_slug: str, categories: frozenset[str]
) -> list[dict[str, Any]]:
    res = table.get_item(Key=_finance_sheet_ddb_key(sheet_slug))
    item = res.get("Item")
    if not item:
        return []
    payload = {k: v for k, v in item.items() if k not in ("pk", "sk")}
    nested = _from_ddb_nested(payload)
    if not isinstance(nested, dict):
        return []
    return _sanitize_ledger_records_list(
        nested.get("records"),
        categories,
        include_income_flags=(sheet_slug == "income"),
        include_expense_flags=False,
    )


def _load_finance_expenses_ledger_with_allocation(
    table: Any,
) -> tuple[list[dict[str, Any]], dict[str, float]]:
    """Expense ledger rows plus optional income-allocation percentages."""
    res = table.get_item(Key=_finance_sheet_ddb_key("expenses"))
    item = res.get("Item")
    if not item:
        return [], _sanitize_expense_income_allocation_percentages(None)
    payload = {k: v for k, v in item.items() if k not in ("pk", "sk")}
    nested = _from_ddb_nested(payload)
    if not isinstance(nested, dict):
        return [], _sanitize_expense_income_allocation_percentages(None)
    records = _sanitize_ledger_records_list(
        nested.get("records"),
        EXPENSE_RECORD_CATEGORIES,
        include_income_flags=False,
        include_expense_flags=True,
    )
    perc = _sanitize_expense_income_allocation_percentages(
        nested.get("expenseIncomeAllocationPercents")
    )
    return records, perc


def _load_existing_expense_income_allocation_percentages(table: Any) -> dict[str, float]:
    """Allocation rates currently stored on the expenses sheet item (if any)."""
    res = table.get_item(Key=_finance_sheet_ddb_key("expenses"))
    item = res.get("Item")
    if not item:
        return _sanitize_expense_income_allocation_percentages(None)
    payload = {k: v for k, v in item.items() if k not in ("pk", "sk")}
    nested = _from_ddb_nested(payload)
    if not isinstance(nested, dict):
        return _sanitize_expense_income_allocation_percentages(None)
    return _sanitize_expense_income_allocation_percentages(
        nested.get("expenseIncomeAllocationPercents")
    )


def _path_finance_house(event: dict[str, Any], path: str) -> str | None:
    pp = (event.get("pathParameters") or {}).get("house")
    if isinstance(pp, str) and pp.strip():
        return pp.strip().lower()
    parts = [p for p in path.split("/") if p]
    if len(parts) == 2 and parts[0] == "finance":
        return parts[1].lower()
    return None


def _validate_record_pk(pk: str) -> bool:
    return isinstance(pk, str) and pk.startswith(RECORD_PK_PREFIX)


FRANKFURTER_API_BASE = "https://api.frankfurter.dev"

YAHOO_FINANCE_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"

# Maximum number of distinct symbols accepted per /finance/quotes request.
# Bounds Lambda fan-out and protects Yahoo from runaway requests.
FINANCE_QUOTES_MAX_SYMBOLS = 50

# Maps the "EXCHANGE:SYMBOL" prefix users type into the admin Investments tab
# (TradingView style) into the Yahoo Finance suffix convention. Empty string
# means "no suffix" (US listings on NASDAQ/NYSE/AMEX/BATS use the bare ticker).
_YAHOO_EXCHANGE_SUFFIX_BY_PREFIX: dict[str, str] = {
    "US": "",
    "USA": "",
    "NASDAQ": "",
    "NYSE": "",
    "NYSEARCA": "",
    "ARCA": "",
    "AMEX": "",
    "BATS": "",
    "CBOE": "",
    "OTC": "",
    "LON": ".L",
    "LSE": ".L",
    "LSIN": ".IL",
    "HK": ".HK",
    "HKG": ".HK",
    "HKEX": ".HK",
    "TYO": ".T",
    "TSE": ".T",  # Tokyo Stock Exchange
    "JPX": ".T",
    "ASX": ".AX",
    "TSX": ".TO",
    "TSXV": ".V",
    "FRA": ".F",
    "ETR": ".DE",
    "XETRA": ".DE",
    "GER": ".DE",
    "PAR": ".PA",
    "EPA": ".PA",
    "AMS": ".AS",
    "EBR": ".BR",
    "BIT": ".MI",
    "MIL": ".MI",
    "BME": ".MC",
    "MAD": ".MC",
    "SWX": ".SW",
    "VIE": ".VI",
    "STO": ".ST",
    "OSL": ".OL",
    "CSE": ".CO",
    "HEL": ".HE",
    "SGX": ".SI",
    "KRX": ".KS",
    "KOSDAQ": ".KQ",
    "TWSE": ".TW",
    "SHA": ".SS",
    "SSE": ".SS",
    "SHE": ".SZ",
    "SZSE": ".SZ",
    "BSE": ".BO",
    "NSE": ".NS",
    "JSE": ".JO",
    "B3": ".SA",
    "BMV": ".MX",
    "BCBA": ".BA",
}

# Crypto codes that should be quoted against USD when the user enters just the
# ticker (e.g. ``BTC`` rather than ``BTC-USD``). The list is intentionally
# permissive — anything we don't recognise still gets a ``-USD`` suffix as a
# default, which is how Yahoo represents crypto pairs.


def _normalize_finance_quote_symbol(raw: str) -> str | None:
    """Convert a user-entered symbol (e.g. ``US:TQQQ``, ``BTC``, ``VWRA.L``)
    into the Yahoo Finance symbol form. Returns ``None`` for empty input.

    Heuristics:
    - ``EXCHANGE:SYMBOL`` is mapped via :data:`_YAHOO_EXCHANGE_SUFFIX_BY_PREFIX`.
      Unknown prefixes pass the bare symbol through unchanged.
    - Bare alphanumeric tokens that look like a crypto ticker (3-5 letters,
      no dot, no dash) get a ``-USD`` suffix so Yahoo treats them as crypto.
    - Anything else (already contains ``.``/``-``/``=``) is passed through.
    """
    if not raw:
        return None
    s = raw.strip()
    if not s:
        return None
    if ":" in s:
        prefix, _, sym = s.partition(":")
        prefix_up = prefix.strip().upper()
        sym = sym.strip()
        if not sym:
            return None
        suffix = _YAHOO_EXCHANGE_SUFFIX_BY_PREFIX.get(prefix_up)
        if suffix is None:
            # Unknown prefix: drop it and pass through the bare symbol.
            return sym.upper() if sym.isascii() and sym.isalnum() else sym
        if suffix == "":
            return sym.upper()
        return f"{sym.upper()}{suffix}"
    if "." in s or "-" in s or "=" in s:
        return s
    # Bare ticker: assume crypto if 2-6 letters all-alpha (Yahoo crypto pairs
    # use ``XXX-USD``); otherwise leave as-is so Yahoo can resolve the equity.
    upper = s.upper()
    if upper.isalpha() and 2 <= len(upper) <= 6:
        return f"{upper}-USD"
    return upper


def _parse_finance_quotes_query(
    qs: dict[str, Any] | None,
) -> tuple[list[tuple[str, str]], None] | str:
    """Return ``(pairs, None)`` where ``pairs`` is a list of
    ``(originalSymbol, yahooSymbol)`` (preserving order, deduplicated by
    yahoo symbol), or a validation error message.
    """
    if not qs:
        return "symbols is required"
    raw = str(qs.get("symbols") or "").strip()
    if not raw:
        return "symbols is required"
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if not parts:
        return "symbols is required"
    if len(parts) > FINANCE_QUOTES_MAX_SYMBOLS:
        return f"At most {FINANCE_QUOTES_MAX_SYMBOLS} symbols per request"
    seen: set[str] = set()
    pairs: list[tuple[str, str]] = []
    for orig in parts:
        if len(orig) > 32:
            return f"Symbol too long: {orig[:32]}…"
        normalized = _normalize_finance_quote_symbol(orig)
        if normalized is None:
            return f"Invalid symbol: {orig}"
        if normalized in seen:
            continue
        seen.add(normalized)
        pairs.append((orig, normalized))
    return (pairs, None)


def _normalize_yahoo_price_currency(
    price: float, currency: str
) -> tuple[float, str]:
    """Yahoo reports some venues in sub-units (e.g. UK pence as ``GBp``,
    South African cents as ``ZAc``, Israeli agorot as ``ILA``). Convert
    those to the major-unit ISO 4217 code so the rest of the pipeline
    (Frankfurter, MoneyAmount) handles them consistently.
    """
    if not currency:
        return price, currency
    cu = currency.strip()
    if cu == "GBp" or cu == "GBX":
        return price / 100.0, "GBP"
    if cu == "ZAc":
        return price / 100.0, "ZAR"
    if cu == "ILA":
        return price / 100.0, "ILS"
    return price, cu.upper()


def _fetch_yahoo_quote(
    yahoo_symbol: str, request_id: str
) -> dict[str, Any]:
    """Returns ``{ price, currency }`` on success or ``{ error }`` on failure.

    Hits the public Yahoo Finance v8 chart endpoint (no auth required) and
    pulls ``meta.regularMarketPrice`` / ``meta.currency``. Sub-unit
    currencies (GBp, ZAc, ILA) are normalized to the major unit.
    """
    upstream = (
        f"{YAHOO_FINANCE_CHART_BASE}/{quote(yahoo_symbol, safe='')}"
        "?interval=1d&range=1d"
    )
    try:
        req = urllib.request.Request(
            upstream,
            headers={
                "User-Agent": "lxsoftware-admin-api/1.0",
                "Accept": "application/json",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:200]
        _log_event(
            "warning",
            tag="quote_upstream_http_error",
            symbol=yahoo_symbol,
            status=exc.code,
            body_snip=body,
            request_id=request_id,
        )
        return {"error": f"Quote HTTP {exc.code}"}
    except urllib.error.URLError as exc:
        _log_event(
            "warning",
            tag="quote_upstream_url_error",
            symbol=yahoo_symbol,
            err=str(exc)[:200],
            request_id=request_id,
        )
        return {"error": "Quote upstream unreachable"}
    except Exception as exc:  # pragma: no cover - defensive
        _log_event(
            "warning",
            tag="quote_upstream_unexpected_error",
            symbol=yahoo_symbol,
            err=str(exc)[:200],
            request_id=request_id,
        )
        return {"error": "Quote upstream error"}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {"error": "Quote upstream returned invalid JSON"}
    chart = payload.get("chart") if isinstance(payload, dict) else None
    if not isinstance(chart, dict):
        return {"error": "Quote upstream unexpected shape"}
    err = chart.get("error")
    if err:
        msg = (
            err.get("description") if isinstance(err, dict) else None
        ) or "Quote upstream error"
        return {"error": str(msg)[:200]}
    result = chart.get("result")
    if not isinstance(result, list) or not result:
        return {"error": "Quote not found"}
    meta = result[0].get("meta") if isinstance(result[0], dict) else None
    if not isinstance(meta, dict):
        return {"error": "Quote meta missing"}
    price_raw = meta.get("regularMarketPrice")
    currency_raw = meta.get("currency")
    try:
        price = float(price_raw) if price_raw is not None else None
    except (TypeError, ValueError):
        price = None
    if price is None or not (price == price):  # NaN check
        return {"error": "Quote price missing"}
    currency = (
        str(currency_raw).strip() if isinstance(currency_raw, str) else ""
    )
    if not currency:
        return {"error": "Quote currency missing"}
    norm_price, norm_currency = _normalize_yahoo_price_currency(price, currency)
    return {"price": norm_price, "currency": norm_currency}


def _proxy_finance_quotes(
    qs: dict[str, Any] | None, request_id: str
) -> dict[str, Any]:
    """Look up live spot prices for ETF tickers / crypto coins via Yahoo.

    The frontend calls this for Investment rows (Crypto / ETF) so the
    *Current Value* column can show ``unit × spot price`` converted to
    the row currency via Frankfurter.
    """
    parsed = _parse_finance_quotes_query(qs)
    if isinstance(parsed, str):
        return _json_response(400, {"message": parsed})
    pairs, _ = parsed
    if not pairs:
        return _json_response(200, [])

    # Yahoo's chart endpoint is one symbol per call. Fan out in parallel so
    # a 5-symbol request stays well below the API gateway timeout.
    import concurrent.futures

    def _one(pair: tuple[str, str]) -> dict[str, Any]:
        original, yahoo_symbol = pair
        result = _fetch_yahoo_quote(yahoo_symbol, request_id)
        return {"symbol": original, "yahooSymbol": yahoo_symbol, **result}

    max_workers = min(8, len(pairs))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = list(pool.map(_one, pairs))
    return _json_response(200, results)


def _parse_fx_v2_rates_query(
    qs: dict[str, Any] | None,
) -> tuple[str, list[str]] | str:
    """Return ``(base, sorted_unique_quotes)`` or a validation error message.

    Accepts any 3-letter alphabetic ISO 4217 code (Frankfurter validates
    whether the code is actually supported upstream and returns 4xx otherwise).
    The Investments tab needs to convert Yahoo-reported quote currencies
    (which can be any of Frankfurter's supported fiat currencies — JPY, AUD,
    CAD, …) into the row currency, so we pass the validation through to the
    upstream rather than restricting to ``SUPPORTED_FINANCE_CURRENCIES``.
    """
    if not qs:
        return "base is required"
    base = str(qs.get("base") or "").strip().upper()
    quotes_raw = str(qs.get("quotes") or "").strip()
    if not base:
        return "base is required"
    parts = [p.strip().upper() for p in quotes_raw.split(",") if p.strip()]
    need = sorted({p for p in parts if p != base})
    for c in [base, *need]:
        if not (len(c) == 3 and c.isalpha()):
            return f"Invalid currency code: {c}"
    return (base, need)


def _proxy_fx_v2_rates(qs: dict[str, Any] | None, request_id: str) -> dict[str, Any]:
    """ECB-oriented FX rows from Frankfurter (server-side; keeps browser CSP tight)."""
    parsed = _parse_fx_v2_rates_query(qs)
    if isinstance(parsed, str):
        return _json_response(400, {"message": parsed})
    base, quotes_need = parsed
    if not quotes_need:
        return _json_response(200, [])
    quotes_param = ",".join(quote(q, safe="") for q in quotes_need)
    upstream = (
        f"{FRANKFURTER_API_BASE}/v2/rates?"
        f"base={quote(base, safe='')}&quotes={quotes_param}"
    )
    try:
        req = urllib.request.Request(
            upstream,
            headers={"User-Agent": "lxsoftware-admin-api/1.0"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        _log_event(
            "warning",
            tag="fx_rates_upstream_http_error",
            status=exc.code,
            body_snip=body,
            request_id=request_id,
        )
        return _json_response(
            502, {"message": f"FX upstream returned HTTP {exc.code}"}
        )
    except urllib.error.URLError as exc:
        _log_event(
            "warning",
            tag="fx_rates_upstream_url_error",
            err=str(exc)[:256],
            request_id=request_id,
        )
        return _json_response(502, {"message": "FX upstream unreachable"})
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return _json_response(502, {"message": "FX upstream returned invalid JSON"})
    if not isinstance(payload, list):
        return _json_response(502, {"message": "FX upstream unexpected shape"})
    return _json_response(200, payload)


def _parse_job_key(job_id: str) -> dict[str, str]:
    return {"pk": f"{PARSE_JOB_PK_PREFIX}{job_id}", "sk": "META"}


def _job_expires_at_epoch() -> int:
    ttl = int(os.environ.get("PARSE_JOB_TTL_SECONDS", str(7 * 24 * 3600)))
    return int(time.time()) + ttl


def _parse_job_stale_cutoff_iso() -> str:
    sec = int(os.environ.get("PARSE_JOB_STALE_SECONDS", "150"))
    dt = datetime.now(timezone.utc) - timedelta(seconds=sec)
    return _utc_iso_z(dt)


def _parse_job_stuck_seconds() -> float:
    return float(os.environ.get("PARSE_JOB_STUCK_SECONDS", "240"))


def _iso_to_utc_time(s: Any) -> datetime | None:
    if not isinstance(s, str) or not s.strip():
        return None
    try:
        t = s.strip()
        if t.endswith("Z"):
            t = t[:-1] + "+00:00"
        return datetime.fromisoformat(t).astimezone(timezone.utc)
    except ValueError:
        return None


def _finalize_stuck_processing_job(
    table: Any, key: dict[str, str], doc: dict[str, Any]
) -> dict[str, Any]:
    """If processing exceeded the stuck threshold, mark failed (terminal for pollers)."""
    if doc.get("status") != "processing":
        return doc
    updated_at = _iso_to_utc_time(doc.get("updatedAt"))
    if updated_at is None:
        return doc
    age_sec = (datetime.now(timezone.utc) - updated_at).total_seconds()
    if age_sec <= _parse_job_stuck_seconds():
        return doc
    fail_doc = {
        **doc,
        "status": "failed",
        "errorMessage": (
            "Statement parse did not complete in time. Reload the finance page "
            "and check whether lines were added, or try uploading again."
        ),
        "errorStatus": 504,
        "updatedAt": _utc_iso_z(datetime.now(timezone.utc)),
    }
    try:
        table.put_item(Item=_to_ddb_nested(fail_doc))
    except ClientError:
        pass
    return fail_doc


def enqueue_parse_statement_async_job(
    *,
    house: str,
    s3_keys: list[str],
    owner_sub: str,
    api_request_id: str | None,
    source: str = "api",
) -> str:
    """Persist a pending PARSE_JOB and invoke the worker Lambda (async)."""
    table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
    job_id = uuid.uuid4().hex
    created = _utc_iso_z(datetime.now(timezone.utc))
    job_item: dict[str, Any] = {
        **_parse_job_key(job_id),
        "jobId": job_id,
        "status": "pending",
        "house": house,
        "ownerSub": owner_sub,
        "s3Keys": s3_keys,
        "createdAt": created,
        "updatedAt": created,
        "expiresAt": _job_expires_at_epoch(),
        "apiRequestId": (api_request_id or "")[:256],
        "source": source[:64],
    }
    table.put_item(Item=_to_ddb_nested(job_item))
    payload = {
        "internal": "parse_statement_async",
        "jobId": job_id,
        "house": house,
        "s3Keys": s3_keys,
        "ownerSub": owner_sub,
        "apiRequestId": api_request_id or "",
    }
    try:
        _invoke_parse_statement_worker(payload)
    except Exception:
        try:
            table.delete_item(Key=_parse_job_key(job_id))
        except ClientError:
            pass
        raise
    return job_id


def _path_finance_parse_job(
    event: dict[str, Any], path: str
) -> tuple[str | None, str | None]:
    """House + job id from ``/finance/{house}/parse-statement/jobs/{jobId}``."""
    pp = event.get("pathParameters") or {}
    house_raw = pp.get("house")
    job_raw = pp.get("jobId")
    if (
        isinstance(house_raw, str)
        and house_raw.strip()
        and isinstance(job_raw, str)
        and job_raw.strip()
    ):
        return house_raw.strip().lower(), job_raw.strip()
    parts = [p for p in path.split("/") if p]
    if (
        len(parts) == 5
        and parts[0] == "finance"
        and parts[2] == "parse-statement"
        and parts[3] == "jobs"
    ):
        return parts[1].lower(), parts[4]
    return None, None


def _invoke_parse_statement_worker(payload: dict[str, Any]) -> None:
    """Fire-and-forget async invocation to PARSE_WORKER_FUNCTION_NAME (AdminApiFn)."""
    fn_name = (
        (os.environ.get("PARSE_WORKER_FUNCTION_NAME") or "").strip()
        or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    )
    if not fn_name:
        _handle_parse_statement_async_worker(payload)
        return
    _get_lambda_client().invoke(
        FunctionName=fn_name,
        InvocationType="Event",
        Payload=json.dumps(payload).encode("utf-8"),
    )


def _parse_job_public_doc(doc: dict[str, Any]) -> dict[str, Any]:
    st = doc.get("status")
    if st in ("pending", "processing"):
        return {"status": st}
    if st == "succeeded":
        keys = doc.get("sourceAssetKeys") or []
        if not isinstance(keys, list):
            keys = []
        out: dict[str, Any] = {
            "status": "succeeded",
            "addedLines": int(doc.get("addedLines") or 0),
            "sourceAssetKeys": keys,
        }
        sk = doc.get("sourceAssetKey")
        if sk:
            out["sourceAssetKey"] = sk
        return out
    if st == "failed":
        return {
            "status": "failed",
            "message": str(doc.get("errorMessage") or "Statement parse failed"),
        }
    return {"status": "unknown"}


def _handle_parse_statement_async_worker(payload: dict[str, Any]) -> None:
    job_id = payload.get("jobId")
    house = payload.get("house")
    owner_sub = payload.get("ownerSub")
    raw_keys = payload.get("s3Keys")
    s3_keys: list[str] = []
    if isinstance(raw_keys, list):
        s3_keys = [str(x).strip() for x in raw_keys if isinstance(x, str) and str(x).strip()]
    if not s3_keys:
        sk = payload.get("s3Key")
        if isinstance(sk, str) and sk.strip():
            s3_keys = [sk.strip()]
    if (
        not isinstance(job_id, str)
        or not job_id.strip()
        or not isinstance(house, str)
        or not isinstance(owner_sub, str)
        or not s3_keys
    ):
        _log_event("warning", tag="parse_job_worker_bad_payload")
        return

    table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
    key = _parse_job_key(job_id.strip())
    now = _utc_iso_z(datetime.now(timezone.utc))
    stale_cutoff = _parse_job_stale_cutoff_iso()
    try:
        table.update_item(
            Key=key,
            UpdateExpression="SET #st = :proc, updatedAt = :u",
            ConditionExpression=(
                "#st = :pend OR (#st = :proc AND updatedAt < :stale)"
            ),
            ExpressionAttributeNames={"#st": "status"},
            ExpressionAttributeValues={
                ":proc": "processing",
                ":pend": "pending",
                ":u": now,
                ":stale": stale_cutoff,
            },
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            _log_event(
                "info",
                tag="parse_job_skip_duplicate_worker",
                job_id=job_id[:64],
            )
            return
        raise

    api_rid = str(payload.get("apiRequestId") or "").strip()
    req_token = api_rid if api_rid else f"async-parse-{job_id}"
    synthetic_event: dict[str, Any] = {
        "requestContext": {
            "requestId": req_token,
            "http": {"requestId": req_token},
        }
    }
    try:
        result = execute_parse_statement(
            house=house,
            s3_keys=s3_keys,
            user_sub=owner_sub,
            request_id=req_token,
            event=synthetic_event,
        )
    except _ParseStatementError as exc:
        raw_old = table.get_item(Key=key).get("Item") or {}
        base_doc = _from_ddb_nested(raw_old)
        fail_doc = {
            **base_doc,
            "status": "failed",
            "errorMessage": exc.message,
            "errorStatus": exc.status,
            "updatedAt": _utc_iso_z(datetime.now(timezone.utc)),
        }
        table.put_item(Item=_to_ddb_nested(fail_doc))
        _log_event(
            "warning",
            tag="parse_job_failed",
            job_id=job_id[:64],
            house=house,
            error=exc.message[:300],
        )
        return
    except Exception as exc:
        logger.exception("parse_statement_async worker failed")
        raw_old = table.get_item(Key=key).get("Item") or {}
        base_doc = _from_ddb_nested(raw_old)
        fail_doc = {
            **base_doc,
            "status": "failed",
            "errorMessage": "Statement parse failed unexpectedly",
            "errorStatus": 500,
            "updatedAt": _utc_iso_z(datetime.now(timezone.utc)),
        }
        table.put_item(Item=_to_ddb_nested(fail_doc))
        _log_event(
            "error",
            tag="parse_job_worker_exception",
            job_id=job_id[:64],
            error=str(exc)[:500],
        )
        return

    raw_old = table.get_item(Key=key).get("Item") or {}
    base_doc = _from_ddb_nested(raw_old)
    ok_doc = {
        **base_doc,
        "status": "succeeded",
        "addedLines": result.get("addedLines", 0),
        "sourceAssetKeys": result.get("sourceAssetKeys") or [],
        "updatedAt": _utc_iso_z(datetime.now(timezone.utc)),
    }
    sk = result.get("sourceAssetKey")
    if sk:
        ok_doc["sourceAssetKey"] = sk
    elif "sourceAssetKey" in ok_doc:
        del ok_doc["sourceAssetKey"]
    table.put_item(Item=_to_ddb_nested(ok_doc))


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if isinstance(event, dict) and event.get("internal") == "parse_statement_async":
        _handle_parse_statement_async_worker(event)
        return {}

    method, path = _route(event)

    if method == "GET" and path == "/health":
        return _json_response(200, {"status": "ok"})

    admin_claims = _require_admin(event)
    if admin_claims is None:
        claims = _claims(event)
        if not claims:
            logger.info(
                json.dumps(
                    {
                        "tag": "admin_auth_denied",
                        "reason": "missing_claims",
                        "method": method,
                        "path": path,
                        "request_id": _request_id(event),
                    }
                )
            )
            return _json_response(401, {"message": "Unauthorized"})
        logger.info(
            json.dumps(
                {
                    "tag": "admin_auth_denied",
                    "reason": "not_in_admin_group",
                    "method": method,
                    "path": path,
                    "request_id": _request_id(event),
                    "sub": claims.get("sub"),
                    "email": claims.get("email"),
                    "cognito_username": claims.get("cognito:username"),
                    "cognito_groups": claims.get("cognito:groups"),
                    "token_use": claims.get("token_use"),
                    "iss": claims.get("iss"),
                    "aud": claims.get("aud"),
                }
            )
        )
        return _json_response(403, {"message": "Forbidden: admin group required"})

    user_sub = admin_claims.get("sub")

    if method == "GET" and path == "/me":
        return _json_response(
            200,
            {
                "sub": admin_claims.get("sub"),
                "email": admin_claims.get("email"),
                "cognito_username": admin_claims.get("cognito:username"),
            },
        )

    if method == "GET" and path == "/fx/v2/rates":
        return _proxy_fx_v2_rates(
            event.get("queryStringParameters"),
            _request_id(event),
        )

    if method == "GET" and path == "/finance/quotes":
        return _proxy_finance_quotes(
            event.get("queryStringParameters"),
            _request_id(event),
        )

    if method == "POST" and path == "/assets/upload-url":
        body = _parse_json_body(event)
        filename = body.get("filename")
        content_type = body.get("contentType")
        if not filename or not content_type:
            return _json_response(
                400, {"message": "filename and contentType are required"}
            )
        if not _is_allowed_upload_content_type(str(content_type)):
            _log_event(
                "warning",
                tag="asset_upload_url_rejected",
                reason="unsupported_content_type",
                sub=user_sub,
                content_type_raw=str(content_type)[:128],
                request_id=_request_id(event),
            )
            return _json_response(
                400,
                {
                    "message": (
                        "contentType must be image/* or application/pdf"
                    )
                },
            )
        if not user_sub:
            return _json_response(400, {"message": "Missing sub claim"})
        safe_name = os.path.basename(str(filename))
        object_key = f"uploads/{user_sub}/{uuid.uuid4().hex}/{safe_name}"
        bucket = os.environ["ASSETS_BUCKET_NAME"]
        max_bytes = int(os.environ.get("ASSET_MAX_BYTES", str(20 * 1024 * 1024)))
        normalized_ct = str(content_type).strip().lower()
        if normalized_ct == "application/pdf":
            content_type_condition = ["eq", "$Content-Type", "application/pdf"]
        else:
            content_type_condition = ["starts-with", "$Content-Type", "image/"]
        conditions = [
            ["content-length-range", 1, max_bytes],
            content_type_condition,
            ["eq", "$key", object_key],
        ]
        # NOTE: the form field carries the *raw* client-supplied casing while
        # the explicit `eq` condition is hardcoded lowercase. S3 evaluates
        # `eq` case-sensitively, so a non-canonical client casing (e.g.
        # "Application/PDF") will result in the browser POST being rejected
        # with HTTP 403 / `<Code>AccessDenied</Code>` even though
        # /assets/upload-url returned 200. Logged below so CloudWatch can
        # show the gap without having to reproduce in a browser.
        fields = {"Content-Type": str(content_type), "key": object_key}
        post = _s3.generate_presigned_post(
            Bucket=bucket,
            Key=object_key,
            Fields=fields,
            Conditions=conditions,
            ExpiresIn=300,
        )
        _log_event(
            "info",
            tag="asset_upload_url_issued",
            sub=user_sub,
            key=object_key,
            content_type_raw=str(content_type)[:128],
            content_type_normalized=normalized_ct[:128],
            content_type_matches_policy=(
                str(content_type) == normalized_ct
                if normalized_ct == "application/pdf"
                else str(content_type).lower().startswith("image/")
            ),
            policy_content_type_rule=" ".join(str(part) for part in content_type_condition),
            max_bytes=max_bytes,
            expires_in_seconds=300,
            request_id=_request_id(event),
        )
        _audit(user_sub, "ASSET_UPLOAD_URL", object_key, event)
        return _json_response(200, {"upload": post, "key": object_key})

    if method == "POST" and path == "/assets/confirm":
        body = _parse_json_body(event)
        key = body.get("key")
        if key is None:
            return _json_response(400, {"message": "key is required"})
        if not user_sub:
            return _json_response(400, {"message": "Missing sub claim"})
        house_raw = body.get("house")
        house_val: str | None = None
        if house_raw is not None:
            if not isinstance(house_raw, str) or house_raw not in FINANCE_HOUSE_KEYS:
                return _json_response(
                    400,
                    {"message": "house must be hillmarton or morrison when provided"},
                )
            house_val = house_raw
        prefix = f"uploads/{user_sub}/"
        if not str(key).startswith(prefix):
            _log_event(
                "warning",
                tag="asset_confirm_rejected",
                reason="prefix_mismatch",
                sub=user_sub,
                key=str(key)[:512],
                request_id=_request_id(event),
            )
            return _json_response(400, {"message": "Invalid key for this user"})
        bucket = os.environ["ASSETS_BUCKET_NAME"]
        try:
            head = _s3.head_object(Bucket=bucket, Key=str(key))
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                _log_event(
                    "warning",
                    tag="asset_confirm_not_in_bucket",
                    sub=user_sub,
                    key=str(key)[:512],
                    s3_error_code=code,
                    request_id=_request_id(event),
                )
                return _json_response(400, {"message": "Object not found in bucket"})
            raise
        size = int(head["ContentLength"])
        etag = head.get("ETag", "").strip('"')
        last_mod = head.get("LastModified")
        if isinstance(last_mod, datetime):
            uploaded_at = _utc_iso_z(last_mod)
        else:
            uploaded_at = _utc_iso_z(datetime.now(timezone.utc))
        file_name = os.path.basename(str(key))
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        ddb_key = {"pk": f"ASSET#{key}", "sk": "META"}
        item: dict[str, Any] = {
            **ddb_key,
            "size": size,
            "s3Etag": etag,
            "ownerSub": user_sub,
            "clientSha256": body.get("sha256"),
            "clientReportedSize": body.get("size"),
            "note": "size and s3Etag are from S3 head_object; client fields are informational only",
            "uploadedAt": uploaded_at,
            "fileName": file_name,
        }
        if house_val is not None:
            item["house"] = house_val
        table.put_item(Item=_to_ddb(item))
        _log_event(
            "info",
            tag="asset_confirm_ok",
            sub=user_sub,
            key=str(key)[:512],
            size_bytes=size,
            client_reported_size=body.get("size"),
            has_client_sha256=bool(body.get("sha256")),
            request_id=_request_id(event),
        )
        _audit(user_sub, "ASSET_CONFIRM", str(key), event)
        return _json_response(201, {"item": _from_ddb(item)})

    if method == "GET" and path == "/assets/download-url":
        qs = event.get("rawQueryString") or ""
        key_param = parse_qs(qs).get("key", [""])[0]
        return _asset_download_presigned_response(event, user_sub, key_param)

    if method == "POST" and path == "/assets/download-url":
        body = _parse_json_body(event)
        return _asset_download_presigned_response(event, user_sub, body.get("key"))

    if method == "POST" and path == "/assets/delete":
        body = _parse_json_body(event)
        return _asset_delete_response(event, user_sub, body.get("key"))

    if method == "GET" and path == "/records":
        qs = event.get("rawQueryString") or ""
        cursor_raw = parse_qs(qs).get("cursor", [""])[0]
        start_key = _decode_cursor(cursor_raw)
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        kwargs: dict[str, Any] = {"Limit": 50}
        if start_key:
            kwargs["ExclusiveStartKey"] = start_key
        result = table.scan(**kwargs)
        items = [_from_ddb(i) for i in result.get("Items", [])]
        bucket = os.environ.get("ASSETS_BUCKET_NAME") or ""
        items = _enrich_scan_items_asset_meta(items, table=table, bucket=bucket)
        last = result.get("LastEvaluatedKey")
        next_cursor = _encode_cursor(last) if last else None
        return _json_response(
            200, {"items": items, "nextCursor": next_cursor}
        )

    if method == "POST" and path == "/records":
        body = _parse_json_body(event)
        pk = body.get("pk")
        sk = body.get("sk")
        if not pk or not sk:
            return _json_response(400, {"message": "pk and sk are required"})
        if not _validate_record_pk(str(pk)):
            return _json_response(
                400,
                {"message": f"pk must start with {RECORD_PK_PREFIX} for creates"},
            )
        data = body.get("data")
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        item: dict[str, Any] = {"pk": pk, "sk": sk}
        if isinstance(data, dict):
            for k, v in data.items():
                if k in ("pk", "sk"):
                    continue
                item[k] = v
        try:
            table.put_item(
                Item=_to_ddb(item),
                ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)",
            )
        except ClientError as exc:
            if (
                exc.response.get("Error", {}).get("Code")
                == "ConditionalCheckFailedException"
            ):
                return _json_response(409, {"message": "Record already exists"})
            raise
        _audit(user_sub, "RECORD_CREATE", f"{pk}|{sk}", event)
        return _json_response(201, {"item": _from_ddb(item)})

    if method == "PUT" and path == "/records":
        body = _parse_json_body(event)
        pk = body.get("pk")
        sk = body.get("sk")
        if not pk or not sk:
            return _json_response(400, {"message": "pk and sk are required"})
        if not _validate_record_pk(str(pk)):
            return _json_response(
                400,
                {"message": f"pk must start with {RECORD_PK_PREFIX}"},
            )
        data = body.get("data")
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        item: dict[str, Any] = {"pk": pk, "sk": sk}
        if isinstance(data, dict):
            for k, v in data.items():
                if k in ("pk", "sk"):
                    continue
                item[k] = v
        try:
            table.put_item(
                Item=_to_ddb(item),
                ConditionExpression="attribute_exists(pk) AND attribute_exists(sk)",
            )
        except ClientError as exc:
            if (
                exc.response.get("Error", {}).get("Code")
                == "ConditionalCheckFailedException"
            ):
                return _json_response(404, {"message": "Record not found for update"})
            raise
        _audit(user_sub, "RECORD_UPDATE", f"{pk}|{sk}", event)
        return _json_response(200, {"item": _from_ddb(item)})

    if method == "GET" and path == "/finance":
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        exp_rows, exp_pct = _load_finance_expenses_ledger_with_allocation(table)
        alloc_stored = _load_allocation_stored_records(table)
        income_rows = _load_finance_sheet(table, "income", INCOME_RECORD_CATEGORIES)
        allocation_records = _build_allocation_records_for_response(
            exp_rows, alloc_stored, income_rows, exp_pct
        )
        return _json_response(
            200,
            {
                "hillmarton": _load_finance_house(table, "hillmarton"),
                "morrison": _load_finance_house(table, "morrison"),
                "incomeRecords": income_rows,
                "expenseRecords": exp_rows,
                "expenseIncomeAllocationPercents": exp_pct,
                "investmentRecords": _load_investment_records(table),
                "savingsRecords": _load_savings_records(table),
                "pensionRecords": _load_pension_records(table),
                "accountRecords": _load_accounts_records(table),
                "allocationRecords": allocation_records,
            },
        )

    if method == "PUT" and path in ("/finance/income", "/finance/expenses"):
        sheet_routes: dict[str, tuple[str, frozenset[str], str]] = {
            "/finance/income": ("income", INCOME_RECORD_CATEGORIES, "incomeRecords"),
            "/finance/expenses": (
                "expenses",
                EXPENSE_RECORD_CATEGORIES,
                "expenseRecords",
            ),
        }
        sheet_slug, cats, body_key = sheet_routes[path]
        body = _parse_json_body(event)
        try:
            normalized = _normalize_ledger_sheet_payload(
                body, body_key=body_key, categories=cats
            )
        except ValueError as exc:
            return _json_response(400, {"message": str(exc)})
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        if sheet_slug == "expenses":
            existing_perc = _load_existing_expense_income_allocation_percentages(table)
            if isinstance(body.get("expenseIncomeAllocationPercents"), dict):
                patched_perc = _sanitize_expense_income_allocation_percentages(
                    body["expenseIncomeAllocationPercents"]
                )
            else:
                patched_perc = existing_perc
            doc = {
                "records": normalized,
                "expenseIncomeAllocationPercents": patched_perc,
            }
        else:
            doc = {"records": normalized}
        ddb_item = {**_finance_sheet_ddb_key(sheet_slug), **_to_ddb_nested(doc)}
        table.put_item(Item=ddb_item)
        _audit(user_sub, "FINANCE_PUT", sheet_slug, event)
        if sheet_slug == "expenses":
            return _json_response(
                200,
                {
                    body_key: normalized,
                    "expenseIncomeAllocationPercents": patched_perc,
                },
            )
        return _json_response(200, {body_key: normalized})

    if method == "PUT" and path == "/finance/investments":
        body = _parse_json_body(event)
        try:
            normalized = _normalize_investment_sheet_payload(body)
        except ValueError as exc:
            return _json_response(400, {"message": str(exc)})
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        existing = _load_investment_records(table)
        merged = _merge_investment_last_updated(normalized, existing)
        doc = {"records": merged}
        ddb_item = {**_finance_sheet_ddb_key("investments"), **_to_ddb_nested(doc)}
        table.put_item(Item=ddb_item)
        _audit(user_sub, "FINANCE_PUT", "investments", event)
        return _json_response(200, {"investmentRecords": merged})

    if method == "PUT" and path == "/finance/savings":
        body = _parse_json_body(event)
        try:
            normalized = _normalize_savings_sheet_payload(body)
        except ValueError as exc:
            return _json_response(400, {"message": str(exc)})
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        doc = {"records": normalized}
        ddb_item = {**_finance_sheet_ddb_key("savings"), **_to_ddb_nested(doc)}
        table.put_item(Item=ddb_item)
        _audit(user_sub, "FINANCE_PUT", "savings", event)
        return _json_response(200, {"savingsRecords": normalized})

    if method == "PUT" and path == "/finance/pension":
        body = _parse_json_body(event)
        try:
            normalized = _normalize_pension_sheet_payload(body)
        except ValueError as exc:
            return _json_response(400, {"message": str(exc)})
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        existing = _load_pension_records(table)
        merged = _merge_pension_last_updated(normalized, existing)
        doc = {"records": merged}
        ddb_item = {**_finance_sheet_ddb_key("pension"), **_to_ddb_nested(doc)}
        table.put_item(Item=ddb_item)
        _audit(user_sub, "FINANCE_PUT", "pension", event)
        return _json_response(200, {"pensionRecords": merged})

    if method == "PUT" and path == "/finance/accounts":
        body = _parse_json_body(event)
        try:
            normalized = _normalize_accounts_sheet_payload(body)
        except ValueError as exc:
            return _json_response(400, {"message": str(exc)})
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        existing = _load_accounts_records(table)
        merged = _merge_accounts_last_updated(normalized, existing)
        doc = {"records": merged}
        ddb_item = {**_finance_sheet_ddb_key("accounts"), **_to_ddb_nested(doc)}
        table.put_item(Item=ddb_item)
        _audit(user_sub, "FINANCE_PUT", "accounts", event)
        return _json_response(200, {"accountRecords": merged})

    if method == "PUT" and path == "/finance/allocations":
        body = _parse_json_body(event)
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        allocated_ids = _allocated_expense_ids_for_allocations(table)
        try:
            normalized = _normalize_allocations_sheet_payload(body, allocated_ids)
        except ValueError as exc:
            return _json_response(400, {"message": str(exc)})
        existing = _load_allocation_stored_records(table)
        merged_stored = _merge_allocation_stored_last_updated(normalized, existing)
        doc = {"records": merged_stored}
        ddb_item = {**_finance_sheet_ddb_key("allocations"), **_to_ddb_nested(doc)}
        table.put_item(Item=ddb_item)
        _audit(user_sub, "FINANCE_PUT", "allocations", event)
        exp_rows, exp_pct = _load_finance_expenses_ledger_with_allocation(table)
        inc_rows = _load_finance_sheet(table, "income", INCOME_RECORD_CATEGORIES)
        allocation_response = _build_allocation_records_for_response(
            exp_rows, merged_stored, inc_rows, exp_pct
        )
        return _json_response(200, {"allocationRecords": allocation_response})

    if method == "PUT" and path.startswith("/finance/") and not path.endswith(
        "/parse-statement"
    ):
        house = _path_finance_house(event, path)
        if not house or house not in FINANCE_HOUSE_KEYS:
            return _json_response(
                400,
                {"message": "house must be hillmarton or morrison"},
            )
        body = _parse_json_body(event)
        try:
            normalized = _normalize_finance_payload(body)
        except ValueError as exc:
            return _json_response(400, {"message": str(exc)})
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        ddb_item = {**_finance_ddb_key(house), **_to_ddb_nested(normalized)}
        table.put_item(Item=ddb_item)
        _audit(user_sub, "FINANCE_PUT", house, event)
        return _json_response(200, {"data": normalized})

    if method == "GET" and "/parse-statement/jobs/" in path:
        house_j, job_id = _path_finance_parse_job(event, path)
        if not house_j or house_j not in FINANCE_HOUSE_KEYS or not job_id:
            return _json_response(404, {"message": "Not found"})
        if not user_sub:
            return _json_response(400, {"message": "Missing sub claim"})
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        raw = table.get_item(Key=_parse_job_key(job_id))
        item = raw.get("Item")
        if not item:
            return _json_response(404, {"message": "Job not found"})
        doc = _from_ddb_nested(item)
        if doc.get("ownerSub") != user_sub:
            return _json_response(403, {"message": "Forbidden"})
        if doc.get("house") != house_j:
            return _json_response(400, {"message": "House does not match job"})
        doc = _finalize_stuck_processing_job(table, _parse_job_key(job_id), doc)
        return _json_response(200, _parse_job_public_doc(doc))

    if (
        method == "POST"
        and path.startswith("/finance/")
        and path.endswith("/parse-statement")
        and "/parse-statement/jobs/" not in path
    ):
        house = _path_finance_house_for_parse(event, path)
        if not house or house not in FINANCE_HOUSE_KEYS:
            return _json_response(
                400,
                {"message": "house must be hillmarton or morrison"},
            )
        if not user_sub:
            return _json_response(400, {"message": "Missing sub claim"})
        body = _parse_json_body(event)
        key = body.get("key")
        if not isinstance(key, str) or not key.strip():
            return _json_response(400, {"message": "key is required"})
        prefix = f"uploads/{user_sub}/"
        if not key.startswith(prefix):
            return _json_response(400, {"message": "Invalid key for this user"})
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        house_data = _load_finance_house(table, house)
        file_name = os.path.basename(key)
        if _statement_basename_already_imported(house_data, file_name):
            return _json_response(
                409,
                {
                    "message": (
                        f"A statement file named {file_name!r} was already imported for this house. "
                        "Remove its imported lines or rename the file, then try again."
                    )
                },
            )
        try:
            job_id = enqueue_parse_statement_async_job(
                house=house,
                s3_keys=[key],
                owner_sub=user_sub,
                api_request_id=_request_id(event),
                source="api",
            )
        except Exception as exc:
            _log_event(
                "error",
                tag="parse_job_enqueue_failed",
                err=str(exc)[:400],
                request_id=_request_id(event),
            )
            return _json_response(
                502,
                {"message": "Could not start statement parse job"},
            )
        _log_event(
            "info",
            tag="parse_job_enqueued",
            sub=user_sub,
            house=house,
            job_id=job_id,
            request_id=_request_id(event),
        )
        return _json_response(202, {"jobId": job_id, "status": "pending"})


    return _json_response(404, {"message": "Not found"})


class _ParseStatementError(Exception):
    """User-facing error for the /finance/{house}/parse-statement endpoint."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _path_finance_house_for_parse(event: dict[str, Any], path: str) -> str | None:
    """Pull the {house} segment out of /finance/{house}/parse-statement."""
    pp = (event.get("pathParameters") or {}).get("house")
    if isinstance(pp, str) and pp.strip():
        return pp.strip().lower()
    parts = [p for p in path.split("/") if p]
    if len(parts) == 3 and parts[0] == "finance" and parts[2] == "parse-statement":
        return parts[1].lower()
    return None


def _statement_basename_already_imported(
    house_data: dict[str, Any], basename: str
) -> bool:
    """True if any finance line references an asset with this exact filename."""
    for ln in house_data.get("lines") or []:
        if not isinstance(ln, dict):
            continue
        for key in _line_source_asset_keys_raw(ln):
            if os.path.basename(key) == basename:
                return True
    return False


def execute_parse_statement(
    *,
    house: str,
    s3_keys: list[str],
    user_sub: str | None,
    request_id: str,
    event: dict[str, Any],
) -> dict[str, Any]:
    """Run OpenRouter on one or more assets and append parsed lines.

    Each new line gets ``sourceAssetKeys`` set to the full ordered list of
    ``s3_keys`` (same idea as attaching every PDF from one import to every
    extracted line in the admin UI). Used by the HTTP API and inbound-email.

    Raises ``_ParseStatementError`` on user-facing failures.

    Returns a dict with ``data``, ``addedLines``, ``sourceAssetKeys``, and
    legacy ``sourceAssetKey`` (first key).
    """
    keys_ordered: list[str] = []
    seen: set[str] = set()
    for k in s3_keys:
        if not isinstance(k, str) or not k.strip():
            continue
        kk = k.strip()
        if kk not in seen:
            seen.add(kk)
            keys_ordered.append(kk)
    if not keys_ordered:
        raise _ParseStatementError(400, "At least one S3 key is required")
    if len(keys_ordered) > MAX_SOURCE_ASSET_KEYS_PER_LINE:
        raise _ParseStatementError(
            400,
            f"At most {MAX_SOURCE_ASSET_KEYS_PER_LINE} statement files per import",
        )

    bucket = os.environ["ASSETS_BUCKET_NAME"]
    _log_event(
        "info",
        tag="parse_statement_start",
        sub=user_sub,
        house=house,
        key=",".join(keys_ordered)[:512],
        request_id=request_id,
    )

    table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
    house_data = _load_finance_house(table, house)

    file_meta: list[tuple[str, str, dict[str, Any]]] = []
    for s3_key in keys_ordered:
        try:
            head = _s3.head_object(Bucket=bucket, Key=s3_key)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                _log_event(
                    "warning",
                    tag="parse_statement_not_in_bucket",
                    sub=user_sub,
                    house=house,
                    key=s3_key[:512],
                    s3_error_code=code,
                    request_id=request_id,
                )
                raise _ParseStatementError(400, "Object not found in bucket") from exc
            raise
        file_name = os.path.basename(s3_key)
        if _statement_basename_already_imported(house_data, file_name):
            _log_event(
                "info",
                tag="parse_statement_duplicate_basename",
                sub=user_sub,
                house=house,
                basename=file_name[:256],
                request_id=request_id,
            )
            raise _ParseStatementError(
                409,
                f"A statement file named {file_name!r} was already imported for this house. "
                "Remove its imported lines or rename the file, then try again.",
            )
        file_meta.append((s3_key, file_name, head))

    default_currency = house_data.get("defaultCurrency", DEFAULT_FINANCE_CURRENCY)

    # Lazy-import the parser so unit tests can stub urllib without paying
    # the import cost on unrelated routes.
    from openrouter_statement_parser import parse_statement_from_asset

    all_parsed_raw_lines: list[dict[str, Any]] = []
    for s3_key, file_name, head in file_meta:
        content_type = head.get("ContentType") or ""
        object_size = int(head.get("ContentLength") or 0)
        _log_event(
            "info",
            tag="parse_statement_object_loaded",
            sub=user_sub,
            house=house,
            key=s3_key[:512],
            object_content_type=content_type[:128],
            object_size_bytes=object_size,
            default_currency=default_currency,
            request_id=request_id,
        )
        try:
            parsed = parse_statement_from_asset(
                s3_client=_s3,
                secrets_client=_get_secretsmanager_client(),
                bucket=bucket,
                s3_key=s3_key,
                file_name=file_name,
                content_type=content_type,
                default_currency=default_currency,
            )
        except RuntimeError as exc:
            _log_event(
                "warning",
                tag="parse_statement_failed",
                sub=user_sub,
                house=house,
                key=s3_key[:512],
                error=str(exc)[:500],
                request_id=request_id,
            )
            raise _ParseStatementError(502, f"Statement parser failed: {exc}") from exc
        for raw_line in parsed.get("lines") or []:
            if isinstance(raw_line, dict):
                all_parsed_raw_lines.append(raw_line)

    new_lines: list[dict[str, Any]] = []
    for raw_line in all_parsed_raw_lines:
        nl = {
            **raw_line,
            "id": uuid.uuid4().hex,
            "sourceAssetKeys": list(keys_ordered),
        }
        nl.pop("sourceAssetKey", None)
        new_lines.append(nl)
    _log_event(
        "info",
        tag="parse_statement_extracted",
        sub=user_sub,
        house=house,
        key=",".join(keys_ordered)[:512],
        added_lines=len(new_lines),
        existing_lines=len(house_data.get("lines", []) or []),
        request_id=request_id,
    )

    merged_payload = {
        "defaultCurrency": house_data.get("defaultCurrency", DEFAULT_FINANCE_CURRENCY),
        "float": house_data.get(
            "float",
            {"amount": 0, "currency": DEFAULT_FINANCE_CURRENCY},
        ),
        "lines": list(house_data.get("lines", [])) + new_lines,
    }

    try:
        normalized = _normalize_finance_payload(merged_payload)
    except ValueError as exc:
        raise _ParseStatementError(
            500, f"Parsed lines failed validation: {exc}"
        ) from exc

    ddb_item = {**_finance_ddb_key(house), **_to_ddb_nested(normalized)}
    table.put_item(Item=ddb_item)
    for s3_key, file_name, head in file_meta:
        _persist_asset_meta_after_parse(
            table=table,
            s3_key=s3_key,
            house=house,
            head=head,
            file_name=file_name,
            request_id=request_id,
            owner_sub=user_sub,
        )
    audit_event = {
        **event,
        "requestContext": {
            **event.get("requestContext", {}),
            "requestId": request_id,
            "http": {
                **(event.get("requestContext") or {}).get("http", {}),
                "requestId": request_id,
            },
        },
    }
    audit_target = f"{house}|{','.join(keys_ordered)}"[:1024]
    _audit(user_sub, "FINANCE_PARSE_STATEMENT", audit_target, audit_event)

    return {
        "data": normalized,
        "addedLines": len(new_lines),
        "sourceAssetKeys": list(keys_ordered),
        "sourceAssetKey": keys_ordered[0],
    }


def _to_ddb(obj: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in obj.items():
        if isinstance(v, float):
            out[k] = Decimal(str(v))
        else:
            out[k] = v
    return out


def _from_ddb(obj: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in obj.items():
        if isinstance(v, Decimal):
            if v % 1 == 0:
                out[k] = int(v)
            else:
                out[k] = float(v)
        elif isinstance(v, (bytes, bytearray)):
            out[k] = base64.b64encode(v).decode("ascii")
        else:
            out[k] = v
    return out
