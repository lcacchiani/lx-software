#!/usr/bin/env python3
"""Unit tests for scripts/setup-board-config.py (no live AWS)."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent / "setup-board-config.py"
_SPEC = importlib.util.spec_from_file_location("setup_board_config", _SCRIPT)
assert _SPEC and _SPEC.loader
sbc = importlib.util.module_from_spec(_SPEC)
sys.modules["setup_board_config"] = sbc
_SPEC.loader.exec_module(sbc)


RECEIVABLES = Path(__file__).resolve().parent / "siutindei" / "receivables.sql"


class LoadAnswersTests(unittest.TestCase):
    def test_ignores_underscore_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.json"
            path.write_text(
                json.dumps({"_readme": ["no"], "github_token": "  pat  ", "meta_page_id": "1"}),
                encoding="utf-8",
            )
            answers = sbc.load_answers(path)
        self.assertNotIn("_readme", answers)
        self.assertEqual(sbc.text(answers, "github_token"), "pat")


class SqlSplitTests(unittest.TestCase):
    def test_skips_begin_commit_and_keeps_dollar_quote(self) -> None:
        sql = """
        BEGIN;
        CREATE TABLE t (id int);
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'board_api') THEN
                CREATE ROLE board_api NOLOGIN;
            END IF;
        END
        $$;
        GRANT SELECT ON t TO board_api;
        COMMIT;
        """
        stmts = sbc.split_sql_statements(sql)
        self.assertEqual(len(stmts), 3)
        self.assertTrue(stmts[0].startswith("CREATE TABLE"))
        self.assertIn("CREATE ROLE board_api", stmts[1])
        self.assertTrue(stmts[2].startswith("GRANT SELECT"))

    def test_receivables_sql_splits_cleanly(self) -> None:
        stmts = sbc.split_sql_statements(RECEIVABLES.read_text(encoding="utf-8"))
        kinds = " ".join(stmts)
        self.assertGreaterEqual(len(stmts), 10)
        self.assertIn("CREATE TABLE IF NOT EXISTS listing_plans", kinds)
        self.assertIn("CREATE OR REPLACE VIEW v_catalog_health", kinds)
        self.assertIn("CREATE ROLE board_api", kinds)
        self.assertNotIn("BEGIN;", [s.upper() for s in stmts])


class SecretBuilderTests(unittest.TestCase):
    def test_asc_from_p8_and_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p8 = Path(tmp) / "key.p8"
            p8.write_text("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n")
            built = sbc.build_asc_secret(
                {
                    "asc_key_id": "ABC",
                    "asc_issuer_id": "iss-1",
                    "asc_private_key_file": str(p8),
                    "asc_app_id": "99",
                    "asc_vendor_number": "81234567",
                }
            )
        self.assertEqual(built["keyId"], "ABC")
        self.assertEqual(built["vendorNumber"], "81234567")
        self.assertIn("BEGIN PRIVATE KEY", built["privateKey"])

    def test_asc_incomplete_raises(self) -> None:
        with self.assertRaises(sbc.SetupError):
            sbc.build_asc_secret({"asc_key_id": "ABC"})

    def test_asc_empty_is_none(self) -> None:
        self.assertIsNone(sbc.build_asc_secret({}))

    def test_play_sa_adds_package(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sa.json"
            path.write_text(
                json.dumps({"client_email": "sa@x.iam.gserviceaccount.com", "private_key": "k"}),
                encoding="utf-8",
            )
            built = sbc.build_google_sa_secret(
                {"play_sa_file": str(path), "play_package_name": "com.app"},
                file_key="play_sa_file",
                what="Play",
                package_key="play_package_name",
            )
        self.assertEqual(built["packageName"], "com.app")
        self.assertEqual(built["client_email"], "sa@x.iam.gserviceaccount.com")


class PlanTests(unittest.TestCase):
    def test_tokens_never_land_in_public_params(self) -> None:
        plan = sbc.plan_from_answers(
            {
                "github_token": "github_pat_secret",
                "search_api_key": "BSA_secret",
                "meta_board_token": "EAAB",
                "meta_app_secret": "appsec",
                "meta_verify_token": "verify-me",
                "meta_page_id": "111",
                "board_aws_lambda_names": "fn-a,fn-b",
                "activate_cost_tag": False,
                "apply_receivables_sql": False,
            }
        )
        dumped = json.dumps(plan.public_params)
        self.assertNotIn("github_pat_secret", dumped)
        self.assertNotIn("BSA_secret", dumped)
        self.assertNotIn("EAAB", dumped)
        self.assertNotIn("appsec", dumped)
        self.assertNotIn("verify-me", dumped)
        self.assertEqual(plan.public_params["lxsoftware:MetaPageId"], "111")
        self.assertEqual(plan.public_params["lxsoftware:BoardAwsLambdaNames"], "fn-a,fn-b")
        self.assertEqual(plan.local_params["lxsoftware:MetaVerifyToken"], "verify-me")
        kinds = [a.kind for a in plan.actions]
        self.assertIn("upsert_secret", kinds)
        self.assertIn("write_params", kinds)
        self.assertIn("write_local_params", kinds)
        self.assertNotIn("activate_cost_tag", kinds)

    def test_discovers_lambda_names_when_blank(self) -> None:
        plan = sbc.plan_from_answers(
            {"activate_cost_tag": False},
            discovered_lambdas=["siutindei-Api", "siutindei-Worker"],
        )
        self.assertEqual(
            plan.public_params["lxsoftware:BoardAwsLambdaNames"],
            "siutindei-Api,siutindei-Worker",
        )

    def test_render_redacts_verify_token(self) -> None:
        plan = sbc.plan_from_answers(
            {"meta_verify_token": "super-secret-token", "activate_cost_tag": False}
        )
        rendered = sbc.render_plan(plan)
        self.assertNotIn("super-secret-token", rendered)
        self.assertIn("redacted", rendered)


class MergeAndExecuteTests(unittest.TestCase):
    def test_merge_preserves_existing_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "p.json"
            path.write_text(
                json.dumps({"PublicWebsiteDomainName": "www.lx-software.com", "lxsoftware:MetaPageId": "old"}),
                encoding="utf-8",
            )
            sbc.merge_json_file(path, {"lxsoftware:MetaPageId": "new", "lxsoftware:MetaIgUserId": "2"})
            data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(data["PublicWebsiteDomainName"], "www.lx-software.com")
        self.assertEqual(data["lxsoftware:MetaPageId"], "new")
        self.assertEqual(data["lxsoftware:MetaIgUserId"], "2")

    def test_dry_run_execute_writes_nothing(self) -> None:
        plan = sbc.plan_from_answers(
            {"github_token": "x", "meta_page_id": "1", "activate_cost_tag": False}
        )
        logs = sbc.execute_plan(plan, session=None, dry_run=True)
        self.assertEqual(logs, ["dry-run: no AWS writes"])


class CliTests(unittest.TestCase):
    def test_init_and_offline_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "answers.json"
            self.assertEqual(sbc.main(["init", "--out", str(dest)]), 0)
            self.assertTrue(dest.is_file())
            answers = json.loads(dest.read_text(encoding="utf-8"))
            answers["meta_page_id"] = "123"
            answers["activate_cost_tag"] = False
            dest.write_text(json.dumps(answers), encoding="utf-8")
            rc = sbc.main(
                ["apply", "--answers", str(dest), "--dry-run", "--offline", "--yes"]
            )
            self.assertEqual(rc, 0)

    def test_example_answers_load(self) -> None:
        answers = sbc.load_answers(sbc.EXAMPLE_ANSWERS)
        self.assertIn("github_token", answers)
        self.assertEqual(answers["github_token"], "")


if __name__ == "__main__":
    unittest.main()
