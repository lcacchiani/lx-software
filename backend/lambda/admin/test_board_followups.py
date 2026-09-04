"""Follow-ups after T8: meeting writes, phishing, templates, PDF, timeouts."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import board_invoice_pdf
import board_mail
import board_meta
import board_store
import board_tools
from board_tools import REGISTRY, ToolContext, ToolOp, execute_call
from test_board_mail import MailTestCase, build_mail
from test_board_t5 import MetaTestCase
from test_board_tools import ToolsTestCase


class TestMeetingWrites(ToolsTestCase):
    def test_ciso_can_report_phishing_at_mail_read(self) -> None:
        settings = board_store.default_settings()
        names = {op.name for op, _ in board_tools.available_ops(settings, "ciso", context="chat")}
        self.assertIn("mail_report_phishing", names)
        self.assertNotIn("mail_send", names)

    def test_timeout_error_is_recorded(self) -> None:
        slow = ToolOp(
            name="slow_test_op",
            tool_id="board",
            kind="read",
            description="test",
            parameters={"type": "object", "properties": {}},
            run=lambda _ctx, _args: {"ok": True},
            summarize=lambda _a: "slow",
            timeout_seconds=1,
        )
        ctx = ToolContext(
            table=self.table,
            settings=board_store.default_settings(),
            persona_id="ceo",
            display_name="CEO",
        )
        with patch("board_tools._invoke_op", side_effect=TimeoutError("slow_test_op timed out after 1s")):
            out = execute_call(ctx, slow, {})
        self.assertEqual(out.status, "error")
        self.assertIn("timed out", out.result["error"])


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
        actions = board_store.list_actions(self.table)
        self.assertTrue(any("Phishing" in str(a.get("title")) for a in actions))


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
