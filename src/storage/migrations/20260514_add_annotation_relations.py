"""Add the annotation_relations table and supporting indexes."""

from sqlalchemy import text


CREATE_ANNOTATION_RELATIONS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS annotation_relations (
    id SERIAL PRIMARY KEY,
    relation_id VARCHAR(160) NOT NULL UNIQUE,
    source_annotation_id VARCHAR(64) NOT NULL,
    target_annotation_id VARCHAR(64) NOT NULL,
    relation_type VARCHAR(64) NOT NULL DEFAULT 'references',
    source_kind VARCHAR(32) NOT NULL DEFAULT 'manual',
    description TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by VARCHAR(128) NOT NULL DEFAULT 'me',
    updated_by VARCHAR(128) NOT NULL DEFAULT 'me',
    created_by_user_id VARCHAR(128),
    updated_by_user_id VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_annotation_relations_edge
        UNIQUE (source_annotation_id, target_annotation_id, relation_type, source_kind)
)
"""

CREATE_ANNOTATION_RELATIONS_SOURCE_TYPE_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS ix_annotation_relations_source_type
ON annotation_relations (source_annotation_id, relation_type)
"""

CREATE_ANNOTATION_RELATIONS_TARGET_TYPE_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS ix_annotation_relations_target_type
ON annotation_relations (target_annotation_id, relation_type)
"""

CREATE_ANNOTATION_RELATIONS_SOURCE_KIND_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS ix_annotation_relations_source_kind
ON annotation_relations (source_kind)
"""


async def run_migration(conn) -> None:
    """Create the annotation_relations table and indexes if they are missing."""

    await conn.execute(text(CREATE_ANNOTATION_RELATIONS_TABLE_SQL))
    await conn.execute(text(CREATE_ANNOTATION_RELATIONS_SOURCE_TYPE_INDEX_SQL))
    await conn.execute(text(CREATE_ANNOTATION_RELATIONS_TARGET_TYPE_INDEX_SQL))
    await conn.execute(text(CREATE_ANNOTATION_RELATIONS_SOURCE_KIND_INDEX_SQL))
