"""Unit tests for admin API helpers (host has no boto3; stub deps before import)."""

import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
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

from handler import (  # noqa: E402
    EXPENSE_RECORD_CATEGORIES,
    INCOME_RECORD_CATEGORIES,
    _groups_include_admin,
    _is_allowed_upload_content_type,
    _normalize_finance_payload,
    _normalize_ledger_sheet_payload,
    _path_finance_house_for_parse,
    _statement_basename_already_imported,
    _utc_iso_z,
)


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
            "defaultCurrency": "EUR",
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
        self.assertEqual(out["defaultCurrency"], "EUR")
        self.assertEqual(out["float"]["currency"], "GBP")
        self.assertEqual(len(out["lines"]), 1)
        self.assertEqual(out["lines"][0]["netAmount"], 100.0)

    def test_omitted_default_currency_is_hkd(self) -> None:
        body = {"float": {"amount": 0, "currency": "USD"}, "lines": []}
        out = _normalize_finance_payload(body)
        self.assertEqual(out["defaultCurrency"], "HKD")

    def test_unsupported_currency_rejected(self) -> None:
        body = {
            "defaultCurrency": "JPY",
            "float": {"amount": 0, "currency": "HKD"},
            "lines": [],
        }
        with self.assertRaises(ValueError):
            _normalize_finance_payload(body)

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


    def test_source_asset_key_persisted(self) -> None:
        body = {
            "defaultCurrency": "GBP",
            "float": {"amount": 0, "currency": "GBP"},
            "lines": [
                {
                    "id": "a",
                    "dateUtc": "2026-05-08T12:00:00.000Z",
                    "type": "expenditure",
                    "description": "Coffee",
                    "netAmount": 2.5,
                    "vat": 0.5,
                    "grossAmount": 3.0,
                    "currency": "GBP",
                    "sourceAssetKey": "uploads/abc/123/statement.pdf",
                }
            ],
        }
        out = _normalize_finance_payload(body)
        self.assertEqual(
            out["lines"][0]["sourceAssetKey"], "uploads/abc/123/statement.pdf"
        )

    def test_source_asset_key_optional(self) -> None:
        body = {
            "defaultCurrency": "GBP",
            "float": {"amount": 0, "currency": "GBP"},
            "lines": [
                {
                    "id": "a",
                    "dateUtc": "2026-05-08T12:00:00.000Z",
                    "type": "income",
                    "description": "Rent",
                    "netAmount": 1.0,
                    "vat": 0,
                    "grossAmount": 1.0,
                    "currency": "GBP",
                }
            ],
        }
        out = _normalize_finance_payload(body)
        self.assertNotIn("sourceAssetKey", out["lines"][0])


class TestLedgerSheetPayload(unittest.TestCase):
    def test_income_valid(self) -> None:
        body = {
            "incomeRecords": [
                {
                    "id": "a",
                    "category": "Rent",
                    "description": "Room sublet",
                    "amount": 500.5,
                    "currency": "GBP",
                }
            ]
        }
        out = _normalize_ledger_sheet_payload(
            body,
            body_key="incomeRecords",
            categories=INCOME_RECORD_CATEGORIES,
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["category"], "Rent")
        self.assertEqual(out[0]["amount"], 500.5)

    def test_income_invalid_category(self) -> None:
        body = {
            "incomeRecords": [
                {
                    "id": "a",
                    "category": "Bonus",
                    "description": "x",
                    "amount": 1,
                    "currency": "HKD",
                }
            ]
        }
        with self.assertRaises(ValueError):
            _normalize_ledger_sheet_payload(
                body, body_key="incomeRecords", categories=INCOME_RECORD_CATEGORIES
            )

    def test_income_missing_body_key(self) -> None:
        with self.assertRaises(ValueError):
            _normalize_ledger_sheet_payload(
                {}, body_key="incomeRecords", categories=INCOME_RECORD_CATEGORIES
            )

    def test_expense_valid(self) -> None:
        body = {
            "expenseRecords": [
                {
                    "id": "e1",
                    "category": "Utility",
                    "description": "Electric",
                    "amount": 88,
                    "currency": "HKD",
                }
            ]
        }
        out = _normalize_ledger_sheet_payload(
            body,
            body_key="expenseRecords",
            categories=EXPENSE_RECORD_CATEGORIES,
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["category"], "Utility")


