"""roles, member removal and channel ownership

Revision ID: 3f9c1a72d5b4
Revises: 08fbd40665f8
Create Date: 2026-10-25 21:10:00.000000

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3f9c1a72d5b4"
down_revision: str | None = "08fbd40665f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("role", sa.String(length=16), nullable=False, server_default="member"),
    )
    op.add_column(
        "users",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "users",
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("channels", sa.Column("created_by", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_channels_created_by_users",
        "channels",
        "users",
        ["created_by"],
        ["id"],
        ondelete="SET NULL",
    )

    # The earliest account becomes the workspace administrator.
    op.execute("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)")
    # Existing channels are owned by that administrator.
    op.execute(
        "UPDATE channels SET created_by = (SELECT MIN(id) FROM users) WHERE created_by IS NULL"
    )


def downgrade() -> None:
    op.drop_constraint("fk_channels_created_by_users", "channels", type_="foreignkey")
    op.drop_column("channels", "created_by")
    op.drop_column("users", "removed_at")
    op.drop_column("users", "is_active")
    op.drop_column("users", "role")
