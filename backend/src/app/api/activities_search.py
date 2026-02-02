"""Lambda handler for activity search.

This module provides the public activity search API endpoint,
using shared utilities and centralized database management.
"""

from __future__ import annotations

import base64
import json
from dataclasses import replace
from typing import Any
from typing import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.schemas import ActivitySchema
from app.api.schemas import ActivitySearchResponseSchema
from app.api.schemas import ActivitySearchResultSchema
from app.api.schemas import LocationSchema
from app.api.schemas import OrganizationSchema
from app.api.schemas import PricingSchema
from app.api.schemas import ScheduleSchema
from app.db.engine import get_engine
from app.db.models import Activity
from app.db.models import ActivityPricing
from app.db.models import ActivitySchedule
from app.db.models import Location
from app.db.models import Organization
from app.db.models import PricingType
from app.db.models import ScheduleType
from app.db.queries import ActivitySearchCursor
from app.db.queries import ActivitySearchFilters
from app.db.queries import build_activity_search_query
from app.exceptions import CursorError, ValidationError
from app.utils import (
    json_response,
    parse_datetime,
    parse_decimal,
    parse_enum,
    parse_int,
)
from app.utils.logging import configure_logging, get_logger, set_request_context
from app.utils.parsers import collect_query_params, first_param, parse_languages

