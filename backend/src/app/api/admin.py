"""Admin CRUD API handlers.

This module provides admin CRUD operations using the repository pattern
for cleaner separation of concerns and better testability.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from typing import Callable
from typing import Mapping
from typing import Optional
from typing import Protocol
from typing import Sequence
from typing import Tuple
from typing import Type
from uuid import UUID

import boto3
from psycopg.types.range import Range
from sqlalchemy.orm import Session

from app.db.engine import get_engine
from app.db.models import Activity
from app.db.models import ActivityPricing
from app.db.models import ActivitySchedule
from app.db.models import Location
from app.db.models import Organization
from app.db.models import PricingType
from app.db.models import ScheduleType
from app.db.repositories import (
    ActivityPricingRepository,
    ActivityRepository,
    ActivityScheduleRepository,
    LocationRepository,
    OrganizationRepository,
)
from app.exceptions import NotFoundError, ValidationError
from app.utils import json_response, parse_datetime, parse_int
from app.utils.logging import configure_logging, get_logger, set_request_context


class RepositoryProtocol(Protocol):
    """Protocol for repository classes used in ResourceConfig."""

    def __init__(self, session: Session) -> None: ...

    def get_by_id(self, entity_id: UUID) -> Any: ...

    def get_all(
        self, limit: int = 50, cursor: Optional[UUID] = None
    ) -> Sequence[Any]: ...

    def create(self, entity: Any) -> Any: ...

    def update(self, entity: Any) -> Any: ...

    def delete(self, entity: Any) -> None: ...


# Configure logging on module load
configure_logging()
logger = get_logger(__name__)


@dataclass(frozen=True)
class ResourceConfig:
    """Configuration for admin resources."""

    name: str
    model: Type[Any]
    repository_class: Type[RepositoryProtocol]
    serializer: Callable[[Any], dict[str, Any]]
    create_handler: Callable[..., Any]
    update_handler: Callable[..., Any]


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Handle admin CRUD requests."""

    # Set request context for logging
    request_id = event.get("requestContext", {}).get("requestId", "")
    set_request_context(req_id=request_id)

    if not _is_admin(event):
        logger.warning("Unauthorized admin access attempt")
        return json_response(403, {"error": "Forbidden"})

    method = event.get("httpMethod", "")
    path = event.get("path", "")
    resource, resource_id, sub_resource = _parse_path(path)

    logger.info(
        f"Admin request: {method} {path}",
        extra={"resource": resource, "resource_id": resource_id},
    )

    if resource == "users" and sub_resource == "groups":
        return _handle_user_group(event, method, resource_id)

    config = _RESOURCE_CONFIG.get(resource)
    if not config:
        return json_response(404, {"error": "Not found"})

    try:
        if method == "GET":
            return _handle_get(event, config, resource_id)
        if method == "POST":
            return _handle_post(event, config)
        if method == "PUT":
            return _handle_put(event, config, resource_id)
        if method == "DELETE":
            return _handle_delete(event, config, resource_id)
        return json_response(405, {"error": "Method not allowed"})
    except ValidationError as exc:
        logger.warning(f"Validation error: {exc.message}")
        return json_response(exc.status_code, exc.to_dict())
    except NotFoundError as exc:
        return json_response(exc.status_code, exc.to_dict())
    except ValueError as exc:
        logger.warning(f"Value error: {exc}")
        return json_response(400, {"error": str(exc)})
    except Exception as exc:  # pragma: no cover
        logger.exception("Unexpected error in admin handler")
        return json_response(
            500, {"error": "Internal server error", "detail": str(exc)}
        )


def _handle_get(
    event: Mapping[str, Any],
    config: ResourceConfig,
    resource_id: Optional[str],
) -> dict[str, Any]:
    """Handle GET requests for admin resources using repository."""

    limit = parse_int(_query_param(event, "limit")) or 50
    if limit < 1 or limit > 200:
        raise ValidationError("limit must be between 1 and 200", field="limit")

    with Session(get_engine()) as session:
        repo = config.repository_class(session)

        if resource_id:
            entity = repo.get_by_id(_parse_uuid(resource_id))
            if entity is None:
                raise NotFoundError(config.name, resource_id)
            return json_response(200, config.serializer(entity))

        cursor = _parse_cursor(_query_param(event, "cursor"))
        rows = repo.get_all(limit=limit + 1, cursor=cursor)
        has_more = len(rows) > limit
        trimmed = list(rows)[:limit]
        next_cursor = _encode_cursor(trimmed[-1].id) if has_more and trimmed else None

        return json_response(
            200,
            {
                "items": [config.serializer(row) for row in trimmed],
                "next_cursor": next_cursor,
            },
        )


