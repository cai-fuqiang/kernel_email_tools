"""Unit tests for annotation relation primitives and Markdown link parsing."""

from __future__ import annotations

import importlib.util
import asyncio
from pathlib import Path

import pytest
from pydantic import ValidationError

from src.storage.annotation_links import extract_annotation_links, normalize_relation_type
from src.api.schemas import AnnotationRelationRequest
from src.storage.annotation_store import _keyword_search_filters
from src.storage.models import (
    AnnotationRelationCreate,
    AnnotationRelationORM,
    AnnotationRelationRead,
)

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "storage"
    / "migrations"
    / "20260514_add_annotation_relations.py"
)


def load_annotation_relation_migration():
    spec = importlib.util.spec_from_file_location(
        "annotation_relation_migration",
        MIGRATION_PATH,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CapturingConnection:
    def __init__(self):
        self.statements: list[str] = []

    async def execute(self, statement):
        self.statements.append(str(statement))


class TestExtractAnnotationLinks:
    def test_parses_annotation_links_and_ignores_https_links(self):
        markdown = """
        See [base note](annotation:code-annot-a1b2c3) and
        [evolved note](annotation:code-annot-a1b2c3 "variable_evolves_to").
        Ignore [docs](https://example.com/spec).
        Ignore image references ![diagram](annotation:code-annot-image).
        """

        assert extract_annotation_links(markdown) == [
            {
                "label": "base note",
                "annotation_id": "code-annot-a1b2c3",
                "relation_type": "references",
            },
            {
                "label": "evolved note",
                "annotation_id": "code-annot-a1b2c3",
                "relation_type": "variable_evolves_to",
            },
        ]

    def test_keeps_same_annotation_when_relation_types_differ(self):
        markdown = """
        Compare [first](annotation:code-annot-a1b2c3 "references") and
        [second](annotation:code-annot-a1b2c3 "depends_on").
        """

        assert extract_annotation_links(markdown) == [
            {
                "label": "first",
                "annotation_id": "code-annot-a1b2c3",
                "relation_type": "references",
            },
            {
                "label": "second",
                "annotation_id": "code-annot-a1b2c3",
                "relation_type": "depends_on",
            },
        ]


class TestNormalizeRelationType:
    def test_returns_valid_relation_type(self):
        assert normalize_relation_type("depends_on") == "depends_on"
        assert normalize_relation_type("depends-on") == "depends_on"

    def test_falls_back_to_references_for_invalid_values(self):
        assert normalize_relation_type("unknown-edge") == "references"
        assert normalize_relation_type("") == "references"


class TestAnnotationRelationORM:
    def test_orm_has_required_columns(self):
        cols = {c.name for c in AnnotationRelationORM.__table__.columns}
        assert cols >= {
            "relation_id",
            "source_annotation_id",
            "target_annotation_id",
            "relation_type",
            "source_kind",
            "description",
            "metadata",
            "created_by",
            "updated_by",
            "created_by_user_id",
            "updated_by_user_id",
            "created_at",
            "updated_at",
        }

    def test_orm_unique_constraint_edge(self):
        edge_constraints = [
            c
            for c in AnnotationRelationORM.__table__.constraints
            if c.name == "uq_annotation_relations_edge"
        ]
        assert len(edge_constraints) == 1
        assert tuple(edge_constraints[0].columns.keys()) == (
            "source_annotation_id",
            "target_annotation_id",
            "relation_type",
            "source_kind",
        )

    def test_orm_has_source_and_target_indexes(self):
        index_columns = {
            index.name: tuple(column.name for column in index.columns)
            for index in AnnotationRelationORM.__table__.indexes
        }

        assert index_columns["ix_annotation_relations_source_type"] == (
            "source_annotation_id",
            "relation_type",
        )
        assert index_columns["ix_annotation_relations_target_type"] == (
            "target_annotation_id",
            "relation_type",
        )


class TestAnnotationRelationRead:
    def test_read_schema_exposes_audit_fields(self):
        fields = AnnotationRelationRead.model_fields
        assert "created_by" in fields
        assert "updated_by" in fields
        assert "updated_by_user_id" in fields


class TestAnnotationRelationCreate:
    def test_normalizes_relation_type_and_source_kind(self):
        relation = AnnotationRelationCreate(
            source_annotation_id="code-annot-a1b2c3",
            target_annotation_id="code-annot-d4e5f6",
            relation_type="value-passed-to",
            source_kind="markdown-link",
        )

        assert relation.relation_type == "value_passed_to"
        assert relation.source_kind == "markdown_link"

    def test_falls_back_to_default_relation_type_and_source_kind(self):
        relation = AnnotationRelationCreate(
            source_annotation_id="code-annot-a1b2c3",
            target_annotation_id="code-annot-d4e5f6",
            relation_type="unknown-edge",
            source_kind="spreadsheet-import",
        )

        assert relation.relation_type == "references"
        assert relation.source_kind == "manual"

    def test_rejects_self_links(self):
        with pytest.raises(ValidationError):
            AnnotationRelationCreate(
                source_annotation_id="code-annot-a1b2c3",
                target_annotation_id="code-annot-a1b2c3",
            )

    def test_rejects_self_links_after_trimming_ids(self):
        with pytest.raises(ValidationError):
            AnnotationRelationCreate(
                source_annotation_id="code-annot-a1b2c3",
                target_annotation_id=" code-annot-a1b2c3 ",
            )


class TestAnnotationRelationRequest:
    def test_request_defaults(self):
        relation = AnnotationRelationRequest(target_annotation_id="code-annot-d4e5f6")

        assert relation.target_annotation_id == "code-annot-d4e5f6"
        assert relation.relation_type == "references"
        assert relation.description == ""
        assert relation.meta == {}


class TestAnnotationRelationMigration:
    def test_migration_executes_annotation_relations_table_and_constraints(self):
        migration = load_annotation_relation_migration()
        conn = CapturingConnection()

        asyncio.run(migration.run_migration(conn))

        assert len(conn.statements) == 4
        migration_sql = "\n".join(conn.statements)

        assert "CREATE TABLE IF NOT EXISTS annotation_relations" in migration_sql
        assert "relation_id VARCHAR(160)" in migration_sql
        assert "source_annotation_id VARCHAR(64) NOT NULL" in migration_sql
        assert "target_annotation_id VARCHAR(64) NOT NULL" in migration_sql
        assert "relation_type VARCHAR(64) NOT NULL DEFAULT 'references'" in migration_sql
        assert "source_kind VARCHAR(32) NOT NULL DEFAULT 'manual'" in migration_sql
        assert "description TEXT NOT NULL DEFAULT ''" in migration_sql
        assert "metadata JSONB NOT NULL DEFAULT '{}'::jsonb" in migration_sql
        assert "created_by VARCHAR(128)" in migration_sql
        assert "updated_by VARCHAR(128)" in migration_sql
        assert "created_by_user_id VARCHAR(128)" in migration_sql
        assert "updated_by_user_id VARCHAR(128)" in migration_sql
        assert "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" in migration_sql
        assert "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" in migration_sql
        assert "uq_annotation_relations_edge" in migration_sql
        assert (
            "UNIQUE (source_annotation_id, target_annotation_id, relation_type, source_kind)"
            in migration_sql
        )


class TestAnnotationKeywordSearchFilters:
    def test_search_filters_include_exact_id_and_locator_fields(self):
        filters = _keyword_search_filters("ann-123")

        assert len(filters) == 1
        compiled = str(filters[0])
        assert "annotations.annotation_id =" in compiled
        assert "annotations.target_ref =" in compiled
        assert "annotations.body" in compiled
        assert "annotations.file_path" in compiled

    def test_blank_keyword_returns_no_filters(self):
        assert _keyword_search_filters("   ") == []

    def test_migration_executes_annotation_relations_indexes(self):
        migration = load_annotation_relation_migration()
        conn = CapturingConnection()

        asyncio.run(migration.run_migration(conn))

        migration_sql = "\n".join(conn.statements)

        assert "ix_annotation_relations_source_type" in migration_sql
        assert "ON annotation_relations (source_annotation_id, relation_type)" in migration_sql
        assert "ix_annotation_relations_target_type" in migration_sql
        assert "ON annotation_relations (target_annotation_id, relation_type)" in migration_sql
        assert "ix_annotation_relations_source_kind" in migration_sql
        assert "ON annotation_relations (source_kind)" in migration_sql
