"""Base repository with common CRUD operations.

This module provides a generic base repository that can be extended
for specific entity types.
"""

from __future__ import annotations

from typing import Generic
from typing import Optional
from typing import Sequence
from typing import Type
from typing import TypeVar
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import Base

T = TypeVar("T", bound=Base)


class BaseRepository(Generic[T]):
    """Base repository with common CRUD operations.

    Provides standard database operations that can be inherited
    by entity-specific repositories.

    Type Parameters:
        T: The SQLAlchemy model type this repository manages.
    """

    def __init__(self, session: Session, model: Type[T]):
        """Initialize the repository.

        Args:
            session: SQLAlchemy session for database operations.
            model: The SQLAlchemy model class.
        """
        self._session = session
        self._model = model

    @property
    def session(self) -> Session:
        """Get the current session."""
        return self._session

    def get_by_id(self, entity_id: UUID) -> Optional[T]:
        """Get an entity by its primary key.

        Args:
            entity_id: The UUID primary key.

        Returns:
            The entity if found, None otherwise.
        """
        return self._session.get(self._model, entity_id)

    def get_all(
        self,
        limit: int = 50,
        cursor: Optional[UUID] = None,
    ) -> Sequence[T]:
        """Get all entities with cursor pagination.

        Args:
            limit: Maximum number of entities to return.
            cursor: UUID of the last entity from the previous page.

        Returns:
            Sequence of entities.
        """
        query = select(self._model).order_by(self._model.id)
        if cursor is not None:
            query = query.where(self._model.id > cursor)
        return self._session.execute(query.limit(limit)).scalars().all()

    def exists(self, entity_id: UUID) -> bool:
        """Check if an entity exists.

        Args:
            entity_id: The UUID primary key.

        Returns:
            True if the entity exists.
        """
        return self.get_by_id(entity_id) is not None

    def create(self, entity: T) -> T:
        """Create a new entity.

        Args:
            entity: The entity to create.

        Returns:
            The created entity with generated fields populated.
        """
        self._session.add(entity)
        self._session.flush()
        self._session.refresh(entity)
        return entity

    def update(self, entity: T) -> T:
        """Update an existing entity.

        Args:
            entity: The entity to update.

        Returns:
            The updated entity.
        """
        self._session.add(entity)
        self._session.flush()
        self._session.refresh(entity)
        return entity

    def delete(self, entity: T) -> None:
        """Delete an entity.

        Args:
            entity: The entity to delete.
        """
        self._session.delete(entity)
        self._session.flush()

    def delete_by_id(self, entity_id: UUID) -> bool:
        """Delete an entity by its primary key.

        Args:
            entity_id: The UUID primary key.

        Returns:
            True if the entity was deleted, False if not found.
        """
        entity = self.get_by_id(entity_id)
        if entity is None:
            return False
        self.delete(entity)
        return True

    def count(self) -> int:
        """Count total entities.

        Returns:
            Total number of entities.
        """
        from sqlalchemy import func

        result = self._session.execute(select(func.count()).select_from(self._model))
        return result.scalar() or 0
