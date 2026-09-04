"""Follow-ups after T8: meeting writes, phishing, templates, PDF, timeouts."""

from __future__ import annotations

import json
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

import board_deadline
import board_invoice_pdf
import board_mail
import board_meta
import board_pii
import board_store
import board_tools
from board_tools import REGISTRY, ToolContext, ToolOp, execute_call
from test_board_mail import MailTestCase, build_mail
from test_board_t5 import MetaTestCase
from test_board_tools import ToolsTestCase


def _slow_op(run, *, timeout_seconds: int) -> ToolOp:
    return ToolOp(
        name="slow_test_op",
        tool_id="board",
        kind="read",
        description="test",
        parameters={"type": "object", "properties": {}},
        run=run,
        summarize=lambda _a: "slow",
        timeout_seconds=timeout_seconds,
    )


class TestMeetingWrites(ToolsTestCase):
    def test_ciso_can_report_phishing_at_mail_read(self) -> None:
        settings = board_store.default_settings()
        names = {op.name for op, _ in board_tools.available_ops(settings, "ciso", context="chat")}
        self.assertIn("mail_report_phishing", names)
        self.assertNotIn("mail_send", names)

    def test_timeout_returns_before_the_op_finishes(self) -> None:
        finished = threading.Event()
        release = threading.Event()  # time.sleep is patched out by BoardTestCase; block on an Event instead

        def run(_ctx, _args):
            release.wait(3)
            finished.set()
            return {"ok": True}

        self.addCleanup(release.set)

        ctx = ToolContext(table=self.table, settings=board_store.default_settings(), persona_id="ceo", display_name="CEO")
        started = time.monotonic()
        with patch.object(board_tools, "BOARD_TOOL_CALL_TIMEOUT_SECONDS", 1):
            out = execute_call(ctx, _slow_op(run, timeout_seconds=1), {})
        elapsed = time.monotonic() - started
        self.assertEqual(out.status, "error")
        self.assertIn("timed out", out.result["error"])
        self.assertLess(elapsed, 2.5, "execute_call must not wait for the worker thread")
        self.assertFalse(finished.is_set())

    def test_http_timeouts_shrink_to_the_op_deadline(self) -> None:
        seen: list[float | None] = []

        def run(_ctx, _args):
            seen.append(board_deadline.remaining(25))
            return {"ok": True}

        ctx = ToolContext(table=self.table, settings=board_store.default_settings(), persona_id="ceo", display_name="CEO")
        out = execute_call(ctx, _slow_op(run, timeout_seconds=2), {})
        self.assertEqual(out.status, "ok")
        self.assertTrue(seen and seen[0] is not None and 0.5 <= seen[0] <= 2.0, seen)
        # Outside an op there is no deadline: clients keep their own timeout.
        self.assertEqual(board_deadline.remaining(25), 25)

    def test_phishing_report_is_always_a_proposal_even_at_act(self) -> None:
        settings = board_store.default_settings()
        settings["tools"]["globalMode"] = "act"
        settings["tools"]["matrix"]["mail"]["cfo"] = "act"
        self.assertEqual(board_tools.effective_level(settings, "mail", "cfo"), "act")
        ctx = ToolContext(table=self.table, settings=settings, persona_id="cfo", display_name="CFO")
        with patch.object(board_mail, "op_report_phishing") as run:
            out = execute_call(ctx, REGISTRY["mail_report_phishing"], {"threadId": "t-1", "reason": "Looks fake."})
        self.assertEqual(out.status, "pending_approval")
        run.assert_not_called()


class TestPhishing(MailTestCase):
    def test_report_is_proposal_then_action(self) -> None:
        ingested = board_mail.ingest_bytes(self.table, build_mail(frm="evil@phish.example", subject="Reset now"))
        thread_id = ingested["threadId"]
        ctx = ToolContext(
            table=self.table,
            settings=board_store.default_settings(),
            persona_id="ciso",
            display_name="CISO",
        )
        out = execute_call(
            ctx,
            REGISTRY["mail_report_phishing"],
            {"threadId": thread_id, "note": "Lookalike domain", "reason": "CISO review."},
        )
        self.assertEqual(out.status, "pending_approval")
        owner = ToolContext(
            table=self.table,
            settings=board_store.default_settings(),
            persona_id="ciso",
            display_name="Founder",
            actor="owner",
            owner_sub="owner-1",
        )
        decided = execute_call(
            owner,
            REGISTRY["mail_report_phishing"],
            {"threadId": thread_id, "note": "Lookalike domain", "reason": "Approved."},
        )
        self.assertEqual(decided.status, "ok")
        actions = [a for a in board_store.list_actions(self.table) if "Phishing" in str(a.get("title"))]
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0]["source"], "approval")
        again = execute_call(
            owner,
            REGISTRY["mail_report_phishing"],
            {"threadId": thread_id, "note": "Lookalike domain", "reason": "Approved twice."},
        )
        self.assertEqual(again.status, "ok")
        self.assertTrue(again.result.get("duplicate"))
        self.assertEqual(len([a for a in board_store.list_actions(self.table) if "Phishing" in str(a.get("title"))]), 1)


