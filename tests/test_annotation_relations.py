"""Unit tests for annotation relation primitives and Markdown link parsing."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.storage.annotation_links import extract_annotation_links, normalize_relation_type
from src.storage.models import (
    AnnotationRelationCreate,
    AnnotationRelationORM,
    AnnotationRelationRead,
)


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

    def test_rejects_self_links(self):
        with pytest.raises(ValidationError):
            AnnotationRelationCreate(
                source_annotation_id="code-annot-a1b2c3",
                target_annotation_id="code-annot-a1b2c3",
            )