# Configure logging on module load
configure_logging()
logger = get_logger(__name__)


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Handle API Gateway request for activity search."""

    # Set request context for logging
    request_id = event.get("requestContext", {}).get("requestId", "")
    set_request_context(req_id=request_id)

    try:
        filters = parse_filters(event)
        logger.debug("Search filters parsed", extra={"filters": str(filters)})
        response = fetch_activity_search_response(filters)
        logger.info(
            f"Search completed: {len(response.items)} results",
            extra={
                "count": len(response.items),
                "has_more": response.next_cursor is not None,
            },
        )
        return _create_response(200, response)
    except (ValidationError, CursorError) as exc:
        logger.warning(f"Validation error: {exc.message}")
        return json_response(exc.status_code, exc.to_dict())
    except ValueError as exc:
        logger.warning(f"Value error: {exc}")
        return json_response(400, {"error": str(exc)})
    except Exception as exc:  # pragma: no cover - safety net
        logger.exception("Unexpected error in activity search")
        return json_response(
            500, {"error": "Internal server error", "detail": str(exc)}
        )


def parse_filters(event: Mapping[str, Any]) -> ActivitySearchFilters:
    """Parse query parameters into activity search filters."""

    params = collect_query_params(event)

    return ActivitySearchFilters(
        age=parse_int(first_param(params, "age")),
        district=first_param(params, "district"),
        pricing_type=parse_enum(first_param(params, "pricing_type"), PricingType),
        price_min=parse_decimal(first_param(params, "price_min")),
        price_max=parse_decimal(first_param(params, "price_max")),
        schedule_type=parse_enum(first_param(params, "schedule_type"), ScheduleType),
        day_of_week_utc=parse_int(first_param(params, "day_of_week_utc")),
        day_of_month=parse_int(first_param(params, "day_of_month")),
        start_minutes_utc=parse_int(first_param(params, "start_minutes_utc")),
        end_minutes_utc=parse_int(first_param(params, "end_minutes_utc")),
        start_at_utc=parse_datetime(first_param(params, "start_at_utc")),
        end_at_utc=parse_datetime(first_param(params, "end_at_utc")),
        languages=parse_languages(params.get("language", [])),
        cursor=_parse_cursor(first_param(params, "cursor")),
        limit=parse_int(first_param(params, "limit")) or 50,
    )


def fetch_activity_search_response(
    filters: ActivitySearchFilters,
) -> ActivitySearchResponseSchema:
    """Fetch activity search response from the database."""

    engine = get_engine()
    requested_limit = filters.limit
    query_filters = replace(filters, limit=requested_limit + 1)
    query = build_activity_search_query(query_filters)

    with Session(engine) as session:
        rows = session.execute(query).all()

    has_more = len(rows) > requested_limit
    trimmed_rows = rows[:requested_limit]
    items = [map_row_to_result(row) for row in trimmed_rows]
    next_cursor = None
    if has_more and trimmed_rows:
        schedule = trimmed_rows[-1]._mapping[ActivitySchedule]
        next_cursor = _encode_cursor(schedule)
    return ActivitySearchResponseSchema(items=items, next_cursor=next_cursor)


def map_row_to_result(row: Any) -> ActivitySearchResultSchema:
    """Map a SQLAlchemy row to a search result schema."""

    mapping = row._mapping
    activity: Activity = mapping[Activity]
    organization: Organization = mapping[Organization]
    location: Location = mapping[Location]
    pricing: ActivityPricing = mapping[ActivityPricing]
    schedule: ActivitySchedule = mapping[ActivitySchedule]

    age_min, age_max = _extract_age_bounds(activity.age_range)

    return ActivitySearchResultSchema(
        activity=ActivitySchema(
            id=str(activity.id),
            name=activity.name,
            description=activity.description,
            age_min=age_min,
            age_max=age_max,
        ),
        organization=OrganizationSchema(
            id=str(organization.id),
            name=organization.name,
            description=organization.description,
        ),
        location=LocationSchema(
            id=str(location.id),
            district=location.district,
            address=location.address,
            lat=location.lat,
            lng=location.lng,
        ),
        pricing=PricingSchema(
            pricing_type=pricing.pricing_type.value,
            amount=pricing.amount,
            currency=pricing.currency,
            sessions_count=pricing.sessions_count,
        ),
        schedule=ScheduleSchema(
            schedule_type=schedule.schedule_type.value,
            day_of_week_utc=schedule.day_of_week_utc,
            day_of_month=schedule.day_of_month,
            start_minutes_utc=schedule.start_minutes_utc,
            end_minutes_utc=schedule.end_minutes_utc,
            start_at_utc=schedule.start_at_utc,
            end_at_utc=schedule.end_at_utc,
            languages=schedule.languages or [],
        ),
    )


def _extract_age_bounds(age_range: Any) -> tuple[int | None, int | None]:
    """Extract age range bounds from a database range value."""

    lower = getattr(age_range, "lower", None)
    upper = getattr(age_range, "upper", None)
    if lower is not None or upper is not None:
        return lower, upper

    if isinstance(age_range, str):
        cleaned = age_range.strip("[]()")
        parts = cleaned.split(",")
        if len(parts) == 2:
            try:
                return int(parts[0]), int(parts[1])
            except ValueError:
                return None, None
    return None, None


def _create_response(
    status_code: int, body: ActivitySearchResponseSchema
) -> dict[str, Any]:
    """Create a JSON API Gateway response for Pydantic models."""

    payload = body.model_dump() if hasattr(body, "model_dump") else body.dict()

    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload, default=str),
    }


# --- Cursor encoding/decoding ---


def _parse_cursor(value: str | None) -> ActivitySearchCursor | None:
    """Parse a pagination cursor."""

    if value is None or value == "":
        return None
    try:
        payload = _decode_cursor(value)
        return ActivitySearchCursor(
            schedule_type=ScheduleType(payload["schedule_type"]),
            day_of_week_utc=payload.get("day_of_week_utc"),
            day_of_month=payload.get("day_of_month"),
            start_at_utc=parse_datetime(payload.get("start_at_utc")),
            start_minutes_utc=payload.get("start_minutes_utc"),
            schedule_id=UUID(payload["schedule_id"]),
        )
    except (ValueError, KeyError, TypeError) as exc:
        raise CursorError("Malformed cursor payload") from exc


def _encode_cursor(schedule: ActivitySchedule) -> str:
    """Encode a pagination cursor."""

    payload = json.dumps(
        {
            "schedule_id": str(schedule.id),
            "schedule_type": schedule.schedule_type.value,
            "day_of_week_utc": schedule.day_of_week_utc,
            "day_of_month": schedule.day_of_month,
            "start_at_utc": schedule.start_at_utc.isoformat()
            if schedule.start_at_utc
            else None,
            "start_minutes_utc": schedule.start_minutes_utc,
        }
    ).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("utf-8")
    return encoded.rstrip("=")


def _decode_cursor(cursor: str) -> dict[str, Any]:
    """Decode a pagination cursor."""

    padding = "=" * (-len(cursor) % 4)
    raw = base64.urlsafe_b64decode(cursor + padding)
    return json.loads(raw)
