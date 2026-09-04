"""Minimal PDF renderer for listing invoices (no third-party PDF library)."""

from __future__ import annotations

from datetime import date


def render_invoice_pdf(
    *,
    number: str,
    amount_hkd: float,
    fps_reference: str,
    issued_on: str,
    due_on: str,
    payer_contact: str = "",
) -> bytes:
    """Return a one-page PDF the payer can print or forward to their bank."""
    lines = [
        "Siu Tin Dei — listing invoice",
        f"Invoice {number}",
        f"Issued {issued_on}   Due {due_on}",
        f"Amount  HK$ {amount_hkd:.2f}",
        f"Pay by FPS quoting {fps_reference}",
    ]
    if payer_contact:
        lines.append(f"Billed to {payer_contact}")
    lines.extend(["", "The siutindei team"])
    return _simple_pdf(lines)


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _simple_pdf(lines: list[str]) -> bytes:
    content_lines = ["BT", "/F1 12 Tf", "50 780 Td"]
    for i, line in enumerate(lines):
        if i:
            content_lines.append("0 -18 Td")
        content_lines.append(f"({_escape(line[:110])}) Tj")
    content_lines.append("ET")
    stream = "\n".join(content_lines).encode("latin-1", errors="replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{i} 0 obj\n".encode())
        out.extend(obj)
        out.extend(b"\nendobj\n")
    xref_at = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode())
    out.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    )
    return bytes(out)


def invoice_s3_key(invoice_id: str, issued_on: str | None = None) -> str:
    year = (issued_on or date.today().isoformat())[:4]
    safe = "".join(ch for ch in invoice_id if ch.isalnum() or ch in "-_")[:64]
    return f"board/invoices/{year}/{safe}.pdf"
