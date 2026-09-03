"""Executive Board: HTTP routing under ``/siu-tin-dei/board``."""

from __future__ import annotations

from typing import Any

import board_actions
import board_budget
import board_chat
import board_github
import board_meeting
import board_personas
import board_store
from contract_constants import (
    BOARD_CHAIR_DEFAULT,
    BOARD_MAX_BRIEF_LEN,
    BOARD_MAX_DAILY_BUDGET_USD,
    BOARD_MAX_UPDATE_LEN,
    BOARD_MEETING_MODES,
)
from http_common import _audit, _json_response, _log_event, _parse_json_body

BOARD_BASE_PATH = "/siu-tin-dei/board"


def handle_board_route(
    event: dict[str, Any], method: str, path: str, user_sub: str | None
) -> dict[str, Any] | None:
    """Return a response for board routes, or None when the path is not ours."""
    if path != BOARD_BASE_PATH and not path.startswith(BOARD_BASE_PATH + "/"):
        return None
    rest = [p for p in path[len(BOARD_BASE_PATH):].split("/") if p]

    if not rest:
        if method == "GET":
            return _overview()
        return _json_response(405, {"message": "Method not allowed"})

    head = rest[0]

    if head == "charter" and len(rest) == 1 and method == "PUT":
        return _charter_put(event, user_sub)

    if head == "members" and len(rest) == 2:
        persona_id = rest[1].lower()
        if not board_personas.is_persona_id(persona_id):
            return _json_response(404, {"message": "Unknown board member"})
        if method == "PUT":
            return _member_put(event, persona_id, user_sub)
        if method == "DELETE":
            return _member_reset(event, persona_id, user_sub)

    if head == "brief" and len(rest) == 1 and method == "PUT":
        return _brief_put(event, user_sub)

    if head == "settings" and len(rest) == 1 and method == "PUT":
        return _settings_put(event, user_sub)

    if head == "updates" and len(rest) == 1:
        if method == "POST":
            return _update_post(event, user_sub)
        if method == "GET":
            table = board_store.records_table()
            return _json_response(200, {"updates": board_store.list_updates(table, limit=50)})

    if head == "chat" and len(rest) >= 2:
        persona_id = rest[1].lower()
        if not board_personas.is_persona_id(persona_id):
            return _json_response(404, {"message": "Unknown board member"})
        if len(rest) == 2:
            if method == "GET":
                return board_chat.handle_thread_get(persona_id)
            if method == "POST":
                return board_chat.handle_message_post(event, persona_id, user_sub)
            if method == "DELETE":
                return board_chat.handle_thread_delete(event, persona_id, user_sub)
        if len(rest) == 4 and rest[2] == "jobs" and method == "GET":
            return board_chat.handle_job_get(persona_id, rest[3], user_sub)

    if head == "meetings":
        if len(rest) == 1:
            if method == "GET":
                return board_meeting.handle_meetings_get()
            if method == "POST":
                return board_meeting.handle_meeting_post(event, user_sub)
        if len(rest) == 2 and method == "GET":
            return board_meeting.handle_meeting_get(rest[1])
        if len(rest) == 3 and rest[2] == "cancel" and method == "POST":
            return board_meeting.handle_meeting_cancel(event, rest[1], user_sub)

    if head == "actions":
        if len(rest) == 1 and method == "GET":
            return board_actions.handle_actions_get(event)
        if len(rest) == 2 and method == "PUT":
            return board_actions.handle_action_put(event, rest[1], user_sub)

    if head == "repo-snapshot" and len(rest) == 2 and rest[1] == "refresh" and method == "POST":
        return _repo_snapshot_refresh(event, user_sub)

    return _json_response(404, {"message": "Not found"})


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def _overview() -> dict[str, Any]:
    table = board_store.records_table()
    settings = board_store.load_settings(table)
    roster = board_personas.effective_roster(board_store.load_member_overrides(table))
    meetings = board_store.list_meetings(table, limit=5)
    meetings = [board_meeting._finalize_stuck(table, m) for m in meetings]
    actions = board_store.list_actions(table)
    open_count = sum(1 for a in actions if a.get("status") == "open")
    running = next((m for m in meetings if m.get("status") == "running"), None)
    latest_done = next((m for m in meetings if m.get("status") == "succeeded"), None)
    usage = board_store.load_usage_day(table)
    return _json_response(
        200,
        {
            "settings": settings,
            "charter": board_store.load_charter(table),
            "brief": board_store.load_brief(table),
            "members": roster,
            "chairDefault": BOARD_CHAIR_DEFAULT,
            "openActionCount": open_count,
            "runningMeeting": board_meeting.public_meeting_summary(running) if running else None,
            "latestMeeting": board_meeting.public_meeting_summary(latest_done) if latest_done else None,
            "usageToday": {**usage, "budgetUsd": board_budget.daily_budget_usd(settings)},
            "models": {
                "chat": board_budget.model_for("chat", settings),
                "standup": board_budget.model_for("standup", settings),
                "deepDive": board_budget.model_for("deepDive", settings),
            },
            "repoSnapshot": board_github.public_snapshot_meta(board_store.load_repo_snapshot(table)),
            "repoSnapshotEnabled": board_github.snapshot_enabled(),
            "repo": board_github.repo_full_name(),
        },
    )


