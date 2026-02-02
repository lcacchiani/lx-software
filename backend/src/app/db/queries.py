"""Query builders for activity search."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from datetime import timezone
from decimal import Decimal
from typing import Iterable
from typing import Sequence
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy import and_
from sqlalchemy import or_
from sqlalchemy import select
from sqlalchemy.sql import Select

from app.db.models import Activity
from app.db.models import ActivityPricing
from app.db.models import ActivitySchedule
from app.db.models import Location
from app.db.models import Organization
from app.db.models import PricingType
from app.db.models import ScheduleType


@dataclass(frozen=True)
class ActivitySearchCursor:
    """Cursor for activity search pagination."""

    schedule_type: ScheduleType
    day_of_week_utc: int | None
    day_of_month: int | None
    start_at_utc: datetime | None
    start_minutes_utc: int | None
    schedule_id: UUID


@dataclass(frozen=True)
class ActivitySearchFilters:
    """Filters for activity search queries."""

    age: int | None = None
    district: str | None = None
    pricing_type: PricingType | None = None
    price_min: Decimal | None = None
    price_max: Decimal | None = None
    schedule_type: ScheduleType | None = None
    day_of_week_utc: int | None = None
    day_of_month: int | None = None
    start_minutes_utc: int | None = None
    end_minutes_utc: int | None = None
    start_at_utc: datetime | None = None
    end_at_utc: datetime | None = None
    languages: Sequence[str] = ()
    cursor: ActivitySearchCursor | None = None
    limit: int = 50


def validate_filters(filters: ActivitySearchFilters) -> None:
    """Validate filter combinations for activity search."""

    if filters.day_of_week_utc is not None and filters.day_of_month is not None:
        raise ValueError("Use day_of_week_utc or day_of_month, not both.")

    if (filters.start_at_utc or filters.end_at_utc) and (
        filters.day_of_week_utc is not None or filters.day_of_month is not None
    ):
        raise ValueError(
            "Date-specific ranges cannot be combined with weekly/monthly fields."
        )

    if (
        filters.schedule_type == ScheduleType.WEEKLY
        and filters.day_of_month is not None
    ):
        raise ValueError("Weekly schedules cannot include day_of_month.")

    if (
        filters.schedule_type == ScheduleType.MONTHLY
        and filters.day_of_week_utc is not None
    ):
        raise ValueError("Monthly schedules cannot include day_of_week_utc.")

    if filters.schedule_type == ScheduleType.DATE_SPECIFIC and (
        filters.day_of_week_utc is not None or filters.day_of_month is not None
    ):
        raise ValueError(
            "Date-specific schedules cannot include weekly/monthly fields."
        )

    if filters.start_minutes_utc is not None and filters.end_minutes_utc is not None:
        if filters.start_minutes_utc >= filters.end_minutes_utc:
            raise ValueError("start_minutes_utc must be less than end_minutes_utc.")

    if filters.start_at_utc and filters.end_at_utc:
        if filters.start_at_utc >= filters.end_at_utc:
            raise ValueError("start_at_utc must be before end_at_utc.")

    if filters.limit <= 0 or filters.limit > 200:
        raise ValueError("limit must be between 1 and 200.")


def build_activity_search_query(filters: ActivitySearchFilters) -> Select:
    """Build a SQLAlchemy query for activity search."""

    validate_filters(filters)

    query = (
        select(Activity, Organization, Location, ActivityPricing, ActivitySchedule)
        .join(Organization, Organization.id == Activity.org_id)
        .join(ActivitySchedule, ActivitySchedule.activity_id == Activity.id)
        .join(Location, Location.id == ActivitySchedule.location_id)
        .join(
            ActivityPricing,
            and_(
                ActivityPricing.activity_id == Activity.id,
                ActivityPricing.location_id == Location.id,
            ),
        )
    )

    conditions: list = []

    if filters.age is not None:
        conditions.append(Activity.age_range.contains(filters.age))

    if filters.district:
        conditions.append(Location.district == filters.district)

    if filters.pricing_type is not None:
        conditions.append(ActivityPricing.pricing_type == filters.pricing_type)

    if filters.price_min is not None:
        conditions.append(ActivityPricing.amount >= filters.price_min)

    if filters.price_max is not None:
        conditions.append(ActivityPricing.amount <= filters.price_max)

    _apply_schedule_filters(filters, conditions)

    if filters.languages:
        language_conditions = _build_language_conditions(filters.languages)
        conditions.append(or_(*language_conditions))

    order_columns = _order_columns()
    if filters.cursor is not None:
        cursor_values = _cursor_values(filters.cursor)
        conditions.append(sa.tuple_(*order_columns) > sa.tuple_(*cursor_values))

    if conditions:
        query = query.where(and_(*conditions))

    query = query.order_by(*order_columns)
    return query.limit(filters.limit)


def _apply_schedule_filters(filters: ActivitySearchFilters, conditions: list) -> None:
    """Apply schedule filters to a query condition list."""

    if filters.schedule_type is not None:
        conditions.append(ActivitySchedule.schedule_type == filters.schedule_type)

    if filters.day_of_week_utc is not None:
        conditions.append(ActivitySchedule.schedule_type == ScheduleType.WEEKLY)
        conditions.append(ActivitySchedule.day_of_week_utc == filters.day_of_week_utc)

    if filters.day_of_month is not None:
        conditions.append(ActivitySchedule.schedule_type == ScheduleType.MONTHLY)
        conditions.append(ActivitySchedule.day_of_month == filters.day_of_month)

    if filters.start_minutes_utc is not None and filters.end_minutes_utc is not None:
        conditions.append(ActivitySchedule.start_minutes_utc < filters.end_minutes_utc)
        conditions.append(ActivitySchedule.end_minutes_utc > filters.start_minutes_utc)
    elif filters.start_minutes_utc is not None:
        conditions.append(ActivitySchedule.end_minutes_utc >= filters.start_minutes_utc)
    elif filters.end_minutes_utc is not None:
        conditions.append(ActivitySchedule.start_minutes_utc <= filters.end_minutes_utc)

    if filters.start_at_utc is not None or filters.end_at_utc is not None:
        conditions.append(ActivitySchedule.schedule_type == ScheduleType.DATE_SPECIFIC)
        if filters.start_at_utc is not None and filters.end_at_utc is not None:
            conditions.append(ActivitySchedule.start_at_utc < filters.end_at_utc)
            conditions.append(ActivitySchedule.end_at_utc > filters.start_at_utc)
        elif filters.start_at_utc is not None:
            conditions.append(ActivitySchedule.end_at_utc >= filters.start_at_utc)
        elif filters.end_at_utc is not None:
            conditions.append(ActivitySchedule.start_at_utc <= filters.end_at_utc)


def _build_language_conditions(languages: Iterable[str]) -> list:
    """Build language conditions for session-specific languages."""

    return [ActivitySchedule.languages.any(language) for language in languages]  # type: ignore[arg-type]


def _order_columns() -> list:
    """Return ordering columns for pagination."""

    type_order = sa.case(
        (ActivitySchedule.schedule_type == ScheduleType.WEEKLY, 1),
        (ActivitySchedule.schedule_type == ScheduleType.MONTHLY, 2),
        (ActivitySchedule.schedule_type == ScheduleType.DATE_SPECIFIC, 3),
        else_=4,
    )
    day_of_week = sa.func.coalesce(ActivitySchedule.day_of_week_utc, -1)
    day_of_month = sa.func.coalesce(ActivitySchedule.day_of_month, -1)
    start_at = sa.func.coalesce(
        ActivitySchedule.start_at_utc,
        datetime(1970, 1, 1, tzinfo=timezone.utc),
    )
    start_minutes = sa.func.coalesce(ActivitySchedule.start_minutes_utc, -1)

    return [
        type_order,
        day_of_week,
        day_of_month,
        start_at,
        start_minutes,
        ActivitySchedule.id,
    ]


def _cursor_values(cursor: ActivitySearchCursor) -> list:
    """Return ordering values for the cursor comparison."""

    type_order = _schedule_type_order(cursor.schedule_type)
    day_of_week = cursor.day_of_week_utc if cursor.day_of_week_utc is not None else -1
    day_of_month = cursor.day_of_month if cursor.day_of_month is not None else -1
    start_at = cursor.start_at_utc or datetime(1970, 1, 1, tzinfo=timezone.utc)
    start_minutes = (
        cursor.start_minutes_utc if cursor.start_minutes_utc is not None else -1
    )

    return [
        type_order,
        day_of_week,
        day_of_month,
        start_at,
        start_minutes,
        cursor.schedule_id,
    ]


def _schedule_type_order(value: ScheduleType) -> int:
    """Return a deterministic order for schedule types."""

    if value == ScheduleType.WEEKLY:
        return 1
    if value == ScheduleType.MONTHLY:
        return 2
    if value == ScheduleType.DATE_SPECIFIC:
        return 3
    return 4
