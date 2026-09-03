"""Executive Board: cached snapshot of the Siu Tin Dei GitHub repository.

Reads a fine-grained, read-only personal access token from Secrets Manager
(``GITHUB_READ_TOKEN_SECRET_ARN``) and collects a bounded amount of
context: README, AGENTS.md, architecture docs, open issues, recent commits
and the latest CI run. The result is cached in the records table and
refreshed by the daily meeting or on demand.
"""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

from admin_runtime import _get_secretsmanager_client
from http_common import _log_event, _utc_iso_z
from openrouter_client import OpenRouterError, read_secret_string

DEFAULT_REPO = "lx-software-ltd/siutindei"
API_ORIGIN = "https://api.github.com"
HTTP_TIMEOUT_SECONDS = 20
MAX_DOC_CHARS = 6000
MAX_TOTAL_CHARS = 32000
MAX_DOC_FILES = 6
MAX_ISSUES = 30
MAX_COMMITS = 20

_token_cache: str | None = None


class GitHubSnapshotError(RuntimeError):
    """User-facing failure while refreshing the repository snapshot."""


def repo_full_name() -> str:
    return (os.environ.get("BOARD_GITHUB_REPO") or "").strip() or DEFAULT_REPO


def snapshot_enabled() -> bool:
    return bool((os.environ.get("GITHUB_READ_TOKEN_SECRET_ARN") or "").strip())


def _token() -> str:
    global _token_cache
    if _token_cache:
        return _token_cache
    direct = (os.environ.get("GITHUB_READ_TOKEN") or "").strip()
    if direct:
        _token_cache = direct
        return direct
    arn = (os.environ.get("GITHUB_READ_TOKEN_SECRET_ARN") or "").strip()
    if not arn:
        raise GitHubSnapshotError(
            "GitHub access is not configured (set the GitHubReadTokenSecretArn stack parameter)"
        )
    try:
        _token_cache = read_secret_string(
            _get_secretsmanager_client(), arn, what="GitHub token"
        )
    except OpenRouterError as exc:
        raise GitHubSnapshotError(str(exc)) from exc
    return _token_cache


def _get(path: str, *, accept: str = "application/vnd.github+json") -> Any:
    url = path if path.startswith("http") else f"{API_ORIGIN}{path}"
    req = urlrequest.Request(  # noqa: S310 - fixed API origin
        url,
        headers={
            "Authorization": f"Bearer {_token()}",
            "Accept": accept,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "lxsoftware-admin-board",
        },
    )
    try:
        with urlrequest.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:  # noqa: S310
            body = resp.read().decode("utf-8", errors="replace")
    except urlerror.HTTPError as exc:
        if exc.code == 404:
            return None
        raise GitHubSnapshotError(f"GitHub API returned status {exc.code} for {path}") from exc
    except urlerror.URLError as exc:
        raise GitHubSnapshotError(f"GitHub API transport error: {exc.reason}") from exc
    if accept.endswith("raw"):
        return body
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise GitHubSnapshotError("GitHub API returned invalid JSON") from exc


def _file_text(repo: str, path: str) -> str | None:
    data = _get(f"/repos/{repo}/contents/{urlparse.quote(path)}")
    if not isinstance(data, dict):
        return None
    content = data.get("content")
    if not isinstance(content, str):
        return None
    try:
        text = base64.b64decode(content).decode("utf-8", errors="replace")
    except Exception:  # pragma: no cover - defensive
        return None
    return _cap(text, MAX_DOC_CHARS)


def _cap(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 15].rstrip() + "\n[... truncated]"


