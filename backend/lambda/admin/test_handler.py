"""Unit tests for admin API helpers (host has no boto3; stub deps before import)."""

import sys
import types
import unittest
from unittest.mock import MagicMock


def _install_stubs() -> None:
    mock_boto = MagicMock()
    sys.modules["boto3"] = mock_boto

    class ClientError(Exception):
        pass

    botocore = types.ModuleType("botocore")
    exceptions = types.ModuleType("botocore.exceptions")
    exceptions.ClientError = ClientError
    botocore.exceptions = exceptions
    sys.modules["botocore"] = botocore
    sys.modules["botocore.exceptions"] = exceptions


_install_stubs()

from handler import _groups_include_admin, _normalize_finance_payload  # noqa: E402


class TestGroups(unittest.TestCase):
    def test_admin_present(self) -> None:
        self.assertTrue(_groups_include_admin({"cognito:groups": "admin"}))
        self.assertTrue(_groups_include_admin({"cognito:groups": "viewer,admin"}))
        self.assertTrue(_groups_include_admin({"cognito:groups": ["admin"]}))
        self.assertTrue(
            _groups_include_admin({"cognito:groups": ["viewer", "admin"]})
        )

    def test_admin_present_httpapi_bracketed(self) -> None:
        # API Gateway HTTP API JWT authorizer passes array claims as a
        # Java toString() string, with literal brackets and ", " separators.
        self.assertTrue(_groups_include_admin({"cognito:groups": "[admin]"}))
        self.assertTrue(
            _groups_include_admin({"cognito:groups": "[viewer, admin]"})
        )
        self.assertTrue(
            _groups_include_admin({"cognito:groups": "[admin, viewer]"})
        )

    def test_admin_absent(self) -> None:
        self.assertFalse(_groups_include_admin({"cognito:groups": "viewer"}))
        self.assertFalse(_groups_include_admin({"cognito:groups": "[viewer]"}))
        self.assertFalse(
            _groups_include_admin({"cognito:groups": "[viewer, editor]"})
        )
        self.assertFalse(_groups_include_admin({"cognito:groups": []}))
        self.assertFalse(_groups_include_admin({}))


class TestFinancePayload(unittest.TestCase):
    def test_valid_minimal(self) -> None:
        body = {
            "float": {"amount": 100.5, "currency": "gbp"},
            "lines": [
                {
                    "id": "a",
                    "dateUtc": "2026-05-08T12:00:00.000Z",
                    "type": "income",
                    "description": "Rent",
                    "netAmount": 100,
                    "vat": 20,
                    "grossAmount": 120,
                    "currency": "GBP",
                }
            ],
        }
        out = _normalize_finance_payload(body)
        self.assertEqual(out["float"]["currency"], "GBP")
        self.assertEqual(len(out["lines"]), 1)
        self.assertEqual(out["lines"][0]["netAmount"], 100.0)

    def test_invalid_type(self) -> None:
        body = {
            "float": {"amount": 0, "currency": "GBP"},
            "lines": [
                {
                    "id": "a",
                    "dateUtc": "2026-05-08T12:00:00.000Z",
                    "type": "other",
                    "description": "x",
                    "netAmount": 1,
                    "vat": 0,
                    "grossAmount": 1,
                    "currency": "GBP",
                }
            ],
        }
        with self.assertRaises(ValueError):
            _normalize_finance_payload(body)


if __name__ == "__main__":
    unittest.main()
