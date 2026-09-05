#!/usr/bin/env python3
"""Create Executive Board AWS secrets and CDK parameters from a fill-in file.

Discovers what is already in the account, writes Secrets Manager secrets,
merges non-secret keys into the committed CDK param file, and keeps
noEcho values (``MetaVerifyToken``) in a gitignored overlay. Optionally
activates the Cost Explorer stack-name tag and applies
``scripts/siutindei/receivables.sql`` through the RDS Data API.

Does **not** touch Cloudflare, Meta's developer console, App Store Connect
roles, Play Console grants, or GitHub (those stay in their own UIs).

Requires admin AWS credentials (not the read-only cloud-agent user).

Usage:
  python3 scripts/setup-board-config.py init [--out setup-board-config.answers.json]
  python3 scripts/setup-board-config.py status [--region ap-southeast-1]
  python3 scripts/setup-board-config.py apply --answers my.json [--dry-run] [--yes]
"""

from __future__ import annotations

import argparse
import json
import re
import secrets
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
EXAMPLE_ANSWERS = Path(__file__).resolve().parent / "setup-board-config.example.json"
RECEIVABLES_SQL = Path(__file__).resolve().parent / "siutindei" / "receivables.sql"
DEFAULT_REGION = "ap-southeast-1"
DEFAULT_STACK = "lxsoftware"
DEFAULT_PARAMS = REPO_ROOT / "backend" / "infrastructure" / "params" / "production.json"
DEFAULT_LOCAL_PARAMS = REPO_ROOT / "backend" / "infrastructure" / "params" / "production.local.json"
COST_TAG = "aws:cloudformation:stack-name"
CE_REGION = "us-east-1"

# Stable secret names so re-runs update instead of creating duplicates.
SECRET_GITHUB = "lxsoftware-admin-github-read-token"
SECRET_SEARCH = "lxsoftware-admin-search-api-key"
SECRET_META_TOKEN = "lxsoftware-admin-meta-board-token"
SECRET_META_APP = "lxsoftware-admin-meta-app-secret"
SECRET_ASC = "lxsoftware-admin-app-store-connect-key"
SECRET_PLAY = "lxsoftware-admin-google-play-sa"
SECRET_GA = "lxsoftware-admin-google-analytics-sa"

PUBLIC_PARAM_KEYS = (
    "lxsoftware:GitHubReadTokenSecretArn",
    "lxsoftware:SearchApiKeySecretArn",
    "lxsoftware:BoardGitHubRepo",
    "lxsoftware:BoardToolsEnabled",
    "lxsoftware:BoardAwsStackPrefix",
    "lxsoftware:BoardAwsLambdaNames",
    "lxsoftware:SiutindeiClusterArn",
    "lxsoftware:SiutindeiDbSecretArn",
    "lxsoftware:MetaBoardTokenSecretArn",
    "lxsoftware:MetaAppSecretSecretArn",
    "lxsoftware:MetaPageId",
    "lxsoftware:MetaIgUserId",
    "lxsoftware:MetaWaPhoneNumberId",
    "lxsoftware:MetaAdAccountId",
    "lxsoftware:MetaWabaId",
    "lxsoftware:AppStoreConnectKeySecretArn",
    "lxsoftware:GooglePlayServiceAccountSecretArn",
    "lxsoftware:AppStoreConnectAppId",
    "lxsoftware:AppStoreConnectVendorNumber",
    "lxsoftware:GooglePlayPackageName",
    "lxsoftware:GoogleAnalyticsServiceAccountSecretArn",
    "lxsoftware:Ga4PropertyIds",
    "lxsoftware:GtmContainers",
    "lxsoftware:BoardMailSendingEnabled",
)


class SetupError(RuntimeError):
    """User-facing failure (bad answers, missing file, AWS API)."""


def _ignore_key(key: str) -> bool:
    return key.startswith("_")