def fetch_snapshot() -> dict[str, Any]:
    repo = repo_full_name()
    meta = _get(f"/repos/{repo}")
    if not isinstance(meta, dict):
        raise GitHubSnapshotError(f"Repository {repo} not found or token lacks access")
    default_branch = str(meta.get("default_branch") or "main")

    docs: list[dict[str, str]] = []
    for path in ("README.md", "AGENTS.md"):
        text = _file_text(repo, path)
        if text:
            docs.append({"path": path, "text": text})
    listing = _get(f"/repos/{repo}/contents/docs/architecture")
    if isinstance(listing, list):
        md_files = [
            str(e.get("path"))
            for e in listing
            if isinstance(e, dict)
            and e.get("type") == "file"
            and str(e.get("name") or "").lower().endswith(".md")
        ]
        for path in sorted(md_files)[:MAX_DOC_FILES]:
            text = _file_text(repo, path)
            if text:
                docs.append({"path": path, "text": text})

    issues_raw = _get(f"/repos/{repo}/issues?state=open&per_page={MAX_ISSUES}&sort=updated")
    issues: list[dict[str, Any]] = []
    if isinstance(issues_raw, list):
        for it in issues_raw:
            if not isinstance(it, dict) or it.get("pull_request"):
                continue
            issues.append(
                {
                    "number": it.get("number"),
                    "title": _cap(str(it.get("title") or ""), 200),
                    "labels": [
                        str(lb.get("name"))
                        for lb in (it.get("labels") or [])
                        if isinstance(lb, dict) and lb.get("name")
                    ],
                    "updatedAt": it.get("updated_at"),
                }
            )

    commits_raw = _get(f"/repos/{repo}/commits?sha={urlparse.quote(default_branch)}&per_page={MAX_COMMITS}")
    commits: list[dict[str, Any]] = []
    if isinstance(commits_raw, list):
        for c in commits_raw:
            if not isinstance(c, dict):
                continue
            commit = c.get("commit") or {}
            message = str(commit.get("message") or "").splitlines()[0] if commit else ""
            author = (commit.get("author") or {}) if isinstance(commit, dict) else {}
            commits.append(
                {
                    "sha": str(c.get("sha") or "")[:8],
                    "message": _cap(message, 160),
                    "date": author.get("date"),
                }
            )

    runs_raw = _get(
        f"/repos/{repo}/actions/runs?branch={urlparse.quote(default_branch)}&per_page=5"
    )
    ci: list[dict[str, Any]] = []
    if isinstance(runs_raw, dict):
        for run in runs_raw.get("workflow_runs") or []:
            if not isinstance(run, dict):
                continue
            ci.append(
                {
                    "name": _cap(str(run.get("name") or ""), 80),
                    "status": run.get("status"),
                    "conclusion": run.get("conclusion"),
                    "updatedAt": run.get("updated_at"),
                }
            )

    snapshot = {
        "repo": repo,
        "defaultBranch": default_branch,
        "description": _cap(str(meta.get("description") or ""), 400),
        "openIssuesCount": int(meta.get("open_issues_count") or 0),
        "pushedAt": meta.get("pushed_at"),
        "docs": docs,
        "issues": issues,
        "commits": commits,
        "ci": ci,
        "fetchedAt": _utc_iso_z(datetime.now(timezone.utc)),
    }
    snapshot["text"] = render_snapshot(snapshot)
    _log_event(
        "info",
        tag="board_repo_snapshot",
        repo=repo,
        docs=len(docs),
        issues=len(issues),
        commits=len(commits),
        chars=len(snapshot["text"]),
    )
    return snapshot


def render_snapshot(snapshot: dict[str, Any]) -> str:
    parts: list[str] = [
        f"Repository {snapshot.get('repo')} (default branch {snapshot.get('defaultBranch')}, "
        f"last push {snapshot.get('pushedAt') or 'unknown'}, "
        f"{snapshot.get('openIssuesCount', 0)} open issues)."
    ]
    if snapshot.get("description"):
        parts.append(f"Description: {snapshot['description']}")
    ci = snapshot.get("ci") or []
    if ci:
        parts.append("Latest CI runs:")
        for run in ci[:5]:
            parts.append(
                f"- {run.get('name')}: {run.get('status')} / {run.get('conclusion') or 'n/a'} "
                f"({run.get('updatedAt')})"
            )
    commits = snapshot.get("commits") or []
    if commits:
        parts.append("Recent commits:")
        for c in commits:
            parts.append(f"- {c.get('sha')} {c.get('message')} ({str(c.get('date') or '')[:10]})")
    issues = snapshot.get("issues") or []
    if issues:
        parts.append("Open issues:")
        for it in issues:
            labels = f" [{', '.join(it.get('labels') or [])}]" if it.get("labels") else ""
            parts.append(f"- #{it.get('number')} {it.get('title')}{labels}")
    for doc in snapshot.get("docs") or []:
        parts.append("")
        parts.append(f"===== {doc.get('path')} =====")
        parts.append(str(doc.get("text") or ""))
    text = "\n".join(parts)
    return _cap(text, MAX_TOTAL_CHARS)


def snapshot_age_seconds(snapshot: dict[str, Any] | None) -> float | None:
    if not snapshot:
        return None
    raw = snapshot.get("fetchedAt")
    if not isinstance(raw, str):
        return None
    try:
        text = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
        fetched = datetime.fromisoformat(text)
    except ValueError:
        return None
    return (datetime.now(timezone.utc) - fetched.astimezone(timezone.utc)).total_seconds()


def public_snapshot_meta(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    """Snapshot metadata for the SPA (omits the large rendered text)."""
    if not snapshot:
        return None
    return {
        "repo": snapshot.get("repo"),
        "fetchedAt": snapshot.get("fetchedAt"),
        "openIssuesCount": snapshot.get("openIssuesCount", 0),
        "docs": [d.get("path") for d in snapshot.get("docs") or []],
        "commits": len(snapshot.get("commits") or []),
        "ci": (snapshot.get("ci") or [None])[0],
        "chars": len(str(snapshot.get("text") or "")),
    }


def reset_token_cache_for_tests() -> None:
    global _token_cache
    _token_cache = None
