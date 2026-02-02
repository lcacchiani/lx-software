"""Repository for Organization entities."""

from __future__ import annotations

from typing import Optional
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Organization
from app.db.repositories.base import BaseRepository


class OrganizationRepository(BaseRepository[Organization]):
    """Repository for Organization CRUD operations."""

    def __init__(self, session: Session):
        """Initialize the repository.

        Args:
            session: SQLAlchemy session for database operations.
        """
        super().__init__(session, Organization)

    def find_by_name(self, name: str) -> Optional[Organization]:
        """Find an organization by exact name.

        Args:
            name: The organization name.

        Returns:
            The organization if found, None otherwise.
        """
        query = select(Organization).where(Organization.name == name)
        return self._session.execute(query).scalar_one_or_none()

    def search_by_name(
        self,
        name_pattern: str,
        limit: int = 50,
    ) -> Sequence[Organization]:
        """Search organizations by name pattern (case-insensitive).

        Args:
            name_pattern: Pattern to search for.
            limit: Maximum results to return.

        Returns:
            Matching organizations.
        """
        query = (
            select(Organization)
            .where(Organization.name.ilike(f"%{name_pattern}%"))
            .order_by(Organization.name)
            .limit(limit)
        )
        return self._session.execute(query).scalars().all()

    def create_organization(
        self,
        name: str,
        description: Optional[str] = None,
    ) -> Organization:
        """Create a new organization.

        Args:
            name: Organization name.
            description: Optional description.

        Returns:
            The created organization.
        """
        org = Organization(name=name, description=description)
        return self.create(org)

    def update_organization(
        self,
        organization: Organization,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Organization:
        """Update an organization.

        Args:
            organization: The organization to update.
            name: New name (if provided).
            description: New description (if provided).

        Returns:
            The updated organization.
        """
        if name is not None:
            organization.name = name
        if description is not None:
            organization.description = description
        return self.update(organization)
