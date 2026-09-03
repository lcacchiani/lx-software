"""Executive Board: DynamoDB persistence.

All board state lives in the records table under ``BOARD#<boardKey>#…``
partition keys so it can be excluded from the generic ``/records`` scan.

Key layout (``pk`` / ``sk``):

- ``BOARD#<b>#settings`` / ``STATE``            — board settings
- ``BOARD#<b>#charter`` / ``STATE``             — company vision + mission
- ``BOARD#<b>#members`` / ``MEMBER#<personaId>`` — per-member overrides
- ``BOARD#<b>#brief`` / ``STATE``               — company brief (Markdown)
- ``BOARD#<b>#updates`` / ``UPDATE#<ts>#<id>``  — owner updates
- ``BOARD#<b>#meeting#<id>`` / ``META``         — meeting document
  (``gsi1pk=BOARD#<b>#meetings``, ``gsi1sk=<createdAt>`` for listing)
- ``BOARD#<b>#meeting#<id>`` / ``TURN#<seq>``   — one persona statement
- ``BOARD#<b>#actions`` / ``ACTION#<id>``       — action items
- ``BOARD#<b>#chat#<personaId>`` / ``MSG#<ts>#<id>`` — chat threads
- ``BOARD#<b>#chatjob#<jobId>`` / ``META``      — chat jobs (TTL)
- ``BOARD#<b>#repo-snapshot`` / ``STATE``       — cached GitHub context
- ``BOARD#<b>#usage#<yyyy-mm-dd>`` / ``STATE``  — daily token / cost totals
"""

from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from botocore.exceptions import ClientError

import runtime
from contract_constants import (
    BOARD_CHAIR_DEFAULT,
    BOARD_CHAT_JOB_TTL_SECONDS,
    BOARD_DEFAULT_DAILY_BUDGET_USD,
    BOARD_KEY,
)
from ddb_convert import _from_ddb_nested, _to_ddb_nested
from http_common import _utc_iso_z

BOARD_PK_PREFIX = "BOARD#"


def board_pk(suffix: str) -> str:
    return f"{BOARD_PK_PREFIX}{BOARD_KEY}#{suffix}"


def records_table() -> Any:
    return runtime._ddb.Table(os.environ["RECORDS_TABLE_NAME"])


def now_iso() -> str:
    return _utc_iso_z(datetime.now(timezone.utc))


def new_id() -> str:
    return uuid.uuid4().hex


def _strip_keys(item: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v
        for k, v in item.items()
        if k not in ("pk", "sk", "gsi1pk", "gsi1sk")
    }


def _get_state(table: Any, suffix: str) -> dict[str, Any] | None:
    res = table.get_item(Key={"pk": board_pk(suffix), "sk": "STATE"})
    item = res.get("Item") if isinstance(res, dict) else None
    if not item:
        return None
    doc = _from_ddb_nested(_strip_keys(item))
    return doc if isinstance(doc, dict) else None


def _put_state(table: Any, suffix: str, doc: dict[str, Any]) -> None:
    table.put_item(
        Item={"pk": board_pk(suffix), "sk": "STATE", **_to_ddb_nested(doc)}
    )


