"""Input validation utilities."""

from __future__ import annotations

import re
from typing import Optional
from uuid import UUID


def validate_uuid(value: str, field_name: str = "id") -> UUID:
    """Validate and parse a UUID string.

    Args:
        value: The string to validate as a UUID.
        field_name: Name of the field for error messages.

    Returns:
        The parsed UUID.

    Raises:
        ValueError: If the string is not a valid UUID.
    """
    try:
        return UUID(value)
    except (ValueError, TypeError) as e:
        raise ValueError(f"Invalid {field_name}: must be a valid UUID") from e


def validate_email(value: str) -> str:
    """Validate an email address.

    Args:
        value: The email address to validate.

    Returns:
        The lowercase email address.

    Raises:
        ValueError: If the email address is invalid.
    """
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    if not re.match(pattern, value):
        raise ValueError("Invalid email address")
    return value.lower()


def validate_range(
    value: int,
    min_val: int,
    max_val: int,
    field_name: str,
) -> int:
    """Validate a numeric value is within range.

    Args:
        value: The value to validate.
        min_val: Minimum allowed value (inclusive).
        max_val: Maximum allowed value (inclusive).
        field_name: Name of the field for error messages.

    Returns:
        The validated value.

    Raises:
        ValueError: If the value is out of range.
    """
    if not min_val <= value <= max_val:
        raise ValueError(f"{field_name} must be between {min_val} and {max_val}")
    return value


def sanitize_string(
    value: Optional[str],
    max_length: int = 1000,
    strip: bool = True,
) -> Optional[str]:
    """Sanitize a string input.

    Args:
        value: The string to sanitize, or None.
        max_length: Maximum allowed length.
        strip: Whether to strip whitespace.

    Returns:
        The sanitized string, or None if input is None.

    Raises:
        ValueError: If the string exceeds max_length.
    """
    if value is None:
        return None
    if strip:
        value = value.strip()
    if len(value) > max_length:
        raise ValueError(f"Value exceeds maximum length of {max_length}")
    return value if value else None
