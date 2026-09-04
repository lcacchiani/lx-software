"""Executive Board ``finance`` tools: listing receivables on siutindei Aurora.

Tables and views: ``scripts/siutindei/receivables.sql`` (apply in the product
repo). Mirror + dunning run from EventBridge Scheduler. The board never
initiates a bank payment.

Plan: docs/architecture/executive-board-tools-plan.md §5.4–§5.5.
"""

from __future__ import annotations

import os
import uuid
from datetime import date, timedelta
from typing import Any

import board_data_api
import board_invoice_pdf
import board_mail
import board_meta
import board_store
import runtime
from contract_constants import BOARD_INVOICE_NUMBER_PREFIX, BOARD_RECEIVABLES_LIST_MAX
from finance_store import (
    _finance_owner_ddb_key,
    _load_finance_owner,
    _normalize_finance_payload,
)
from ddb_convert import _to_ddb_nested
from http_common import _log_event, _utc_iso_z

BOOK = "siuTinDei"
DUNNING_OFFSETS = (7, 21, 35)


class ReceivablesError(RuntimeError):
    """User-facing receivables failure."""


def configured() -> bool:
    return board_data_api.configured() or board_data_api._executor is not None


def status_summary() -> dict[str, Any]:
    return {
        "configured": configured(),
        "clusterSet": bool(board_data_api.cluster_arn()),
    }


def _q(sql: str, **kwargs: Any) -> list[dict[str, Any]]:
    try:
        return board_data_api.execute(sql, board_data_api.params(**kwargs) if kwargs else None)
    except board_data_api.DataApiError as exc:
        raise ReceivablesError(str(exc)) from exc


def _one(sql: str, **kwargs: Any) -> dict[str, Any] | None:
    rows = _q(sql, **kwargs)
    return rows[0] if rows else None