def _charter_put(event: dict[str, Any], user_sub: str | None) -> dict[str, Any]:
    try:
        charter = board_personas.validate_charter(_parse_json_body(event))
    except ValueError as exc:
        return _json_response(400, {"message": str(exc)})
    table = board_store.records_table()
    saved = board_store.save_charter(table, vision=charter["vision"], mission=charter["mission"], owner_sub=user_sub)
    _audit(user_sub, "BOARD_CHARTER_PUT", "charter", event)
    return _json_response(200, {"charter": saved})


def _member_put(event: dict[str, Any], persona_id: str, user_sub: str | None) -> dict[str, Any]:
    try:
        override = board_personas.validate_member_override(_parse_json_body(event))
    except ValueError as exc:
        return _json_response(400, {"message": str(exc)})
    table = board_store.records_table()
    doc = {**override, "updatedAt": board_store.now_iso(), "updatedBySub": user_sub or ""}
    board_store.save_member_override(table, persona_id, doc)
    _audit(user_sub, "BOARD_MEMBER_PUT", persona_id, event)
    profile = board_personas.effective_profile(board_personas.persona_default(persona_id) or {"id": persona_id}, doc)
    return _json_response(200, {"member": profile})


def _member_reset(event: dict[str, Any], persona_id: str, user_sub: str | None) -> dict[str, Any]:
    table = board_store.records_table()
    board_store.delete_member_override(table, persona_id)
    _audit(user_sub, "BOARD_MEMBER_RESET", persona_id, event)
    profile = board_personas.effective_profile(board_personas.persona_default(persona_id) or {"id": persona_id}, None)
    return _json_response(200, {"member": profile})


def _brief_put(event: dict[str, Any], user_sub: str | None) -> dict[str, Any]:
    body = _parse_json_body(event)
    raw = body.get("markdown", "")
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        return _json_response(400, {"message": "markdown must be a string"})
    if len(raw) > BOARD_MAX_BRIEF_LEN:
        return _json_response(400, {"message": f"markdown must be at most {BOARD_MAX_BRIEF_LEN} characters"})
    table = board_store.records_table()
    saved = board_store.save_brief(table, markdown=raw.strip(), owner_sub=user_sub)
    _audit(user_sub, "BOARD_BRIEF_PUT", "brief", event)
    return _json_response(200, {"brief": saved})


