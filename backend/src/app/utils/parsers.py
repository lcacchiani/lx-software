"""Shared parsing utilities for request handling."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from typing import Mapping
from typing import Optional
from typing import Sequence
from typing import TypeVar

T = TypeVar("T", bound=Enum)


def parse_int(value: Optional[str]) -> Optional[int]:
    """Parse an integer from a string.

    Args:
        value: The string value to parse, or None.

    Returns:
        The parsed integer, or None if input is None or empty.

    Raises:
        ValueError: If the string cannot be converted to an integer.
    """
    if value is None or value == "":
        return None
    return int(value)


def parse_decimal(value: Optional[str]) -> Optional[Decimal]:
    """Parse a Decimal from a string.

    Args:
        value: The string value to parse, or None.

    Returns:
        The parsed Decimal, or None if input is None or empty.

    Raises:
        ValueError: If the string cannot be converted to a Decimal.
    """
    if value is None or value == "":
        return None
    return Decimal(value)


def parse_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 datetime string.

    Handles both 'Z' suffix and '+00:00' timezone notation.

    Args:
        value: The ISO-8601 datetime string to parse, or None.

    Returns:
        The parsed datetime with timezone info, or None if input is None or empty.

    Raises:
        ValueError: If the string cannot be parsed as an ISO datetime.
    """
    if value is None or value == "":
        return None
    cleaned = value.replace("Z", "+00:00") if value.endswith("Z") else value
    return datetime.fromisoformat(cleaned)


def parse_enum(value: Optional[str], enum_type: type[T]) -> Optional[T]:
    """Parse an enum value from a string.

    Args:
        value: The string value to parse, or None.
        enum_type: The enum class to parse into.

    Returns:
        The parsed enum value, or None if input is None or empty.

    Raises:
        ValueError: If the string is not a valid enum value.
    """
    if value is None or value == "":
        return None
    return enum_type(value)


def parse_languages(values: Sequence[str]) -> list[str]:
    """Parse language filters from query parameters.

    Handles both comma-separated strings and multiple parameter values.

    Args:
        values: List of language parameter values.

    Returns:
        Deduplicated list of language codes.
    """
    languages: list[str] = []
    for value in values:
        for item in value.split(","):
            item = item.strip()
            if item and item not in languages:
                languages.append(item)
    return languages


def first_param(params: dict[str, list[str]], key: str) -> Optional[str]:
    """Return the first query parameter value for a key.

    Args:
        params: Dictionary of parameter name to list of values.
        key: The parameter name to look up.

    Returns:
        The first value for the key, or None if not present.
    """
    values = params.get(key, [])
    return values[0] if values else None


def collect_query_params(event: Mapping[str, Any]) -> dict[str, list[str]]:
    """Collect query parameters from API Gateway events.

    Handles both single and multi-value query string parameters.

    Args:
        event: The API Gateway event dictionary.

    Returns:
        Dictionary mapping parameter names to lists of values.
    """
    params: dict[str, list[str]] = {}
    single = event.get("queryStringParameters") or {}
    multi = event.get("multiValueQueryStringParameters") or {}

    for key, value in single.items():
        if value is None:
            continue
        params.setdefault(key, []).append(value)

    for key, values in multi.items():
        if not values:
            continue
        for value in values:
            if value is None:
                continue
            params.setdefault(key, []).append(value)

    return params