def _query_all(table: Any, **kwargs: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start_key: dict[str, Any] | None = None
    while True:
        params = dict(kwargs)
        if start_key:
            params["ExclusiveStartKey"] = start_key
        res = table.query(**params)
        for raw in res.get("Items", []) or []:
            doc = _from_ddb_nested(raw)
            if isinstance(doc, dict):
                items.append(doc)
        start_key = res.get("LastEvaluatedKey")
        if not start_key or ("Limit" in kwargs and len(items) >= kwargs["Limit"]):
            break
    return items


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def default_settings() -> dict[str, Any]:
    return {
        "schedule": {"morningEnabled": False, "eveningEnabled": False},
        "defaultMode": "standup",
        "defaultChair": BOARD_CHAIR_DEFAULT,
        "shareFinanceSummary": False,
        "shareRepoSnapshot": False,
        "models": {"chat": "", "standup": "", "deepDive": ""},
        "dailyBudgetUsd": BOARD_DEFAULT_DAILY_BUDGET_USD,
        "updatedAt": None,
    }


def load_settings(table: Any) -> dict[str, Any]:
    stored = _get_state(table, "settings") or {}
    merged = default_settings()
    for key in ("defaultMode", "defaultChair", "dailyBudgetUsd", "updatedAt"):
        if key in stored:
            merged[key] = stored[key]
    for key in ("shareFinanceSummary", "shareRepoSnapshot"):
        merged[key] = bool(stored.get(key, merged[key]))
    schedule = stored.get("schedule")
    if isinstance(schedule, dict):
        merged["schedule"] = {
            "morningEnabled": bool(schedule.get("morningEnabled", False)),
            "eveningEnabled": bool(schedule.get("eveningEnabled", False)),
        }
    models = stored.get("models")
    if isinstance(models, dict):
        merged["models"] = {
            k: str(models.get(k) or "") for k in ("chat", "standup", "deepDive")
        }
    return merged


def save_settings(table: Any, doc: dict[str, Any]) -> dict[str, Any]:
    out = {**doc, "updatedAt": now_iso()}
    _put_state(table, "settings", out)
    return out


# ---------------------------------------------------------------------------
# Charter, member overrides, brief
# ---------------------------------------------------------------------------

def load_charter(table: Any) -> dict[str, Any]:
    stored = _get_state(table, "charter") or {}
    return {
        "vision": str(stored.get("vision") or ""),
        "mission": str(stored.get("mission") or ""),
        "updatedAt": stored.get("updatedAt"),
    }


def save_charter(table: Any, *, vision: str, mission: str, owner_sub: str | None) -> dict[str, Any]:
    doc = {
        "vision": vision,
        "mission": mission,
        "updatedAt": now_iso(),
        "updatedBySub": owner_sub or "",
    }
    _put_state(table, "charter", doc)
    return {k: v for k, v in doc.items() if k != "updatedBySub"}


def load_member_overrides(table: Any) -> dict[str, dict[str, Any]]:
    items = _query_all(
        table,
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": board_pk("members"), ":prefix": "MEMBER#"},
    )
    out: dict[str, dict[str, Any]] = {}
    for item in items:
        sk = str(item.get("sk") or "")
        persona_id = sk[len("MEMBER#"):] if sk.startswith("MEMBER#") else ""
        if persona_id:
            out[persona_id] = _strip_keys(item)
    return out


def save_member_override(table: Any, persona_id: str, doc: dict[str, Any]) -> None:
    table.put_item(
        Item={
            "pk": board_pk("members"),
            "sk": f"MEMBER#{persona_id}",
            **_to_ddb_nested(doc),
        }
    )


def delete_member_override(table: Any, persona_id: str) -> None:
    table.delete_item(Key={"pk": board_pk("members"), "sk": f"MEMBER#{persona_id}"})


def load_brief(table: Any) -> dict[str, Any]:
    stored = _get_state(table, "brief") or {}
    return {
        "markdown": str(stored.get("markdown") or ""),
        "updatedAt": stored.get("updatedAt"),
    }


def save_brief(table: Any, *, markdown: str, owner_sub: str | None) -> dict[str, Any]:
    doc = {"markdown": markdown, "updatedAt": now_iso(), "updatedBySub": owner_sub or ""}
    _put_state(table, "brief", doc)
    return {"markdown": markdown, "updatedAt": doc["updatedAt"]}


# ---------------------------------------------------------------------------
# Owner updates
# ---------------------------------------------------------------------------

def add_update(table: Any, *, text: str, owner_sub: str | None) -> dict[str, Any]:
    created = now_iso()
    update_id = new_id()
    doc = {
        "updateId": update_id,
        "text": text,
        "createdAt": created,
        "ownerSub": owner_sub or "",
    }
    table.put_item(
        Item={
            "pk": board_pk("updates"),
            "sk": f"UPDATE#{created}#{update_id}",
            **_to_ddb_nested(doc),
        }
    )
    return {k: v for k, v in doc.items() if k != "ownerSub"}


def list_updates(table: Any, *, limit: int = 20) -> list[dict[str, Any]]:
    items = _query_all(
        table,
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": board_pk("updates"), ":prefix": "UPDATE#"},
        ScanIndexForward=False,
        Limit=limit,
    )
    return [
        {k: v for k, v in _strip_keys(i).items() if k != "ownerSub"}
        for i in items[:limit]
    ]


# ---------------------------------------------------------------------------
# Meetings
# ---------------------------------------------------------------------------

def meeting_key(meeting_id: str) -> dict[str, str]:
    return {"pk": board_pk(f"meeting#{meeting_id}"), "sk": "META"}


def put_meeting(table: Any, doc: dict[str, Any]) -> None:
    meeting_id = str(doc["meetingId"])
    table.put_item(
        Item={
            **meeting_key(meeting_id),
            "gsi1pk": board_pk("meetings"),
            "gsi1sk": str(doc.get("createdAt") or now_iso()),
            **_to_ddb_nested(doc),
        }
    )


def get_meeting(table: Any, meeting_id: str) -> dict[str, Any] | None:
    res = table.get_item(Key=meeting_key(meeting_id))
    item = res.get("Item") if isinstance(res, dict) else None
    if not item:
        return None
    doc = _from_ddb_nested(_strip_keys(item))
    return doc if isinstance(doc, dict) else None


def list_meetings(table: Any, *, limit: int = 30) -> list[dict[str, Any]]:
    items = _query_all(
        table,
        IndexName="gsi1",
        KeyConditionExpression="gsi1pk = :pk",
        ExpressionAttributeValues={":pk": board_pk("meetings")},
        ScanIndexForward=False,
        Limit=limit,
    )
    return [_strip_keys(i) for i in items[:limit]]


def claim_meeting_phase(
    table: Any,
    meeting_id: str,
    *,
    expected_phase: str,
    stale_before_iso: str,
) -> bool:
    """Atomically mark a phase as running. False when another worker owns it."""
    now = now_iso()
    try:
        table.update_item(
            Key=meeting_key(meeting_id),
            UpdateExpression="SET phaseState = :running, phaseStartedAt = :now, updatedAt = :now",
            ConditionExpression=(
                "#st = :active AND phase = :expected AND "
                "(phaseState <> :running OR phaseStartedAt < :stale)"
            ),
            ExpressionAttributeNames={"#st": "status"},
            ExpressionAttributeValues={
                ":running": "running",
                ":now": now,
                ":active": "running",
                ":expected": expected_phase,
                ":stale": stale_before_iso,
            },
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise
    return True


def put_turn(table: Any, meeting_id: str, turn: dict[str, Any]) -> None:
    seq = int(turn["seq"])
    table.put_item(
        Item={
            "pk": board_pk(f"meeting#{meeting_id}"),
            "sk": f"TURN#{seq:04d}",
            **_to_ddb_nested(turn),
        }
    )


def list_turns(table: Any, meeting_id: str) -> list[dict[str, Any]]:
    items = _query_all(
        table,
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={
            ":pk": board_pk(f"meeting#{meeting_id}"),
            ":prefix": "TURN#",
        },
    )
    return [_strip_keys(i) for i in items]


# ---------------------------------------------------------------------------
# Action items
# ---------------------------------------------------------------------------

def put_action(table: Any, doc: dict[str, Any]) -> None:
    table.put_item(
        Item={
            "pk": board_pk("actions"),
            "sk": f"ACTION#{doc['actionId']}",
            **_to_ddb_nested(doc),
        }
    )


def get_action(table: Any, action_id: str) -> dict[str, Any] | None:
    res = table.get_item(Key={"pk": board_pk("actions"), "sk": f"ACTION#{action_id}"})
    item = res.get("Item") if isinstance(res, dict) else None
    if not item:
        return None
    doc = _from_ddb_nested(_strip_keys(item))
    return doc if isinstance(doc, dict) else None


def list_actions(table: Any) -> list[dict[str, Any]]:
    items = _query_all(
        table,
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": board_pk("actions"), ":prefix": "ACTION#"},
    )
    return [_strip_keys(i) for i in items]


# ---------------------------------------------------------------------------
# Chat threads and jobs
# ---------------------------------------------------------------------------

def chat_pk(persona_id: str) -> str:
    return board_pk(f"chat#{persona_id}")


def add_chat_message(
    table: Any,
    persona_id: str,
    *,
    role: str,
    text: str,
    usage: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    created = _utc_iso_z(now)
    message_id = new_id()
    doc: dict[str, Any] = {
        "messageId": message_id,
        "role": role,
        "text": text,
        "createdAt": created,
    }
    if usage:
        doc["usage"] = usage
    if extra:
        doc.update(extra)
    # Microsecond timestamp plus a role rank keeps a reply after its prompt
    # even when both land in the same millisecond.
    sort_stamp = now.strftime("%Y-%m-%dT%H:%M:%S.%f")
    role_rank = "1" if role == "assistant" else "0"
    table.put_item(
        Item={
            "pk": chat_pk(persona_id),
            "sk": f"MSG#{sort_stamp}#{role_rank}#{message_id}",
            **_to_ddb_nested(doc),
        }
    )
    return doc


def list_chat_messages(table: Any, persona_id: str, *, limit: int) -> list[dict[str, Any]]:
    """Latest ``limit`` messages, oldest first."""
    items = _query_all(
        table,
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": chat_pk(persona_id), ":prefix": "MSG#"},
        ScanIndexForward=False,
        Limit=limit,
    )
    ordered = list(reversed(items[:limit]))
    return [_strip_keys(i) for i in ordered]


def clear_chat_thread(table: Any, persona_id: str) -> int:
    items = _query_all(
        table,
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": chat_pk(persona_id), ":prefix": "MSG#"},
    )
    for item in items:
        table.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})
    return len(items)


def chat_job_key(job_id: str) -> dict[str, str]:
    return {"pk": board_pk(f"chatjob#{job_id}"), "sk": "META"}


def put_chat_job(table: Any, doc: dict[str, Any]) -> None:
    table.put_item(
        Item={
            **chat_job_key(str(doc["jobId"])),
            "expiresAt": int(time.time()) + BOARD_CHAT_JOB_TTL_SECONDS,
            **_to_ddb_nested(doc),
        }
    )


def get_chat_job(table: Any, job_id: str) -> dict[str, Any] | None:
    res = table.get_item(Key=chat_job_key(job_id))
    item = res.get("Item") if isinstance(res, dict) else None
    if not item:
        return None
    doc = _from_ddb_nested(_strip_keys(item))
    return doc if isinstance(doc, dict) else None


def claim_chat_job(table: Any, job_id: str, *, stale_before_iso: str) -> bool:
    now = now_iso()
    try:
        table.update_item(
            Key=chat_job_key(job_id),
            UpdateExpression="SET #st = :proc, updatedAt = :now",
            ConditionExpression="#st = :pend OR (#st = :proc AND updatedAt < :stale)",
            ExpressionAttributeNames={"#st": "status"},
            ExpressionAttributeValues={
                ":proc": "processing",
                ":pend": "pending",
                ":now": now,
                ":stale": stale_before_iso,
            },
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise
    return True


# ---------------------------------------------------------------------------
# Decision log, repo snapshot and usage
# ---------------------------------------------------------------------------

MAX_DECISION_LOG_ENTRIES = 60


def load_decision_log(table: Any) -> list[dict[str, Any]]:
    stored = _get_state(table, "decision-log") or {}
    entries = stored.get("entries")
    return [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []


def append_decision_log(table: Any, entries: list[dict[str, Any]]) -> None:
    if not entries:
        return
    merged = (load_decision_log(table) + entries)[-MAX_DECISION_LOG_ENTRIES:]
    _put_state(table, "decision-log", {"entries": merged, "updatedAt": now_iso()})

def load_repo_snapshot(table: Any) -> dict[str, Any] | None:
    return _get_state(table, "repo-snapshot")


def save_repo_snapshot(table: Any, doc: dict[str, Any]) -> None:
    _put_state(table, "repo-snapshot", doc)


def usage_day_key(date_iso: str | None = None) -> str:
    day = date_iso or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"usage#{day}"


def load_usage_day(table: Any, date_iso: str | None = None) -> dict[str, Any]:
    stored = _get_state(table, usage_day_key(date_iso)) or {}
    return {
        "promptTokens": int(stored.get("promptTokens") or 0),
        "completionTokens": int(stored.get("completionTokens") or 0),
        "totalTokens": int(stored.get("totalTokens") or 0),
        "cost": float(stored.get("cost") or 0.0),
        "calls": int(stored.get("calls") or 0),
    }


def add_usage_day(table: Any, usage: dict[str, Any], *, calls: int = 1) -> None:
    from decimal import Decimal

    table.update_item(
        Key={"pk": board_pk(usage_day_key()), "sk": "STATE"},
        UpdateExpression=(
            "ADD promptTokens :p, completionTokens :c, totalTokens :t, cost :cost, calls :calls"
        ),
        ExpressionAttributeValues={
            ":p": int(usage.get("promptTokens") or 0),
            ":c": int(usage.get("completionTokens") or 0),
            ":t": int(usage.get("totalTokens") or 0),
            ":cost": Decimal(str(round(float(usage.get("cost") or 0.0), 6))),
            ":calls": int(calls),
        },
    )