def _handle_post(event: Mapping[str, Any], config: ResourceConfig) -> dict[str, Any]:
    """Handle POST requests for admin resources using repository."""

    body = _parse_body(event)
    with Session(get_engine()) as session:
        repo = config.repository_class(session)
        entity = config.create_handler(repo, body)
        repo.create(entity)
        session.commit()
        session.refresh(entity)
        logger.info(f"Created {config.name}: {entity.id}")
        return json_response(201, config.serializer(entity))


def _handle_put(
    event: Mapping[str, Any],
    config: ResourceConfig,
    resource_id: Optional[str],
) -> dict[str, Any]:
    """Handle PUT requests for admin resources using repository."""

    if not resource_id:
        raise ValidationError("Resource id is required", field="id")

    body = _parse_body(event)
    with Session(get_engine()) as session:
        repo = config.repository_class(session)
        entity = repo.get_by_id(_parse_uuid(resource_id))
        if entity is None:
            raise NotFoundError(config.name, resource_id)
        updated = config.update_handler(repo, entity, body)
        repo.update(updated)
        session.commit()
        session.refresh(updated)
        logger.info(f"Updated {config.name}: {resource_id}")
        return json_response(200, config.serializer(updated))


def _handle_delete(
    event: Mapping[str, Any],
    config: ResourceConfig,
    resource_id: Optional[str],
) -> dict[str, Any]:
    """Handle DELETE requests for admin resources using repository."""

    if not resource_id:
        raise ValidationError("Resource id is required", field="id")

    with Session(get_engine()) as session:
        repo = config.repository_class(session)
        entity = repo.get_by_id(_parse_uuid(resource_id))
        if entity is None:
            raise NotFoundError(config.name, resource_id)
        repo.delete(entity)
        session.commit()
        logger.info(f"Deleted {config.name}: {resource_id}")
        return json_response(204, {})


# --- Request parsing helpers ---


