"""Tests for inbound SES mail PDF extraction."""

from __future__ import annotations

import unittest
from email.message import EmailMessage

from inbound_email_handler import extract_first_pdf_attachment


class TestExtractFirstPdf(unittest.TestCase):
    def test_multipart_attachment(self) -> None:
        msg = EmailMessage()
        msg["Subject"] = "Stmt"
        msg["From"] = "a@b.com"
        msg["To"] = "hillmarton@inbound.lx-software.com"
        msg.set_content("See attached.")
        pdf = b"%PDF-1.4 minimal"
        msg.add_attachment(
            pdf,
            maintype="application",
            subtype="pdf",
            filename="January.pdf",
        )
        raw = msg.as_bytes()
        got = extract_first_pdf_attachment(raw)
        self.assertIsNotNone(got)
        data, name = got
        self.assertEqual(data, pdf)
        self.assertEqual(name, "January.pdf")

    def test_skips_non_pdf(self) -> None:
        msg = EmailMessage()
        msg.set_content("plain")
        msg.add_attachment(b"hello", maintype="text", subtype="plain", filename="x.txt")
        self.assertIsNone(extract_first_pdf_attachment(msg.as_bytes()))


if __name__ == "__main__":
    unittest.main()
