"""Add IAM-enabled database user and grants."""

from __future__ import annotations

from typing import Sequence
from typing import Union

from alembic import op

revision: str = "0002_add_iam_db_user"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create IAM database role and grant privileges."""
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siutindei_app') THEN
            CREATE ROLE siutindei_app LOGIN;
          END IF;
        END
        $$;
        """
    )
    op.execute("GRANT rds_iam TO siutindei_app;")
    op.execute(
        """
        DO $$
        BEGIN
          EXECUTE format('GRANT CONNECT ON DATABASE %I TO siutindei_app', current_database());
        END
        $$;
        """
    )
    op.execute("GRANT USAGE ON SCHEMA public TO siutindei_app;")
    op.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO siutindei_app;")
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO siutindei_app;"
    )
    op.execute("GRANT rds_iam TO CURRENT_USER;")


def downgrade() -> None:
    """Drop IAM database role and revoke privileges."""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siutindei_app') THEN
            EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM siutindei_app', current_database());
            REVOKE USAGE ON SCHEMA public FROM siutindei_app;
            REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM siutindei_app;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM siutindei_app;
            REVOKE rds_iam FROM siutindei_app;
            DROP ROLE siutindei_app;
          END IF;
        END
        $$;
        """
    )