class TestUploadContentTypeAllowList(unittest.TestCase):
    def test_image_types_allowed(self) -> None:
        self.assertTrue(_is_allowed_upload_content_type("image/png"))
        self.assertTrue(_is_allowed_upload_content_type("image/jpeg"))
        self.assertTrue(_is_allowed_upload_content_type("IMAGE/WEBP"))

    def test_pdf_allowed(self) -> None:
        self.assertTrue(_is_allowed_upload_content_type("application/pdf"))
        self.assertTrue(_is_allowed_upload_content_type("Application/PDF"))

    def test_other_types_rejected(self) -> None:
        self.assertFalse(_is_allowed_upload_content_type("application/json"))
        self.assertFalse(_is_allowed_upload_content_type("text/plain"))
        self.assertFalse(_is_allowed_upload_content_type(""))
        self.assertFalse(_is_allowed_upload_content_type(None))  # type: ignore[arg-type]


class TestUtcIsoZ(unittest.TestCase):
    def test_naive_treated_as_utc(self) -> None:
        self.assertEqual(
            _utc_iso_z(datetime(2026, 5, 9, 12, 0, 0, 123000)),
            "2026-05-09T12:00:00.123Z",
        )

    def test_offset_converts_to_utc(self) -> None:
        dt = datetime(
            2026,
            5,
            9,
            14,
            30,
            0,
            0,
            tzinfo=timezone(timedelta(hours=2)),
        )
        self.assertEqual(_utc_iso_z(dt), "2026-05-09T12:30:00.000Z")


class TestStatementBasenameDuplicate(unittest.TestCase):
    def test_empty_lines(self) -> None:
        self.assertFalse(
            _statement_basename_already_imported({"lines": []}, "jan.pdf")
        )

    def test_matches_basename_only(self) -> None:
        house = {
            "lines": [
                {
                    "id": "a",
                    "sourceAssetKey": "uploads/u1/x/BankStmt.pdf",
                }
            ]
        }
        self.assertTrue(
            _statement_basename_already_imported(house, "BankStmt.pdf")
        )
        self.assertFalse(
            _statement_basename_already_imported(house, "Other.pdf")
        )

    def test_case_sensitive(self) -> None:
        house = {
            "lines": [{"id": "a", "sourceAssetKey": "uploads/u/x/report.PDF"}]
        }
        self.assertTrue(
            _statement_basename_already_imported(house, "report.PDF")
        )
        self.assertFalse(
            _statement_basename_already_imported(house, "report.pdf")
        )

    def test_ignores_manual_lines(self) -> None:
        house = {
            "lines": [
                {
                    "id": "a",
                    "dateUtc": "2026-05-08T12:00:00.000Z",
                    "type": "income",
                    "description": "Rent",
                    "netAmount": 1,
                    "vat": 0,
                    "grossAmount": 1,
                    "currency": "GBP",
                }
            ]
        }
        self.assertFalse(
            _statement_basename_already_imported(house, "Rent.pdf")
        )


class TestParseStatementHousePath(unittest.TestCase):
    def test_path_param(self) -> None:
        ev = {"pathParameters": {"house": "Hillmarton"}}
        self.assertEqual(
            _path_finance_house_for_parse(ev, "/finance/hillmarton/parse-statement"),
            "hillmarton",
        )

    def test_path_split(self) -> None:
        self.assertEqual(
            _path_finance_house_for_parse(
                {}, "/finance/morrison/parse-statement"
            ),
            "morrison",
        )

    def test_invalid_path(self) -> None:
        self.assertIsNone(
            _path_finance_house_for_parse({}, "/finance/morrison")
        )
        self.assertIsNone(_path_finance_house_for_parse({}, "/something"))


if __name__ == "__main__":
    unittest.main()
