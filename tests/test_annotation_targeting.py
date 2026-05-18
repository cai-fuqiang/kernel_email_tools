from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from src.api.routers.annotations import AnnotationCreateRequest
from src.api.schemas import _annotation_to_response
from src.storage.annotation_store import UnifiedAnnotationStore
from src.storage.models import AnnotationCreate


class _FakeSession:
    def __init__(self):
        self.added = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def add(self, orm):
        orm.id = 1
        self.added = orm

    async def commit(self):
        return None

    async def refresh(self, orm):
        return None

    async def execute(self, stmt):
        raise AssertionError(f"unexpected query execution: {stmt}")


class _FakeSessionFactory:
    def __init__(self):
        self.session = _FakeSession()

    def __call__(self):
        return self.session


def test_create_annotation_persists_related_targets():
    session_factory = _FakeSessionFactory()
    annotation_store = UnifiedAnnotationStore(session_factory)

    created = asyncio.run(
        annotation_store.create(
            AnnotationCreate(
                annotation_type="claim",
                body="folio batching was introduced here",
                short_label="folio batching intro",
                pinned=True,
                target_type="commit",
                target_ref="commit:abc123",
                related_targets=[
                    {"target_type": "symbol", "target_ref": "symbol:filemap_fault"},
                    {"target_type": "mail_thread", "target_ref": "thread:lkml-123"},
                ],
            )
        )
    )

    assert session_factory.session.added is not None
    assert session_factory.session.added.short_label == "folio batching intro"
    assert session_factory.session.added.pinned is True
    assert session_factory.session.added.related_targets == [
        {
            "target_type": "symbol",
            "target_ref": "symbol:filemap_fault",
            "target_label": "",
            "target_subtitle": "",
            "anchor": {},
            "role": "",
        },
        {
            "target_type": "mail_thread",
            "target_ref": "thread:lkml-123",
            "target_label": "",
            "target_subtitle": "",
            "anchor": {},
            "role": "",
        },
    ]
    assert created.short_label == "folio batching intro"
    assert created.pinned is True
    assert created.related_targets == [
        {
            "target_type": "symbol",
            "target_ref": "symbol:filemap_fault",
            "target_label": "",
            "target_subtitle": "",
            "anchor": {},
            "role": "",
        },
        {
            "target_type": "mail_thread",
            "target_ref": "thread:lkml-123",
            "target_label": "",
            "target_subtitle": "",
            "anchor": {},
            "role": "",
        },
    ]


def test_annotation_create_request_accepts_related_targets_and_promotion_fields():
    request = AnnotationCreateRequest(
        annotation_type="claim",
        body="folio batching was introduced here",
        short_label="folio batching intro",
        pinned=True,
        target_type="commit",
        target_ref="commit:abc123",
        related_targets=[
            {"target_type": "symbol", "target_ref": "symbol:filemap_fault"},
        ],
    )

    assert request.short_label == "folio batching intro"
    assert request.pinned is True
    assert len(request.related_targets) == 1
    assert request.related_targets[0].target_type == "symbol"
    assert request.related_targets[0].target_label == ""
    assert request.related_targets[0].anchor == {}
    assert request.related_targets[0].role == ""


def test_annotation_response_exposes_targeting_fields():
    response = _annotation_to_response(
        SimpleNamespace(
            annotation_id="annotation-123",
            annotation_type="claim",
            body="folio batching was introduced here",
            author="tester",
            author_user_id="user-1",
            target_type="commit",
            target_ref="commit:abc123",
            target_label="abc123",
            target_subtitle="v1",
            anchor={},
            related_targets=[
                {"target_type": "symbol", "target_ref": "symbol:filemap_fault"},
            ],
            short_label="folio batching intro",
            pinned=True,
            code_target={},
            meta={},
            thread_id="",
            parent_annotation_id="",
            in_reply_to="",
            version="",
            file_path="",
            start_line=0,
            end_line=0,
            visibility="public",
            publish_status="approved",
            created_at=None,
            updated_at=None,
        )
    )

    assert response.short_label == "folio batching intro"
    assert response.pinned is True
    assert len(response.related_targets) == 1
    assert response.related_targets[0].target_type == "symbol"
    assert response.related_targets[0].target_ref == "symbol:filemap_fault"
    assert response.related_targets[0].target_label == ""
    assert response.related_targets[0].target_subtitle == ""
    assert response.related_targets[0].anchor == {}
    assert response.related_targets[0].role == ""
