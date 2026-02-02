"""Tests for repository pattern implementations.

Note: These tests require PostgreSQL due to use of INT4RANGE type.
They are skipped when running with SQLite (default test configuration).
Set TEST_DATABASE_URL to a PostgreSQL connection string to run these tests.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from uuid import uuid4

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1] / 'backend' / 'src'))

from app.db.repositories.base import BaseRepository
from app.db.models import Organization

# Skip all tests in this module if not using PostgreSQL
pytestmark = pytest.mark.skipif(
    'postgresql' not in os.getenv('TEST_DATABASE_URL', ''),
    reason='Repository tests require PostgreSQL (set TEST_DATABASE_URL)',
)


class TestBaseRepository:
    """Tests for BaseRepository class."""

    def test_init_stores_session_and_model(self, db_session) -> None:
        """Repository should store session and model references."""
        repo = BaseRepository(db_session, Organization)
        assert repo.session is db_session
        assert repo._model is Organization

    def test_get_by_id_returns_none_for_missing(self, db_session) -> None:
        """get_by_id should return None for non-existent entity."""
        repo = BaseRepository(db_session, Organization)
        result = repo.get_by_id(uuid4())
        assert result is None

    def test_exists_returns_false_for_missing(self, db_session) -> None:
        """exists should return False for non-existent entity."""
        repo = BaseRepository(db_session, Organization)
        assert repo.exists(uuid4()) is False


class TestOrganizationRepository:
    """Tests for OrganizationRepository class."""

    def test_create_organization(self, db_session) -> None:
        """Should create and return organization with generated ID."""
        from app.db.repositories.organization import OrganizationRepository

        repo = OrganizationRepository(db_session)
        org = repo.create_organization(
            name='Test Org',
            description='Test Description',
        )

        assert org.id is not None
        assert org.name == 'Test Org'
        assert org.description == 'Test Description'

    def test_find_by_name(self, db_session) -> None:
        """Should find organization by exact name."""
        from app.db.repositories.organization import OrganizationRepository

        repo = OrganizationRepository(db_session)
        created = repo.create_organization(name='Unique Name')

        found = repo.find_by_name('Unique Name')
        assert found is not None
        assert found.id == created.id

    def test_find_by_name_returns_none_when_not_found(self, db_session) -> None:
        """Should return None when organization not found by name."""
        from app.db.repositories.organization import OrganizationRepository

        repo = OrganizationRepository(db_session)
        result = repo.find_by_name('Nonexistent Org')
        assert result is None

    def test_update_organization(self, db_session) -> None:
        """Should update organization fields."""
        from app.db.repositories.organization import OrganizationRepository

        repo = OrganizationRepository(db_session)
        org = repo.create_organization(name='Original Name')

        updated = repo.update_organization(
            org,
            name='New Name',
            description='New Description',
        )

        assert updated.name == 'New Name'
        assert updated.description == 'New Description'

    def test_delete_organization(self, db_session) -> None:
        """Should delete organization."""
        from app.db.repositories.organization import OrganizationRepository

        repo = OrganizationRepository(db_session)
        org = repo.create_organization(name='To Delete')
        org_id = org.id

        repo.delete(org)

        assert repo.get_by_id(org_id) is None


class TestLocationRepository:
    """Tests for LocationRepository class."""

    def test_create_location(self, db_session, sample_organization) -> None:
        """Should create location with all fields."""
        from decimal import Decimal
        from app.db.repositories.location import LocationRepository

        repo = LocationRepository(db_session)
        location = repo.create_location(
            org_id=sample_organization.id,
            district='Central',
            address='123 Test St',
            lat=Decimal('22.28'),
            lng=Decimal('114.15'),
        )

        assert location.id is not None
        assert location.district == 'Central'
        assert location.org_id == sample_organization.id

    def test_find_by_organization(self, db_session, sample_organization) -> None:
        """Should find locations by organization."""
        from app.db.repositories.location import LocationRepository

        repo = LocationRepository(db_session)
        repo.create_location(org_id=sample_organization.id, district='Central')
        repo.create_location(org_id=sample_organization.id, district='Causeway Bay')

        locations = repo.find_by_organization(sample_organization.id)
        assert len(locations) == 2

    def test_find_by_district(self, db_session, sample_organization) -> None:
        """Should find locations by district."""
        from app.db.repositories.location import LocationRepository

        repo = LocationRepository(db_session)
        repo.create_location(org_id=sample_organization.id, district='Central')
        repo.create_location(org_id=sample_organization.id, district='Causeway Bay')

        locations = repo.find_by_district('Central')
        assert len(locations) == 1
        assert locations[0].district == 'Central'


class TestActivityPricingRepository:
    """Tests for ActivityPricingRepository class."""

    def test_create_pricing(self, db_session, sample_activity, sample_location) -> None:
        """Should create pricing with all fields."""
        from decimal import Decimal
        from app.db.models import PricingType
        from app.db.repositories.pricing import ActivityPricingRepository

        repo = ActivityPricingRepository(db_session)
        pricing = repo.create_pricing(
            activity_id=sample_activity.id,
            location_id=sample_location.id,
            pricing_type=PricingType.PER_CLASS,
            amount=Decimal('150.00'),
            currency='HKD',
        )

        assert pricing.id is not None
        assert pricing.amount == Decimal('150.00')
        assert pricing.pricing_type == PricingType.PER_CLASS

    def test_find_by_activity_and_location(
        self, db_session, sample_activity, sample_location
    ) -> None:
        """Should find pricing by activity and location."""
        from decimal import Decimal
        from app.db.models import PricingType
        from app.db.repositories.pricing import ActivityPricingRepository

        repo = ActivityPricingRepository(db_session)
        created = repo.create_pricing(
            activity_id=sample_activity.id,
            location_id=sample_location.id,
            pricing_type=PricingType.PER_CLASS,
            amount=Decimal('100.00'),
        )

        found = repo.find_by_activity_and_location(
            sample_activity.id,
            sample_location.id,
        )

        assert found is not None
        assert found.id == created.id


class TestActivityScheduleRepository:
    """Tests for ActivityScheduleRepository class."""

    def test_create_weekly_schedule(
        self, db_session, sample_activity, sample_location
    ) -> None:
        """Should create weekly schedule."""
        from app.db.models import ScheduleType
        from app.db.repositories.schedule import ActivityScheduleRepository

        repo = ActivityScheduleRepository(db_session)
        schedule = repo.create_weekly_schedule(
            activity_id=sample_activity.id,
            location_id=sample_location.id,
            day_of_week_utc=1,
            start_minutes_utc=600,
            end_minutes_utc=660,
            languages=['en', 'zh'],
        )

        assert schedule.id is not None
        assert schedule.schedule_type == ScheduleType.WEEKLY
        assert schedule.day_of_week_utc == 1
        assert 'en' in schedule.languages

    def test_find_weekly_by_day(
        self, db_session, sample_activity, sample_location
    ) -> None:
        """Should find weekly schedules by day of week."""
        from app.db.repositories.schedule import ActivityScheduleRepository

        repo = ActivityScheduleRepository(db_session)
        repo.create_weekly_schedule(
            activity_id=sample_activity.id,
            location_id=sample_location.id,
            day_of_week_utc=1,
            start_minutes_utc=600,
            end_minutes_utc=660,
        )
        repo.create_weekly_schedule(
            activity_id=sample_activity.id,
            location_id=sample_location.id,
            day_of_week_utc=3,
            start_minutes_utc=600,
            end_minutes_utc=660,
        )

        monday_schedules = repo.find_weekly_by_day(1)
        assert len(monday_schedules) == 1

    def test_find_by_language(
        self, db_session, sample_activity, sample_location
    ) -> None:
        """Should find schedules by language."""
        from app.db.repositories.schedule import ActivityScheduleRepository

        repo = ActivityScheduleRepository(db_session)
        repo.create_weekly_schedule(
            activity_id=sample_activity.id,
            location_id=sample_location.id,
            day_of_week_utc=1,
            start_minutes_utc=600,
            end_minutes_utc=660,
            languages=['en'],
        )
        repo.create_weekly_schedule(
            activity_id=sample_activity.id,
            location_id=sample_location.id,
            day_of_week_utc=2,
            start_minutes_utc=600,
            end_minutes_utc=660,
            languages=['zh'],
        )

        english_schedules = repo.find_by_language('en')
        assert len(english_schedules) == 1
