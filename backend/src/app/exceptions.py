"""Custom exception classes for the application.

This module provides domain-specific exception classes that carry
appropriate HTTP status codes and structured error information.
"""

from __future__ import annotations

from typing import Any
from typing import Optional


class AppError(Exception):
    """Base exception for application errors.

    All application-specific exceptions should inherit from this class.
    Each exception carries an HTTP status code and optional details.

    Attributes:
        message: Human-readable error message.
        status_code: HTTP status code (default 500).
        detail: Optional additional context.
    """

    def __init__(
        self,
        message: str,
        status_code: int = 500,
        detail: Optional[str] = None,
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.detail = detail

    def to_dict(self) -> dict[str, Any]:
        """Convert exception to API response body."""
        result: dict[str, Any] = {"error": self.message}
        if self.detail:
            result["detail"] = self.detail
        return result


class ValidationError(AppError):
    """Raised when input validation fails.

    Use for malformed requests, invalid parameter values,
    or constraint violations in user input.
    """

    def __init__(self, message: str, field: Optional[str] = None):
        detail = f"Field: {field}" if field else None
        super().__init__(message, status_code=400, detail=detail)
        self.field = field


class NotFoundError(AppError):
    """Raised when a requested resource is not found.

    Use when a specific entity lookup fails (e.g., by ID).
    """

    def __init__(self, resource: str, identifier: str):
        super().__init__(
            f"{resource} not found: {identifier}",
            status_code=404,
        )
        self.resource = resource
        self.identifier = identifier


class AuthorizationError(AppError):
    """Raised when authorization fails.

    Use when the user is authenticated but lacks permission
    for the requested action.
    """

    def __init__(self, message: str = "Forbidden"):
        super().__init__(message, status_code=403)


class AuthenticationError(AppError):
    """Raised when authentication fails.

    Use when credentials are missing or invalid.
    """

    def __init__(self, message: str = "Unauthorized"):
        super().__init__(message, status_code=401)


class ConfigurationError(AppError):
    """Raised when required configuration is missing.

    Use when environment variables or settings are not properly configured.
    """

    def __init__(self, config_name: str):
        super().__init__(
            f"Missing required configuration: {config_name}",
            status_code=500,
        )
        self.config_name = config_name


class DatabaseError(AppError):
    """Raised when a database operation fails.

    Use for connection errors, query failures, or constraint violations.
    """

    def __init__(self, message: str, detail: Optional[str] = None):
        super().__init__(
            message,
            status_code=500,
            detail=detail,
        )


class RateLimitError(AppError):
    """Raised when rate limits are exceeded.

    Use when the client has made too many requests.
    """

    def __init__(self, message: str = "Rate limit exceeded"):
        super().__init__(message, status_code=429)


class CursorError(ValidationError):
    """Raised when a pagination cursor is invalid.

    Use when cursor parsing or validation fails.
    """

    def __init__(self, detail: Optional[str] = None):
        super().__init__("Invalid cursor", field="cursor")
        self.detail = detail
