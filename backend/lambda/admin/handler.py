"""Admin HTTP API: dispatch by route; enforce admin Cognito group in Lambda."""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import time
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any
from urllib.parse import parse_qs

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ADMIN_GROUP = "admin"
RECORD_PK_PREFIX = "RECORD#"
FINANCE_HOUSE_KEYS = frozenset({"hillmarton", "morrison"})
FINANCE_LINE_TYPES = frozenset({"income", "expenditure"})
MAX_FINANCE_LINES = 5000
MAX_FINANCE_DESCRIPTION = 8000
_s3 = boto3.client("s3")
_ddb = boto3.resource("dynamodb")


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


def _decode_cursor(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        pad = "=" * ((4 - len(raw) % 4) % 4)
        blob = base64.urlsafe_b64decode(raw + pad)
        return json.loads(blob.decode("utf-8"))
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError):
        return None


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
    return {"float": {"amount": 0, "currency": "GBP"}, "lines": []}


def _valid_iso_instant(s: str) -> bool:
    try:
        datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def _normalize_finance_payload(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("Body must be a JSON object")
    fl = body.get("float")
    if not isinstance(fl, dict):
        raise ValueError("float is required")
    amt = fl.get("amount")
    if not isinstance(amt, (int, float)) or isinstance(amt, bool):
        raise ValueError("float.amount must be a number")
    if abs(float(amt)) > 1e15:
        raise ValueError("float.amount out of range")
    cur_raw = fl.get("currency", "GBP")
    if not isinstance(cur_raw, str) or not cur_raw.strip():
        raise ValueError("float.currency is required")
    cur = cur_raw.strip().upper()[:3]
    if len(cur) < 3:
        raise ValueError("float.currency must be a 3-letter ISO code")

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
            raise ValueError(f"lines[{i}].type must be income or expenditure")
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

        cur_line = raw.get("currency", "GBP")
        if not isinstance(cur_line, str) or not cur_line.strip():
            raise ValueError(f"lines[{i}].currency is required")
        c = cur_line.strip().upper()[:3]
        if len(c) < 3:
            raise ValueError(f"lines[{i}].currency must be a 3-letter ISO code")

        lines_out.append(
            {
                "id": lid.strip(),
                "dateUtc": date_utc.strip(),
                "type": typ,
                "description": desc.strip(),
                "netAmount": float(raw["netAmount"]),
                "vat": float(raw["vat"]),
                "grossAmount": float(raw["grossAmount"]),
                "currency": c,
            }
        )

    return {
        "float": {"amount": float(amt), "currency": cur},
        "lines": lines_out,
    }


def _finance_ddb_key(house: str) -> dict[str, str]:
    return {"pk": f"FINANCE#house#{house}", "sk": "STATE"}


def _load_finance_house(table: Any, house: str) -> dict[str, Any]:
    res = table.get_item(Key=_finance_ddb_key(house))
    item = res.get("Item")
    if not item:
        return _default_finance_house()
    payload = {k: v for k, v in item.items() if k not in ("pk", "sk")}
    return _from_ddb_nested(payload)


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


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
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

    if method == "POST" and path == "/assets/upload-url":
        body = _parse_json_body(event)
        filename = body.get("filename")
        content_type = body.get("contentType")
        if not filename or not content_type:
            return _json_response(
                400, {"message": "filename and contentType are required"}
            )
        if not str(content_type).startswith("image/"):
            return _json_response(
                400, {"message": "contentType must start with image/ for uploads"}
            )
        if not user_sub:
            return _json_response(400, {"message": "Missing sub claim"})
        safe_name = os.path.basename(str(filename))
        object_key = f"uploads/{user_sub}/{uuid.uuid4().hex}/{safe_name}"
        bucket = os.environ["ASSETS_BUCKET_NAME"]
        max_bytes = int(os.environ.get("ASSET_MAX_BYTES", str(20 * 1024 * 1024)))
        conditions = [
            ["content-length-range", 1, max_bytes],
            ["starts-with", "$Content-Type", "image/"],
            ["eq", "$key", object_key],
        ]
        fields = {"Content-Type": str(content_type), "key": object_key}
        post = _s3.generate_presigned_post(
            Bucket=bucket,
            Key=object_key,
            Fields=fields,
            Conditions=conditions,
            ExpiresIn=300,
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
        prefix = f"uploads/{user_sub}/"
        if not str(key).startswith(prefix):
            return _json_response(400, {"message": "Invalid key for this user"})
        bucket = os.environ["ASSETS_BUCKET_NAME"]
        try:
            head = _s3.head_object(Bucket=bucket, Key=str(key))
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                return _json_response(400, {"message": "Object not found in bucket"})
            raise
        size = int(head["ContentLength"])
        etag = head.get("ETag", "").strip('"')
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        ddb_key = {"pk": f"ASSET#{key}", "sk": "META"}
        item = {
            **ddb_key,
            "size": size,
            "s3Etag": etag,
            "ownerSub": user_sub,
            "clientSha256": body.get("sha256"),
            "clientReportedSize": body.get("size"),
            "note": "size and s3Etag are from S3 head_object; client fields are informational only",
        }
        table.put_item(Item=_to_ddb(item))
        _audit(user_sub, "ASSET_CONFIRM", str(key), event)
        return _json_response(201, {"item": _from_ddb(item)})

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
        return _json_response(
            200,
            {
                "hillmarton": _load_finance_house(table, "hillmarton"),
                "morrison": _load_finance_house(table, "morrison"),
            },
        )

    if method == "PUT" and path.startswith("/finance/"):
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

    return _json_response(404, {"message": "Not found"})


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
