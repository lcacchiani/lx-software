"""Tests for inbound SES mail PDF extraction."""

from __future__ import annotations

import unittest
from email.message import EmailMessage

from inbound_email_handler import extract_first_pdf_attachment, house_key_from_raw_mail_s3_key


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
