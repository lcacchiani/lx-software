"""Tests for utility parser functions."""

from __future__ import annotations

import sys
from datetime import datetime
from datetime import timezone
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1] / 'backend' / 'src'))

from app.db.models import PricingType
from app.db.models import ScheduleType
from app.utils.parsers import (
    collect_query_params,
    first_param,
    parse_datetime,
    parse_decimal,
    parse_enum,
    parse_int,
    parse_languages,
)


class TestParseInt:
    """Tests for parse_int function."""

    def test_returns_none_for_none(self) -> None:
        assert parse_int(None) is None

    def test_returns_none_for_empty_string(self) -> None:
        assert parse_int('') is None

    def test_parses_positive_integer(self) -> None:
        assert parse_int('42') == 42

    def test_parses_negative_integer(self) -> None:
        assert parse_int('-10') == -10

    def test_parses_zero(self) -> None:
        assert parse_int('0') == 0

    def test_raises_for_invalid_string(self) -> None:
        with pytest.raises(ValueError):
            parse_int('not-a-number')


class TestParseDecimal:
    """Tests for parse_decimal function."""

    def test_returns_none_for_none(self) -> None:
        assert parse_decimal(None) is None

    def test_returns_none_for_empty_string(self) -> None:
        assert parse_decimal('') is None

    def test_parses_decimal_value(self) -> None:
        assert parse_decimal('123.45') == Decimal('123.45')

    def test_parses_integer_as_decimal(self) -> None:
        assert parse_decimal('100') == Decimal('100')

    def test_raises_for_invalid_string(self) -> None:
        with pytest.raises(Exception):
            parse_decimal('invalid')


class TestParseDatetime:
    """Tests for parse_datetime function."""

    def test_returns_none_for_none(self) -> None:
        assert parse_datetime(None) is None

    def test_returns_none_for_empty_string(self) -> None:
        assert parse_datetime('') is None

    def test_parses_iso_format_with_z(self) -> None:
        result = parse_datetime('2024-01-15T10:30:00Z')
        assert result == datetime(2024, 1, 15, 10, 30, 0, tzinfo=timezone.utc)

    def test_parses_iso_format_with_offset(self) -> None:
        result = parse_datetime('2024-01-15T10:30:00+00:00')
        assert result == datetime(2024, 1, 15, 10, 30, 0, tzinfo=timezone.utc)

    def test_raises_for_invalid_format(self) -> None:
        with pytest.raises(ValueError):
            parse_datetime('not-a-date')


class TestParseEnum:
    """Tests for parse_enum function."""

    def test_returns_none_for_none(self) -> None:
        assert parse_enum(None, PricingType) is None

    def test_returns_none_for_empty_string(self) -> None:
        assert parse_enum('', ScheduleType) is None

    def test_parses_valid_enum_value(self) -> None:
        assert parse_enum('per_class', PricingType) == PricingType.PER_CLASS
        assert parse_enum('weekly', ScheduleType) == ScheduleType.WEEKLY

    def test_raises_for_invalid_enum_value(self) -> None:
        with pytest.raises(ValueError):
            parse_enum('invalid', PricingType)


class TestParseLanguages:
    """Tests for parse_languages function."""

    def test_returns_empty_list_for_empty_input(self) -> None:
        assert parse_languages([]) == []

    def test_parses_single_language(self) -> None:
        assert parse_languages(['en']) == ['en']

    def test_parses_comma_separated_languages(self) -> None:
        assert parse_languages(['en,zh,jp']) == ['en', 'zh', 'jp']

    def test_handles_whitespace(self) -> None:
        assert parse_languages([' en , zh ']) == ['en', 'zh']

    def test_deduplicates_languages(self) -> None:
        assert parse_languages(['en,zh', 'en']) == ['en', 'zh']

    def test_ignores_empty_values(self) -> None:
        assert parse_languages(['en,,zh']) == ['en', 'zh']


class TestFirstParam:
    """Tests for first_param function."""

    def test_returns_none_for_missing_key(self) -> None:
        assert first_param({'other': ['value']}, 'missing') is None

    def test_returns_none_for_empty_values(self) -> None:
        assert first_param({'key': []}, 'key') is None

    def test_returns_first_value(self) -> None:
        assert first_param({'key': ['first', 'second']}, 'key') == 'first'


class TestCollectQueryParams:
    """Tests for collect_query_params function."""

    def test_handles_empty_event(self) -> None:
        event = {}
        assert collect_query_params(event) == {}

    def test_collects_single_value_params(self) -> None:
        event = {'queryStringParameters': {'age': '10', 'district': 'Central'}}
        result = collect_query_params(event)
        assert result == {'age': ['10'], 'district': ['Central']}

    def test_collects_multi_value_params(self) -> None:
        event = {'multiValueQueryStringParameters': {'language': ['en', 'zh']}}
        result = collect_query_params(event)
        assert result == {'language': ['en', 'zh']}

    def test_handles_none_values(self) -> None:
        event = {'queryStringParameters': {'key': None}}
        result = collect_query_params(event)
        assert result == {}

    def test_merges_single_and_multi_value(self) -> None:
        event = {
            'queryStringParameters': {'age': '10'},
            'multiValueQueryStringParameters': {'language': ['en']},
        }
        result = collect_query_params(event)
        assert 'age' in result
        assert 'language' in result
