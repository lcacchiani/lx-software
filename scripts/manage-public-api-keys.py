#!/usr/bin/env python3
"""Mint, list, and revoke public read-only API keys.

Keys authenticate the /public/* GET routes on the admin HTTP API via the
`x-api-key` header. Plaintext keys look like ``lxpk_<keyId>_<secret>``.
Only a scrypt digest of the secret is stored (as ``pk = APIKEY#<keyId>``,
``sk = META`` in the records table); the plaintext is printed exactly once
by ``create``.

Requires AWS credentials with GetItem/PutItem/UpdateItem/Scan on the records
table (plus kms:Decrypt/GenerateDataKey on its CMK) — i.e. an admin identity,
not the read-only cloud-agent user.

Usage:
  python3 scripts/manage-public-api-keys.py create --label "grafana" \
      [--expires-at 2027-01-01] [--table lxsoftware-admin-records] [--region ap-southeast-1]
  python3 scripts/manage-public-api-keys.py list
  python3 scripts/manage-public-api-keys.py revoke --key-id <keyId>
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

# Reuse the authorizer's crypto helpers so mint + verify stay in lockstep.
_AUTH_DIR = (
    Path(__file__).resolve().parents[1]
    / "backend"
    / "lambda"
    / "public_api_authorizer"
)
sys.path.insert(0, str(_AUTH_DIR))
from api_key_crypto import (  # noqa: E402
    API_KEY_PK_PREFIX,
    ddb_key,
    hash_secret,
    mint_key_id,
    mint_plaintext,
    parse_api_key,
)

DEFAULT_TABLE = "lxsoftware-admin-records"
DEFAULT_REGION = "ap-southeast-1"


def _table(args: argparse.Namespace):
    return boto3.resource("dynamodb", region_name=args.region).Table(args.table)


def _validate_expires_at(raw: str | None) -> str | None:
    if raw is None:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        sys.exit(f"error: --expires-at {raw!r} is not an ISO date/datetime")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    if parsed <= datetime.now(timezone.utc):
        sys.exit(f"error: --expires-at {raw!r} is in the past")
    return raw


def cmd_create(args: argparse.Namespace) -> None:
    expires_at = _validate_expires_at(args.expires_at)
    key_id = mint_key_id()
    plaintext = mint_plaintext(key_id)
    parsed = parse_api_key(plaintext)
    if parsed is None:
        sys.exit("error: minted key failed to parse (internal bug)")
    _, secret = parsed
    item = {
        **ddb_key(key_id),
        "keyId": key_id,
        "label": args.label,
        "scope": "read",
        "revoked": False,
        "secretHash": hash_secret(secret),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    if expires_at:
        item["expiresAt"] = expires_at
    try:
        _table(args).put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(pk)",
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code == "ConditionalCheckFailedException":
            sys.exit("error: keyId collision (retry)")
        raise
    print(f"keyId:  {key_id}")
    print(f"label:  {args.label}")
    print(f"expires: {expires_at or 'never'}")
    print()
    print("API key (shown once, store it now):")
    print(f"  {plaintext}")
    print()
    print("Example:")
    print(f'  curl -H "x-api-key: {plaintext}" <AdminApiBaseUrl>/public/finance')


def _scan_keys(args: argparse.Namespace) -> list[dict]:
    table = _table(args)
    items: list[dict] = []
    kwargs: dict = {
        "FilterExpression": "begins_with(pk, :p)",
        "ExpressionAttributeValues": {":p": API_KEY_PK_PREFIX},
    }
    while True:
        res = table.scan(**kwargs)
        items.extend(res.get("Items", []))
        lek = res.get("LastEvaluatedKey")
        if not lek:
            return items
        kwargs["ExclusiveStartKey"] = lek


def cmd_list(args: argparse.Namespace) -> None:
    items = _scan_keys(args)
    if not items:
        print("no API keys found")
        return
    for it in sorted(items, key=lambda x: str(x.get("createdAt", ""))):
        state = "revoked" if it.get("revoked") else "active"
        expires = it.get("expiresAt") or "never"
        print(
            f"{it.get('keyId')}  {state:8}  label={it.get('label')!r}  "
            f"created={it.get('createdAt')}  expires={expires}"
        )


def cmd_revoke(args: argparse.Namespace) -> None:
    key = ddb_key(args.key_id)
    table = _table(args)
    try:
        res = table.get_item(Key=key)
    except ClientError:
        raise
    item = res.get("Item")
    if not item:
        # Fall back to a scan in case an older SHA-256-keyed record exists
        # from an earlier revision of this script.
        matches = [i for i in _scan_keys(args) if i.get("keyId") == args.key_id]
        if not matches:
            sys.exit(f"error: no API key with keyId {args.key_id!r}")
        for it in matches:
            table.update_item(
                Key={"pk": it["pk"], "sk": it["sk"]},
                UpdateExpression="SET revoked = :t",
                ExpressionAttributeValues={":t": True},
            )
            print(f"revoked keyId {args.key_id} (label={it.get('label')!r})")
    else:
        table.update_item(
            Key=key,
            UpdateExpression="SET revoked = :t",
            ExpressionAttributeValues={":t": True},
        )
        print(f"revoked keyId {args.key_id} (label={item.get('label')!r})")
    print("note: API Gateway caches authorizer verdicts for up to 5 minutes")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--table", default=DEFAULT_TABLE)
    common.add_argument("--region", default=DEFAULT_REGION)
    sub = parser.add_subparsers(dest="command", required=True)

    p_create = sub.add_parser(
        "create", parents=[common], help="mint a new read-only API key"
    )
    p_create.add_argument("--label", required=True, help="human-readable key name")
    p_create.add_argument(
        "--expires-at", default=None, help="ISO date/datetime, e.g. 2027-01-01"
    )
    p_create.set_defaults(func=cmd_create)

    p_list = sub.add_parser(
        "list", parents=[common], help="list all API keys (hashes never shown)"
    )
    p_list.set_defaults(func=cmd_list)

    p_revoke = sub.add_parser("revoke", parents=[common], help="revoke a key by keyId")
    p_revoke.add_argument("--key-id", required=True)
    p_revoke.set_defaults(func=cmd_revoke)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