def op_list_subscriptions(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    status = str(args.get("status") or "").strip()
    sql = (
        "SELECT s.id, s.organization_id, s.store_id, s.plan_id, s.starts_on, s.renews_on, "
        "s.status, s.payer_contact, p.name AS plan_name, p.price_hkd, p.billing_period "
        "FROM listing_subscriptions s LEFT JOIN listing_plans p ON p.id = s.plan_id "
    )
    if status:
        sql += "WHERE s.status = :status "
        rows = _q(sql + "ORDER BY s.renews_on NULLS LAST LIMIT :lim", status=status, lim=BOARD_RECEIVABLES_LIST_MAX)
    else:
        rows = _q(sql + "ORDER BY s.renews_on NULLS LAST LIMIT :lim", lim=BOARD_RECEIVABLES_LIST_MAX)
    return {"subscriptions": rows, "count": len(rows)}


def op_list_invoices(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    status = str(args.get("status") or "").strip()
    sql = (
        "SELECT id, subscription_id, number, issued_on, due_on, amount_hkd, status, "
        "fps_reference, pdf_key FROM invoices "
    )
    if status:
        rows = _q(sql + "WHERE status = :status ORDER BY due_on NULLS LAST LIMIT :lim", status=status, lim=BOARD_RECEIVABLES_LIST_MAX)
    else:
        rows = _q(sql + "ORDER BY due_on NULLS LAST LIMIT :lim", lim=BOARD_RECEIVABLES_LIST_MAX)
    return {"invoices": rows, "count": len(rows)}


def op_aging_report(_ctx: Any, _args: dict[str, Any]) -> dict[str, Any]:
    today = date.today().isoformat()
    rows = _q(
        "SELECT id, number, amount_hkd, status, due_on, fps_reference "
        "FROM invoices WHERE status IN ('sent', 'overdue') ORDER BY due_on"
    )
    buckets = {"current": [], "d7": [], "d21": [], "d35": []}
    outstanding = 0.0
    for inv in rows:
        due = str(inv.get("due_on") or today)
        try:
            days = (date.today() - date.fromisoformat(due[:10])).days
        except ValueError:
            days = 0
        amount = float(inv.get("amount_hkd") or 0)
        outstanding += amount
        item = {**inv, "daysOverdue": max(0, days)}
        if days < 7:
            buckets["current"].append(item)
        elif days < 21:
            buckets["d7"].append(item)
        elif days < 35:
            buckets["d21"].append(item)
        else:
            buckets["d35"].append(item)
    open_count = sum(len(v) for v in buckets.values())
    dso = round(outstanding / max(open_count, 1), 2)
    return {"asOf": today, "outstandingHkd": round(outstanding, 2), "dso": dso, "buckets": buckets}


def op_unit_economics(_ctx: Any, _args: dict[str, Any]) -> dict[str, Any]:
    paid = _one("SELECT COALESCE(SUM(amount_hkd), 0) AS total FROM invoices WHERE status = 'paid'") or {}
    active = _one("SELECT COUNT(*) AS n FROM listing_subscriptions WHERE status IN ('trial', 'active')") or {}
    aws = board_store.get_cache(_ctx.table, "aws:monthly_cost") if _ctx is not None else None
    cost = 0.0
    if aws and isinstance(aws.get("payload"), dict):
        try:
            cost = float(aws["payload"].get("totalUsd") or 0)
        except (TypeError, ValueError):
            cost = 0.0
    snapshot = (
        board_meta.ads_spend_snapshot(getattr(_ctx, "table", None), getattr(_ctx, "settings", None))
        if _ctx is not None
        else {"monthlyUsd": 0.0, "graphMonthlyUsd": 0.0, "recordedMonthlyUsd": 0.0}
    )
    meta_monthly = float(snapshot.get("monthlyUsd") or 0)
    revenue = float(paid.get("total") or 0)
    providers = int(active.get("n") or 0)
    return {
        "paidInvoicesHkd": revenue,
        "activeSubscriptions": providers,
        "revenuePerSubscriptionHkd": round(revenue / max(providers, 1), 2),
        "awsMonthlyUsd": cost,
        "metaAdsMonthlyUsd": meta_monthly,
        "metaAdsRecordedMonthlyUsd": float(snapshot.get("recordedMonthlyUsd") or 0),
        "metaAdsGraphMonthlyUsd": float(snapshot.get("graphMonthlyUsd") or 0),
        "note": "Gross margin uses AWS monthly cost plus Meta ads (recorded board commitment + Graph month-to-date).",
    }


def _next_number() -> str:
    year = date.today().year
    prefix = f"{BOARD_INVOICE_NUMBER_PREFIX}-{year}-"
    row = _one("SELECT number FROM invoices WHERE number LIKE :p ORDER BY number DESC LIMIT 1", p=f"{prefix}%")
    seq = 1
    if row and str(row.get("number") or "").startswith(prefix):
        try:
            seq = int(str(row["number"])[len(prefix):]) + 1
        except ValueError:
            seq = 1
    return f"{prefix}{seq:04d}"


def _fps_ref() -> str:
    return f"{BOARD_INVOICE_NUMBER_PREFIX}{uuid.uuid4().hex[:8].upper()}"


def op_draft_invoice(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    sub_id = str(args.get("subscriptionId") or "").strip()
    amount = args.get("amountHkd")
    try:
        hkd = float(amount)
    except (TypeError, ValueError) as exc:
        raise ReceivablesError("amountHkd must be a number") from exc
    if hkd <= 0:
        raise ReceivablesError("amountHkd must be positive")
    sub = _one("SELECT id, payer_contact FROM listing_subscriptions WHERE id = :id", id=sub_id)
    if not sub:
        raise ReceivablesError(f"subscription {sub_id} not found")
    due_days = int(args.get("dueInDays") or 14)
    issued = date.today()
    due = issued + timedelta(days=max(1, min(due_days, 90)))
    number = _next_number()
    fps = _fps_ref()
    inv_id = str(uuid.uuid4())
    _q(
        "INSERT INTO invoices (id, subscription_id, number, issued_on, due_on, amount_hkd, status, fps_reference) "
        "VALUES (:id, :sub, :number, :issued, :due, :amount, 'draft', :fps)",
        id=inv_id,
        sub=sub_id,
        number=number,
        issued=issued.isoformat(),
        due=due.isoformat(),
        amount=hkd,
        fps=fps,
    )
    pdf_key = _store_invoice_pdf(
        invoice_id=inv_id,
        number=number,
        amount_hkd=hkd,
        fps_reference=fps,
        issued_on=issued.isoformat(),
        due_on=due.isoformat(),
        payer_contact=str(sub.get("payer_contact") or ""),
    )
    if pdf_key:
        _q("UPDATE invoices SET pdf_key = :key WHERE id = :id", key=pdf_key, id=inv_id)
    return {
        "ok": True,
        "invoiceId": inv_id,
        "number": number,
        "fpsReference": fps,
        "amountHkd": hkd,
        "dueOn": due.isoformat(),
        "status": "draft",
        "payerContact": sub.get("payer_contact"),
        "pdfKey": pdf_key,
    }


def _store_invoice_pdf(
    *,
    invoice_id: str,
    number: str,
    amount_hkd: float,
    fps_reference: str,
    issued_on: str,
    due_on: str,
    payer_contact: str,
) -> str:
    bucket = (os.environ.get("ASSETS_BUCKET_NAME") or "").strip()
    if not bucket:
        return ""
    pdf = board_invoice_pdf.render_invoice_pdf(
        number=number,
        amount_hkd=amount_hkd,
        fps_reference=fps_reference,
        issued_on=issued_on,
        due_on=due_on,
        payer_contact=payer_contact,
    )
    key = board_invoice_pdf.invoice_s3_key(invoice_id, issued_on)
    try:
        runtime._s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=pdf,
            ContentType="application/pdf",
        )
    except Exception as exc:
        _log_event("warning", tag="board_invoice_pdf_failed", error=str(exc)[:200])
        return ""
    return key


def _load_invoice_pdf(inv: dict[str, Any]) -> bytes | None:
    key = str(inv.get("pdf_key") or "").strip()
    bucket = (os.environ.get("ASSETS_BUCKET_NAME") or "").strip()
    if not key or not bucket:
        return None
    try:
        obj = runtime._s3.get_object(Bucket=bucket, Key=key)
        body = obj.get("Body")
        data = body.read() if hasattr(body, "read") else body
    except Exception:
        return None
    return data if isinstance(data, (bytes, bytearray)) else None


def _invoice(invoice_id: str) -> dict[str, Any]:
    inv = _one("SELECT * FROM invoices WHERE id = :id", id=invoice_id)
    if not inv:
        raise ReceivablesError(f"invoice {invoice_id} not found")
    return inv


def payer_email(invoice: dict[str, Any]) -> str:
    sub_id = invoice.get("subscription_id")
    if not sub_id:
        return ""
    sub = _one("SELECT payer_contact FROM listing_subscriptions WHERE id = :id", id=str(sub_id))
    return str((sub or {}).get("payer_contact") or "")


def act_guard_send(_ctx: Any, args: dict[str, Any], *, op: str) -> str | None:
    inv = _invoice(str(args.get("invoiceId") or ""))
    email = payer_email(inv)
    if not email:
        return "the subscription has no payer contact"
    if not board_mail.recipient_allowed(getattr(_ctx, "settings", {}) or {}, email):
        return f"{email} is not on the email allow-list"
    return None


def owner_preview_send(_ctx: Any, args: dict[str, Any], *, op: str) -> dict[str, Any]:
    inv = _invoice(str(args.get("invoiceId") or ""))
    email = payer_email(inv)
    kind = "reminder" if op == "finance_send_reminder" else "invoice"
    label = "Reminder" if kind == "reminder" else "Invoice"
    note = str(args.get("note") or args.get("reason") or "").strip()
    body = (
        f"{label} {inv.get('number')} for HK${inv.get('amount_hkd')}. "
        f"Pay by FPS quoting {inv.get('fps_reference')}. Due {inv.get('due_on')}."
    )
    if note:
        body = f"{body}\n\n{note}"
    return {
        "kind": "email",
        "from": "billing@siutindei.com",
        "to": [email] if email else [],
        "cc": [],
        "subject": f"{label} {inv.get('number')} — HK${inv.get('amount_hkd')} (FPS {inv.get('fps_reference')})",
        "text": body,
        "threadId": "",
        "sendEnabled": board_mail.sending_enabled(),
        "invoiceId": inv.get("id"),
        "number": inv.get("number"),
        "fpsReference": inv.get("fps_reference"),
        "amountHkd": inv.get("amount_hkd"),
        "pdfKey": inv.get("pdf_key") or "",
        "attachments": [{"name": f"{inv.get('number')}.pdf"}] if inv.get("pdf_key") else [],
    }


def _send_mail(ctx: Any, inv: dict[str, Any], *, subject: str, body: str) -> dict[str, Any]:
    email = payer_email(inv)
    if not email:
        raise ReceivablesError("subscription has no payer contact")
    if not board_mail.sending_enabled():
        _q("UPDATE invoices SET status = 'sent' WHERE id = :id AND status = 'draft'", id=str(inv["id"]))
        return {"ok": True, "sent": False, "note": "Sending is off; invoice marked sent in the ledger only."}
    plan = board_mail.outgoing_plan(
        ctx.table,
        op="mail_send",
        args={
            "fromMailbox": "billing",
            "to": [email],
            "subject": subject,
            "body": body,
        },
    )
    pdf = _load_invoice_pdf(inv)
    if pdf:
        plan["attachments"] = [
            {"filename": f"{inv.get('number') or 'invoice'}.pdf", "contentType": "application/pdf", "content": pdf}
        ]
    return board_mail.send_plan(ctx.table, plan, sent_by=getattr(ctx, "persona_id", "cfo"))


def op_send_invoice(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    inv = _invoice(str(args.get("invoiceId") or ""))
    subject = f"Invoice {inv['number']} — HK${inv['amount_hkd']} (FPS {inv.get('fps_reference')})"
    body = (
        f"Please pay HK${inv['amount_hkd']} by FPS quoting {inv.get('fps_reference')}. "
        f"Due {inv.get('due_on')}.\n\nThe siutindei team"
    )
    result = _send_mail(ctx, inv, subject=subject, body=body)
    _q("UPDATE invoices SET status = 'sent' WHERE id = :id AND status IN ('draft', 'sent')", id=str(inv["id"]))
    return {"ok": True, "invoiceId": inv["id"], "number": inv["number"], **({} if result.get("ok") else result)}


def op_send_reminder(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    inv = _invoice(str(args.get("invoiceId") or ""))
    subject = f"Reminder: invoice {inv['number']} is due (FPS {inv.get('fps_reference')})"
    body = (
        f"This is a reminder that invoice {inv['number']} for HK${inv['amount_hkd']} "
        f"was due {inv.get('due_on')}. Please pay by FPS quoting {inv.get('fps_reference')}.\n\nThe siutindei team"
    )
    result = _send_mail(ctx, inv, subject=subject, body=body)
    if str(inv.get("status")) == "sent":
        _q("UPDATE invoices SET status = 'overdue' WHERE id = :id", id=str(inv["id"]))
    return {"ok": True, "invoiceId": inv["id"], "number": inv["number"], **({} if result.get("ok") else result)}


def op_match_payment(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    pay_id = str(args.get("paymentId") or "").strip()
    inv_id = str(args.get("invoiceId") or "").strip()
    pay = _one("SELECT * FROM payments WHERE id = :id", id=pay_id)
    if not pay:
        raise ReceivablesError(f"payment {pay_id} not found")
    inv = _invoice(inv_id)
    amount_ok = abs(float(pay.get("amount_hkd") or 0) - float(inv.get("amount_hkd") or 0)) < 0.01
    ref_ok = bool(pay.get("bank_reference")) and str(pay.get("bank_reference")).upper() == str(inv.get("fps_reference") or "").upper()
    _q(
        "UPDATE payments SET invoice_id = :inv, matched_by = :who WHERE id = :id",
        inv=inv_id,
        who=str(args.get("matchedBy") or "board"),
        id=pay_id,
    )
    if amount_ok:
        _q("UPDATE invoices SET status = 'paid' WHERE id = :id", id=inv_id)
    return {"ok": True, "matched": True, "amountAgrees": amount_ok, "referenceAgrees": ref_ok, "invoiceId": inv_id, "paymentId": pay_id}


def act_guard_match(_ctx: Any, args: dict[str, Any]) -> str | None:
    pay = _one("SELECT * FROM payments WHERE id = :id", id=str(args.get("paymentId") or ""))
    try:
        inv = _invoice(str(args.get("invoiceId") or ""))
    except ReceivablesError as exc:
        return str(exc)
    if not pay:
        return "payment not found"
    amount_ok = abs(float(pay.get("amount_hkd") or 0) - float(inv.get("amount_hkd") or 0)) < 0.01
    ref_ok = bool(pay.get("bank_reference")) and str(pay.get("bank_reference")).upper() == str(inv.get("fps_reference") or "").upper()
    if amount_ok and ref_ok:
        return None
    return "amount or FPS reference does not agree with the invoice"


def op_propose_price_change(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    name = " ".join(str(args.get("name") or "").split())[:80]
    period = str(args.get("billingPeriod") or "monthly")
    if period not in ("monthly", "annual"):
        raise ReceivablesError("billingPeriod must be monthly or annual")
    try:
        price = float(args.get("priceHkd"))
    except (TypeError, ValueError) as exc:
        raise ReceivablesError("priceHkd must be a number") from exc
    if price <= 0:
        raise ReceivablesError("priceHkd must be positive")
    plan_id = str(uuid.uuid4())
    _q(
        "INSERT INTO listing_plans (id, name, price_hkd, billing_period, active) "
        "VALUES (:id, :name, :price, :period, true)",
        id=plan_id,
        name=name,
        price=price,
        period=period,
    )
    return {"ok": True, "planId": plan_id, "name": name, "priceHkd": price, "billingPeriod": period}


def op_record_manual_payment(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    try:
        amount = float(args.get("amountHkd"))
    except (TypeError, ValueError) as exc:
        raise ReceivablesError("amountHkd must be a number") from exc
    if amount <= 0:
        raise ReceivablesError("amountHkd must be positive")
    received = str(args.get("receivedOn") or date.today().isoformat())[:10]
    pay_id = str(uuid.uuid4())
    inv_id = str(args.get("invoiceId") or "").strip() or None
    _q(
        "INSERT INTO payments (id, invoice_id, received_on, amount_hkd, payer_name, bank_reference, source, matched_by) "
        "VALUES (:id, :inv, :received, :amount, :payer, :ref, 'manual', :who)",
        id=pay_id,
        inv=inv_id,
        received=received,
        amount=amount,
        payer=str(args.get("payerName") or "")[:120],
        ref=str(args.get("bankReference") or "")[:80],
        who="manual",
    )
    if inv_id:
        try:
            op_match_payment(_ctx, {"paymentId": pay_id, "invoiceId": inv_id, "matchedBy": "manual"})
        except ReceivablesError:
            pass
    return {"ok": True, "paymentId": pay_id, "amountHkd": amount, "invoiceId": inv_id}


def aging_for_owner() -> dict[str, Any]:
    if not configured():
        return {"configured": False, "invoices": [], "subscriptions": [], "aging": {"buckets": {}, "outstandingHkd": 0}}
    return {
        "configured": True,
        "invoices": op_list_invoices(None, {})["invoices"],
        "subscriptions": op_list_subscriptions(None, {})["subscriptions"],
        "aging": op_aging_report(None, {}),
    }


def _line_same(prev: dict[str, Any], line: dict[str, Any]) -> bool:
    try:
        return (
            str(prev.get("description") or "") == str(line.get("description") or "")
            and str(prev.get("dateUtc") or "") == str(line.get("dateUtc") or "")
            and float(prev.get("grossAmount") or 0) == float(line.get("grossAmount") or 0)
            and str(prev.get("type") or "") == str(line.get("type") or "")
        )
    except (TypeError, ValueError):
        return False


def _upsert_book_lines(table: Any, new_lines: list[dict[str, Any]]) -> int:
    data = _load_finance_owner(table, BOOK)
    existing = [ln for ln in (data.get("lines") or []) if isinstance(ln, dict)]
    by_id = {str(ln.get("id")): ln for ln in existing}
    changed = 0
    for line in new_lines:
        lid = str(line["id"])
        prev = by_id.get(lid)
        if isinstance(prev, dict) and _line_same(prev, line):
            continue
        by_id[lid] = line
        changed += 1
    payload = _normalize_finance_payload(
        {
            "defaultCurrency": data.get("defaultCurrency") or "HKD",
            "float": data.get("float") or {"amount": 0, "currency": "HKD"},
            "lines": list(by_id.values()),
        }
    )
    table.put_item(Item={**_finance_owner_ddb_key(BOOK), **_to_ddb_nested(payload)})
    return changed


def mirror_to_statement_book(table: Any) -> dict[str, Any]:
    """Issued invoices and matched payments → Siu Tin Dei book lines.

    Outstanding sent/overdue invoices become income rows (still receivable);
    matched payments become income rows. Stable ``recv-inv-*`` / ``recv-pay-*``
    ids plus a ``[receivables]`` description prefix make re-runs idempotent.
    """
    invoices = _q("SELECT id, number, amount_hkd, status, issued_on, due_on FROM invoices WHERE status IN ('sent', 'overdue', 'paid')")
    payments = _q("SELECT id, invoice_id, amount_hkd, received_on FROM payments WHERE invoice_id IS NOT NULL")
    lines: list[dict[str, Any]] = []
    for inv in invoices:
        issued = str(inv.get("issued_on") or date.today().isoformat())
        iso = f"{issued[:10]}T00:00:00.000Z"
        amount = float(inv.get("amount_hkd") or 0)
        if inv.get("status") == "paid":
            continue
        lines.append(
            {
                "id": f"recv-inv-{inv['id']}",
                "dateUtc": iso,
                "type": "income",
                "description": f"[receivables] Invoice {inv.get('number')} due {inv.get('due_on')} ({inv.get('status')})",
                "netAmount": amount,
                "vat": 0,
                "grossAmount": amount,
                "currency": "HKD",
            }
        )
    for pay in payments:
        received = str(pay.get("received_on") or date.today().isoformat())
        iso = f"{received[:10]}T00:00:00.000Z"
        amount = float(pay.get("amount_hkd") or 0)
        lines.append(
            {
                "id": f"recv-pay-{pay['id']}",
                "dateUtc": iso,
                "type": "income",
                "description": f"[receivables] Payment matched to invoice {pay.get('invoice_id')}",
                "netAmount": amount,
                "vat": 0,
                "grossAmount": amount,
                "currency": "HKD",
            }
        )
    changed = _upsert_book_lines(table, lines)
    _log_event("info", tag="board_receivables_mirrored", lines=changed)
    return {"ok": True, "linesWritten": changed}


def handle_mirror_trigger(_event: dict[str, Any]) -> dict[str, Any]:
    if not configured():
        return {"ok": True, "skipped": "not_configured"}
    return mirror_to_statement_book(board_store.records_table())


def handle_dunning_trigger(_event: dict[str, Any]) -> dict[str, Any]:
    """Create propose-level reminder approvals for D+7 / D+21 / D+35 invoices."""
    if not configured():
        return {"ok": True, "skipped": "not_configured"}
    import board_tools

    table = board_store.records_table()
    settings = board_store.load_settings(table)
    aging = op_aging_report(None, {})
    created = 0
    pending = [a for a in board_store.list_approvals(table) if a.get("status") == "pending"]
    pending_invoices = {str((a.get("arguments") or {}).get("invoiceId")) for a in pending if a.get("op") == "finance_send_reminder"}
    buckets = aging.get("buckets") or {}
    for key, offset in (("d7", 7), ("d21", 21), ("d35", 35)):
        for inv in buckets.get(key) or []:
            inv_id = str(inv.get("id") or "")
            if not inv_id or inv_id in pending_invoices:
                continue
            ctx = board_tools.ToolContext(
                table=table,
                settings=settings,
                persona_id="cfo",
                display_name="CFO",
                kind="schedule",
            )
            board_tools.create_approval(
                ctx,
                board_tools.REGISTRY["finance_send_reminder"],
                {"invoiceId": inv_id, "reason": f"Automatic dunning at D+{offset} for {inv.get('number')}."},
                summary=f"Dunning reminder for {inv.get('number')}",
            )
            created += 1
    _log_event("info", tag="board_dunning_queued", created=created)
    return {"ok": True, "created": created}


def digest_for_context() -> dict[str, Any]:
    if not configured():
        return {}
    try:
        aging = op_aging_report(None, {})
    except ReceivablesError:
        return {}
    return {
        "outstandingHkd": aging.get("outstandingHkd"),
        "overdue": len((aging.get("buckets") or {}).get("d7") or [])
        + len((aging.get("buckets") or {}).get("d21") or [])
        + len((aging.get("buckets") or {}).get("d35") or []),
    }
