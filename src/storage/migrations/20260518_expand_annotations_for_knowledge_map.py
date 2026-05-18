"""Expand annotations for annotation-centered knowledge map fields."""

from sqlalchemy import text


ADD_SHORT_LABEL_SQL = """
ALTER TABLE annotations
ADD COLUMN IF NOT EXISTS short_label VARCHAR(256) NOT NULL DEFAULT ''
"""

ADD_PINNED_SQL = """
ALTER TABLE annotations
ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE
"""

ADD_RELATED_TARGETS_SQL = """
ALTER TABLE annotations
ADD COLUMN IF NOT EXISTS related_targets JSONB NOT NULL DEFAULT '[]'::jsonb
"""

CREATE_PINNED_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS ix_annotations_pinned
ON annotations (pinned)
"""


async def run_migration(conn) -> None:
    """Add knowledge-map annotation fields if they are missing."""

    await conn.execute(text(ADD_SHORT_LABEL_SQL))
    await conn.execute(text(ADD_PINNED_SQL))
    await conn.execute(text(ADD_RELATED_TARGETS_SQL))
    await conn.execute(text(CREATE_PINNED_INDEX_SQL))
