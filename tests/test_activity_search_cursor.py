"""Tests for activity search cursor encoding."""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from uuid import UUID
from uuid import uuid4

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1] / "backend" / "src"))

from app.api.activities_search import _decode_cursor  # noqa: E402
from app.api.activities_search import _encode_cursor  # noqa: E402
from app.api.activities_search import _parse_cursor  # noqa: E402
from app.db.models import ScheduleType  # noqa: E402
from app.exceptions import CursorError  # noqa: E402
class _ScheduleStub:
    def __init__(self, schedule_id, schedule_type):
        self.id = schedule_id
        self.schedule_type = schedule_type
        self.day_of_week_utc = 2
        self.day_of_month = None
        self.start_at_utc = None
        self.start_minutes_utc = 480


def test_encode_decode_cursor_roundtrip() -> None:
    """Ensure cursor roundtrips to the same schedule id."""

    schedule_id = uuid4()
    cursor = _encode_cursor(_ScheduleStub(schedule_id, ScheduleType.WEEKLY))
    payload = _decode_cursor(cursor)
    assert payload["schedule_id"] == str(schedule_id)
    assert payload["schedule_type"] == "weekly"


def test_parse_cursor_returns_uuid() -> None:
    """Ensure the cursor parser returns a UUID."""

    schedule_id = uuid4()
    cursor = _encode_cursor(_ScheduleStub(schedule_id, ScheduleType.WEEKLY))
    parsed = _parse_cursor(cursor)
    assert parsed is not None
    assert parsed.schedule_id == schedule_id
    assert parsed.schedule_type == ScheduleType.WEEKLY


def test_parse_cursor_rejects_invalid_value() -> None:
    """Ensure invalid cursors raise a CursorError."""

    raw = json.dumps({"schedule_id": "not-a-uuid"}).encode("utf-8")
    cursor = base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")
    with pytest.raises(CursorError):
        _parse_cursor(cursor)
