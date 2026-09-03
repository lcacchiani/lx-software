"""Executive Board: aggregated finance summary for the context pack.

Only totals are produced (per statement book, fiscal year and trailing three
months, by currency). No individual lines, payees or account data leave the
table.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from finance_store import _load_finance_owner

BOOKS = ("siuTinDei", "lxSoftware")
BOOK_LABELS = {"siuTinDei": "Siu Tin Dei", "lxSoftware": "LX Software"}


def _fiscal_year_start(now: datetime) -> datetime:
    year = now.year if now.month >= 4 else now.year - 1
    return datetime(year, 4, 1, tzinfo=timezone.utc)


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def summarize_book(data: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    fy_start = _fiscal_year_start(now)
    trailing_start = now - timedelta(days=90)
    fy: dict[str, dict[str, float]] = defaultdict(lambda: {"income": 0.0, "expenditure": 0.0})
    trailing: dict[str, dict[str, float]] = defaultdict(
        lambda: {"income": 0.0, "expenditure": 0.0}
    )
    fy_count = 0
    total_count = 0
    latest: datetime | None = None
    for line in data.get("lines") or []:
        if not isinstance(line, dict):
            continue
        total_count += 1
        dt = _parse_iso(line.get("dateUtc"))
        if dt is None:
            continue
        if latest is None or dt > latest:
            latest = dt
        line_type = str(line.get("type") or "")
        if line_type not in ("income", "expenditure"):
            continue
        currency = str(line.get("currency") or "HKD").upper()
        amount = line.get("grossAmount")
        try:
            value = abs(float(amount))
        except (TypeError, ValueError):
            continue
        if dt >= fy_start:
            fy[currency][line_type] += value
            fy_count += 1
        if dt >= trailing_start:
            trailing[currency][line_type] += value

    def _rows(bucket: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
        out = []
        for currency in sorted(bucket):
            inc = round(bucket[currency]["income"], 2)
            exp = round(bucket[currency]["expenditure"], 2)
            out.append(
                {
                    "currency": currency,
                    "income": inc,
                    "expenditure": exp,
                    "net": round(inc - exp, 2),
                }
            )
        return out

    return {
        "fiscalYearStart": fy_start.strftime("%Y-%m-%d"),
        "fiscalYear": _rows(fy),
        "trailing90Days": _rows(trailing),
        "lineCountFiscalYear": fy_count,
        "lineCountTotal": total_count,
        "latestLineDate": latest.strftime("%Y-%m-%d") if latest else None,
    }


def build_finance_summary(table: Any, *, now: datetime | None = None) -> dict[str, Any]:
    books: dict[str, Any] = {}
    for book in BOOKS:
        try:
            data = _load_finance_owner(table, book)
        except Exception:  # pragma: no cover - defensive: summary is optional
            continue
        books[book] = summarize_book(data, now=now)
    return {"generatedAt": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d"), "books": books}


def render_finance_summary(summary: dict[str, Any]) -> str:
    books = summary.get("books") or {}
    if not books:
        return ""
    lines = ["Finance summary (aggregated totals from the admin statement books):"]
    for book, data in books.items():
        label = BOOK_LABELS.get(book, book)
        lines.append(
            f"- {label}: {data.get('lineCountTotal', 0)} recorded lines, "
            f"latest {data.get('latestLineDate') or 'n/a'}."
        )
        fy_rows = data.get("fiscalYear") or []
        if fy_rows:
            for row in fy_rows:
                lines.append(
                    f"  - Fiscal year from {data.get('fiscalYearStart')}: "
                    f"income {row['income']:.2f} {row['currency']}, "
                    f"expenditure {row['expenditure']:.2f} {row['currency']}, "
                    f"net {row['net']:.2f} {row['currency']}."
                )
        else:
            lines.append("  - No lines in the current fiscal year.")
        for row in data.get("trailing90Days") or []:
            lines.append(
                f"  - Last 90 days: income {row['income']:.2f} {row['currency']}, "
                f"expenditure {row['expenditure']:.2f} {row['currency']}, "
                f"net {row['net']:.2f} {row['currency']}."
            )
    return "\n".join(lines)