def validate_settings(body: Any, current: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("Body must be a JSON object")
    out = {**current}
    schedule = body.get("schedule")
    if schedule is not None:
        if not isinstance(schedule, dict):
            raise ValueError("schedule must be an object")
        out["schedule"] = {
            "morningEnabled": bool(schedule.get("morningEnabled", current["schedule"]["morningEnabled"])),
            "eveningEnabled": bool(schedule.get("eveningEnabled", current["schedule"]["eveningEnabled"])),
        }
    if "defaultMode" in body:
        mode = body.get("defaultMode")
        if mode not in BOARD_MEETING_MODES:
            raise ValueError("defaultMode must be standup or deepDive")
        out["defaultMode"] = mode
    if "defaultChair" in body:
        chair = body.get("defaultChair")
        if not board_personas.is_persona_id(chair):
            raise ValueError("defaultChair must be a board member id")
        out["defaultChair"] = chair
    for key in ("shareFinanceSummary", "shareRepoSnapshot"):
        if key in body:
            out[key] = bool(body.get(key))
    if "models" in body:
        models = body.get("models")
        if not isinstance(models, dict):
            raise ValueError("models must be an object")
        cleaned: dict[str, str] = {}
        for kind in ("chat", "standup", "deepDive"):
            value = models.get(kind, current["models"].get(kind, ""))
            if value is None:
                value = ""
            if not isinstance(value, str):
                raise ValueError(f"models.{kind} must be a string")
            value = value.strip()
            if len(value) > 120:
                raise ValueError(f"models.{kind} is too long")
            cleaned[kind] = value
        out["models"] = cleaned
    if "dailyBudgetUsd" in body:
        raw = body.get("dailyBudgetUsd")
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise ValueError("dailyBudgetUsd must be a number")
        if raw < 0 or raw > BOARD_MAX_DAILY_BUDGET_USD:
            raise ValueError(f"dailyBudgetUsd must be between 0 and {BOARD_MAX_DAILY_BUDGET_USD}")
        out["dailyBudgetUsd"] = round(float(raw), 2)
    return out


def _settings_put(event: dict[str, Any], user_sub: str | None) -> dict[str, Any]:
    table = board_store.records_table()
    current = board_store.load_settings(table)
    try:
        merged = validate_settings(_parse_json_body(event), current)
    except ValueError as exc:
        return _json_response(400, {"message": str(exc)})
    saved = board_store.save_settings(table, merged)
    _audit(user_sub, "BOARD_SETTINGS_PUT", "settings", event)
    return _json_response(200, {"settings": saved})


def _update_post(event: dict[str, Any], user_sub: str | None) -> dict[str, Any]:
    body = _parse_json_body(event)
    raw = body.get("text")
    if not isinstance(raw, str) or not raw.strip():
        return _json_response(400, {"message": "text is required"})
    if len(raw) > BOARD_MAX_UPDATE_LEN:
        return _json_response(400, {"message": f"text must be at most {BOARD_MAX_UPDATE_LEN} characters"})
    table = board_store.records_table()
    saved = board_store.add_update(table, text=raw.strip(), owner_sub=user_sub)
    _audit(user_sub, "BOARD_UPDATE_POST", saved["updateId"], event)
    return _json_response(201, {"update": saved})


def _repo_snapshot_refresh(event: dict[str, Any], user_sub: str | None) -> dict[str, Any]:
    if not board_github.snapshot_enabled():
        return _json_response(
            400,
            {"message": "GitHub access is not configured (set the GitHubReadTokenSecretArn stack parameter)"},
        )
    table = board_store.records_table()
    try:
        snapshot = board_github.fetch_snapshot()
    except board_github.GitHubSnapshotError as exc:
        _log_event("warning", tag="board_repo_snapshot_failed", error=str(exc)[:300])
        return _json_response(502, {"message": str(exc)})
    board_store.save_repo_snapshot(table, snapshot)
    _audit(user_sub, "BOARD_REPO_SNAPSHOT_REFRESH", snapshot.get("repo") or "", event)
    return _json_response(200, {"repoSnapshot": board_github.public_snapshot_meta(snapshot)})
