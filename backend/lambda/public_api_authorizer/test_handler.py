"""Unit tests for the public API key authorizer (boto3 stubbed before import)."""

import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch


def _install_stubs() -> None:
    mock_boto = MagicMock()
    sys.modules["boto3"] = mock_boto

    class ClientError(Exception):
        def __init__(self, response=None, operation_name=""):
            super().__init__(operation_name)
            self.response = response or {}

    botocore = types.ModuleType("botocore")
    exceptions = types.ModuleType("botocore.exceptions")
    exceptions.ClientError = ClientError
    botocore.exceptions = exceptions
    sys.modules["botocore"] = botocore
    sys.modules["botocore.exceptions"] = exceptions


_install_stubs()

from api_key_crypto import (  # noqa: E402
    hash_secret,
    mint_key_id,
    mint_plaintext,
    parse_api_key,
    verify_secret,
)
import handler  # noqa: E402
from handler import _is_expired, lambda_handler  # noqa: E402

_KEY_ID = "a1b2c3d4e5f6"
_SECRET = "super-secret-token-value-xx"
_KEY = f"lxpk_{_KEY_ID}_{_SECRET}"
_SECRET_HASH = hash_secret(_SECRET)


def _event(key: str | None = _KEY) -> dict:
    headers = {} if key is None else {"x-api-key": key}
    return {"headers": headers, "requestContext": {"requestId": "req-1"}}


def _valid_item(**overrides) -> dict:
    item = {
        "pk": f"APIKEY#{_KEY_ID}",
        "sk": "META",
        "keyId": _KEY_ID,
        "label": "test key",
        "scope": "read",
        "revoked": False,
        "secretHash": _SECRET_HASH,
    }
    item.update(overrides)
    return item


class TestApiKeyCrypto(unittest.TestCase):
    def test_mint_roundtrip(self) -> None:
        key_id = mint_key_id()
        plaintext = mint_plaintext(key_id)
        parsed = parse_api_key(plaintext)
        self.assertIsNotNone(parsed)
        assert parsed is not None
        got_id, secret = parsed
        self.assertEqual(got_id, key_id)
        stored = hash_secret(secret)
        self.assertTrue(verify_secret(secret, stored))
        self.assertFalse(verify_secret("wrong-secret-value!!", stored))

    def test_parse_rejects_malformed(self) -> None:
        self.assertIsNone(parse_api_key(""))
        self.assertIsNone(parse_api_key("not-a-key"))
        self.assertIsNone(parse_api_key("lxpk_short_secret"))
        self.assertIsNone(parse_api_key("lxpk_NOTHEXLENGTH_secretsecret"))
        self.assertIsNone(parse_api_key(f"lxpk_{_KEY_ID}_short"))
        self.assertIsNone(parse_api_key("x" * 300))


class TestAuthorizer(unittest.TestCase):
    def setUp(self) -> None:
        self.table = MagicMock()
        patcher_ddb = patch.object(handler, "_ddb")
        self.mock_ddb = patcher_ddb.start()
        self.addCleanup(patcher_ddb.stop)
        self.mock_ddb.Table.return_value = self.table
        patcher_env = patch.dict(
            "os.environ", {"RECORDS_TABLE_NAME": "records-test"}
        )
        patcher_env.start()
        self.addCleanup(patcher_env.stop)

    def test_missing_header_denied(self) -> None:
        self.table.get_item.return_value = {"Item": _valid_item()}
        self.assertFalse(lambda_handler(_event(key=None), None)["isAuthorized"])
        self.table.get_item.assert_not_called()

    def test_malformed_key_denied(self) -> None:
        self.assertFalse(lambda_handler(_event(key="   "), None)["isAuthorized"])
        self.assertFalse(
            lambda_handler(_event(key="lxpk_notvalid"), None)["isAuthorized"]
        )
        self.table.get_item.assert_not_called()

    def test_unknown_key_denied(self) -> None:
        self.table.get_item.return_value = {}
        self.assertFalse(lambda_handler(_event(), None)["isAuthorized"])

    def test_valid_key_allowed_with_context(self) -> None:
        self.table.get_item.return_value = {"Item": _valid_item()}
        out = lambda_handler(_event(), None)
        self.assertTrue(out["isAuthorized"])
        self.assertEqual(out["context"]["keyId"], _KEY_ID)
        self.assertEqual(out["context"]["scope"], "read")
        self.table.get_item.assert_called_once_with(
            Key={"pk": f"APIKEY#{_KEY_ID}", "sk": "META"}
        )

    def test_wrong_secret_denied(self) -> None:
        self.table.get_item.return_value = {"Item": _valid_item()}
        bad = f"lxpk_{_KEY_ID}_totally-different-secret!!"
        self.assertFalse(lambda_handler(_event(key=bad), None)["isAuthorized"])

    def test_revoked_key_denied(self) -> None:
        self.table.get_item.return_value = {"Item": _valid_item(revoked=True)}
        self.assertFalse(lambda_handler(_event(), None)["isAuthorized"])

    def test_expired_key_denied(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        self.table.get_item.return_value = {"Item": _valid_item(expiresAt=past)}
        self.assertFalse(lambda_handler(_event(), None)["isAuthorized"])

    def test_future_expiry_allowed(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        self.table.get_item.return_value = {"Item": _valid_item(expiresAt=future)}
        self.assertTrue(lambda_handler(_event(), None)["isAuthorized"])

    def test_non_read_scope_denied(self) -> None:
        self.table.get_item.return_value = {"Item": _valid_item(scope="write")}
        self.assertFalse(lambda_handler(_event(), None)["isAuthorized"])

    def test_ddb_error_denied(self) -> None:
        from botocore.exceptions import ClientError

        self.table.get_item.side_effect = ClientError(
            {"Error": {"Code": "InternalServerError"}}, "GetItem"
        )
        self.assertFalse(lambda_handler(_event(), None)["isAuthorized"])


class TestIsExpired(unittest.TestCase):
    def test_absent_never_expires(self) -> None:
        now = datetime.now(timezone.utc)
        self.assertFalse(_is_expired(None, now))
        self.assertFalse(_is_expired("", now))

    def test_date_only_string(self) -> None:
        now = datetime(2026, 6, 15, tzinfo=timezone.utc)
        self.assertTrue(_is_expired("2026-06-01", now))
        self.assertFalse(_is_expired("2026-07-01", now))

    def test_zulu_suffix(self) -> None:
        now = datetime(2026, 6, 15, tzinfo=timezone.utc)
        self.assertTrue(_is_expired("2026-06-01T00:00:00Z", now))

    def test_garbage_fails_closed(self) -> None:
        now = datetime.now(timezone.utc)
        self.assertTrue(_is_expired("not-a-date", now))


if __name__ == "__main__":
    unittest.main()
