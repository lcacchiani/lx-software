"""Shared OpenRouter Chat Completions client.

Used by the statement parser and the Executive Board. Owns API key
resolution (env var or Secrets Manager, cached per container), the HTTP
call with bounded retries, response text extraction, and usage / cost
accounting so callers can enforce budgets.
"""

from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_TIMEOUT_SECONDS = 60
_RETRYABLE_STATUSES = frozenset({408, 409, 425, 429, 500, 502, 503, 504})
_MAX_RETRIES_DEFAULT = 2

_api_key_cache: str | None = None


class OpenRouterError(RuntimeError):
    """Transport or API failure talking to OpenRouter."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class ChatCompletion:
    text: str
    model: str
    usage: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def cost_usd(self) -> float:
        value = self.usage.get("cost")
        return float(value) if isinstance(value, (int, float)) else 0.0


def endpoint_url() -> str:
    return os.getenv("OPENROUTER_CHAT_COMPLETIONS_URL", "").strip() or DEFAULT_ENDPOINT


def chat_completion(
    *,
    messages: list[dict[str, Any]],
    model: str,
    secrets_client: Any,
    timeout: int,
    json_mode: bool = False,
    temperature: float | None = None,
    max_tokens: int | None = None,
    plugins: list[dict[str, Any]] | None = None,
    include_usage: bool = True,
    deny_data_collection: bool = True,
    max_retries: int = _MAX_RETRIES_DEFAULT,
) -> ChatCompletion:
    """POST one chat completion and return the assistant text plus usage.

    With ``deny_data_collection`` (the default) OpenRouter only routes to
    providers that do not retain prompts.
    """
    payload: dict[str, Any] = {"model": model, "messages": messages}
    if deny_data_collection:
        payload["provider"] = {"data_collection": "deny"}
    if temperature is not None:
        payload["temperature"] = temperature
    if max_tokens is not None:
        payload["max_tokens"] = int(max_tokens)
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    if plugins:
        payload["plugins"] = plugins
    if include_usage:
        payload["usage"] = {"include": True}

    api_key = resolve_api_key(secrets_client)
    body_text = post_json(
        url=endpoint_url(),
        api_key=api_key,
        payload=payload,
        timeout=timeout,
        max_retries=max_retries,
    )
    raw = _load_json_object(body_text, what="OpenRouter response")
    text = extract_message_text(raw)
    return ChatCompletion(
        text=text,
        model=str(raw.get("model") or model),
        usage=normalize_usage(raw.get("usage")),
        raw=raw,
    )


def post_json(
    *,
    url: str,
    api_key: str,
    payload: dict[str, Any],
    timeout: int,
    max_retries: int = _MAX_RETRIES_DEFAULT,
) -> str:
    data = json.dumps(payload).encode("utf-8")
    attempt = 0
    while True:
        req = urlrequest.Request(  # noqa: S310 - URL is trusted (env-configured)
            url=url,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://admin.lx-software.com",
                "X-Title": "lxsoftware-admin",
            },
        )
        try:
            with urlrequest.urlopen(req, timeout=timeout) as resp:  # noqa: S310
                return resp.read().decode("utf-8")
        except urlerror.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")
            except Exception:  # pragma: no cover - defensive
                body = ""
            if exc.code in _RETRYABLE_STATUSES and attempt < max_retries:
                attempt += 1
                time.sleep(min(8.0, 1.5 * (2 ** (attempt - 1))))
                continue
            preview = body.replace("\n", " ").strip()
            if len(preview) > 500:
                preview = f"{preview[:500]}..."
            detail = f": {preview}" if preview else ""
            raise OpenRouterError(
                f"OpenRouter request failed with status {exc.code}{detail}",
                status=exc.code,
            ) from exc
        except urlerror.URLError as exc:
            if attempt < max_retries:
                attempt += 1
                time.sleep(min(8.0, 1.5 * (2 ** (attempt - 1))))
                continue
            raise OpenRouterError(
                f"OpenRouter request transport error: {exc.reason}"
            ) from exc


def extract_message_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise OpenRouterError("OpenRouter response choices are missing")
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        raise OpenRouterError("OpenRouter response choice has invalid shape")
    message = first_choice.get("message")
    if not isinstance(message, dict):
        raise OpenRouterError("OpenRouter response message is missing")
    content = message.get("content")
    if isinstance(content, list):
        text_parts = [
            str(item.get("text"))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ]
        return "\n".join(part for part in text_parts if part)
    return str(content or "")


def strip_code_fences(text: str) -> str:
    return (
        text.strip()
        .removeprefix("```json")
        .removeprefix("```")
        .removesuffix("```")
        .strip()
    )


def parse_json_object_text(text: str) -> dict[str, Any]:
    """Parse assistant text that should be a single JSON object.

    Tolerates markdown code fences and leading / trailing prose around the
    first balanced ``{...}`` block.
    """
    cleaned = strip_code_fences(text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise OpenRouterError("Model response is not a JSON object") from None
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise OpenRouterError("Model response is not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise OpenRouterError("Model response payload is not an object")
    return parsed


def normalize_usage(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"promptTokens": 0, "completionTokens": 0, "totalTokens": 0, "cost": 0.0}
    prompt = _as_int(raw.get("prompt_tokens"))
    completion = _as_int(raw.get("completion_tokens"))
    total = _as_int(raw.get("total_tokens")) or (prompt + completion)
    cost_raw = raw.get("cost")
    cost = float(cost_raw) if isinstance(cost_raw, (int, float)) else 0.0
    return {
        "promptTokens": prompt,
        "completionTokens": completion,
        "totalTokens": total,
        "cost": round(cost, 6),
    }


def add_usage(total: dict[str, Any] | None, delta: dict[str, Any] | None) -> dict[str, Any]:
    base = normalize_usage(
        {
            "prompt_tokens": (total or {}).get("promptTokens", 0),
            "completion_tokens": (total or {}).get("completionTokens", 0),
            "total_tokens": (total or {}).get("totalTokens", 0),
            "cost": (total or {}).get("cost", 0.0),
        }
    )
    extra = delta or {}
    return {
        "promptTokens": base["promptTokens"] + _as_int(extra.get("promptTokens")),
        "completionTokens": base["completionTokens"]
        + _as_int(extra.get("completionTokens")),
        "totalTokens": base["totalTokens"] + _as_int(extra.get("totalTokens")),
        "cost": round(base["cost"] + float(extra.get("cost") or 0.0), 6),
    }


def resolve_api_key(secrets_client: Any) -> str:
    """Resolve the OpenRouter API key from env var or Secrets Manager."""
    global _api_key_cache
    if _api_key_cache is not None:
        return _api_key_cache
    direct = os.getenv("OPENROUTER_API_KEY", "").strip()
    if direct:
        _api_key_cache = direct
        return _api_key_cache
    secret_arn = os.getenv("OPENROUTER_API_KEY_SECRET_ARN", "").strip()
    if not secret_arn:
        raise OpenRouterError(
            "OpenRouter API key is not configured (set OPENROUTER_API_KEY_SECRET_ARN)"
        )
    _api_key_cache = read_secret_string(secrets_client, secret_arn, what="OpenRouter API key")
    return _api_key_cache


def read_secret_string(secrets_client: Any, secret_arn: str, *, what: str) -> str:
    """Fetch a Secrets Manager secret and return the bare token inside it.

    Accepts either a plain string secret or a JSON object with one of the
    conventional key names.
    """
    response = secrets_client.get_secret_value(SecretId=secret_arn)
    secret_string = response.get("SecretString")
    if not secret_string and response.get("SecretBinary"):
        secret_string = base64.b64decode(response["SecretBinary"]).decode("utf-8")
    if not secret_string:
        raise OpenRouterError(f"{what} secret is empty")
    raw = secret_string.strip()
    if not raw:
        raise OpenRouterError(f"{what} value is blank")
    if raw.startswith("{"):
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise OpenRouterError(f"{what} secret JSON must be an object")
        for key_name in (
            "openrouter_api_key",
            "OPENROUTER_API_KEY",
            "github_token",
            "GITHUB_TOKEN",
            "api_key",
            "key",
            "token",
        ):
            candidate = payload.get(key_name)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        raise OpenRouterError(f"{what} is missing in secret JSON")
    return raw


def reset_api_key_cache_for_tests() -> None:
    global _api_key_cache
    _api_key_cache = None


def _load_json_object(text: str, *, what: str) -> dict[str, Any]:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise OpenRouterError(f"{what} is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise OpenRouterError(f"{what} must be a JSON object")
    return payload


def _as_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    return 0
