"""Unit tests for PLAN-31001 Knowledge enhancements.

仅覆盖纯函数 / Pydantic schema 行为；DB 集成行为依赖 PostgreSQL，由集成测试覆盖。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.api.routers.knowledge import KnowledgeImportRequest
from src.storage.knowledge_store import (
    HAS_SUBTOPIC_RELATION,
    KNOWLEDGE_RELATION_TYPES,
    SUBTOPIC_PARENT_META_KEY,
    _annotation_references_entity,
    _retarget_annotation_entity,
    can_relation_become_subtopic,
    normalize_slug,
)
from src.storage.models import (
    KnowledgeEntityORM,
    KnowledgeEntityVersionORM,
    KnowledgeEntityVersionRead,
)


class TestKnowledgeEntityVersion:
    """KnowledgeEntityVersionORM 与 KnowledgeEntityVersionRead 是 PLAN-31001 Phase 4 新增。"""

    def test_orm_table_name(self):
        assert KnowledgeEntityVersionORM.__tablename__ == "knowledge_entity_versions"

    def test_orm_has_required_columns(self):
        cols = {c.name for c in KnowledgeEntityVersionORM.__table__.columns}
        # 关键列：entity_id, version, snapshot fields, audit fields
        assert "entity_id" in cols
        assert "version" in cols
        assert "canonical_name" in cols
        assert "aliases" in cols
        assert "summary" in cols
        assert "description" in cols
        assert "status" in cols
        # `meta` 在 ORM 中映射到 SQL column "metadata"，所以从 columns 看到的是 metadata
        assert "metadata" in cols
        assert "change_note" in cols
        assert "changed_by" in cols
        assert "changed_at" in cols

    def test_orm_unique_constraint_entity_version(self):
        constraint_names = {
            c.name
            for c in KnowledgeEntityVersionORM.__table__.constraints
            if c.name
        }
        assert "uq_knowledge_entity_versions_entity_version" in constraint_names

    def test_read_schema_defaults(self):
        from datetime import datetime

        snap = KnowledgeEntityVersionRead(
            entity_id="concept:foo",
            version=1,
            changed_at=datetime.utcnow(),
        )
        assert snap.canonical_name == ""
        assert snap.aliases == []
        assert snap.summary == ""
        assert snap.status == "active"
        assert snap.meta == {}
        assert snap.change_note == ""


class TestKnowledgeEntitySearchVector:
    """PLAN-31001 Phase 3：knowledge_entities 增加 search_vector 列。"""

    def test_orm_has_search_vector(self):
        cols = {c.name for c in KnowledgeEntityORM.__table__.columns}
        assert "search_vector" in cols

    def test_search_vector_index_present(self):
        index_names = {idx.name for idx in KnowledgeEntityORM.__table__.indexes}
        assert "ix_knowledge_entities_search_vector" in index_names


class TestKnowledgeImportRequest:
    """PLAN-31001 Phase 4：导入请求体 schema。"""

    def test_default_strategy_upsert(self):
        req = KnowledgeImportRequest(entities=[], relations=[])
        assert req.strategy == "upsert"
        assert req.schema_version == 1

    def test_invalid_strategy_rejected(self):
        with pytest.raises(Exception):
            KnowledgeImportRequest(entities=[], relations=[], strategy="bogus")

    def test_skip_strategy_accepted(self):
        req = KnowledgeImportRequest(entities=[], relations=[], strategy="skip")
        assert req.strategy == "skip"

    def test_minimal_payload(self):
        req = KnowledgeImportRequest(
            entities=[
                {
                    "entity_id": "concept:foo",
                    "entity_type": "concept",
                    "canonical_name": "Foo",
                }
            ],
            relations=[],
        )
        assert len(req.entities) == 1
        assert req.entities[0]["entity_id"] == "concept:foo"


class TestNormalizeSlug:
    """KnowledgeStore.normalize_slug 是导入流程在缺少 slug 时的兜底。"""

    def test_basic(self):
        assert normalize_slug("Hello World") == "hello-world"

    def test_special_chars(self):
        assert normalize_slug("CFS / O(1)") == "cfs-o-1"

    def test_empty_returns_default(self):
        assert normalize_slug("") == "entity"
        assert normalize_slug("   ") == "entity"

    def test_idempotent(self):
        s = normalize_slug("foo bar")
        assert normalize_slug(s) == s

    def test_strips_leading_trailing_dashes(self):
        assert normalize_slug("---hello---") == "hello"


class TestKnowledgeAnnotationRetargeting:
    def test_annotation_reference_matches_primary_target(self):
        annotation = SimpleNamespace(
            target_type="concept",
            target_ref="concept:src",
            related_targets=[],
        )
        entity = SimpleNamespace(entity_id="concept:src", entity_type="concept")

        assert _annotation_references_entity(annotation, entity) is True

    def test_annotation_reference_matches_related_target(self):
        annotation = SimpleNamespace(
            target_type="commit",
            target_ref="commit:abc123",
            related_targets=[
                {
                    "target_type": "concept",
                    "target_ref": "concept:src",
                    "target_label": "Source",
                    "target_subtitle": "concept",
                    "anchor": {},
                    "role": "context",
                }
            ],
        )
        entity = SimpleNamespace(entity_id="concept:src", entity_type="concept")

        assert _annotation_references_entity(annotation, entity) is True

    def test_retarget_annotation_updates_primary_and_related_targets(self):
        annotation = SimpleNamespace(
            target_type="concept",
            target_ref="concept:src",
            target_label="Source",
            target_subtitle="concept",
            related_targets=[
                {
                    "target_type": "concept",
                    "target_ref": "concept:src",
                    "target_label": "Source",
                    "target_subtitle": "concept",
                    "anchor": {},
                    "role": "context",
                },
                {
                    "target_type": "commit",
                    "target_ref": "commit:abc123",
                    "target_label": "abc123",
                    "target_subtitle": "commit",
                    "anchor": {},
                    "role": "evidence",
                },
            ],
        )
        source = SimpleNamespace(entity_id="concept:src", entity_type="concept")
        target = SimpleNamespace(entity_id="concept:dst", entity_type="feature_topic", canonical_name="Target")

        changed = _retarget_annotation_entity(annotation, source, target)

        assert changed is True
        assert annotation.target_type == "feature_topic"
        assert annotation.target_ref == "concept:dst"
        assert annotation.target_label == "Target"
        assert annotation.target_subtitle == "feature_topic"
        assert annotation.related_targets[0]["target_type"] == "feature_topic"
        assert annotation.related_targets[0]["target_ref"] == "concept:dst"
        assert annotation.related_targets[0]["target_label"] == "Target"
        assert annotation.related_targets[0]["target_subtitle"] == "feature_topic"
        assert annotation.related_targets[1]["target_ref"] == "commit:abc123"

    def test_retarget_annotation_supports_legacy_knowledge_entity_target_type(self):
        annotation = SimpleNamespace(
            target_type="knowledge_entity",
            target_ref="concept:src",
            target_label="Source",
            target_subtitle="knowledge_entity",
            related_targets=[],
        )
        source = SimpleNamespace(entity_id="concept:src", entity_type="concept")
        target = SimpleNamespace(entity_id="concept:dst", entity_type="concept", canonical_name="Target")

        changed = _retarget_annotation_entity(annotation, source, target)

        assert changed is True
        assert annotation.target_type == "concept"
        assert annotation.target_ref == "concept:dst"


class TestKnowledgeSubtopicSemantics:
    def test_has_subtopic_relation_type_is_registered(self):
        assert HAS_SUBTOPIC_RELATION == "has_subtopic"
        assert HAS_SUBTOPIC_RELATION in KNOWLEDGE_RELATION_TYPES

    def test_subtopic_parent_meta_key_is_stable(self):
        assert SUBTOPIC_PARENT_META_KEY == "subtopic_parent"

    def test_subtopic_requires_aspect_style_names(self):
        assert can_relation_become_subtopic("VMCS", "VMCS lifecycle") is True
        assert can_relation_become_subtopic("VMCS", "VMCS fields") is True
        assert can_relation_become_subtopic("VMCS", "Nested virtualization") is False
        assert can_relation_become_subtopic("VMCS", "VMX") is False
