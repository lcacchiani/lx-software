"""Add admin database role with write access."""

from __future__ import annotations

from typing import Sequence
from typing import Union

from alembic import op

revision: str = "0003_add_admin_db_user"
down_revision: Union[str, None] = "0002_add_iam_db_user"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create admin role and grant write privileges."""
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siutindei_admin') THEN
            CREATE ROLE siutindei_admin LOGIN;
          END IF;
        END
        $$;
        """
    )
    op.execute("GRANT rds_iam TO siutindei_admin;")
    op.execute(
        """
        DO $$
        BEGIN
          EXECUTE format('GRANT CONNECT ON DATABASE %I TO siutindei_admin', current_database());
        END
        $$;
        """
    )
    op.execute("GRANT USAGE ON SCHEMA public TO siutindei_admin;")
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO siutindei_admin;"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO siutindei_admin;"
    )


def downgrade() -> None:
    """Drop admin role and revoke write privileges."""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siutindei_admin') THEN
            EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM siutindei_admin', current_database());
            REVOKE USAGE ON SCHEMA public FROM siutindei_admin;
            REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM siutindei_admin;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM siutindei_admin;
            REVOKE rds_iam FROM siutindei_admin;
            DROP ROLE siutindei_admin;
          END IF;
        END
        $$;
        """
    )
