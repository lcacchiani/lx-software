"""Repository for ActivitySchedule entities."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from typing import Sequence
from uuid import UUID

from sqlalchemy import and_
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ActivitySchedule
from app.db.models import ScheduleType
from app.db.repositories.base import BaseRepository


class ActivityScheduleRepository(BaseRepository[ActivitySchedule]):
    """Repository for ActivitySchedule CRUD operations."""

    def __init__(self, session: Session):
        """Initialize the repository.

        Args:
            session: SQLAlchemy session for database operations.
        """
        super().__init__(session, ActivitySchedule)

    def find_by_activity(
        self,
        activity_id: UUID,
        limit: int = 50,
    ) -> Sequence[ActivitySchedule]:
        """Find all schedules for an activity.

        Args:
            activity_id: The activity UUID.
            limit: Maximum results to return.

        Returns:
            Schedules for the activity.
        """
        query = (
            select(ActivitySchedule)
            .where(ActivitySchedule.activity_id == activity_id)
            .order_by(ActivitySchedule.id)
            .limit(limit)
        )
        return self._session.execute(query).scalars().all()

    def find_by_location(
        self,
        location_id: UUID,
        limit: int = 50,
    ) -> Sequence[ActivitySchedule]:
        """Find all schedules at a location.

        Args:
            location_id: The location UUID.
            limit: Maximum results to return.

        Returns:
            Schedules at the location.
        """
        query = (
            select(ActivitySchedule)
            .where(ActivitySchedule.location_id == location_id)
            .order_by(ActivitySchedule.id)
            .limit(limit)
        )
        return self._session.execute(query).scalars().all()

    def find_weekly_by_day(
        self,
        day_of_week_utc: int,
        limit: int = 50,
    ) -> Sequence[ActivitySchedule]:
        """Find weekly schedules for a specific day.

        Args:
            day_of_week_utc: Day of week (0=Sunday, 6=Saturday).
            limit: Maximum results to return.

        Returns:
            Weekly schedules on the specified day.
        """
        query = (
            select(ActivitySchedule)
            .where(
                and_(
                    ActivitySchedule.schedule_type == ScheduleType.WEEKLY,
                    ActivitySchedule.day_of_week_utc == day_of_week_utc,
                )
            )
            .order_by(ActivitySchedule.start_minutes_utc)
            .limit(limit)
        )
        return self._session.execute(query).scalars().all()

    def find_by_language(
        self,
        language: str,
        limit: int = 50,
    ) -> Sequence[ActivitySchedule]:
        """Find schedules offering a specific language.

        Args:
            language: Language code.
            limit: Maximum results to return.

        Returns:
            Schedules offering the language.
        """
        query = (
            select(ActivitySchedule)
            .where(ActivitySchedule.languages.any(language))  # type: ignore[arg-type]
            .order_by(ActivitySchedule.id)
            .limit(limit)
        )
        return self._session.execute(query).scalars().all()

    def create_weekly_schedule(
        self,
        activity_id: UUID,
        location_id: UUID,
        day_of_week_utc: int,
        start_minutes_utc: int,
        end_minutes_utc: int,
        languages: Optional[list[str]] = None,
    ) -> ActivitySchedule:
        """Create a weekly schedule.

        Args:
            activity_id: Activity UUID.
            location_id: Location UUID.
            day_of_week_utc: Day of week (0=Sunday, 6=Saturday).
            start_minutes_utc: Start time in minutes from midnight UTC.
            end_minutes_utc: End time in minutes from midnight UTC.
            languages: Optional list of language codes.

        Returns:
            The created schedule.
        """
        schedule = ActivitySchedule(
            activity_id=activity_id,
            location_id=location_id,
            schedule_type=ScheduleType.WEEKLY,
            day_of_week_utc=day_of_week_utc,
            start_minutes_utc=start_minutes_utc,
            end_minutes_utc=end_minutes_utc,
            languages=languages or [],
        )
        return self.create(schedule)

    def create_monthly_schedule(
        self,
        activity_id: UUID,
        location_id: UUID,
        day_of_month: int,
        start_minutes_utc: int,
        end_minutes_utc: int,
        languages: Optional[list[str]] = None,
    ) -> ActivitySchedule:
        """Create a monthly schedule.

        Args:
            activity_id: Activity UUID.
            location_id: Location UUID.
            day_of_month: Day of month (1-31).
            start_minutes_utc: Start time in minutes from midnight UTC.
            end_minutes_utc: End time in minutes from midnight UTC.
            languages: Optional list of language codes.

        Returns:
            The created schedule.
        """
        schedule = ActivitySchedule(
            activity_id=activity_id,
            location_id=location_id,
            schedule_type=ScheduleType.MONTHLY,
            day_of_month=day_of_month,
            start_minutes_utc=start_minutes_utc,
            end_minutes_utc=end_minutes_utc,
            languages=languages or [],
        )
        return self.create(schedule)

    def create_date_specific_schedule(
        self,
        activity_id: UUID,
        location_id: UUID,
        start_at_utc: datetime,
        end_at_utc: datetime,
        languages: Optional[list[str]] = None,
    ) -> ActivitySchedule:
        """Create a date-specific schedule.

        Args:
            activity_id: Activity UUID.
            location_id: Location UUID.
            start_at_utc: Start datetime in UTC.
            end_at_utc: End datetime in UTC.
            languages: Optional list of language codes.

        Returns:
            The created schedule.
        """
        schedule = ActivitySchedule(
            activity_id=activity_id,
            location_id=location_id,
            schedule_type=ScheduleType.DATE_SPECIFIC,
            start_at_utc=start_at_utc,
            end_at_utc=end_at_utc,
            languages=languages or [],
        )
        return self.create(schedule)

    def update_schedule(
        self,
        schedule: ActivitySchedule,
        day_of_week_utc: Optional[int] = None,
        day_of_month: Optional[int] = None,
        start_minutes_utc: Optional[int] = None,
        end_minutes_utc: Optional[int] = None,
        start_at_utc: Optional[datetime] = None,
        end_at_utc: Optional[datetime] = None,
        languages: Optional[list[str]] = None,
    ) -> ActivitySchedule:
        """Update a schedule.

        Note: Changing schedule_type is not supported; create a new schedule instead.

        Args:
            schedule: The schedule to update.
            day_of_week_utc: New day of week (for weekly).
            day_of_month: New day of month (for monthly).
            start_minutes_utc: New start minutes (for weekly/monthly).
            end_minutes_utc: New end minutes (for weekly/monthly).
            start_at_utc: New start datetime (for date_specific).
            end_at_utc: New end datetime (for date_specific).
            languages: New language list.

        Returns:
            The updated schedule.
        """
        if day_of_week_utc is not None:
            schedule.day_of_week_utc = day_of_week_utc
        if day_of_month is not None:
            schedule.day_of_month = day_of_month
        if start_minutes_utc is not None:
            schedule.start_minutes_utc = start_minutes_utc
        if end_minutes_utc is not None:
            schedule.end_minutes_utc = end_minutes_utc
        if start_at_utc is not None:
            schedule.start_at_utc = start_at_utc
        if end_at_utc is not None:
            schedule.end_at_utc = end_at_utc
        if languages is not None:
            schedule.languages = languages
        return self.update(schedule)
