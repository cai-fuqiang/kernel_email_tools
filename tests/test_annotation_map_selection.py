from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace

from src.api import state
from src.api.routers.annotations import list_annotations
from src.storage.annotation_store import UnifiedAnnotationStore


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _ExecuteResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _ScalarResult(self._rows)


class _FakeSession:
    def __init__(self, rows):
        self._rows = rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, stmt):
        return _ExecuteResult(self._rows)


class _FakeSessionFactory:
    def __init__(self, rows):
        self._rows = rows

    def __call__(self):
        return _FakeSession(self._rows)


def _annotation_row(
    annotation_id: str,
    annotation_type: str,
    *,
    pinned: bool = False,
    target_type: str = "symbol",
    target_ref: str = "symbol:do_mmap",
    related_targets: list[dict] | None = None,
):
    now = datetime.utcnow()
    return SimpleNamespace(
        id=1,
        annotation_id=annotation_id,
        annotation_type=annotation_type,
        author="tester",
        author_user_id="user-1",
        visibility="public",
        publish_status="approved",
        short_label=f"{annotation_type}-label",
        body=f"{annotation_type} body",
        pinned=pinned,
        parent_annotation_id="",
        publish_requested_at=None,
        publish_requested_by_user_id=None,
        publish_reviewed_at=None,
        publish_reviewed_by_user_id=None,
        publish_review_comment="",
        created_at=now,
        updated_at=now,
        target_type=target_type,
        target_ref=target_ref,
        target_label=target_ref,
        target_subtitle="",
        related_targets=related_targets or [],
        anchor={},
        thread_id="",
        in_reply_to="",
        version="",
        file_path="",
        start_line=None,
        end_line=None,
        meta={},
    )


def test_map_selection_returns_only_promoted_annotations():
    annotation_store = UnifiedAnnotationStore(
        _FakeSessionFactory(
            [
                _annotation_row("ann-claim", "claim"),
                _annotation_row("ann-summary", "summary"),
                _annotation_row("ann-link", "link"),
                _annotation_row("ann-note-pinned", "note", pinned=True),
                _annotation_row("ann-note-unpinned", "note", pinned=False),
                _annotation_row("ann-excerpt", "excerpt"),
                _annotation_row(
                    "ann-related",
                    "claim",
                    target_type="commit",
                    target_ref="commit:abc123",
                    related_targets=[
                        {
                            "target_type": "symbol",
                            "target_ref": "symbol:do_mmap",
                            "target_label": "",
                            "target_subtitle": "",
                            "anchor": {},
                            "role": "",
                        }
                    ],
                ),
            ]
        )
    )

    rows = asyncio.run(
        annotation_store.list_map_annotations(
            target_type="symbol",
            target_ref="symbol:do_mmap",
        )
    )

    assert [item.annotation_id for item in rows] == [
        "ann-claim",
        "ann-summary",
        "ann-link",
        "ann-note-pinned",
        "ann-related",
    ]
    assert all(item.annotation_type in {"claim", "summary", "link", "note"} for item in rows)
    assert all(item.annotation_type != "excerpt" for item in rows)


def test_list_annotations_uses_promoted_map_selection():
    class _Store:
        def __init__(self):
            self.calls = []

        async def list_map_annotations(
            self,
            target_type: str,
            target_ref: str,
            viewer_user_id=None,
            include_all_private: bool = False,
        ):
            self.calls.append(
                {
                    "target_type": target_type,
                    "target_ref": target_ref,
                    "viewer_user_id": viewer_user_id,
                    "include_all_private": include_all_private,
                }
            )
            return [
                _annotation_row(
                    "ann-claim",
                    "claim",
                    target_type=target_type,
                    target_ref=target_ref,
                )
            ]

    store = _Store()
    previous_store = state._annotation_store
    try:
        state._annotation_store = store
        payload = asyncio.run(
            list_annotations(
                target_type="symbol",
                target_ref="symbol:do_mmap",
                promoted_only=True,
                current_user=None,
            )
        )
    finally:
        state._annotation_store = previous_store

    assert store.calls == [
        {
            "target_type": "symbol",
            "target_ref": "symbol:do_mmap",
            "viewer_user_id": None,
            "include_all_private": False,
        }
    ]
    assert [item["annotation_id"] for item in payload["annotations"]] == ["ann-claim"]
