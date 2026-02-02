"""Pytest configuration and fixtures for backend tests.

This module provides shared fixtures for testing the backend application,
including database sessions, sample data factories, and mock services.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime
from datetime import timezone
from decimal import Decimal
from pathlib import Path
from typing import Generator
from uuid import UUID
from uuid import uuid4

import pytest

# Add backend source to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend' / 'src'))


# --- Database Fixtures ---


@pytest.fixture(scope='session')
def test_database_url() -> str:
    """Get or create a test database URL.

    Uses SQLite in-memory by default for fast, isolated tests.
    Set TEST_DATABASE_URL environment variable to use a real PostgreSQL database.
    """
    return os.getenv('TEST_DATABASE_URL', 'sqlite:///:memory:')


@pytest.fixture(scope='session')
def test_engine(test_database_url: str):
    """Create a test database engine and schema.

    This fixture creates all tables at the start of the test session
    and tears them down at the end.
    """
    from sqlalchemy import create_engine

    from app.db.base import Base

    engine = create_engine(
        test_database_url,
        echo=os.getenv('TEST_SQL_ECHO', '').lower() == 'true',
    )

    # Create all tables
    Base.metadata.create_all(engine)

    yield engine

    # Drop all tables
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def db_session(test_engine) -> Generator:
    """Create a test database session with automatic rollback.

    Each test gets an isolated transaction that is rolled back after the test,
    ensuring tests don't affect each other.
    """
    from sqlalchemy.orm import Session

    connection = test_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()


# --- Sample Data Factories ---


@pytest.fixture
def sample_organization_data() -> dict:
    """Sample data for creating an organization."""
    return {
        'name': 'Test Organization',
        'description': 'A test organization for unit tests',
    }


@pytest.fixture
def sample_organization(db_session, sample_organization_data):
    """Create a sample organization in the test database."""
    from app.db.models import Organization

    org = Organization(**sample_organization_data)
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture
def sample_location_data(sample_organization) -> dict:
    """Sample data for creating a location."""
    return {
        'org_id': sample_organization.id,
        'district': 'Central',
        'address': '123 Test Street',
        'lat': Decimal('22.282667'),
        'lng': Decimal('114.158167'),
    }


@pytest.fixture
def sample_location(db_session, sample_location_data):
    """Create a sample location in the test database."""
    from app.db.models import Location

    location = Location(**sample_location_data)
    db_session.add(location)
    db_session.flush()
    return location


@pytest.fixture
def sample_activity_data(sample_organization) -> dict:
    """Sample data for creating an activity."""
    from psycopg.types.range import Range

    return {
        'org_id': sample_organization.id,
        'name': 'Swimming Class',
        'description': 'Learn to swim in our heated pool',
        'age_range': Range(5, 12, bounds='[]'),
    }


@pytest.fixture
def sample_activity(db_session, sample_activity_data):
    """Create a sample activity in the test database."""
    from app.db.models import Activity

    activity = Activity(**sample_activity_data)
    db_session.add(activity)
    db_session.flush()
    return activity


@pytest.fixture
def sample_pricing_data(sample_activity, sample_location) -> dict:
    """Sample data for creating activity pricing."""
    from app.db.models import PricingType

    return {
        'activity_id': sample_activity.id,
        'location_id': sample_location.id,
        'pricing_type': PricingType.PER_CLASS,
        'amount': Decimal('150.00'),
        'currency': 'HKD',
    }


@pytest.fixture
def sample_pricing(db_session, sample_pricing_data):
    """Create sample pricing in the test database."""
    from app.db.models import ActivityPricing

    pricing = ActivityPricing(**sample_pricing_data)
    db_session.add(pricing)
    db_session.flush()
    return pricing


@pytest.fixture
def sample_schedule_data(sample_activity, sample_location) -> dict:
    """Sample data for creating an activity schedule."""
    from app.db.models import ScheduleType

    return {
        'activity_id': sample_activity.id,
        'location_id': sample_location.id,
        'schedule_type': ScheduleType.WEEKLY,
        'day_of_week_utc': 1,  # Monday
        'start_minutes_utc': 600,  # 10:00 AM
        'end_minutes_utc': 660,  # 11:00 AM
        'languages': ['en', 'zh'],
    }


@pytest.fixture
def sample_schedule(db_session, sample_schedule_data):
    """Create a sample schedule in the test database."""
    from app.db.models import ActivitySchedule

    schedule = ActivitySchedule(**sample_schedule_data)
    db_session.add(schedule)
    db_session.flush()
    return schedule


# --- API Event Fixtures ---


@pytest.fixture
def api_gateway_event() -> dict:
    """Base API Gateway event structure."""
    return {
        'httpMethod': 'GET',
        'path': '/v1/activities/search',
        'queryStringParameters': {},
        'multiValueQueryStringParameters': {},
        'headers': {},
        'requestContext': {
            'requestId': str(uuid4()),
            'authorizer': {},
        },
        'body': None,
        'isBase64Encoded': False,
    }


@pytest.fixture
def admin_api_event(api_gateway_event) -> dict:
    """API Gateway event with admin authorization."""
    event = api_gateway_event.copy()
    event['requestContext'] = {
        'requestId': str(uuid4()),
        'authorizer': {
            'claims': {
                'cognito:groups': 'admin,staff',
                'sub': str(uuid4()),
                'email': 'admin@example.com',
            },
        },
    }
    return event


# --- Mock Fixtures ---


@pytest.fixture
def mock_boto3_client(mocker):
    """Mock boto3 client for AWS service calls."""
    mock = mocker.patch('boto3.client')
    return mock


# --- Utility Functions ---


def make_search_filters(**kwargs) -> dict:
    """Create ActivitySearchFilters kwargs with defaults."""
    defaults = {
        'age': None,
        'district': None,
        'pricing_type': None,
        'price_min': None,
        'price_max': None,
        'schedule_type': None,
        'day_of_week_utc': None,
        'day_of_month': None,
        'start_minutes_utc': None,
        'end_minutes_utc': None,
        'start_at_utc': None,
        'end_at_utc': None,
        'languages': (),
        'cursor': None,
        'limit': 50,
    }
    defaults.update(kwargs)
    return defaults
