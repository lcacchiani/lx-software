"""Executive Board ``product`` tools: read-only siutindei SQL views (§5.7).

Parameters are limited to date ranges and district/category filters. The
only write is ``product_flag_listing``, which records an action item for
the founder (no catalog mutation from this stack).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import board_data_api
import board_store
from http_common import _utc_iso_z

class ProductError(RuntimeError):
    """User-facing product-analytics failure."""


def _q(sql: str, **kwargs: Any) -> list[dict[str, Any]]:
    try:
        return board_data_api.execute(sql, board_data_api.params(**kwargs) if kwargs else None)
    except board_data_api.DataApiError as exc:
        raise ProductError(str(exc)) from exc


def op_catalog_health(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    district = str(args.get("district") or "").strip()
    category = str(args.get("category") or "").strip()
    sql = "SELECT district, category, activities, providers, stores, completeness FROM v_catalog_health"
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if district:
        clauses.append("district = :district")
        params["district"] = district
    if category:
        clauses.append("category = :category")
        params["category"] = category
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY activities DESC LIMIT 50"
    return {"rows": _q(sql, **params)}


def op_funnel(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    start = str(args.get("from") or "").strip()
    end = str(args.get("to") or "").strip()
    district = str(args.get("district") or "").strip()
    sql = (
        "SELECT day, district, searches, listing_views, cta_taps, leads_relayed, bookings_confirmed "
        "FROM v_funnel_daily"
    )
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if start:
        clauses.append("day >= :dfrom")
        params["dfrom"] = start
    if end:
        clauses.append("day <= :dto")
        params["dto"] = end
    if district:
        clauses.append("district = :district")
        params["district"] = district
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY day DESC LIMIT 60"
    return {"rows": _q(sql, **params)}


def op_provider_pipeline(_ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    status = str(args.get("status") or "").strip()
    sql = (
        "SELECT organization_id, organization_name, signed_up_on, onboarding_step, "
        "days_since_last_edit, subscription_status FROM v_provider_pipeline"
    )
    if status:
        rows = _q(sql + " WHERE subscription_status = :status ORDER BY days_since_last_edit DESC LIMIT 50", status=status)
    else:
        rows = _q(sql + " ORDER BY days_since_last_edit DESC LIMIT 50")
    return {"providers": rows, "count": len(rows)}


def op_flag_listing(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    listing_id = str(args.get("listingId") or "").strip()
    reason = str(args.get("reason") or "").strip()
    if not listing_id:
        raise ProductError("listingId is required")
    now = _utc_iso_z(datetime.now(timezone.utc))
    title = f"Review listing {listing_id}"
    doc = {
        "actionId": board_store.new_id(),
        "title": title[:200],
        "detail": reason[:800],
        "persona": ctx.persona_id or "cpo",
        "priority": "next",
        "effort": "S",
        "metric": "Listing reviewed or unpublished",
        "dependsOn": [],
        "status": "open",
        "note": "",
        "meetingId": getattr(ctx, "meeting_id", "") or "",
        "source": "tool",
        "reaffirmedByMeetingIds": [],
        "dueAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    board_store.put_action(ctx.table, doc)
    return {"ok": True, "actionId": doc["actionId"], "listingId": listing_id}
