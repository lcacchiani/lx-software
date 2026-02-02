"""Repository for Location entities."""

from __future__ import annotations

from decimal import Decimal
from typing import Optional
from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Location
from app.db.repositories.base import BaseRepository


class LocationRepository(BaseRepository[Location]):
    """Repository for Location CRUD operations."""

    def __init__(self, session: Session):
        """Initialize the repository.

        Args:
            session: SQLAlchemy session for database operations.
        """
        super().__init__(session, Location)

    def find_by_organization(
        self,
        org_id: UUID,
        limit: int = 50,
        cursor: Optional[UUID] = None,
    ) -> Sequence[Location]:
        """Find all locations for an organization.

        Args:
            org_id: The organization UUID.
            limit: Maximum results to return.
            cursor: Pagination cursor.

        Returns:
            Locations belonging to the organization.
        """
        query = select(Location).where(Location.org_id == org_id).order_by(Location.id)
        if cursor is not None:
            query = query.where(Location.id > cursor)
        return self._session.execute(query.limit(limit)).scalars().all()

    def find_by_district(
        self,
        district: str,
        limit: int = 50,
    ) -> Sequence[Location]:
        """Find locations by district.

        Args:
            district: The district name.
            limit: Maximum results to return.

        Returns:
            Locations in the specified district.
        """
        query = (
            select(Location)
            .where(Location.district == district)
            .order_by(Location.id)
            .limit(limit)
        )
        return self._session.execute(query).scalars().all()

    def get_distinct_districts(self) -> Sequence[str]:
        """Get all distinct district names.

        Returns:
            List of unique district names.
        """
        query = select(Location.district).distinct().order_by(Location.district)
        return self._session.execute(query).scalars().all()

    def create_location(
        self,
        org_id: UUID,
        district: str,
        address: Optional[str] = None,
        lat: Optional[Decimal] = None,
        lng: Optional[Decimal] = None,
    ) -> Location:
        """Create a new location.

        Args:
            org_id: Organization UUID.
            district: District name.
            address: Optional address.
            lat: Optional latitude.
            lng: Optional longitude.

        Returns:
            The created location.
        """
        location = Location(
            org_id=org_id,
            district=district,
            address=address,
            lat=lat,
            lng=lng,
        )
        return self.create(location)

    def update_location(
        self,
        location: Location,
        district: Optional[str] = None,
        address: Optional[str] = None,
        lat: Optional[Decimal] = None,
        lng: Optional[Decimal] = None,
    ) -> Location:
        """Update a location.

        Args:
            location: The location to update.
            district: New district (if provided).
            address: New address (if provided).
            lat: New latitude (if provided).
            lng: New longitude (if provided).

        Returns:
            The updated location.
        """
        if district is not None:
            location.district = district
        if address is not None:
            location.address = address
        if lat is not None:
            location.lat = lat
        if lng is not None:
            location.lng = lng
        return self.update(location)
