"""Initial schema for organizations, activities, locations, pricing, and schedules."""

from __future__ import annotations

from typing import Sequence
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create initial tables, enums, and indexes."""
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    pricing_type_enum = postgresql.ENUM(
        "per_class",
        "per_month",
        "per_sessions",
        name="pricing_type",
        create_type=False,
    )
    schedule_type_enum = postgresql.ENUM(
        "weekly",
        "monthly",
        "date_specific",
        name="schedule_type",
        create_type=False,
    )
    pricing_type_enum.create(op.get_bind(), checkfirst=True)
    schedule_type_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "organizations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_table(
        "locations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "org_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("district", sa.Text(), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("lng", sa.Numeric(9, 6), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("locations_district_idx", "locations", ["district"])
    op.create_index("locations_org_idx", "locations", ["org_id"])

    op.create_table(
        "activities",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "org_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("age_range", postgresql.INT4RANGE(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "activities_age_gist",
        "activities",
        ["age_range"],
        postgresql_using="gist",
    )
    op.create_index("activities_org_idx", "activities", ["org_id"])

    op.create_table(
        "activity_locations",
        sa.Column(
            "activity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "location_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("locations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("activity_id", "location_id"),
    )
    op.create_index(
        "activity_locations_location_idx",
        "activity_locations",
        ["location_id"],
    )

    op.create_table(
        "activity_pricing",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "activity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "location_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("locations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("pricing_type", pricing_type_enum, nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False, server_default="HKD"),
        sa.Column("sessions_count", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "(pricing_type <> 'per_sessions') OR "
            "(sessions_count IS NOT NULL AND sessions_count > 0)",
            name="pricing_sessions_count_check",
        ),
    )
    op.create_index(
        "activity_pricing_type_amount_idx",
        "activity_pricing",
        ["pricing_type", "amount"],
    )
    op.create_index(
        "activity_pricing_location_idx",
        "activity_pricing",
        ["location_id"],
    )

    op.create_table(
        "activity_schedule",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "activity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "location_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("locations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("schedule_type", schedule_type_enum, nullable=False),
        sa.Column("day_of_week_utc", sa.SmallInteger(), nullable=True),
        sa.Column("day_of_month", sa.SmallInteger(), nullable=True),
        sa.Column("start_minutes_utc", sa.Integer(), nullable=True),
        sa.Column("end_minutes_utc", sa.Integer(), nullable=True),
        sa.Column("start_at_utc", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("end_at_utc", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "languages",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.CheckConstraint(
            "day_of_week_utc BETWEEN 0 AND 6",
            name="schedule_day_of_week_range",
        ),
        sa.CheckConstraint(
            "day_of_month BETWEEN 1 AND 31",
            name="schedule_day_of_month_range",
        ),
        sa.CheckConstraint(
            "start_minutes_utc BETWEEN 0 AND 1439",
            name="schedule_start_minutes_range",
        ),
        sa.CheckConstraint(
            "end_minutes_utc BETWEEN 0 AND 1439",
            name="schedule_end_minutes_range",
        ),
        sa.CheckConstraint(
            "start_minutes_utc IS NULL OR "
            "end_minutes_utc IS NULL OR "
            "start_minutes_utc < end_minutes_utc",
            name="schedule_minutes_order",
        ),
        sa.CheckConstraint(
            "start_at_utc IS NULL OR end_at_utc IS NULL OR start_at_utc < end_at_utc",
            name="schedule_date_order",
        ),
        sa.CheckConstraint(
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
    op.create_index(
        "activity_schedule_type_weekly_idx",
        "activity_schedule",
        ["schedule_type", "day_of_week_utc", "start_minutes_utc", "end_minutes_utc"],
    )
    op.create_index(
        "activity_schedule_type_monthly_idx",
        "activity_schedule",
        ["schedule_type", "day_of_month", "start_minutes_utc", "end_minutes_utc"],
    )
    op.create_index(
        "activity_schedule_date_idx",
        "activity_schedule",
        ["start_at_utc", "end_at_utc"],
    )
    op.create_index(
        "activity_schedule_languages_gin",
        "activity_schedule",
        ["languages"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    """Drop initial tables, enums, and indexes."""
    op.drop_index("activity_schedule_languages_gin", table_name="activity_schedule")
    op.drop_index("activity_schedule_date_idx", table_name="activity_schedule")
    op.drop_index("activity_schedule_type_monthly_idx", table_name="activity_schedule")
    op.drop_index("activity_schedule_type_weekly_idx", table_name="activity_schedule")
    op.drop_table("activity_schedule")

    op.drop_index("activity_pricing_location_idx", table_name="activity_pricing")
    op.drop_index("activity_pricing_type_amount_idx", table_name="activity_pricing")
    op.drop_table("activity_pricing")

    op.drop_index("activity_locations_location_idx", table_name="activity_locations")
    op.drop_table("activity_locations")

    op.drop_index("activities_org_idx", table_name="activities")
    op.drop_index("activities_age_gist", table_name="activities")
    op.drop_table("activities")

    op.drop_index("locations_org_idx", table_name="locations")
    op.drop_index("locations_district_idx", table_name="locations")
    op.drop_table("locations")

    op.drop_table("organizations")

    schedule_type_enum = postgresql.ENUM(
        "weekly",
        "monthly",
        "date_specific",
        name="schedule_type",
        create_type=False,
    )
    pricing_type_enum = postgresql.ENUM(
        "per_class",
        "per_month",
        "per_sessions",
        name="pricing_type",
        create_type=False,
    )
    schedule_type_enum.drop(op.get_bind(), checkfirst=True)
    pricing_type_enum.drop(op.get_bind(), checkfirst=True)
