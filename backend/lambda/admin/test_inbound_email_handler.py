"""Tests for inbound SES mail PDF extraction."""

from __future__ import annotations

import unittest
from email.message import EmailMessage

from inbound_email_handler import (
    extract_first_pdf_attachment,
    extract_pdf_attachments,
    house_key_from_raw_mail_s3_key,
)


class TestExtractFirstPdf(unittest.TestCase):
    def test_multipart_attachment(self) -> None:
        msg = EmailMessage()
        msg["Subject"] = "Stmt"
        msg["From"] = "a@b.com"
        msg["To"] = "32-hillmarton@inbound.lx-software.com"
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

    def test_extracts_multiple_pdfs_in_order(self) -> None:
        msg = EmailMessage()
        msg.set_content("body")
        msg.add_attachment(
            b"%PDF-1 first",
            maintype="application",
            subtype="pdf",
            filename="a.pdf",
        )
        msg.add_attachment(
            b"%PDF-1 second",
            maintype="application",
            subtype="pdf",
            filename="b.pdf",
        )
        parts = extract_pdf_attachments(msg.as_bytes())
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0][0], b"%PDF-1 first")
        self.assertEqual(parts[0][1], "a.pdf")
        self.assertEqual(parts[1][0], b"%PDF-1 second")
        self.assertEqual(parts[1][1], "b.pdf")


class TestHouseKeyFromRawMailKey(unittest.TestCase):
    def test_resolves_hillmarton(self) -> None:
        self.assertEqual(
            house_key_from_raw_mail_s3_key(
                ses_drop_path="inbound-raw/hillmarton/AMAZON_SES_msg",
                raw_mail_prefix="inbound-raw",
            ),
            "hillmarton",
        )

    def test_resolves_morrison(self) -> None:
        self.assertEqual(
            house_key_from_raw_mail_s3_key(
                ses_drop_path="inbound-raw/morrison/x",
                raw_mail_prefix="inbound-raw",
            ),
            "morrison",
        )

    def test_rejects_unknown_house_segment(self) -> None:
        self.assertIsNone(
            house_key_from_raw_mail_s3_key(
                ses_drop_path="inbound-raw/unknown/x",
                raw_mail_prefix="inbound-raw",
            )
        )

    def test_rejects_wrong_prefix(self) -> None:
        self.assertIsNone(
            house_key_from_raw_mail_s3_key(
                ses_drop_path="other/hillmarton/x",
                raw_mail_prefix="inbound-raw",
            )
        )


if __name__ == "__main__":
    unittest.main()
