"""SQLAlchemy models for activities data."""

from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal
from typing import List
from typing import Optional

import sqlalchemy as sa
from sqlalchemy import CheckConstraint
from sqlalchemy import ForeignKey
from sqlalchemy import Numeric
from sqlalchemy import Integer
from sqlalchemy import SmallInteger
from sqlalchemy import Text
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import INT4RANGE
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base


class PricingType(str, enum.Enum):
    """Supported pricing types for activities."""

    PER_CLASS = "per_class"
    PER_MONTH = "per_month"
    PER_SESSIONS = "per_sessions"


class ScheduleType(str, enum.Enum):
    """Supported schedule types for activities."""

    WEEKLY = "weekly"
    MONTHLY = "monthly"
    DATE_SPECIFIC = "date_specific"


class Organization(Base):
    """Organization that provides activities."""

    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    locations: Mapped[List["Location"]] = relationship(
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    activities: Mapped[List["Activity"]] = relationship(
        back_populates="organization",
        cascade="all, delete-orphan",
    )


class Location(Base):
    """Location for an organization."""

    __tablename__ = "locations"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    org_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    district: Mapped[str] = mapped_column(Text(), nullable=False)
    address: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(9, 6), nullable=True)
    lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(9, 6), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    organization: Mapped["Organization"] = relationship(back_populates="locations")
    activity_pricing: Mapped[List["ActivityPricing"]] = relationship(
        back_populates="location",
        cascade="all, delete-orphan",
    )
    activity_schedules: Mapped[List["ActivitySchedule"]] = relationship(
        back_populates="location",
        cascade="all, delete-orphan",
    )


class Activity(Base):
    """Activity offered by an organization."""

    __tablename__ = "activities"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    org_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    age_range: Mapped[object] = mapped_column(INT4RANGE(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    organization: Mapped["Organization"] = relationship(back_populates="activities")
    locations: Mapped[List["ActivityLocation"]] = relationship(
        back_populates="activity",
        cascade="all, delete-orphan",
    )
    pricing: Mapped[List["ActivityPricing"]] = relationship(
        back_populates="activity",
        cascade="all, delete-orphan",
    )
    schedules: Mapped[List["ActivitySchedule"]] = relationship(
        back_populates="activity",
        cascade="all, delete-orphan",
    )


class ActivityLocation(Base):
    """Association between activities and locations."""

    __tablename__ = "activity_locations"

    activity_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="CASCADE"),
        primary_key=True,
    )
    location_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id", ondelete="CASCADE"),
        primary_key=True,
    )

    activity: Mapped["Activity"] = relationship(back_populates="locations")
    location: Mapped["Location"] = relationship()


class ActivityPricing(Base):
    """Pricing for an activity at a specific location."""

    __tablename__ = "activity_pricing"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    activity_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="CASCADE"),
        nullable=False,
    )
    location_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id", ondelete="CASCADE"),
        nullable=False,
    )
    pricing_type: Mapped[PricingType] = mapped_column(
        sa.Enum(PricingType, name="pricing_type"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(Text(), nullable=False, server_default="HKD")
    sessions_count: Mapped[Optional[int]] = mapped_column(Integer(), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "(pricing_type <> 'per_sessions') OR "
            "(sessions_count IS NOT NULL AND sessions_count > 0)",
            name="pricing_sessions_count_check",
        ),
    )

    activity: Mapped["Activity"] = relationship(back_populates="pricing")
    location: Mapped["Location"] = relationship(back_populates="activity_pricing")


class ActivitySchedule(Base):
    """Schedule entry for an activity at a location."""

    __tablename__ = "activity_schedule"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    activity_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="CASCADE"),
        nullable=False,
    )
    location_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id", ondelete="CASCADE"),
        nullable=False,
    )
    schedule_type: Mapped[ScheduleType] = mapped_column(
        sa.Enum(ScheduleType, name="schedule_type"),
        nullable=False,
    )
    day_of_week_utc: Mapped[Optional[int]] = mapped_column(
        SmallInteger(), nullable=True
    )
    day_of_month: Mapped[Optional[int]] = mapped_column(SmallInteger(), nullable=True)
    start_minutes_utc: Mapped[Optional[int]] = mapped_column(Integer(), nullable=True)
    end_minutes_utc: Mapped[Optional[int]] = mapped_column(Integer(), nullable=True)
    start_at_utc: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    end_at_utc: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    languages: Mapped[List[str]] = mapped_column(
        ARRAY(Text()),
        nullable=False,
        server_default=text("'{}'::text[]"),
    )

    __table_args__ = (
        CheckConstraint(
            "day_of_week_utc BETWEEN 0 AND 6", name="schedule_day_of_week_range"
        ),
        CheckConstraint(
            "day_of_month BETWEEN 1 AND 31", name="schedule_day_of_month_range"
        ),
        CheckConstraint(
            "start_minutes_utc BETWEEN 0 AND 1439", name="schedule_start_minutes_range"
        ),
        CheckConstraint(
            "end_minutes_utc BETWEEN 0 AND 1439", name="schedule_end_minutes_range"
        ),
        CheckConstraint(
            "start_minutes_utc IS NULL OR end_minutes_utc IS NULL OR "
            "start_minutes_utc < end_minutes_utc",
            name="schedule_minutes_order",
        ),
        CheckConstraint(
            "start_at_utc IS NULL OR end_at_utc IS NULL OR start_at_utc < end_at_utc",
            name="schedule_date_order",
        ),
        CheckConstraint(
            "("
            "schedule_type = 'weekly' AND "
            "day_of_week_utc IS NOT NULL AND "
            "start_minutes_utc IS NOT NULL AND "
            "end_minutes_utc IS NOT NULL AND "
            "day_of_month IS NULL AND "
            "start_at_utc IS NULL AND "
            "end_at_utc IS NULL"
            ") OR ("
            "schedule_type = 'monthly' AND "
            "day_of_month IS NOT NULL AND "
            "start_minutes_utc IS NOT NULL AND "
            "end_minutes_utc IS NOT NULL AND "
            "day_of_week_utc IS NULL AND "
            "start_at_utc IS NULL AND "
            "end_at_utc IS NULL"
            ") OR ("
            "schedule_type = 'date_specific' AND "
            "start_at_utc IS NOT NULL AND "
            "end_at_utc IS NOT NULL AND "
            "day_of_week_utc IS NULL AND "
            "day_of_month IS NULL AND "
            "start_minutes_utc IS NULL AND "
            "end_minutes_utc IS NULL"
            ")",
            name="schedule_type_fields_check",
        ),
    )

    activity: Mapped["Activity"] = relationship(back_populates="schedules")
    location: Mapped["Location"] = relationship(back_populates="activity_schedules")
