"""Repository for Activity entities."""

from __future__ import annotations

from typing import Any
from typing import Optional
from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Activity
from app.db.repositories.base import BaseRepository


class ActivityRepository(BaseRepository[Activity]):
    """Repository for Activity CRUD operations."""

    def __init__(self, session: Session):
        """Initialize the repository.

        Args:
            session: SQLAlchemy session for database operations.
        """
        super().__init__(session, Activity)

    def find_by_organization(
        self,
        org_id: UUID,
        limit: int = 50,
        cursor: Optional[UUID] = None,
    ) -> Sequence[Activity]:
        """Find all activities for an organization.

        Args:
            org_id: The organization UUID.
            limit: Maximum results to return.
            cursor: Pagination cursor.

        Returns:
            Activities belonging to the organization.
        """
        query = select(Activity).where(Activity.org_id == org_id).order_by(Activity.id)
        if cursor is not None:
            query = query.where(Activity.id > cursor)
        return self._session.execute(query.limit(limit)).scalars().all()

    def find_by_age(
        self,
        age: int,
        limit: int = 50,
    ) -> Sequence[Activity]:
        """Find activities suitable for a given age.

        Args:
            age: The age to filter by.
            limit: Maximum results to return.

        Returns:
            Activities where age falls within the age_range.
        """
        query = (
            select(Activity)
            .where(Activity.age_range.contains(age))
            .order_by(Activity.name)
            .limit(limit)
        )
        return self._session.execute(query).scalars().all()

    def search_by_name(
        self,
        name_pattern: str,
        limit: int = 50,
    ) -> Sequence[Activity]:
        """Search activities by name pattern (case-insensitive).

        Args:
            name_pattern: Pattern to search for.
            limit: Maximum results to return.

        Returns:
            Matching activities.
        """
        query = (
            select(Activity)
            .where(Activity.name.ilike(f"%{name_pattern}%"))
            .order_by(Activity.name)
            .limit(limit)
        )
        return self._session.execute(query).scalars().all()

    def create_activity(
        self,
        org_id: UUID,
        name: str,
        age_range: Any,
        description: Optional[str] = None,
    ) -> Activity:
        """Create a new activity.

        Args:
            org_id: Organization UUID.
            name: Activity name.
            age_range: PostgreSQL int4range for age limits.
            description: Optional description.

        Returns:
            The created activity.
        """
        activity = Activity(
            org_id=org_id,
            name=name,
            age_range=age_range,
            description=description,
        )
        return self.create(activity)

    def update_activity(
        self,
        activity: Activity,
        name: Optional[str] = None,
        description: Optional[str] = None,
        age_range: Optional[Any] = None,
    ) -> Activity:
        """Update an activity.

        Args:
            activity: The activity to update.
            name: New name (if provided).
            description: New description (if provided).
            age_range: New age range (if provided).

        Returns:
            The updated activity.
        """
        if name is not None:
            activity.name = name
        if description is not None:
            activity.description = description
        if age_range is not None:
            activity.age_range = age_range
        return self.update(activity)