def load_answers(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise SetupError(f"{path} must be a JSON object")
    return {str(k): v for k, v in raw.items() if not _ignore_key(str(k))}


def text(answers: dict[str, Any], key: str, default: str = "") -> str:
    value = answers.get(key, default)
    if value is None:
        return default
    return str(value).strip()


def flag(answers: dict[str, Any], key: str, default: bool = False) -> bool:
    value = answers.get(key, default)
    if isinstance(value, bool):
        return value
    if value is None or value == "":
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def resolve_path(raw: str) -> Path | None:
    if not raw:
        return None
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    return path


def read_text_file(raw: str, *, what: str) -> str:
    path = resolve_path(raw)
    if path is None:
        return ""
    if not path.is_file():
        raise SetupError(f"{what}: file not found: {path}")
    return path.read_text(encoding="utf-8")


def load_json_file(raw: str, *, what: str) -> dict[str, Any]:
    body = read_text_file(raw, what=what).strip()
    if not body:
        return {}
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise SetupError(f"{what}: {raw} must be a JSON object")
    return parsed


def merge_json_file(path: Path, updates: dict[str, str]) -> dict[str, Any]:
    current: dict[str, Any] = {}
    if path.is_file():
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise SetupError(f"{path} must be a JSON object")
        current = loaded
    changed = False
    for key, value in updates.items():
        if not value:
            continue
        if current.get(key) != value:
            current[key] = value
            changed = True
    if changed or not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    return current


def split_sql_statements(sql: str) -> list[str]:
    """Split a PostgreSQL script into Data API-safe statements.

    Skips ``BEGIN`` / ``COMMIT`` (the Data API has its own transactions and
    rejects those as multi-statement). Keeps dollar-quoted bodies intact.
    """
    statements: list[str] = []
    buf: list[str] = []
    i = 0
    in_single = False
    dollar: str | None = None
    dollar_re = re.compile(r"\$[A-Za-z0-9_]*\$")

    def flush() -> None:
        text_stmt = "".join(buf).strip()
        buf.clear()
        if not text_stmt:
            return
        stripped = re.sub(r"^\s*--[^\n]*\n?", "", text_stmt, flags=re.M).strip()
        upper = re.sub(r"\s+", " ", stripped).upper()
        if upper in {"BEGIN", "BEGIN;", "COMMIT", "COMMIT;"}:
            return
        statements.append(stripped)

    while i < len(sql):
        ch = sql[i]
        if dollar:
            if sql.startswith(dollar, i):
                buf.append(dollar)
                i += len(dollar)
                dollar = None
                continue
            buf.append(ch)
            i += 1
            continue
        if in_single:
            buf.append(ch)
            if ch == "'" and sql[i : i + 2] == "''":
                buf.append("'")
                i += 2
                continue
            if ch == "'":
                in_single = False
            i += 1
            continue
        if sql.startswith("--", i):
            nl = sql.find("\n", i)
            if nl == -1:
                break
            buf.append(sql[i : nl + 1])
            i = nl + 1
            continue
        if sql.startswith("/*", i):
            end = sql.find("*/", i + 2)
            if end == -1:
                raise SetupError("unclosed block comment in SQL")
            buf.append(sql[i : end + 2])
            i = end + 2
            continue
        match = dollar_re.match(sql, i)
        if match:
            dollar = match.group(0)
            buf.append(dollar)
            i = match.end()
            continue
        if ch == "'":
            in_single = True
            buf.append(ch)
            i += 1
            continue
        if ch == ";":
            flush()
            i += 1
            continue
        buf.append(ch)
        i += 1
    flush()
    return statements


def build_asc_secret(answers: dict[str, Any]) -> dict[str, str] | None:
    payload: dict[str, str] = {}
    json_file = text(answers, "asc_json_file")
    if json_file:
        raw = load_json_file(json_file, what="App Store Connect key")
        payload = {str(k): str(v) if v is not None else "" for k, v in raw.items()}
    key_id = text(answers, "asc_key_id") or str(payload.get("keyId") or payload.get("kid") or "")
    issuer = text(answers, "asc_issuer_id") or str(payload.get("issuerId") or payload.get("iss") or "")
    pem = str(payload.get("privateKey") or payload.get("p8") or payload.get("key") or "")
    pem_file = text(answers, "asc_private_key_file")
    if pem_file:
        pem = read_text_file(pem_file, what="App Store Connect .p8")
    app_id = text(answers, "asc_app_id") or str(payload.get("appId") or payload.get("app_id") or "")
    vendor = text(answers, "asc_vendor_number") or str(
        payload.get("vendorNumber") or payload.get("vendor_number") or ""
    )
    if not any([key_id, issuer, pem, app_id, vendor]) and not json_file:
        return None
    if not (key_id and issuer and pem):
        raise SetupError(
            "App Store Connect secret needs keyId, issuerId and privateKey "
            "(asc_json_file, or asc_key_id + asc_issuer_id + asc_private_key_file)"
        )
    out = {"keyId": key_id.strip(), "issuerId": issuer.strip(), "privateKey": pem.strip()}
    if app_id:
        out["appId"] = app_id.strip()
    if vendor:
        out["vendorNumber"] = vendor.strip()
    return out


def build_google_sa_secret(
    answers: dict[str, Any],
    *,
    file_key: str,
    what: str,
    package_key: str = "",
) -> dict[str, Any] | None:
    path = text(answers, file_key)
    extra = text(answers, package_key) if package_key else ""
    if not path:
        return None
    raw = load_json_file(path, what=what)
    email = str(raw.get("client_email") or raw.get("clientEmail") or "").strip()
    pem = str(raw.get("private_key") or raw.get("privateKey") or "").strip()
    if not (email and pem):
        raise SetupError(f"{what}: JSON must include client_email and private_key")
    if extra and "packageName" not in raw and "package_name" not in raw:
        raw = {**raw, "packageName": extra}
    return raw


@dataclass
class PlannedAction:
    kind: str
    summary: str
    detail: str = ""
    secret_name: str = ""
    secret_string: str = ""
    params: dict[str, str] = field(default_factory=dict)
    local_params: dict[str, str] = field(default_factory=dict)
    sql_statements: list[str] = field(default_factory=list)
    grant_role_to: str = ""
    activate_cost_tag: bool = False


@dataclass
class Plan:
    actions: list[PlannedAction] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    public_params: dict[str, str] = field(default_factory=dict)
    local_params: dict[str, str] = field(default_factory=dict)
    params_file: Path = DEFAULT_PARAMS
    local_params_file: Path = DEFAULT_LOCAL_PARAMS
    region: str = DEFAULT_REGION
    stack_name: str = DEFAULT_STACK
    apply_sql: bool = False
    activate_cost_tag: bool = False
    cluster_arn: str = ""
    db_secret_arn: str = ""
    database: str = "siutindei"


def _put_public(plan: Plan, key: str, value: str) -> None:
    if value:
        plan.public_params[key] = value


def plan_from_answers(
    answers: dict[str, Any],
    *,
    discovered_lambdas: list[str] | None = None,
    discovered_clusters: list[dict[str, str]] | None = None,
    discovered_db_secrets: list[str] | None = None,
) -> Plan:
    plan = Plan()
    plan.region = text(answers, "region", DEFAULT_REGION) or DEFAULT_REGION
    plan.stack_name = text(answers, "stack_name", DEFAULT_STACK) or DEFAULT_STACK
    params_raw = text(answers, "params_file")
    local_raw = text(answers, "local_params_file")
    plan.params_file = Path(params_raw) if params_raw else DEFAULT_PARAMS
    plan.local_params_file = Path(local_raw) if local_raw else DEFAULT_LOCAL_PARAMS
    if not plan.params_file.is_absolute():
        plan.params_file = (REPO_ROOT / plan.params_file).resolve()
    if not plan.local_params_file.is_absolute():
        plan.local_params_file = (REPO_ROOT / plan.local_params_file).resolve()

    def secret_action(name: str, value: str, param_key: str, label: str) -> None:
        if not value:
            return
        plan.actions.append(
            PlannedAction(
                kind="upsert_secret",
                summary=f"Upsert secret {name} ({label})",
                secret_name=name,
                secret_string=value,
            )
        )
        # ARN is filled after apply; record the param key so status/docs stay aligned.
        plan.notes.append(f"Will set {param_key} to the ARN of {name}")

    github = text(answers, "github_token")
    secret_action(SECRET_GITHUB, github, "lxsoftware:GitHubReadTokenSecretArn", "GitHub PAT")

    search = text(answers, "search_api_key")
    secret_action(SECRET_SEARCH, search, "lxsoftware:SearchApiKeySecretArn", "Brave Search")

    meta_token = text(answers, "meta_board_token")
    secret_action(SECRET_META_TOKEN, meta_token, "lxsoftware:MetaBoardTokenSecretArn", "Meta System User token")

    meta_app = text(answers, "meta_app_secret")
    secret_action(SECRET_META_APP, meta_app, "lxsoftware:MetaAppSecretSecretArn", "Meta app secret")

    verify = text(answers, "meta_verify_token")
    if verify:
        plan.local_params["lxsoftware:MetaVerifyToken"] = verify
        plan.notes.append(
            "MetaVerifyToken goes in the gitignored overlay "
            f"({plan.local_params_file.name}); add the same value as a GitHub "
            "Actions variable/secret named for CDK if you deploy from CI"
        )

    _put_public(plan, "lxsoftware:MetaPageId", text(answers, "meta_page_id"))
    _put_public(plan, "lxsoftware:MetaIgUserId", text(answers, "meta_ig_user_id"))
    _put_public(plan, "lxsoftware:MetaWaPhoneNumberId", text(answers, "meta_wa_phone_number_id"))
    _put_public(plan, "lxsoftware:MetaWabaId", text(answers, "meta_waba_id"))
    _put_public(plan, "lxsoftware:MetaAdAccountId", text(answers, "meta_ad_account_id"))

    asc = build_asc_secret(answers)
    if asc:
        secret_action(
            SECRET_ASC,
            json.dumps(asc),
            "lxsoftware:AppStoreConnectKeySecretArn",
            "App Store Connect key",
        )
        if asc.get("appId"):
            _put_public(plan, "lxsoftware:AppStoreConnectAppId", asc["appId"])
        if asc.get("vendorNumber"):
            _put_public(plan, "lxsoftware:AppStoreConnectVendorNumber", asc["vendorNumber"])
    else:
        _put_public(plan, "lxsoftware:AppStoreConnectAppId", text(answers, "asc_app_id"))
        _put_public(plan, "lxsoftware:AppStoreConnectVendorNumber", text(answers, "asc_vendor_number"))

    play = build_google_sa_secret(
        answers, file_key="play_sa_file", package_key="play_package_name", what="Play service account"
    )
    if play:
        secret_action(
            SECRET_PLAY,
            json.dumps(play),
            "lxsoftware:GooglePlayServiceAccountSecretArn",
            "Play service account",
        )
        package = str(play.get("packageName") or play.get("package_name") or "")
        if package:
            _put_public(plan, "lxsoftware:GooglePlayPackageName", package)
    else:
        _put_public(plan, "lxsoftware:GooglePlayPackageName", text(answers, "play_package_name"))

    ga = build_google_sa_secret(answers, file_key="ga_sa_file", what="GA4 / GTM service account")
    if ga:
        secret_action(
            SECRET_GA,
            json.dumps(ga),
            "lxsoftware:GoogleAnalyticsServiceAccountSecretArn",
            "GA4 / GTM service account",
        )
    _put_public(plan, "lxsoftware:Ga4PropertyIds", text(answers, "ga4_property_ids"))
    _put_public(plan, "lxsoftware:GtmContainers", text(answers, "gtm_containers"))

    _put_public(plan, "lxsoftware:BoardGitHubRepo", text(answers, "board_github_repo"))
    _put_public(plan, "lxsoftware:BoardToolsEnabled", text(answers, "board_tools_enabled"))
    _put_public(plan, "lxsoftware:BoardAwsStackPrefix", text(answers, "board_aws_stack_prefix"))

    lambda_names = text(answers, "board_aws_lambda_names")
    if not lambda_names and discovered_lambdas:
        lambda_names = ",".join(discovered_lambdas)
        plan.notes.append(
            f"board_aws_lambda_names was empty; using {len(discovered_lambdas)} "
            "discovered function(s) matching the prefix"
        )
    _put_public(plan, "lxsoftware:BoardAwsLambdaNames", lambda_names)

    cluster = text(answers, "siutindei_cluster_arn")
    db_secret = text(answers, "siutindei_db_secret_arn")
    if not cluster and discovered_clusters:
        picked = _pick_named(discovered_clusters, "siutindei")
        if picked:
            cluster = picked.get("arn") or ""
            plan.notes.append(f"siutindei_cluster_arn was empty; using {cluster}")
            if not db_secret:
                db_secret = picked.get("secret_arn") or ""
    if not db_secret and discovered_db_secrets:
        guessed = next((arn for arn in discovered_db_secrets if "siutindei" in arn.lower()), "")
        if guessed:
            db_secret = guessed
            plan.notes.append(f"siutindei_db_secret_arn was empty; using {db_secret}")
    _put_public(plan, "lxsoftware:SiutindeiClusterArn", cluster)
    _put_public(plan, "lxsoftware:SiutindeiDbSecretArn", db_secret)
    plan.cluster_arn = cluster
    plan.db_secret_arn = db_secret
    plan.database = text(answers, "siutindei_database", "siutindei") or "siutindei"

    sending = text(answers, "board_mail_sending_enabled")
    if sending:
        _put_public(plan, "lxsoftware:BoardMailSendingEnabled", sending)

    if plan.public_params:
        plan.actions.append(
            PlannedAction(
                kind="write_params",
                summary=f"Merge {len(plan.public_params)} key(s) into {plan.params_file}",
                params=dict(plan.public_params),
            )
        )
    if plan.local_params:
        plan.actions.append(
            PlannedAction(
                kind="write_local_params",
                summary=f"Write noEcho overlay {plan.local_params_file}",
                local_params=dict(plan.local_params),
            )
        )

    plan.activate_cost_tag = flag(answers, "activate_cost_tag", True)
    if plan.activate_cost_tag:
        plan.actions.append(
            PlannedAction(
                kind="activate_cost_tag",
                summary=f"Activate Cost Explorer allocation tag {COST_TAG} (us-east-1)",
                activate_cost_tag=True,
            )
        )

    plan.apply_sql = flag(answers, "apply_receivables_sql", False)
    grant_to = text(answers, "grant_board_api_to")
    if plan.apply_sql:
        statements = split_sql_statements(RECEIVABLES_SQL.read_text(encoding="utf-8"))
        plan.actions.append(
            PlannedAction(
                kind="apply_sql",
                summary=f"Apply receivables.sql ({len(statements)} statements) via RDS Data API",
                sql_statements=statements,
                grant_role_to=grant_to,
            )
        )
        if not cluster or not db_secret:
            plan.notes.append(
                "apply_receivables_sql is on but cluster/secret ARN is missing; "
                "apply will fail until those are set"
            )

    return plan


def _pick_named(rows: list[dict[str, str]], needle: str) -> dict[str, str] | None:
    lowered = needle.lower()
    matches = [row for row in rows if lowered in json.dumps(row).lower()]
    if len(matches) == 1:
        return matches[0]
    if len(rows) == 1:
        return rows[0]
    return matches[0] if matches else None


def render_plan(plan: Plan) -> str:
    lines = [
        f"Region:     {plan.region}",
        f"Stack:      {plan.stack_name}",
        f"Params:     {plan.params_file}",
        f"Local:      {plan.local_params_file}",
        "",
        "Actions:",
    ]
    if not plan.actions:
        lines.append("  (nothing to do — fill some blanks in the answers file)")
    for i, action in enumerate(plan.actions, start=1):
        lines.append(f"  {i}. {action.summary}")
    if plan.public_params:
        lines.append("")
        lines.append("Public CDK params (safe to commit):")
        for key in sorted(plan.public_params):
            lines.append(f"  {key}={plan.public_params[key]}")
    if plan.local_params:
        lines.append("")
        lines.append("Local overlay (gitignored, do not commit):")
        for key in sorted(plan.local_params):
            lines.append(f"  {key}=<redacted {len(plan.local_params[key])} chars>")
    if plan.notes:
        lines.append("")
        lines.append("Notes:")
        for note in plan.notes:
            lines.append(f"  - {note}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# AWS
# ---------------------------------------------------------------------------


def _session(region: str):
    try:
        import boto3
    except ImportError as exc:
        raise SetupError("boto3 is required (pip install boto3)") from exc
    return boto3.Session(region_name=region)


def _client(session, service: str, *, region: str | None = None):
    return session.client(service, region_name=region) if region else session.client(service)


def stack_outputs(session, stack_name: str) -> dict[str, str]:
    cf = _client(session, "cloudformation")
    try:
        stacks = cf.describe_stacks(StackName=stack_name).get("Stacks") or []
    except Exception as exc:  # noqa: BLE001 — surface as a setup error
        raise SetupError(f"cannot read stack {stack_name}: {exc}") from exc
    if not stacks:
        raise SetupError(f"stack {stack_name} not found")
    return {row["OutputKey"]: row["OutputValue"] for row in stacks[0].get("Outputs") or []}


def discover_lambdas(session, prefix: str) -> list[str]:
    client = _client(session, "lambda")
    names: list[str] = []
    marker = None
    while True:
        kwargs: dict[str, Any] = {"MaxItems": 50}
        if marker:
            kwargs["Marker"] = marker
        resp = client.list_functions(**kwargs)
        for fn in resp.get("Functions") or []:
            name = str(fn.get("FunctionName") or "")
            if name.startswith(prefix):
                names.append(name)
        marker = resp.get("NextMarker")
        if not marker:
            break
    return sorted(names)


def discover_clusters(session) -> list[dict[str, str]]:
    client = _client(session, "rds")
    rows: list[dict[str, str]] = []
    marker = None
    while True:
        kwargs: dict[str, Any] = {}
        if marker:
            kwargs["Marker"] = marker
        resp = client.describe_db_clusters(**kwargs)
        for cluster in resp.get("DBClusters") or []:
            rows.append(
                {
                    "id": str(cluster.get("DBClusterIdentifier") or ""),
                    "arn": str(cluster.get("DBClusterArn") or ""),
                    "secret_arn": str(
                        (cluster.get("MasterUserSecret") or {}).get("SecretArn") or ""
                    ),
                    "http": "yes" if cluster.get("HttpEndpointEnabled") else "no",
                    "engine": str(cluster.get("Engine") or ""),
                }
            )
        marker = resp.get("Marker")
        if not marker:
            break
    return rows


def discover_secrets(session, names: list[str]) -> dict[str, str]:
    client = _client(session, "secretsmanager")
    found: dict[str, str] = {}
    for name in names:
        try:
            found[name] = client.describe_secret(SecretId=name)["ARN"]
        except client.exceptions.ResourceNotFoundException:
            continue
        except Exception:
            continue
    return found


def list_cost_tag(session) -> str:
    client = _client(session, "ce", region=CE_REGION)
    try:
        resp = client.list_cost_allocation_tags(TagKeys=[COST_TAG])
    except Exception as exc:  # noqa: BLE001
        return f"error: {exc}"
    tags = resp.get("CostAllocationTags") or []
    if not tags:
        return "unknown"
    return str(tags[0].get("Status") or "unknown")


def upsert_secret(session, name: str, secret_string: str) -> str:
    client = _client(session, "secretsmanager")
    try:
        resp = client.create_secret(
            Name=name,
            SecretString=secret_string,
            Description="Executive Board (managed by scripts/setup-board-config.py)",
        )
        return str(resp["ARN"])
    except client.exceptions.ResourceExistsException:
        client.put_secret_value(SecretId=name, SecretString=secret_string)
        return str(client.describe_secret(SecretId=name)["ARN"])


def activate_cost_tag(session) -> str:
    client = _client(session, "ce", region=CE_REGION)
    resp = client.update_cost_allocation_tags_status(
        CostAllocationTagsStatus=[{"TagKey": COST_TAG, "Status": "Active"}]
    )
    errors = resp.get("Errors") or []
    if errors:
        raise SetupError(f"cost allocation tag update failed: {errors}")
    return "Active"


def apply_sql(
    session,
    *,
    cluster_arn: str,
    secret_arn: str,
    database: str,
    statements: list[str],
    grant_role_to: str,
    region: str,
) -> list[str]:
    client = _client(session, "rds-data", region=region)
    logs: list[str] = []
    for i, sql in enumerate(statements, start=1):
        preview = re.sub(r"\s+", " ", sql)[:80]
        try:
            client.execute_statement(
                resourceArn=cluster_arn,
                secretArn=secret_arn,
                database=database,
                sql=sql,
            )
            logs.append(f"OK  {i}/{len(statements)} {preview}")
        except Exception as exc:  # noqa: BLE001
            raise SetupError(f"SQL statement {i} failed ({preview}): {exc}") from exc
    if grant_role_to:
        sql = f'GRANT board_api TO "{grant_role_to.replace(chr(34), "")}"'
        try:
            client.execute_statement(
                resourceArn=cluster_arn,
                secretArn=secret_arn,
                database=database,
                sql=sql,
            )
            logs.append(f"OK  GRANT board_api TO {grant_role_to}")
        except Exception as exc:  # noqa: BLE001
            raise SetupError(f"GRANT board_api TO {grant_role_to} failed: {exc}") from exc
    return logs


SECRET_PARAM = {
    SECRET_GITHUB: "lxsoftware:GitHubReadTokenSecretArn",
    SECRET_SEARCH: "lxsoftware:SearchApiKeySecretArn",
    SECRET_META_TOKEN: "lxsoftware:MetaBoardTokenSecretArn",
    SECRET_META_APP: "lxsoftware:MetaAppSecretSecretArn",
    SECRET_ASC: "lxsoftware:AppStoreConnectKeySecretArn",
    SECRET_PLAY: "lxsoftware:GooglePlayServiceAccountSecretArn",
    SECRET_GA: "lxsoftware:GoogleAnalyticsServiceAccountSecretArn",
}


def execute_plan(
    plan: Plan,
    session,
    *,
    dry_run: bool = False,
) -> list[str]:
    logs: list[str] = []
    if dry_run:
        return ["dry-run: no AWS writes"]

    public_updates = dict(plan.public_params)
    for action in plan.actions:
        if action.kind == "upsert_secret":
            arn = upsert_secret(session, action.secret_name, action.secret_string)
            param_key = SECRET_PARAM.get(action.secret_name)
            if param_key:
                public_updates[param_key] = arn
            logs.append(f"secret {action.secret_name} -> {arn}")
        elif action.kind == "write_params":
            continue
        elif action.kind == "write_local_params":
            merge_json_file(plan.local_params_file, action.local_params)
            logs.append(f"wrote {plan.local_params_file}")
        elif action.kind == "activate_cost_tag":
            status = activate_cost_tag(session)
            logs.append(f"cost allocation tag {COST_TAG} = {status}")
        elif action.kind == "apply_sql":
            sql_logs = apply_sql(
                session,
                cluster_arn=plan.cluster_arn,
                secret_arn=plan.db_secret_arn,
                database=plan.database,
                statements=action.sql_statements,
                grant_role_to=action.grant_role_to,
                region=plan.region,
            )
            logs.extend(sql_logs)
        else:
            raise SetupError(f"unknown action {action.kind}")

    if public_updates:
        merge_json_file(plan.params_file, public_updates)
        logs.append(f"merged {len(public_updates)} key(s) into {plan.params_file}")
    return logs


def remaining_steps(outputs: dict[str, str] | None = None) -> str:
    api = (outputs or {}).get("AdminApiBaseUrl", "<AdminApiBaseUrl>")
    inbound = (outputs or {}).get("BoardMailInboundAddress", "<BoardMailInboundAddress>")
    dkim = [
        (outputs or {}).get(f"BoardMailDkimCname{n}", "")
        for n in (1, 2, 3)
    ]
    lines = [
        "Still manual (not AWS):",
        "",
        "1. GitHub: create the fine-grained PAT (siutindei only; Contents read,",
        "   Issues read/write, Actions read, Metadata read, Security events read)",
        "   if you left github_token blank.",
        "2. Meta developer console: subscribe the app to",
        f"   GET/POST {api}/webhooks/meta",
        "   using the same MetaVerifyToken as the overlay. Enable WhatsApp coexistence.",
        "3. App Store Connect: key needs Sales and Reports (+ App Manager for reviews).",
        "4. Play Console: grant the service account View app information and Reply to reviews.",
        "5. GA4 / GTM: add the SA as Viewer / Read on each property and container.",
        "6. Cloudflare (siutindei.com):",
        f"   - Email Routing destination {inbound} (verify the mail in inbound S3)",
        "   - Worker from scripts/cloudflare/siutindei-mail-fanout.js",
        "     OWNER_DESTINATION / BOARD_DESTINATION / optional SKIP_SENDERS",
        "   - Catch-all → Send to that Worker",
        "7. If BoardMailSendingEnabled=true: add the three DKIM CNAMEs (proxy off),",
        "   SPF include:amazonses.com, and _dmarc. Values:",
    ]
    for i, value in enumerate(dkim, start=1):
        lines.append(f"   DKIM{i}: {value or '(deploy first, then re-run status)'}")
    lines.extend(
        [
            "8. Redeploy the lxsoftware stack so AdminApiFn picks up the new env:",
            "   merge production.json (commit the ARNs) and pass production.local.json",
            "   as extra --parameters, or add MetaVerifyToken as a GitHub Actions secret.",
            "9. Executive Board → Settings: allow-list, spend caps, stand-up toggles.",
            "10. Open a siutindei issue for the listing_events_daily writer if the",
            "    funnel view is still empty.",
        ]
    )
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_init(args: argparse.Namespace) -> int:
    dest = Path(args.out).expanduser()
    if not dest.is_absolute():
        dest = Path.cwd() / dest
    if dest.exists() and not args.force:
        raise SetupError(f"{dest} already exists (pass --force to overwrite)")
    shutil.copyfile(EXAMPLE_ANSWERS, dest)
    print(f"Wrote {dest}")
    print("Fill the blanks, then:")
    print(f"  python3 scripts/setup-board-config.py apply --answers {dest}")
    return 0


def _print_kv(title: str, rows: dict[str, str] | list[str]) -> None:
    print(title)
    if not rows:
        print("  (none)")
        return
    if isinstance(rows, list):
        for item in rows:
            print(f"  {item}")
        return
    for key, value in rows.items():
        print(f"  {key}: {value}")


def cmd_status(args: argparse.Namespace) -> int:
    session = _session(args.region)
    print(f"Account discovery ({args.region}, stack {args.stack})")
    print()
    try:
        outputs = stack_outputs(session, args.stack)
        interesting = {
            key: outputs[key]
            for key in (
                "AdminApiBaseUrl",
                "BoardMailInboundAddress",
                "BoardMailDkimCname1",
                "BoardMailDkimCname2",
                "BoardMailDkimCname3",
                "RecordsTableName",
            )
            if key in outputs
        }
        _print_kv("Stack outputs", interesting)
    except SetupError as exc:
        print(f"Stack outputs: {exc}")
        outputs = {}
    print()
    secrets_found = discover_secrets(
        session,
        [
            SECRET_GITHUB,
            SECRET_SEARCH,
            SECRET_META_TOKEN,
            SECRET_META_APP,
            SECRET_ASC,
            SECRET_PLAY,
            SECRET_GA,
        ],
    )
    _print_kv("Board secrets (ARN only)", secrets_found)
    print()
    prefix = args.lambda_prefix
    lambdas = discover_lambdas(session, prefix)
    _print_kv(f"Lambda functions starting with {prefix!r}", lambdas)
    print()
    clusters = discover_clusters(session)
    print("Aurora clusters")
    if not clusters:
        print("  (none)")
    for row in clusters:
        print(
            f"  {row['id']}  http={row['http']}  {row['arn']}"
            + (f"  secret={row['secret_arn']}" if row["secret_arn"] else "")
        )
    print()
    print(f"Cost allocation tag {COST_TAG}: {list_cost_tag(session)}")
    params_path = Path(args.params_file)
    print()
    if params_path.is_file():
        params = json.loads(params_path.read_text(encoding="utf-8"))
        present = {k: params[k] for k in PUBLIC_PARAM_KEYS if k in params and params[k]}
        _print_kv(f"Already in {params_path}", present)
    else:
        print(f"Params file {params_path} not found")
    local_path = Path(args.local_params_file)
    print()
    if local_path.is_file():
        print(f"Local overlay present: {local_path} (values not printed)")
    else:
        print(f"Local overlay not present: {local_path}")
    print()
    print(remaining_steps(outputs if isinstance(outputs, dict) else None))
    return 0


def _confirm(prompt: str, *, yes: bool) -> bool:
    if yes:
        return True
    if not sys.stdin.isatty():
        raise SetupError("refusing to apply without --yes when stdin is not a TTY")
    reply = input(f"{prompt} [y/N] ").strip().lower()
    return reply in {"y", "yes"}


def cmd_apply(args: argparse.Namespace) -> int:
    answers_path = Path(args.answers).expanduser()
    if not answers_path.is_file():
        raise SetupError(f"answers file not found: {answers_path}")
    answers = load_answers(answers_path)

    region = text(answers, "region", args.region) or args.region
    session = None
    lambdas: list[str] = []
    clusters: list[dict[str, str]] = []
    if not args.offline:
        session = _session(region)
        prefix = text(answers, "discover_lambda_prefix", args.lambda_prefix) or args.lambda_prefix
        if not text(answers, "board_aws_lambda_names"):
            try:
                lambdas = discover_lambdas(session, prefix)
            except Exception as exc:  # noqa: BLE001
                print(f"warning: could not list Lambdas: {exc}", file=sys.stderr)
        if not text(answers, "siutindei_cluster_arn"):
            try:
                clusters = discover_clusters(session)
            except Exception as exc:  # noqa: BLE001
                print(f"warning: could not list Aurora clusters: {exc}", file=sys.stderr)

    if args.generate_verify_token and not text(answers, "meta_verify_token"):
        answers["meta_verify_token"] = secrets.token_hex(24)
        print("Generated meta_verify_token (written to the local overlay only)")

    if args.apply_sql:
        answers["apply_receivables_sql"] = True
    if args.skip_sql:
        answers["apply_receivables_sql"] = False
    if args.activate_cost_tag:
        answers["activate_cost_tag"] = True
    if args.skip_cost_tag:
        answers["activate_cost_tag"] = False

    plan = plan_from_answers(answers, discovered_lambdas=lambdas, discovered_clusters=clusters)
    print(render_plan(plan))
    if args.dry_run:
        print("Dry run — nothing written.")
        return 0
    if not _confirm("Apply these changes to AWS and the param files?", yes=args.yes):
        print("Aborted.")
        return 1
    if session is None:
        session = _session(plan.region)
    logs = execute_plan(plan, session, dry_run=False)
    print()
    print("Done:")
    for line in logs:
        print(f"  {line}")
    outputs: dict[str, str] = {}
    try:
        outputs = stack_outputs(session, plan.stack_name)
    except SetupError:
        pass
    print()
    print(remaining_steps(outputs))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    init = sub.add_parser("init", help="Copy the example answers file")
    init.add_argument("--out", default="setup-board-config.answers.json")
    init.add_argument("--force", action="store_true")
    init.set_defaults(func=cmd_init)

    status = sub.add_parser("status", help="Show stack outputs, secrets, Lambdas, Aurora")
    status.add_argument("--region", default=DEFAULT_REGION)
    status.add_argument("--stack", default=DEFAULT_STACK)
    status.add_argument("--lambda-prefix", default="siutindei")
    status.add_argument("--params-file", default=str(DEFAULT_PARAMS))
    status.add_argument("--local-params-file", default=str(DEFAULT_LOCAL_PARAMS))
    status.set_defaults(func=cmd_status)

    apply = sub.add_parser("apply", help="Create secrets and write CDK params")
    apply.add_argument("--answers", required=True, help="Filled-in JSON (see setup-board-config.example.json)")
    apply.add_argument("--region", default=DEFAULT_REGION)
    apply.add_argument("--lambda-prefix", default="siutindei")
    apply.add_argument("--dry-run", action="store_true")
    apply.add_argument("--yes", action="store_true", help="Do not prompt")
    apply.add_argument("--offline", action="store_true", help="Do not call AWS while planning")
    apply.add_argument("--generate-verify-token", action="store_true")
    apply.add_argument("--apply-sql", action="store_true")
    apply.add_argument("--skip-sql", action="store_true")
    apply.add_argument("--activate-cost-tag", action="store_true")
    apply.add_argument("--skip-cost-tag", action="store_true")
    apply.set_defaults(func=cmd_apply)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except SetupError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