class TestCommentAliases(MetaTestCase):
    def test_commenter_names_never_reach_the_model(self) -> None:
        original = self.graph.__call__

        def with_names(req, timeout=None):
            resp = original(req, timeout)
            if "/feed" in req.full_url:
                payload = json.loads(resp.read())
                payload["data"][0]["comments"]["data"][0]["from"] = {"id": "u1", "name": "Wendy Chan"}
                payload["data"][0]["comments"]["data"].append({"id": "c2", "from": {"id": "u2", "name": "Ka Ming"}, "message": "Price?"})

                class _R:
                    def read(self) -> bytes:
                        return json.dumps(payload).encode()

                    def __enter__(self):
                        return self

                    def __exit__(self, *a):
                        return None

                return _R()
            return resp

        with patch.object(board_meta, "_urlopen", with_names):
            first = board_meta.op_list_comments(self._ctx(), {})
            second = board_meta.op_list_comments(self._ctx(), {})
        dumped = str(first)
        self.assertNotIn("Wendy", dumped)
        self.assertNotIn("Ka Ming", dumped)
        self.assertNotIn('"u1"', dumped)
        froms = [c["from"] for c in first["posts"][0]["comments"]]
        self.assertTrue(all(f.startswith("contact#") for f in froms), froms)
        self.assertEqual(len(set(froms)), 2)
        self.assertEqual(froms, [c["from"] for c in second["posts"][0]["comments"]])
        pseud = board_pii.Pseudonymizer(self.table)
        self.assertEqual(pseud.resolve(froms[0]), "Wendy Chan")

    def test_no_table_falls_back_to_hidden(self) -> None:
        self.assertEqual(board_meta._mask_sender({"id": "u1", "name": "Wendy"}, None), "contact#hidden")
        self.assertEqual(board_meta._mask_sender({}, None), "contact#unknown")


class TestPseudonymizerSave(ToolsTestCase):
    def test_concurrent_writers_merge_instead_of_clobbering(self) -> None:
        a = board_pii.Pseudonymizer(self.table)
        b = board_pii.Pseudonymizer(self.table)
        alias_a = a.alias_for("contact", "parent-a@example.com")
        alias_b = b.alias_for("contact", "parent-b@example.com")
        self.assertEqual(alias_a, alias_b, "both start from an empty map and pick contact#1")
        a.save()
        b.save()
        stored = board_pii.Pseudonymizer(self.table)
        self.assertEqual(stored.resolve(alias_a), "parent-a@example.com")
        self.assertEqual(stored.alias_for("contact", "parent-b@example.com"), "contact#2")
        self.assertFalse(stored._dirty)
        self.assertEqual(stored.state["next"], 3)

    def test_same_value_from_two_writers_keeps_one_digest(self) -> None:
        a = board_pii.Pseudonymizer(self.table)
        b = board_pii.Pseudonymizer(self.table)
        a.alias_for("phone", "+852 9123 4567")
        b.alias_for("phone", "+852 9123 4567")
        a.save()
        b.save()
        stored = board_pii.Pseudonymizer(self.table)
        self.assertEqual(stored.alias_for("phone", "+852 9123 4567"), "phone#1")
        self.assertEqual(len(stored.state["byDigest"]), 1)


class TestTemplates(MetaTestCase):
    def test_lists_approved_templates(self) -> None:
        out = board_meta.op_list_whatsapp_templates(self._ctx(), {})
        self.assertEqual(out["count"], 1)
        self.assertEqual(out["templates"][0]["name"], "hello_world")
        self.assertEqual(out["wabaId"], "waba-1")


class TestInvoicePdf(unittest.TestCase):
    def test_pdf_bytes_are_valid_header(self) -> None:
        pdf = board_invoice_pdf.render_invoice_pdf(
            number="STD-2026-0001",
            amount_hkd=388,
            fps_reference="STDABCDEF",
            issued_on="2026-09-04",
            due_on="2026-09-18",
            payer_contact="billing@provider.example",
        )
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertIn(b"STD-2026-0001", pdf)
        self.assertIn(b"STDABCDEF", pdf)


class TestDraftInvoiceStoresPdf(ToolsTestCase):
    def test_draft_writes_pdf_when_s3_works(self) -> None:
        import board_data_api
        import board_receivables
        from test_board_t4 import FakeAurora

        db = FakeAurora()
        db.subs.append(
            {
                "id": "sub-1",
                "organization_id": "org-1",
                "store_id": None,
                "plan_id": "plan-1",
                "starts_on": "2026-08-01",
                "renews_on": "2026-10-01",
                "status": "active",
                "payer_contact": "billing@provider.example",
            }
        )
        board_data_api.set_executor_for_tests(db)
        self.addCleanup(lambda: board_data_api.set_executor_for_tests(None))
        put = MagicMock()
        with patch("runtime._s3") as s3:
            s3.put_object = put
            out = board_receivables.op_draft_invoice(
                None, {"subscriptionId": "sub-1", "amountHkd": 388, "reason": "PDF."}
            )
        self.assertTrue(out["ok"])
        self.assertTrue(str(out.get("pdfKey") or "").startswith("board/invoices/"))
        put.assert_called_once()
        self.assertEqual(db.invoices[0]["pdf_key"], out["pdfKey"])


if __name__ == "__main__":
    unittest.main()
