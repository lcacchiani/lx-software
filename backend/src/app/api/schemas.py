"""Pydantic schemas for activity search responses."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict


class OrganizationSchema(BaseModel):
    """Organization schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: Optional[str]


class LocationSchema(BaseModel):
    """Location schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    district: str
    address: Optional[str]
    lat: Optional[Decimal]
    lng: Optional[Decimal]


class ActivitySchema(BaseModel):
    """Activity schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: Optional[str]
    age_min: Optional[int]
    age_max: Optional[int]


class PricingSchema(BaseModel):
    """Pricing schema."""

    model_config = ConfigDict(from_attributes=True)

    pricing_type: str
    amount: Decimal
    currency: str
    sessions_count: Optional[int]


class ScheduleSchema(BaseModel):
    """Schedule schema."""

    model_config = ConfigDict(from_attributes=True)

    schedule_type: str
    day_of_week_utc: Optional[int]
    day_of_month: Optional[int]
    start_minutes_utc: Optional[int]
    end_minutes_utc: Optional[int]
    start_at_utc: Optional[datetime]
    end_at_utc: Optional[datetime]
    languages: List[str]


class ActivitySearchResultSchema(BaseModel):
    """Activity search result schema."""

    model_config = ConfigDict(from_attributes=True)

    activity: ActivitySchema
    organization: OrganizationSchema
    location: LocationSchema
    pricing: PricingSchema
    schedule: ScheduleSchema


class ActivitySearchResponseSchema(BaseModel):
    """Activity search response schema."""

    model_config = ConfigDict(from_attributes=True)

    items: List[ActivitySearchResultSchema]
    next_cursor: Optional[str] = None
