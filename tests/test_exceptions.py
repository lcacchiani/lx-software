"""Tests for custom exception classes."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1] / 'backend' / 'src'))

from app.exceptions import (
    AppError,
    AuthenticationError,
    AuthorizationError,
    ConfigurationError,
    CursorError,
    DatabaseError,
    NotFoundError,
    RateLimitError,
    ValidationError,
)


class TestAppError:
    """Tests for base AppError class."""

    def test_default_status_code(self) -> None:
        error = AppError('Something went wrong')
        assert error.status_code == 500
        assert error.message == 'Something went wrong'

    def test_custom_status_code(self) -> None:
        error = AppError('Bad request', status_code=400)
        assert error.status_code == 400

    def test_to_dict_without_detail(self) -> None:
        error = AppError('Error message')
        assert error.to_dict() == {'error': 'Error message'}

    def test_to_dict_with_detail(self) -> None:
        error = AppError('Error', detail='Additional info')
        result = error.to_dict()
        assert result['error'] == 'Error'
        assert result['detail'] == 'Additional info'


class TestValidationError:
    """Tests for ValidationError class."""

    def test_status_code_is_400(self) -> None:
        error = ValidationError('Invalid input')
        assert error.status_code == 400

    def test_includes_field_in_detail(self) -> None:
        error = ValidationError('Invalid value', field='age')
        assert error.field == 'age'
        assert 'age' in error.detail


class TestNotFoundError:
    """Tests for NotFoundError class."""

    def test_status_code_is_404(self) -> None:
        error = NotFoundError('Organization', '123-456')
        assert error.status_code == 404

    def test_message_includes_resource_and_id(self) -> None:
        error = NotFoundError('Activity', 'abc-def')
        assert 'Activity' in error.message
        assert 'abc-def' in error.message

    def test_stores_resource_and_identifier(self) -> None:
        error = NotFoundError('Location', 'xyz')
        assert error.resource == 'Location'
        assert error.identifier == 'xyz'


class TestAuthorizationError:
    """Tests for AuthorizationError class."""

    def test_status_code_is_403(self) -> None:
        error = AuthorizationError()
        assert error.status_code == 403

    def test_default_message(self) -> None:
        error = AuthorizationError()
        assert error.message == 'Forbidden'

    def test_custom_message(self) -> None:
        error = AuthorizationError('Admin access required')
        assert error.message == 'Admin access required'


class TestAuthenticationError:
    """Tests for AuthenticationError class."""

    def test_status_code_is_401(self) -> None:
        error = AuthenticationError()
        assert error.status_code == 401

    def test_default_message(self) -> None:
        error = AuthenticationError()
        assert error.message == 'Unauthorized'


class TestConfigurationError:
    """Tests for ConfigurationError class."""

    def test_status_code_is_500(self) -> None:
        error = ConfigurationError('DATABASE_URL')
        assert error.status_code == 500

    def test_message_includes_config_name(self) -> None:
        error = ConfigurationError('API_KEY')
        assert 'API_KEY' in error.message

    def test_stores_config_name(self) -> None:
        error = ConfigurationError('SECRET_ARN')
        assert error.config_name == 'SECRET_ARN'


class TestDatabaseError:
    """Tests for DatabaseError class."""

    def test_status_code_is_500(self) -> None:
        error = DatabaseError('Connection failed')
        assert error.status_code == 500

    def test_accepts_detail(self) -> None:
        error = DatabaseError('Query failed', detail='Timeout after 30s')
        assert error.detail == 'Timeout after 30s'


class TestRateLimitError:
    """Tests for RateLimitError class."""

    def test_status_code_is_429(self) -> None:
        error = RateLimitError()
        assert error.status_code == 429

    def test_default_message(self) -> None:
        error = RateLimitError()
        assert 'Rate limit' in error.message


class TestCursorError:
    """Tests for CursorError class."""

    def test_inherits_from_validation_error(self) -> None:
        error = CursorError()
        assert isinstance(error, ValidationError)
        assert error.status_code == 400

    def test_has_cursor_field(self) -> None:
        error = CursorError()
        assert error.field == 'cursor'

    def test_accepts_detail(self) -> None:
        error = CursorError(detail='Malformed base64')
        assert error.detail == 'Malformed base64'
