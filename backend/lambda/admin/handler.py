"""Admin HTTP API: dispatch by route; enforce admin Cognito group in Lambda."""

from __future__ import annotations

import base64
import json
import os
import uuid
from decimal import Decimal
from typing import Any

import boto3

ADMIN_GROUP = "admin"
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
    parts = [p.strip() for p in str(raw).split(",") if p.strip()]
    return ADMIN_GROUP in parts


def _require_admin(event: dict[str, Any]) -> dict[str, Any] | None:
    claims = _claims(event)
    if not _groups_include_admin(claims):
        return None
    return claims


def _route(event: dict[str, Any]) -> tuple[str, str]:
    http = event.get("requestContext", {}).get("http", {})
    return http.get("method", ""), http.get("path", "")


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    method, path = _route(event)

    if method == "GET" and path == "/health":
        return _json_response(200, {"status": "ok"})

    admin_claims = _require_admin(event)
    if admin_claims is None:
        if not _claims(event):
            return _json_response(401, {"message": "Unauthorized"})
        return _json_response(403, {"message": "Forbidden: admin group required"})

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
        user_sub = admin_claims.get("sub")
        if not user_sub:
            return _json_response(400, {"message": "Missing sub claim"})
        safe_name = os.path.basename(str(filename))
        object_key = f"uploads/{user_sub}/{uuid.uuid4().hex}/{safe_name}"
        bucket = os.environ["ASSETS_BUCKET_NAME"]
        url = _s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": bucket,
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=300,
        )
        return _json_response(200, {"uploadUrl": url, "key": object_key})

    if method == "POST" and path == "/assets/confirm":
        body = _parse_json_body(event)
        key = body.get("key")
        sha256_hex = body.get("sha256")
        size = body.get("size")
        if key is None or sha256_hex is None or size is None:
            return _json_response(
                400, {"message": "key, sha256, and size are required"}
            )
        user_sub = admin_claims.get("sub")
        prefix = f"uploads/{user_sub}/"
        if not str(key).startswith(prefix):
            return _json_response(400, {"message": "Invalid key for this user"})
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        ddb_key = {"pk": f"ASSET#{key}", "sk": "META"}
        item = {
            **ddb_key,
            "sha256": str(sha256_hex),
            "size": int(size),
            "ownerSub": user_sub,
        }
        table.put_item(Item=_to_ddb(item))
        return _json_response(201, {"item": item})

    if method == "GET" and path == "/records":
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        result = table.scan(Limit=50)
        items = [_from_ddb(i) for i in result.get("Items", [])]
        return _json_response(200, {"items": items})

    if method == "POST" and path == "/records":
        body = _parse_json_body(event)
        pk = body.get("pk")
        sk = body.get("sk")
        if not pk or not sk:
            return _json_response(400, {"message": "pk and sk are required"})
        data = body.get("data")
        table = _ddb.Table(os.environ["RECORDS_TABLE_NAME"])
        item: dict[str, Any] = {"pk": pk, "sk": sk}
        if isinstance(data, dict):
            for k, v in data.items():
                if k in ("pk", "sk"):
                    continue
                item[k] = v
        table.put_item(Item=_to_ddb(item))
        return _json_response(201, {"item": _from_ddb(item)})

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
