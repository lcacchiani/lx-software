"""Repository for ActivityPricing entities."""

from __future__ import annotations

from decimal import Decimal
from typing import Optional
from typing import Sequence
from uuid import UUID

from sqlalchemy import and_
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ActivityPricing
from app.db.models import PricingType
from app.db.repositories.base import BaseRepository


class ActivityPricingRepository(BaseRepository[ActivityPricing]):
    """Repository for ActivityPricing CRUD operations."""

    def __init__(self, session: Session):
        """Initialize the repository.

        Args:
            session: SQLAlchemy session for database operations.
        """
        super().__init__(session, ActivityPricing)

    def find_by_activity(
        self,
        activity_id: UUID,
        limit: int = 50,
    ) -> Sequence[ActivityPricing]:
        """Find all pricing for an activity.

        Args:
            activity_id: The activity UUID.
            limit: Maximum results to return.

        Returns:
            Pricing entries for the activity.
        """
        query = (
            select(ActivityPricing)
            .where(ActivityPricing.activity_id == activity_id)
            .order_by(ActivityPricing.id)
            .limit(limit)
        )
        return self._session.execute(query).scalars().all()

    def find_by_activity_and_location(
        self,
        activity_id: UUID,
        location_id: UUID,
    ) -> Optional[ActivityPricing]:
        """Find pricing for a specific activity at a location.

        Args:
            activity_id: The activity UUID.
            location_id: The location UUID.

        Returns:
            The pricing if found, None otherwise.
        """
        query = select(ActivityPricing).where(
            and_(
                ActivityPricing.activity_id == activity_id,
                ActivityPricing.location_id == location_id,
            )
        )
        return self._session.execute(query).scalar_one_or_none()

    def find_by_price_range(
        self,
        min_amount: Optional[Decimal] = None,
        max_amount: Optional[Decimal] = None,
        pricing_type: Optional[PricingType] = None,
        limit: int = 50,
    ) -> Sequence[ActivityPricing]:
        """Find pricing within a price range.

        Args:
            min_amount: Minimum price (inclusive).
            max_amount: Maximum price (inclusive).
            pricing_type: Filter by pricing type.
            limit: Maximum results to return.

        Returns:
            Matching pricing entries.
        """
        query = select(ActivityPricing)
        conditions = []

        if min_amount is not None:
            conditions.append(ActivityPricing.amount >= min_amount)
        if max_amount is not None:
            conditions.append(ActivityPricing.amount <= max_amount)
        if pricing_type is not None:
            conditions.append(ActivityPricing.pricing_type == pricing_type)

        if conditions:
            query = query.where(and_(*conditions))

        query = query.order_by(ActivityPricing.amount).limit(limit)
        return self._session.execute(query).scalars().all()

    def create_pricing(
        self,
        activity_id: UUID,
        location_id: UUID,
        pricing_type: PricingType,
        amount: Decimal,
        currency: str = "HKD",
        sessions_count: Optional[int] = None,
    ) -> ActivityPricing:
        """Create new pricing.

        Args:
            activity_id: Activity UUID.
            location_id: Location UUID.
            pricing_type: Type of pricing.
            amount: Price amount.
            currency: Currency code.
            sessions_count: Number of sessions (for per_sessions type).

        Returns:
            The created pricing.
        """
        pricing = ActivityPricing(
            activity_id=activity_id,
            location_id=location_id,
            pricing_type=pricing_type,
            amount=amount,
            currency=currency,
            sessions_count=sessions_count,
        )
        return self.create(pricing)

    def update_pricing(
        self,
        pricing: ActivityPricing,
        pricing_type: Optional[PricingType] = None,
        amount: Optional[Decimal] = None,
        currency: Optional[str] = None,
        sessions_count: Optional[int] = None,
    ) -> ActivityPricing:
        """Update pricing.

        Args:
            pricing: The pricing to update.
            pricing_type: New pricing type (if provided).
            amount: New amount (if provided).
            currency: New currency (if provided).
            sessions_count: New sessions count (if provided).

        Returns:
            The updated pricing.
        """
        if pricing_type is not None:
            pricing.pricing_type = pricing_type
        if amount is not None:
            pricing.amount = amount
        if currency is not None:
            pricing.currency = currency
        if sessions_count is not None:
            pricing.sessions_count = sessions_count
        return self.update(pricing)
