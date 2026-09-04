"""Executive Board: tools that members call while chatting or meeting.

Design (see docs/architecture/executive-board-tools-plan.md):

- A **registry** of operations, each belonging to a tool (``github``,
  ``board``) and being either a *read* or a *write*.
- A per-tool, per-member **level** (``off`` < ``read`` < ``propose`` <
  ``act``), capped by a global mode. Read operations are offered at
  ``read`` and above; write operations at ``propose`` and above. At
  ``propose`` a write is recorded as a pending **approval** for the owner
  instead of executing; at ``act`` it executes immediately.
- The **loop**: model → tool calls → results → model, bounded by rounds,
  calls, and wall-clock seconds. Every call lands in the audit log.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import board_actions
import board_budget
import board_github
import board_mail
import board_personas
import board_store
from contract_constants import (
    BOARD_ACTION_EFFORTS,
    BOARD_ACTION_PRIORITIES,
    BOARD_ACTION_STATUSES,
    BOARD_MAIL_BODY_MAX_CHARS,
    BOARD_MAIL_SUBJECT_MAX_LEN,
    BOARD_MAX_PENDING_APPROVALS,
    BOARD_MAX_TOOL_CALLS_PER_TURN,
    BOARD_MAX_TOOL_ROUNDS_PER_TURN,
    BOARD_TOOL_DEFINITIONS,
    BOARD_TOOL_LEVELS,
    BOARD_TOOL_RESULT_MAX_CHARS,
)
from http_common import _log_event, _utc_iso_z
from openrouter_client import ChatCompletion, ToolCall, add_usage

LEVEL_RANK: dict[str, int] = {lvl: i for i, lvl in enumerate(BOARD_TOOL_LEVELS)}
GLOBAL_MODE_CAP: dict[str, str] = {"readOnly": "read", "propose": "propose", "act": "act"}
TOOL_LABELS: dict[str, str] = {str(t["id"]): str(t["label"]) for t in BOARD_TOOL_DEFINITIONS}
MAX_ARGUMENT_CHARS = 8000
MAX_RESULT_PREVIEW = 400


class ToolPermissionError(RuntimeError):
    """The member is not allowed to run this operation at this level."""


@dataclass
class ToolContext:
    """Who is calling, from where. ``actor`` is ``persona`` or ``owner``."""

    table: Any
    settings: dict[str, Any]
    persona_id: str
    display_name: str = ""
    kind: str = "chat"
    meeting_id: str = ""
    phase: str = ""
    job_id: str = ""
    actor: str = "persona"
    owner_sub: str = ""

    def public(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.kind}
        if self.meeting_id:
            out["meetingId"] = self.meeting_id
        if self.phase:
            out["phase"] = self.phase
        if self.job_id:
            out["jobId"] = self.job_id
        return out


@dataclass(frozen=True)
class ToolOp:
    name: str
    tool_id: str
    kind: str  # "read" | "write"
    description: str
    parameters: dict[str, Any]
    run: Callable[[ToolContext, dict[str, Any]], dict[str, Any]]
    summarize: Callable[[dict[str, Any]], str]
    contexts: tuple[str, ...] = ("chat", "meeting")
    # Write ops only. ``act_guard`` returns a reason why an ``act``-level call
    # must still be approved (e.g. recipient not allow-listed); ``preview``
    # renders the owner-facing, un-masked payload stored on the approval.
    act_guard: Callable[[ToolContext, dict[str, Any]], str | None] | None = None
    preview: Callable[[ToolContext, dict[str, Any]], dict[str, Any] | None] | None = None

    @property
    def is_write(self) -> bool:
        return self.kind == "write"

    @property
    def min_level(self) -> str:
        return "propose" if self.is_write else "read"

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


@dataclass
class ToolOutcome:
    status: str  # ok | error | pending_approval
    result: dict[str, Any]
    summary: str
    approval_id: str = ""
    duration_ms: int = 0
    call_id: str = ""

    def public(self, op: ToolOp) -> dict[str, Any]:
        out = {
            "callId": self.call_id,
            "op": op.name,
            "toolId": op.tool_id,
            "toolLabel": TOOL_LABELS.get(op.tool_id, op.tool_id),
            "kind": op.kind,
            "status": self.status,
            "summary": self.summary,
            "durationMs": self.duration_ms,
        }
        if self.approval_id:
            out["approvalId"] = self.approval_id
        if self.status == "error":
            out["error"] = str(self.result.get("error") or "")[:300]
        return out


@dataclass
class ToolLoopResult:
    text: str
    usage: dict[str, Any]
    model: str
    calls: list[dict[str, Any]] = field(default_factory=list)
    rounds: int = 0
    completion: ChatCompletion | None = None


# ---------------------------------------------------------------------------
# Levels
# ---------------------------------------------------------------------------

def env_disabled() -> bool:
    """Deploy-time kill switch: ``BOARD_TOOLS_ENABLED=false`` on the Lambda."""
    env = (os.environ.get("BOARD_TOOLS_ENABLED") or "").strip().lower()
    return env in ("0", "false", "no", "off")


def tools_enabled(settings: dict[str, Any]) -> bool:
    if env_disabled():
        return False
    return bool((settings.get("tools") or {}).get("enabled", True))


def global_cap(settings: dict[str, Any]) -> str:
    mode = str((settings.get("tools") or {}).get("globalMode") or "propose")
    return GLOBAL_MODE_CAP.get(mode, "propose")


def configured_level(settings: dict[str, Any], tool_id: str, persona_id: str) -> str:
    matrix = (settings.get("tools") or {}).get("matrix") or {}
    level = str((matrix.get(tool_id) or {}).get(persona_id) or "off")
    return level if level in LEVEL_RANK else "off"


def effective_level(settings: dict[str, Any], tool_id: str, persona_id: str) -> str:
    """Configured level capped by the global mode; ``off`` when tools are disabled."""
    if not tools_enabled(settings):
        return "off"
    configured = configured_level(settings, tool_id, persona_id)
    cap = global_cap(settings)
    return configured if LEVEL_RANK[configured] <= LEVEL_RANK[cap] else cap


def effective_matrix(settings: dict[str, Any]) -> dict[str, dict[str, str]]:
    matrix = (settings.get("tools") or {}).get("matrix") or {}
    return {
        tool_id: {pid: effective_level(settings, tool_id, pid) for pid in cells}
        for tool_id, cells in matrix.items()
    }


def allows(level: str, required: str) -> bool:
    return LEVEL_RANK.get(level, 0) >= LEVEL_RANK.get(required, 0)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

def _str_param(description: str, *, max_len: int | None = None, enum: list[str] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"type": "string", "description": description}
    if max_len:
        out["maxLength"] = max_len
    if enum:
        out["enum"] = enum
    return out


def _int_param(description: str, *, minimum: int = 1, maximum: int = 20) -> dict[str, Any]:
    return {"type": "integer", "description": description, "minimum": minimum, "maximum": maximum}


def _obj(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


REASON_PARAM = _str_param(
    "One sentence for the founder explaining why this action is needed now.", max_len=400
)


def _gh(fn: Callable[[dict[str, Any]], dict[str, Any]]) -> Callable[[ToolContext, dict[str, Any]], dict[str, Any]]:
    return lambda _ctx, args: fn(args)


# --- board operations -------------------------------------------------------

def _board_list_actions(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    status = str(args.get("status") or "open").lower()
    persona = str(args.get("persona") or "").lower()
    items = board_store.list_actions(ctx.table)
    if status != "all":
        items = [a for a in items if a.get("status") == status]
    if persona:
        items = [a for a in items if a.get("persona") == persona]
    items.sort(key=board_actions._sort_key)
    return {
        "count": len(items),
        "items": [
            {
                "actionId": a.get("actionId"),
                "title": a.get("title"),
                "detail": str(a.get("detail") or "")[:300],
                "persona": a.get("persona"),
                "priority": a.get("priority"),
                "effort": a.get("effort"),
                "status": a.get("status"),
                "dueAt": a.get("dueAt"),
                "note": str(a.get("note") or "")[:300],
                "meetingId": a.get("meetingId"),
                "createdAt": a.get("createdAt"),
            }
            for a in items[:40]
        ],
    }


def _board_list_meetings(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    try:
        limit = min(max(1, int(args.get("limit") or 10)), 20)
    except (TypeError, ValueError):
        limit = 10
    out = []
    for m in board_store.list_meetings(ctx.table, limit=limit):
        minutes = m.get("minutes") if isinstance(m.get("minutes"), dict) else {}
        out.append(
            {
                "meetingId": m.get("meetingId"),
                "status": m.get("status"),
                "mode": m.get("mode"),
                "topic": m.get("topic") or "",
                "chair": m.get("chair"),
                "createdAt": m.get("createdAt"),
                "headline": minutes.get("headline") or "",
                "actionCount": len(minutes.get("actions") or []),
            }
        )
    return {"items": out}


def _board_get_minutes(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = str(args.get("meetingId") or "").strip()
    doc = None
    if meeting_id:
        doc = board_store.get_meeting(ctx.table, meeting_id)
    else:
        for m in board_store.list_meetings(ctx.table, limit=10):
            if m.get("status") == "succeeded" and isinstance(m.get("minutes"), dict):
                doc = m
                break
    if not doc:
        return {"error": "No minutes found" + (f" for meeting {meeting_id}" if meeting_id else "")}
    minutes = doc.get("minutes") if isinstance(doc.get("minutes"), dict) else None
    if not minutes:
        return {"error": f"Meeting {doc.get('meetingId')} has no minutes (status {doc.get('status')})"}
    return {
        "meetingId": doc.get("meetingId"),
        "createdAt": doc.get("createdAt"),
        "mode": doc.get("mode"),
        "topic": doc.get("topic") or "",
        "minutes": minutes,
    }


def _board_search_decisions(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    query = " ".join(str(args.get("query") or "").lower().split())
    entries = board_store.load_decision_log(ctx.table)
    words = [w for w in query.split() if w]
    if words:
        entries = [e for e in entries if all(w in str(e.get("text") or "").lower() for w in words)]
    return {"count": len(entries), "items": entries[-30:]}


def _board_add_action(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    title = " ".join(str(args.get("title") or "").split())[:120]
    if not title:
        return {"error": "title is required"}
    open_actions = [a for a in board_store.list_actions(ctx.table) if a.get("status") == "open"]
    match = board_actions.find_similar_open_action(title, open_actions)
    if match is not None:
        return {
            "ok": False,
            "duplicateOf": match.get("actionId"),
            "message": f"An open action already covers this: '{match.get('title')}' (id {match.get('actionId')}).",
        }
    priority = str(args.get("priority") or "next").lower()
    if priority not in BOARD_ACTION_PRIORITIES:
        priority = "next"
    effort = str(args.get("effort") or "M").upper()[:1]
    if effort not in BOARD_ACTION_EFFORTS:
        effort = "M"
    due_at = None
    try:
        due_days = int(args.get("dueInDays")) if args.get("dueInDays") is not None else None
    except (TypeError, ValueError):
        due_days = None
    now = datetime.now(timezone.utc)
    if due_days is not None and due_days > 0:
        due_at = _utc_iso_z(now + timedelta(days=min(due_days, 180)))
    doc = {
        "actionId": board_store.new_id(),
        "title": title,
        "detail": str(args.get("detail") or "").strip()[:800],
        "persona": ctx.persona_id,
        "priority": priority,
        "effort": effort,
        "metric": str(args.get("metric") or "").strip()[:300],
        "dependsOn": [],
        "status": "open",
        "note": "",
        "meetingId": ctx.meeting_id or "",
        "source": "tool" if ctx.actor == "persona" else "approval",
        "reaffirmedByMeetingIds": [],
        "dueAt": due_at,
        "createdAt": _utc_iso_z(now),
        "updatedAt": _utc_iso_z(now),
    }
    board_store.put_action(ctx.table, doc)
    return {"ok": True, "actionId": doc["actionId"], "title": title, "priority": priority}


def _board_update_action(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    action_id = str(args.get("actionId") or "").strip()
    doc = board_store.get_action(ctx.table, action_id) if action_id else None
    if not doc:
        return {"error": f"Action {action_id or '(missing id)'} not found"}
    if ctx.actor == "persona" and str(doc.get("persona") or "") != ctx.persona_id:
        return {"error": "You may only update actions you own; ask the owner to change others."}
    changed = False
    status = args.get("status")
    if isinstance(status, str) and status:
        if status not in BOARD_ACTION_STATUSES:
            return {"error": "status must be open, done or dismissed"}
        if status != doc.get("status"):
            doc["status"] = status
            doc["statusChangedAt"] = board_store.now_iso()
            changed = True
    note = args.get("note")
    if isinstance(note, str) and note.strip():
        stamp = f"[{ctx.display_name or ctx.persona_id}] {note.strip()[:600]}"
        existing = str(doc.get("note") or "").strip()
        doc["note"] = (existing + "\n" + stamp).strip()[:2000]
        changed = True
    if not changed:
        return {"ok": False, "message": "Nothing to change; pass status and/or note."}
    doc["updatedAt"] = board_store.now_iso()
    doc["updatedBy"] = f"{ctx.actor}:{ctx.persona_id}"
    board_store.put_action(ctx.table, doc)
    return {"ok": True, "actionId": action_id, "status": doc.get("status"), "note": doc.get("note")}


def _summ(template: str) -> Callable[[dict[str, Any]], str]:
    def _fmt(args: dict[str, Any]) -> str:
        try:
            return template.format(**{k: _short(v) for k, v in args.items()})
        except (KeyError, IndexError, ValueError):
            return template.split("{")[0].strip() or template
    return _fmt


def _short(value: Any, limit: int = 80) -> str:
    text = " ".join(str(value if value is not None else "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _summ_search(args: dict[str, Any]) -> str:
    q = _short(args.get("query") or "")
    return f"Searched GitHub {args.get('type') or 'issue'}s" + (f" for '{q}'" if q else "") + f" ({args.get('state') or 'open'})"


def _summ_labels(args: dict[str, Any]) -> str:
    labels = args.get("labels") if isinstance(args.get("labels"), list) else []
    return f"Set labels on #{args.get('number')}: {', '.join(str(x) for x in labels) or '(none)'}"


def _summ_mail_list(args: dict[str, Any]) -> str:
    parts = ["Listed email threads"]
    if args.get("mailbox"):
        parts.append(f"in {_short(args['mailbox'], 40)}")
    if args.get("query"):
        parts.append(f"matching '{_short(args['query'], 40)}'")
    if args.get("unreadOnly"):
        parts.append("(unread only)")
    return " ".join(parts)


def _summ_update_action(args: dict[str, Any]) -> str:
    parts = []
    if args.get("status"):
        parts.append(f"status → {args['status']}")
    if args.get("note"):
        parts.append("added a note")
    return f"Update action {_short(args.get('actionId'), 12)}: {', '.join(parts) or 'no change'}"


def build_registry() -> dict[str, ToolOp]:
    ops: list[ToolOp] = [
        ToolOp(
            name="github_search_issues",
            tool_id="github",
            kind="read",
            description="Search issues or pull requests in the siutindei repository by keywords. Use before proposing new work to avoid duplicates.",
            parameters=_obj(
                {
                    "query": _str_param("Keywords (GitHub search syntax allowed, e.g. 'label:bug booking').", max_len=200),
                    "state": _str_param("Filter by state.", enum=["open", "closed", "all"]),
                    "type": _str_param("issue, pr or any.", enum=["issue", "pr", "any"]),
                    "limit": _int_param("Max results (1-20).", maximum=20),
                }
            ),
            run=_gh(board_github.op_search_issues),
            summarize=_summ_search,
        ),
        ToolOp(
            name="github_get_issue",
            tool_id="github",
            kind="read",
            description="Read one issue or pull request in full, including its most recent comments.",
            parameters=_obj({"number": _int_param("Issue or PR number.", maximum=100000)}, ["number"]),
            run=_gh(board_github.op_get_issue),
            summarize=_summ("Read issue #{number}"),
        ),
        ToolOp(
            name="github_list_pull_requests",
            tool_id="github",
            kind="read",
            description="List pull requests (newest updated first).",
            parameters=_obj(
                {
                    "state": _str_param("open, closed or all.", enum=["open", "closed", "all"]),
                    "limit": _int_param("Max results (1-20).", maximum=20),
                }
            ),
            run=_gh(board_github.op_list_pull_requests),
            summarize=_summ("Listed {state} pull requests"),
        ),
        ToolOp(
            name="github_list_workflow_runs",
            tool_id="github",
            kind="read",
            description="List recent GitHub Actions runs (CI status, conclusions, branch).",
            parameters=_obj(
                {
                    "branch": _str_param("Optional branch filter.", max_len=100),
                    "limit": _int_param("Max results (1-20).", maximum=20),
                }
            ),
            run=_gh(board_github.op_list_workflow_runs),
            summarize=_summ("Checked CI runs"),
        ),
        ToolOp(
            name="github_list_commits",
            tool_id="github",
            kind="read",
            description="List recent commits on the default branch, optionally for one path.",
            parameters=_obj(
                {
                    "path": _str_param("Optional file or directory path.", max_len=200),
                    "limit": _int_param("Max results (1-20).", maximum=20),
                }
            ),
            run=_gh(board_github.op_list_commits),
            summarize=_summ("Listed recent commits"),
        ),
        ToolOp(
            name="github_get_file",
            tool_id="github",
            kind="read",
            description="Read a file (text, truncated) or list a directory in the repository.",
            parameters=_obj(
                {
                    "path": _str_param("Path from the repository root, e.g. README.md or docs/architecture.", max_len=200),
                    "ref": _str_param("Optional branch or tag.", max_len=100),
                },
                ["path"],
            ),
            run=_gh(board_github.op_get_file),
            summarize=_summ("Read {path}"),
        ),
        ToolOp(
            name="github_list_security_alerts",
            tool_id="github",
            kind="read",
            description="List open Dependabot and code-scanning alerts (needs a token with security_events access; otherwise reports why).",
            parameters=_obj({"limit": _int_param("Max alerts per kind (1-50).", maximum=50)}),
            run=_gh(board_github.op_list_security_alerts),
            summarize=_summ("Checked security alerts"),
        ),
        ToolOp(
            name="github_create_issue",
            tool_id="github",
            kind="write",
            description="Open a new GitHub issue. Search first; never duplicate an open issue.",
            parameters=_obj(
                {
                    "title": _str_param("Short imperative title.", max_len=200),
                    "body": _str_param("Markdown body: context, acceptance criteria, links.", max_len=4000),
                    "labels": {"type": "array", "items": {"type": "string"}, "description": "Optional labels."},
                    "reason": REASON_PARAM,
                },
                ["title", "body", "reason"],
            ),
            run=_gh(board_github.op_create_issue),
            summarize=_summ("Open GitHub issue: {title}"),
        ),
        ToolOp(
            name="github_comment_issue",
            tool_id="github",
            kind="write",
            description="Add a comment to an existing issue or pull request.",
            parameters=_obj(
                {
                    "number": _int_param("Issue or PR number.", maximum=100000),
                    "body": _str_param("Markdown comment.", max_len=4000),
                    "reason": REASON_PARAM,
                },
                ["number", "body", "reason"],
            ),
            run=_gh(board_github.op_comment_issue),
            summarize=_summ("Comment on #{number}"),
        ),
        ToolOp(
            name="github_set_labels",
            tool_id="github",
            kind="write",
            description="Replace the labels on an issue or pull request.",
            parameters=_obj(
                {
                    "number": _int_param("Issue or PR number.", maximum=100000),
                    "labels": {"type": "array", "items": {"type": "string"}, "description": "Full label set to apply."},
                    "reason": REASON_PARAM,
                },
                ["number", "labels", "reason"],
            ),
            run=_gh(board_github.op_set_labels),
            summarize=_summ_labels,
        ),
        ToolOp(
            name="board_list_actions",
            tool_id="board",
            kind="read",
            description="List the founder's action items with ids, owners, priorities and status.",
            parameters=_obj(
                {
                    "status": _str_param("open (default), done, dismissed or all.", enum=["open", "done", "dismissed", "all"]),
                    "persona": _str_param("Optional owner persona id (ceo, cfo, ...).", max_len=10),
                }
            ),
            run=_board_list_actions,
            summarize=_summ("Listed {status} actions"),
        ),
        ToolOp(
            name="board_list_meetings",
            tool_id="board",
            kind="read",
            description="List recent board meetings with their headlines.",
            parameters=_obj({"limit": _int_param("Max meetings (1-20).", maximum=20)}),
            run=_board_list_meetings,
            summarize=_summ("Listed recent meetings"),
        ),
        ToolOp(
            name="board_get_minutes",
            tool_id="board",
            kind="read",
            description="Read the full minutes of a meeting (latest successful meeting when meetingId is omitted).",
            parameters=_obj({"meetingId": _str_param("Optional meeting id.", max_len=64)}),
            run=_board_get_minutes,
            summarize=_summ("Read meeting minutes"),
        ),
        ToolOp(
            name="board_search_decisions",
            tool_id="board",
            kind="read",
            description="Search the board's decision log by keywords.",
            parameters=_obj({"query": _str_param("Keywords; all must match.", max_len=200)}),
            run=_board_search_decisions,
            summarize=_summ("Searched decisions for '{query}'"),
        ),
        ToolOp(
            name="board_add_action",
            tool_id="board",
            kind="write",
            description="Add one action item for the founder, owned by you. Check board_list_actions first; duplicates are rejected.",
            parameters=_obj(
                {
                    "title": _str_param("Imperative, <= 100 chars.", max_len=120),
                    "detail": _str_param("What done looks like.", max_len=800),
                    "priority": _str_param("now, next or later.", enum=list(BOARD_ACTION_PRIORITIES)),
                    "effort": _str_param("S, M or L.", enum=sorted(BOARD_ACTION_EFFORTS)),
                    "dueInDays": _int_param("Days until due (1-180).", maximum=180),
                    "metric": _str_param("How we know it worked.", max_len=300),
                    "reason": REASON_PARAM,
                },
                ["title", "detail", "priority", "reason"],
            ),
            run=_board_add_action,
            summarize=_summ("Add action: {title}"),
            contexts=("chat",),
        ),
        ToolOp(
            name="board_update_action",
            tool_id="board",
            kind="write",
            description="Change the status of, or append a note to, an action item you own.",
            parameters=_obj(
                {
                    "actionId": _str_param("Action id from board_list_actions.", max_len=64),
                    "status": _str_param("open, done or dismissed.", enum=sorted(BOARD_ACTION_STATUSES)),
                    "note": _str_param("Note to append.", max_len=600),
                    "reason": REASON_PARAM,
                },
                ["actionId", "reason"],
            ),
            run=_board_update_action,
            summarize=_summ_update_action,
            contexts=("chat",),
        ),
        ToolOp(
            name="mail_list_mailboxes",
            tool_id="mail",
            kind="read",
            description="List the company mailboxes (hello@, billing@, ...) with thread and unread counts.",
            parameters=_obj({}),
            run=board_mail.op_list_mailboxes,
            summarize=_summ("Listed mailboxes"),
        ),
        ToolOp(
            name="mail_list_threads",
            tool_id="mail",
            kind="read",
            description=(
                "List email threads, newest first, optionally for one mailbox, matching keywords, or unread only. "
                "Contacts appear as stable aliases like contact#12; never guess real names or addresses."
            ),
            parameters=_obj(
                {
                    "mailbox": _str_param("Optional mailbox (local part or full address).", max_len=120),
                    "query": _str_param("Optional keywords; all must match subject, snippet or sender.", max_len=200),
                    "unreadOnly": {"type": "boolean", "description": "Only threads the founder has not read yet."},
                    "limit": _int_param("Max threads (1-30).", maximum=30),
                }
            ),
            run=board_mail.op_list_threads,
            summarize=_summ_mail_list,
        ),
        ToolOp(
            name="mail_get_thread",
            tool_id="mail",
            kind="read",
            description="Read every message in one thread (bodies and attachment names, contacts pseudonymised).",
            parameters=_obj({"threadId": _str_param("Thread id from mail_list_threads.", max_len=64)}, ["threadId"]),
            run=board_mail.op_get_thread,
            summarize=_summ("Read email thread {threadId}"),
        ),
        ToolOp(
            name="mail_contact_history",
            tool_id="mail",
            kind="read",
            description="List the threads a contact alias (e.g. contact#12) has taken part in.",
            parameters=_obj({"contact": _str_param("Contact alias exactly as shown in a thread.", max_len=40)}, ["contact"]),
            run=board_mail.op_contact_history,
            summarize=_summ("Looked up history for {contact}"),
        ),
        ToolOp(
            name="mail_reply",
            tool_id="mail",
            kind="write",
            description=(
                "Reply to the last inbound message of a thread from the mailbox it was sent to. "
                "Plain text only; write as the company, sign off as 'The siutindei team'."
            ),
            parameters=_obj(
                {
                    "threadId": _str_param("Thread id from mail_list_threads.", max_len=64),
                    "body": _str_param("Plain-text reply body.", max_len=BOARD_MAIL_BODY_MAX_CHARS),
                    "reason": REASON_PARAM,
                },
                ["threadId", "body", "reason"],
            ),
            run=board_mail._op_write("mail_reply"),
            summarize=_summ("Reply in email thread {threadId}"),
            act_guard=lambda ctx, args: board_mail.act_guard(ctx, args, op="mail_reply"),
            preview=lambda ctx, args: board_mail.owner_preview(ctx, args, op="mail_reply"),
        ),
        ToolOp(
            name="mail_send",
            tool_id="mail",
            kind="write",
            description="Start a new email from a company mailbox to one or more contacts (aliases or full addresses).",
            parameters=_obj(
                {
                    "fromMailbox": _str_param("Sending mailbox, e.g. hello or billing@siutindei.com.", max_len=120),
                    "to": {"type": "array", "items": {"type": "string"}, "description": "Recipients: contact aliases or addresses."},
                    "subject": _str_param("Subject line.", max_len=BOARD_MAIL_SUBJECT_MAX_LEN),
                    "body": _str_param("Plain-text body.", max_len=BOARD_MAIL_BODY_MAX_CHARS),
                    "reason": REASON_PARAM,
                },
                ["fromMailbox", "to", "subject", "body", "reason"],
            ),
            run=board_mail._op_write("mail_send"),
            summarize=_summ("Send email: {subject}"),
            act_guard=lambda ctx, args: board_mail.act_guard(ctx, args, op="mail_send"),
            preview=lambda ctx, args: board_mail.owner_preview(ctx, args, op="mail_send"),
        ),
        ToolOp(
            name="mail_forward",
            tool_id="mail",
            kind="write",
            description="Forward the latest message of a thread to a provider or vendor with a short note.",
            parameters=_obj(
                {
                    "threadId": _str_param("Thread id from mail_list_threads.", max_len=64),
                    "to": {"type": "array", "items": {"type": "string"}, "description": "Recipients: contact aliases or addresses."},
                    "note": _str_param("Short note placed above the forwarded message.", max_len=2000),
                    "reason": REASON_PARAM,
                },
                ["threadId", "to", "reason"],
            ),
            run=board_mail._op_write("mail_forward"),
            summarize=_summ("Forward email thread {threadId}"),
            act_guard=lambda ctx, args: board_mail.act_guard(ctx, args, op="mail_forward"),
            preview=lambda ctx, args: board_mail.owner_preview(ctx, args, op="mail_forward"),
        ),
    ]
    return {op.name: op for op in ops}


REGISTRY: dict[str, ToolOp] = build_registry()


def public_registry() -> list[dict[str, Any]]:
    """Tool and operation descriptions for the SPA."""
    out = []
    for tool in BOARD_TOOL_DEFINITIONS:
        tool_id = str(tool["id"])
        out.append(
            {
                "id": tool_id,
                "label": tool.get("label"),
                "description": tool.get("description"),
                "maxLevel": tool.get("maxLevel"),
                "operations": [
                    {
                        "name": op.name,
                        "kind": op.kind,
                        "description": op.description,
                        "contexts": list(op.contexts),
                    }
                    for op in REGISTRY.values()
                    if op.tool_id == tool_id
                ],
            }
        )
    return out


def available_ops(settings: dict[str, Any], persona_id: str, *, context: str) -> list[tuple[ToolOp, str]]:
    """Operations this member may call now, each with its effective level."""
    out: list[tuple[ToolOp, str]] = []
    if not tools_enabled(settings):
        return out
    for op in REGISTRY.values():
        if context not in op.contexts:
            continue
        level = effective_level(settings, op.tool_id, persona_id)
        if allows(level, op.min_level):
            out.append((op, level))
    return out


def tools_preamble(ops: list[tuple[ToolOp, str]]) -> str:
    """System text explaining what the offered tools do and do not do."""
    if not ops:
        return ""
    lines = [
        "TOOLS: you can call the functions offered to you. Use read tools to check live facts "
        "before asserting them; cite what you found. Never call the same function twice with the "
        f"same arguments, and make at most {BOARD_MAX_TOOL_CALLS_PER_TURN} calls per reply.",
    ]
    proposes = sorted({TOOL_LABELS.get(op.tool_id, op.tool_id) for op, lvl in ops if op.is_write and lvl == "propose"})
    acts = sorted({TOOL_LABELS.get(op.tool_id, op.tool_id) for op, lvl in ops if op.is_write and lvl == "act"})
    if proposes:
        lines.append(
            f"Write operations on {', '.join(proposes)} only RECORD A PROPOSAL for the founder to approve; "
            "nothing happens until they approve it. Say 'I have proposed ...' and never claim it is done."
        )
    if acts:
        lines.append(
            f"Write operations on {', '.join(acts)} execute immediately and are logged. Use them only when "
            "the founder asked for it or your mandate clearly covers it; explain what you did."
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Execution and audit
# ---------------------------------------------------------------------------

def _truncate_json(value: Any, limit: int) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    if len(text) <= limit:
        return text
    return text[: limit - 60].rstrip() + f" ... [truncated, {len(text)} chars total]"


def _clean_arguments(args: Any) -> dict[str, Any]:
    if not isinstance(args, dict):
        return {}
    text = json.dumps(args, default=str)
    if len(text) > MAX_ARGUMENT_CHARS:
        return {"error": "arguments too large"}
    return args


def execute_call(ctx: ToolContext, op: ToolOp, arguments: dict[str, Any]) -> ToolOutcome:
    """Run (or record for approval) one operation and write the audit row."""
    started = time.monotonic()
    arguments = _clean_arguments(arguments)
    level = effective_level(ctx.settings, op.tool_id, ctx.persona_id) if ctx.actor == "persona" else "act"
    summary = op.summarize(arguments)
    approval_id = ""
    guard_reason = ""
    if op.is_write and level == "act" and ctx.actor == "persona" and op.act_guard is not None:
        try:
            guard_reason = str(op.act_guard(ctx, arguments) or "")
        except Exception as exc:  # pragma: no cover - a guard bug must fail closed
            _log_event("error", tag="board_tool_guard_crashed", op=op.name, error=str(exc)[:300])
            guard_reason = "the safety check could not be completed"
    if not allows(level, op.min_level):
        outcome = ToolOutcome(
            status="error",
            result={"error": f"{op.name} is not available to you at level '{level}'."},
            summary=summary,
        )
    elif op.is_write and (level == "propose" or guard_reason):
        approval = create_approval(ctx, op, arguments, summary=summary, downgrade_reason=guard_reason)
        approval_id = str(approval["approvalId"])
        message = (
            "Recorded as a proposal for the founder. It has NOT been executed; "
            "tell the founder it awaits their approval in the Approvals section."
        )
        if guard_reason:
            message = f"Not sent automatically because {guard_reason}. " + message
        outcome = ToolOutcome(
            status="pending_approval",
            result={"status": "pending_approval", "approvalId": approval_id, "message": message},
            summary=summary,
            approval_id=approval_id,
        )
    else:
        try:
            result = op.run(ctx, arguments)
            status = "error" if isinstance(result, dict) and result.get("error") and len(result) == 1 else "ok"
            outcome = ToolOutcome(status=status, result=result if isinstance(result, dict) else {"result": result}, summary=summary)
        except (board_github.GitHubSnapshotError, board_mail.MailError, ValueError) as exc:
            outcome = ToolOutcome(status="error", result={"error": str(exc)[:500]}, summary=summary)
        except Exception as exc:  # pragma: no cover - defensive: a tool bug must not kill the reply
            _log_event("error", tag="board_tool_crashed", op=op.name, error=str(exc)[:300])
            outcome = ToolOutcome(status="error", result={"error": f"Tool failed: {str(exc)[:200]}"}, summary=summary)
    outcome.duration_ms = int((time.monotonic() - started) * 1000)
    outcome.approval_id = approval_id or outcome.approval_id
    record = board_store.add_tool_call(
        ctx.table,
        {
            "personaId": ctx.persona_id,
            "displayName": ctx.display_name,
            "actor": ctx.actor,
            "ownerSub": ctx.owner_sub if ctx.actor == "owner" else "",
            "toolId": op.tool_id,
            "op": op.name,
            "kind": op.kind,
            "level": level,
            "arguments": arguments,
            "status": outcome.status,
            "summary": summary,
            "resultPreview": _truncate_json(outcome.result, MAX_RESULT_PREVIEW),
            "approvalId": approval_id,
            "downgradeReason": guard_reason,
            "context": ctx.public(),
            "durationMs": outcome.duration_ms,
        },
    )
    outcome.call_id = str(record["callId"])
    _log_event(
        "info",
        tag="board_tool_call",
        op=op.name,
        persona=ctx.persona_id,
        actor=ctx.actor,
        status=outcome.status,
        duration_ms=outcome.duration_ms,
    )
    return outcome


def render_preview(ctx: ToolContext, op: ToolOp, arguments: dict[str, Any]) -> dict[str, Any] | None:
    if op.preview is None:
        return None
    try:
        return op.preview(ctx, arguments)
    except Exception as exc:  # pragma: no cover - preview is best effort
        _log_event("warning", tag="board_tool_preview_failed", op=op.name, error=str(exc)[:300])
        return {"error": "Preview unavailable"}


def create_approval(
    ctx: ToolContext,
    op: ToolOp,
    arguments: dict[str, Any],
    *,
    summary: str,
    downgrade_reason: str = "",
) -> dict[str, Any]:
    pending = [a for a in board_store.list_approvals(ctx.table) if a.get("status") == "pending"]
    if len(pending) >= BOARD_MAX_PENDING_APPROVALS:
        raise ToolPermissionError("Too many pending approvals; ask the founder to review the queue first.")
    now = board_store.now_iso()
    preview = render_preview(ctx, op, arguments)
    doc = {
        "approvalId": board_store.new_id(),
        "status": "pending",
        "personaId": ctx.persona_id,
        "displayName": ctx.display_name,
        "toolId": op.tool_id,
        "toolLabel": TOOL_LABELS.get(op.tool_id, op.tool_id),
        "op": op.name,
        "kind": op.kind,
        "arguments": arguments,
        "summary": summary,
        "reason": str(arguments.get("reason") or "")[:400],
        "context": ctx.public(),
        "createdAt": now,
        "updatedAt": now,
    }
    if downgrade_reason:
        doc["downgradeReason"] = downgrade_reason[:300]
    if preview is not None:
        doc["preview"] = preview
    board_store.put_approval(ctx.table, doc)
    return doc


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------

def run_tool_loop(
    *,
    ctx: ToolContext,
    messages: list[dict[str, Any]],
    model: str,
    timeout: int,
    max_tokens: int,
    temperature: float,
    json_mode: bool,
    tag: str,
    max_seconds: int,
    on_progress: Callable[[list[dict[str, Any]]], None] | None = None,
) -> ToolLoopResult:
    """Call the model, execute any requested tools, repeat, then return the final text.

    Falls back to a single plain completion when the member has no tools.
    The final answer is always produced by a call where the model was not
    allowed to request more tools, so the loop terminates deterministically.
    """
    ops = available_ops(ctx.settings, ctx.persona_id, context=ctx.kind)
    if not ops:
        completion = board_budget.board_completion(
            table=ctx.table,
            messages=messages,
            model=model,
            timeout=timeout,
            json_mode=json_mode,
            temperature=temperature,
            max_tokens=max_tokens,
            tag=tag,
        )
        return ToolLoopResult(text=completion.text, usage=completion.usage, model=completion.model, rounds=1, completion=completion)

    by_name = {op.name: op for op, _lvl in ops}
    schemas = [op.schema() for op, _lvl in ops]
    convo: list[dict[str, Any]] = [*messages]
    preamble = tools_preamble(ops)
    if preamble:
        # After the persona prompt and context pack, before the conversation.
        index = 0
        while index < len(convo) and convo[index].get("role") == "system":
            index += 1
        convo.insert(index, {"role": "system", "content": preamble})

    usage = add_usage(None, None)
    calls: list[dict[str, Any]] = []
    started = time.monotonic()
    rounds = 0
    final: ChatCompletion | None = None
    while rounds < BOARD_MAX_TOOL_ROUNDS_PER_TURN:
        elapsed = time.monotonic() - started
        calls_left = BOARD_MAX_TOOL_CALLS_PER_TURN - len(calls)
        if elapsed >= max_seconds or calls_left <= 0:
            break
        rounds += 1
        completion = board_budget.board_completion(
            table=ctx.table,
            messages=convo,
            model=model,
            timeout=timeout,
            json_mode=False,
            temperature=temperature,
            max_tokens=max_tokens,
            tag=tag,
            tools=schemas,
            tool_choice="auto",
        )
        usage = add_usage(usage, completion.usage)
        if not completion.tool_calls:
            final = completion
            break
        convo.append(completion.assistant_message())
        for tc in completion.tool_calls[:calls_left]:
            convo.append(_run_one(ctx, by_name, tc, calls))
        for tc in completion.tool_calls[calls_left:]:
            convo.append(_tool_message(tc, {"error": "Call budget for this reply is exhausted; answer with what you have."}))
        if on_progress:
            try:
                on_progress(list(calls))
            except Exception:  # pragma: no cover - progress is best effort
                pass

    if final is None:
        rounds += 1
        final = board_budget.board_completion(
            table=ctx.table,
            messages=convo,
            model=model,
            timeout=timeout,
            json_mode=json_mode,
            temperature=temperature,
            max_tokens=max_tokens,
            tag=tag,
            tools=schemas,
            tool_choice="none",
        )
        usage = add_usage(usage, final.usage)
    return ToolLoopResult(text=final.text, usage=usage, model=final.model, calls=calls, rounds=rounds, completion=final)


def _run_one(
    ctx: ToolContext,
    by_name: dict[str, ToolOp],
    tc: ToolCall,
    calls: list[dict[str, Any]],
) -> dict[str, Any]:
    op = by_name.get(tc.name)
    if op is None:
        return _tool_message(tc, {"error": f"Unknown tool {tc.name}"})
    try:
        outcome = execute_call(ctx, op, tc.arguments)
    except ToolPermissionError as exc:
        return _tool_message(tc, {"error": str(exc)})
    calls.append(outcome.public(op))
    return _tool_message(tc, outcome.result)


def _tool_message(tc: ToolCall, result: Any) -> dict[str, Any]:
    return {
        "role": "tool",
        "tool_call_id": tc.id,
        "name": tc.name,
        "content": _truncate_json(result, BOARD_TOOL_RESULT_MAX_CHARS),
    }


# ---------------------------------------------------------------------------
# Owner decisions on approvals
# ---------------------------------------------------------------------------

def decide_approval(
    table: Any,
    settings: dict[str, Any],
    approval_id: str,
    *,
    approve: bool,
    owner_sub: str,
    note: str = "",
    arguments_override: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Approve (execute as the owner) or reject a pending proposal."""
    doc = board_store.get_approval(table, approval_id)
    if not doc:
        raise LookupError("Approval not found")
    if doc.get("status") != "pending":
        raise ValueError(f"Approval is already {doc.get('status')}")
    next_status = "approved" if approve else "rejected"
    if not board_store.claim_approval_decision(table, approval_id, status=next_status):
        raise ValueError("Approval was decided by someone else a moment ago")
    now = board_store.now_iso()
    decided = {
        **doc,
        "status": next_status,
        "decidedAt": now,
        "decidedBySub": owner_sub,
        "note": note[:1000],
        "updatedAt": now,
    }
    if not approve:
        board_store.put_approval(table, decided)
        return decided

    op = REGISTRY.get(str(doc.get("op") or ""))
    if op is None:
        decided.update({"status": "failed", "errorMessage": "This operation no longer exists."})
        board_store.put_approval(table, decided)
        return decided
    arguments = dict(doc.get("arguments") or {})
    if isinstance(arguments_override, dict):
        arguments.update(arguments_override)
    profile = board_personas.persona_default(str(doc.get("personaId") or "")) or {}
    ctx = ToolContext(
        table=table,
        settings=settings,
        persona_id=str(doc.get("personaId") or ""),
        display_name=str(doc.get("displayName") or profile.get("shortName") or ""),
        kind=str((doc.get("context") or {}).get("kind") or "approval"),
        meeting_id=str((doc.get("context") or {}).get("meetingId") or ""),
        actor="owner",
        owner_sub=owner_sub,
    )
    if isinstance(arguments_override, dict) and arguments_override:
        refreshed = render_preview(ctx, op, arguments)
        if refreshed is not None:
            decided["preview"] = refreshed
    outcome = execute_call(ctx, op, arguments)
    decided["arguments"] = arguments
    decided["executedCallId"] = outcome.call_id
    if outcome.status == "ok":
        decided.update({"status": "executed", "result": outcome.result})
    else:
        decided.update({"status": "failed", "errorMessage": str(outcome.result.get("error") or "Execution failed")[:500]})
    board_store.put_approval(table, decided)
    return decided


def public_approval(doc: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in doc.items() if k not in ("decidedBySub",)}