def _parse_body(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse JSON request body."""

    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    if not raw:
        raise ValidationError("Request body is required")
    return json.loads(raw)


def _parse_path(path: str) -> Tuple[str, Optional[str], Optional[str]]:
    """Parse resource name and id from the request path."""

    parts = [segment for segment in path.split("/") if segment]
    parts = _strip_version_prefix(parts)
    if len(parts) < 2 or parts[0] != "admin":
        return "", None, None
    resource = parts[1]
    resource_id = parts[2] if len(parts) > 2 else None
    sub_resource = parts[3] if len(parts) > 3 else None
    return resource, resource_id, sub_resource


def _strip_version_prefix(parts: list[str]) -> list[str]:
    """Drop an optional version prefix from path segments."""

    if parts and _is_version_segment(parts[0]):
        return parts[1:]
    return parts


def _is_version_segment(segment: str) -> bool:
    """Return True if the path segment matches v{number}."""

    return segment.startswith("v") and segment[1:].isdigit()


def _query_param(event: Mapping[str, Any], name: str) -> Optional[str]:
    """Return a query parameter value."""

    params = event.get("queryStringParameters") or {}
    return params.get(name)


def _parse_uuid(value: str) -> UUID:
    """Parse a UUID string."""

    try:
        return UUID(value)
    except (ValueError, TypeError) as e:
        raise ValidationError(f"Invalid UUID: {value}", field="id") from e


# --- Authorization ---


def _is_admin(event: Mapping[str, Any]) -> bool:
    """Return True when request belongs to an admin user."""

    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    groups = claims.get("cognito:groups", "")
    admin_group = os.getenv("ADMIN_GROUP", "admin")
    return admin_group in groups.split(",") if groups else False


# --- User group management ---


def _handle_user_group(
    event: Mapping[str, Any],
    method: str,
    username: Optional[str],
) -> dict[str, Any]:
    """Handle user group assignment."""

    if not username:
        raise ValidationError("username is required", field="username")

    group_name = _parse_group_name(event)
    client = boto3.client("cognito-idp")
    user_pool_id = _require_env("COGNITO_USER_POOL_ID")

    if method == "POST":
        client.admin_add_user_to_group(
            UserPoolId=user_pool_id,
            Username=username,
            GroupName=group_name,
        )
        logger.info(f"Added user {username} to group {group_name}")
        return json_response(200, {"status": "added", "group": group_name})

    if method == "DELETE":
        client.admin_remove_user_from_group(
            UserPoolId=user_pool_id,
            Username=username,
            GroupName=group_name,
        )
        logger.info(f"Removed user {username} from group {group_name}")
        return json_response(200, {"status": "removed", "group": group_name})

    return json_response(405, {"error": "Method not allowed"})


def _parse_group_name(event: Mapping[str, Any]) -> str:
    """Parse the group name from the request."""

    raw = event.get("body") or ""
    if not raw:
        return os.getenv("ADMIN_GROUP") or "admin"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        body = {}
    group = body.get("group") if isinstance(body, dict) else None
    return group or os.getenv("ADMIN_GROUP") or "admin"


def _require_env(name: str) -> str:
    """Return a required environment variable value."""

    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


# --- Cursor encoding/decoding ---


def _parse_cursor(value: Optional[str]) -> Optional[UUID]:
    """Parse cursor for admin listing."""

    if value is None or value == "":
        return None
    try:
        payload = _decode_cursor(value)
        return UUID(payload["id"])
    except (ValueError, KeyError, TypeError) as exc:
        raise ValidationError("Invalid cursor", field="cursor") from exc


def _encode_cursor(value: Any) -> str:
    """Encode admin cursor."""

    payload = json.dumps({"id": str(value)}).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("utf-8")
    return encoded.rstrip("=")


def _decode_cursor(cursor: str) -> dict[str, Any]:
    """Decode admin cursor."""

    padding = "=" * (-len(cursor) % 4)
    raw = base64.urlsafe_b64decode(cursor + padding)
    return json.loads(raw)


# --- Entity creation handlers (using repositories) ---


def _create_organization(
    repo: OrganizationRepository, body: dict[str, Any]
) -> Organization:
    """Create an organization."""

    name = body.get("name")
    if not name:
        raise ValidationError("name is required", field="name")
    return Organization(name=name, description=body.get("description"))


def _update_organization(
    repo: OrganizationRepository,
    entity: Organization,
    body: dict[str, Any],
) -> Organization:
    """Update an organization."""

    if "name" in body:
        entity.name = body["name"]
    if "description" in body:
        entity.description = body["description"]
    return entity


def _serialize_organization(entity: Organization) -> dict[str, Any]:
    """Serialize an organization."""

    return {
        "id": str(entity.id),
        "name": entity.name,
        "description": entity.description,
        "created_at": entity.created_at,
        "updated_at": entity.updated_at,
    }


def _create_location(repo: LocationRepository, body: dict[str, Any]) -> Location:
    """Create a location."""

    org_id = body.get("org_id")
    district = body.get("district")
    if not org_id or not district:
        raise ValidationError("org_id and district are required")
    return Location(
        org_id=_parse_uuid(org_id),
        district=district,
        address=body.get("address"),
        lat=body.get("lat"),
        lng=body.get("lng"),
    )


def _update_location(
    repo: LocationRepository,
    entity: Location,
    body: dict[str, Any],
) -> Location:
    """Update a location."""

    if "district" in body:
        entity.district = body["district"]
    if "address" in body:
        entity.address = body["address"]
    if "lat" in body:
        entity.lat = body["lat"]
    if "lng" in body:
        entity.lng = body["lng"]
    return entity


def _serialize_location(entity: Location) -> dict[str, Any]:
    """Serialize a location."""

    return {
        "id": str(entity.id),
        "org_id": str(entity.org_id),
        "district": entity.district,
        "address": entity.address,
        "lat": entity.lat,
        "lng": entity.lng,
        "created_at": entity.created_at,
        "updated_at": entity.updated_at,
    }


def _create_activity(repo: ActivityRepository, body: dict[str, Any]) -> Activity:
    """Create an activity."""

    org_id = body.get("org_id")
    name = body.get("name")
    age_min = body.get("age_min")
    age_max = body.get("age_max")
    if not org_id or not name or age_min is None or age_max is None:
        raise ValidationError("org_id, name, age_min, and age_max are required")
    if int(age_min) >= int(age_max):
        raise ValidationError("age_min must be less than age_max")
    age_range = Range(int(age_min), int(age_max), bounds="[]")
    return Activity(
        org_id=_parse_uuid(org_id),
        name=name,
        description=body.get("description"),
        age_range=age_range,
    )


def _update_activity(
    repo: ActivityRepository,
    entity: Activity,
    body: dict[str, Any],
) -> Activity:
    """Update an activity."""

    if "name" in body:
        entity.name = body["name"]
    if "description" in body:
        entity.description = body["description"]
    if "age_min" in body or "age_max" in body:
        age_min = body.get("age_min")
        age_max = body.get("age_max")
        if age_min is None or age_max is None:
            raise ValidationError("age_min and age_max are required together")
        if int(age_min) >= int(age_max):
            raise ValidationError("age_min must be less than age_max")
        entity.age_range = Range(int(age_min), int(age_max), bounds="[]")
    return entity


def _serialize_activity(entity: Activity) -> dict[str, Any]:
    """Serialize an activity."""

    age_range = entity.age_range
    age_min = getattr(age_range, "lower", None)
    age_max = getattr(age_range, "upper", None)
    return {
        "id": str(entity.id),
        "org_id": str(entity.org_id),
        "name": entity.name,
        "description": entity.description,
        "age_min": age_min,
        "age_max": age_max,
        "created_at": entity.created_at,
        "updated_at": entity.updated_at,
    }


def _create_pricing(
    repo: ActivityPricingRepository, body: dict[str, Any]
) -> ActivityPricing:
    """Create activity pricing."""

    activity_id = body.get("activity_id")
    location_id = body.get("location_id")
    pricing_type = body.get("pricing_type")
    amount = body.get("amount")
    if not activity_id or not location_id or not pricing_type or amount is None:
        raise ValidationError(
            "activity_id, location_id, pricing_type, and amount are required"
        )

    pricing_enum = PricingType(pricing_type)
    sessions_count = body.get("sessions_count")
    if pricing_enum == PricingType.PER_SESSIONS and not sessions_count:
        raise ValidationError("sessions_count is required for per_sessions pricing")
    if pricing_enum != PricingType.PER_SESSIONS:
        sessions_count = None

    return ActivityPricing(
        activity_id=_parse_uuid(activity_id),
        location_id=_parse_uuid(location_id),
        pricing_type=pricing_enum,
        amount=Decimal(str(amount)),
        currency=body.get("currency") or "HKD",
        sessions_count=sessions_count,
    )


def _update_pricing(
    repo: ActivityPricingRepository,
    entity: ActivityPricing,
    body: dict[str, Any],
) -> ActivityPricing:
    """Update activity pricing."""

    if "pricing_type" in body:
        entity.pricing_type = PricingType(body["pricing_type"])
    if "amount" in body:
        entity.amount = Decimal(str(body["amount"]))
    if "currency" in body:
        entity.currency = body["currency"]
    if "sessions_count" in body:
        entity.sessions_count = body["sessions_count"]
    if entity.pricing_type != PricingType.PER_SESSIONS:
        entity.sessions_count = None
    return entity


def _serialize_pricing(entity: ActivityPricing) -> dict[str, Any]:
    """Serialize pricing."""

    return {
        "id": str(entity.id),
        "activity_id": str(entity.activity_id),
        "location_id": str(entity.location_id),
        "pricing_type": entity.pricing_type.value,
        "amount": entity.amount,
        "currency": entity.currency,
        "sessions_count": entity.sessions_count,
    }


def _create_schedule(
    repo: ActivityScheduleRepository, body: dict[str, Any]
) -> ActivitySchedule:
    """Create activity schedule."""

    activity_id = body.get("activity_id")
    location_id = body.get("location_id")
    schedule_type = body.get("schedule_type")
    if not activity_id or not location_id or not schedule_type:
        raise ValidationError(
            "activity_id, location_id, and schedule_type are required"
        )

    schedule_enum = ScheduleType(schedule_type)
    schedule = ActivitySchedule(
        activity_id=_parse_uuid(activity_id),
        location_id=_parse_uuid(location_id),
        schedule_type=schedule_enum,
        languages=_parse_languages(body.get("languages")),
    )
    _apply_schedule_fields(schedule, body, update_only=False)
    _validate_schedule(schedule)
    return schedule


def _update_schedule(
    repo: ActivityScheduleRepository,
    entity: ActivitySchedule,
    body: dict[str, Any],
) -> ActivitySchedule:
    """Update activity schedule."""

    if "schedule_type" in body:
        entity.schedule_type = ScheduleType(body["schedule_type"])
    if "languages" in body:
        entity.languages = _parse_languages(body["languages"])
    _apply_schedule_fields(entity, body, update_only=True)
    _validate_schedule(entity)
    return entity


def _apply_schedule_fields(
    entity: ActivitySchedule,
    body: dict[str, Any],
    update_only: bool,
) -> None:
    """Apply schedule-specific fields."""

    _set_if_present(entity, "day_of_week_utc", body, update_only)
    _set_if_present(entity, "day_of_month", body, update_only)
    _set_if_present(entity, "start_minutes_utc", body, update_only)
    _set_if_present(entity, "end_minutes_utc", body, update_only)

    if not update_only or "start_at_utc" in body:
        entity.start_at_utc = parse_datetime(body.get("start_at_utc"))
    if not update_only or "end_at_utc" in body:
        entity.end_at_utc = parse_datetime(body.get("end_at_utc"))


def _serialize_schedule(entity: ActivitySchedule) -> dict[str, Any]:
    """Serialize schedule."""

    return {
        "id": str(entity.id),
        "activity_id": str(entity.activity_id),
        "location_id": str(entity.location_id),
        "schedule_type": entity.schedule_type.value,
        "day_of_week_utc": entity.day_of_week_utc,
        "day_of_month": entity.day_of_month,
        "start_minutes_utc": entity.start_minutes_utc,
        "end_minutes_utc": entity.end_minutes_utc,
        "start_at_utc": entity.start_at_utc,
        "end_at_utc": entity.end_at_utc,
        "languages": entity.languages,
    }


def _parse_languages(value: Any) -> list[str]:
    """Parse languages from JSON."""

    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    raise ValidationError(
        "languages must be a list or comma-separated string", field="languages"
    )


def _set_if_present(
    entity: ActivitySchedule,
    field_name: str,
    body: dict[str, Any],
    update_only: bool,
) -> None:
    """Set a field on the entity if present in body or create mode."""

    if not update_only or field_name in body:
        setattr(entity, field_name, body.get(field_name))


def _validate_schedule(schedule: ActivitySchedule) -> None:
    """Validate schedule fields for the given schedule type."""

    if schedule.schedule_type == ScheduleType.WEEKLY:
        if schedule.day_of_week_utc is None:
            raise ValidationError("day_of_week_utc is required for weekly schedules")
        if schedule.start_minutes_utc is None or schedule.end_minutes_utc is None:
            raise ValidationError(
                "start_minutes_utc and end_minutes_utc are required for weekly"
            )
    elif schedule.schedule_type == ScheduleType.MONTHLY:
        if schedule.day_of_month is None:
            raise ValidationError("day_of_month is required for monthly schedules")
        if schedule.start_minutes_utc is None or schedule.end_minutes_utc is None:
            raise ValidationError(
                "start_minutes_utc and end_minutes_utc are required for monthly"
            )
    elif schedule.schedule_type == ScheduleType.DATE_SPECIFIC:
        if schedule.start_at_utc is None or schedule.end_at_utc is None:
            raise ValidationError(
                "start_at_utc and end_at_utc are required for date-specific"
            )


# --- Resource configuration ---

_RESOURCE_CONFIG = {
    "organizations": ResourceConfig(
        name="organizations",
        model=Organization,
        repository_class=OrganizationRepository,
        serializer=_serialize_organization,
        create_handler=_create_organization,
        update_handler=_update_organization,
    ),
    "locations": ResourceConfig(
        name="locations",
        model=Location,
        repository_class=LocationRepository,
        serializer=_serialize_location,
        create_handler=_create_location,
        update_handler=_update_location,
    ),
    "activities": ResourceConfig(
        name="activities",
        model=Activity,
        repository_class=ActivityRepository,
        serializer=_serialize_activity,
        create_handler=_create_activity,
        update_handler=_update_activity,
    ),
    "pricing": ResourceConfig(
        name="pricing",
        model=ActivityPricing,
        repository_class=ActivityPricingRepository,
        serializer=_serialize_pricing,
        create_handler=_create_pricing,
        update_handler=_update_pricing,
    ),
    "schedules": ResourceConfig(
        name="schedules",
        model=ActivitySchedule,
        repository_class=ActivityScheduleRepository,
        serializer=_serialize_schedule,
        create_handler=_create_schedule,
        update_handler=_update_schedule,
    ),
}
