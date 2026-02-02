"""Tests for activity search query building."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from uuid import uuid4

sys.path.append(str(Path(__file__).resolve().parents[1] / "backend" / "src"))

from app.db.models import ScheduleType  # noqa: E402
from app.db.queries import ActivitySearchCursor  # noqa: E402
from app.db.queries import ActivitySearchFilters  # noqa: E402
from app.db.queries import build_activity_search_query  # noqa: E402
from app.db.queries import validate_filters  # noqa: E402


def test_validate_filters_rejects_overlapping_day_filters() -> None:
    """Ensure day_of_week and day_of_month cannot be combined."""

    filters = ActivitySearchFilters(day_of_week_utc=2, day_of_month=10)
    with pytest.raises(ValueError, match="day_of_week_utc or day_of_month"):
        validate_filters(filters)


def test_validate_filters_rejects_invalid_minutes() -> None:
    """Ensure start_minutes_utc is less than end_minutes_utc."""

    filters = ActivitySearchFilters(start_minutes_utc=600, end_minutes_utc=540)
    with pytest.raises(ValueError, match="start_minutes_utc"):
        validate_filters(filters)


def test_validate_filters_rejects_schedule_type_conflict() -> None:
    """Ensure schedule_type conflicts are rejected."""

    filters = ActivitySearchFilters(
        schedule_type=ScheduleType.MONTHLY,
        day_of_week_utc=3,
    )
    with pytest.raises(ValueError, match="Monthly schedules"):
        validate_filters(filters)


def test_build_activity_search_query_sets_limit() -> None:
    """Ensure the query sets a limit."""

    filters = ActivitySearchFilters(limit=25)
    query = build_activity_search_query(filters)
    assert query._limit_clause is not None


def test_build_activity_search_query_applies_cursor() -> None:
    """Ensure the cursor filter is applied."""

    cursor_id = uuid4()
    cursor = ActivitySearchCursor(
        schedule_type=ScheduleType.WEEKLY,
        day_of_week_utc=2,
        day_of_month=None,
        start_at_utc=None,
        start_minutes_utc=480,
        schedule_id=cursor_id,
    )
    filters = ActivitySearchFilters(cursor=cursor)
    query = build_activity_search_query(filters)
    where_clause = str(query.whereclause)
    assert "activity_schedule.id" in where_clause
