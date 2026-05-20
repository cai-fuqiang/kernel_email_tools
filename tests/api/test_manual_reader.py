from __future__ import annotations

import asyncio
from types import SimpleNamespace

from fastapi import HTTPException

from src.api import state
from src.api.routers import manual
from src.api.schemas import ManualDocumentViewResponse
from src.storage.document_store import build_document_id, parse_document_id


def test_manual_document_view_schema_round_trip():
    payload = {
        "document_id": "intel_sdm:9.6",
        "title": "Intel SDM Volume 3",
        "subtitle": "System Programming Guide",
        "manual_type": "intel_sdm",
        "manual_version": "9.6",
        "pdf_url": "/api/manual/documents/intel_sdm%3A9.6/file",
        "page_count": 1234,
        "initial_page": 176,
        "toc": [
            {
                "id": "toc-1",
                "label": "Chapter 6",
                "page": 176,
                "children": [],
            }
        ],
        "page_text": [{"page": 176, "text": "DMA remapping hardware supports..."}],
    }

    model = ManualDocumentViewResponse.model_validate(payload)

    assert model.document_id == "intel_sdm:9.6"
    assert model.toc[0].page == 176
    assert model.page_text[0].page == 176


def test_document_id_helpers_round_trip_default_version():
    document_id = build_document_id("paper", "")

    assert document_id == "paper:default"
    assert parse_document_id(document_id) == ("paper", "default")


def test_manual_document_view_returns_reader_payload():
    class FakeStorage:
        async def get_document_view(self, document_id: str):
            return {
                "document_id": document_id,
                "title": "Intel SDM Volume 3",
                "subtitle": "intel_sdm | 9.6 | Vol 3",
                "manual_type": "intel_sdm",
                "manual_version": "9.6",
                "pdf_url": f"/api/manual/documents/{document_id}/file",
                "page_count": 1200,
                "initial_page": 176,
                "toc": [{"id": "toc-1", "label": "Chapter 6", "page": 176, "children": []}],
                "page_text": [{"page": 176, "text": "DMA remapping hardware supports..."}],
            }

    original = state._manual_storage
    state._manual_storage = FakeStorage()
    try:
        payload = asyncio.run(manual.manual_document_view("intel_sdm:9.6"))
    finally:
        state._manual_storage = original

    assert payload.document_id == "intel_sdm:9.6"
    assert payload.toc[0].label == "Chapter 6"
    assert payload.pdf_url.endswith("/api/manual/documents/intel_sdm:9.6/file")


def test_manual_document_view_raises_404_when_missing():
    class FakeStorage:
        async def get_document_view(self, document_id: str):
            return None

    original = state._manual_storage
    state._manual_storage = FakeStorage()
    try:
        try:
            asyncio.run(manual.manual_document_view("missing:doc"))
        except HTTPException as exc:
            caught = exc
        else:
            caught = None
    finally:
        state._manual_storage = original

    assert caught is not None
    assert caught.status_code == 404


def test_manual_search_includes_document_id(monkeypatch):
    class FakeRetriever:
        async def search(self, query):
            return SimpleNamespace(
                query=query.text,
                mode="manual_keyword",
                total=1,
                hits=[
                    SimpleNamespace(
                        chunk_id="intel_sdm:9.6:00176:opcode_table",
                        manual_type="intel_sdm",
                        manual_version="9.6",
                        volume="Vol 3",
                        chapter="6",
                        section="6.1",
                        section_title="DMA Remapping",
                        content_type="text",
                        content="DMA remapping hardware supports...",
                        page_start=175,
                        page_end=175,
                        score=1.0,
                        snippet="DMA remapping hardware supports...",
                    )
                ],
            )

    original = state._manual_retriever
    state._manual_retriever = FakeRetriever()
    try:
        response = asyncio.run(manual.manual_search("dma"))
    finally:
        state._manual_retriever = original

    assert response.hits[0]["document_id"] == "intel_sdm:9.6"


def test_list_documents_returns_summary_per_manual():
    """list_documents groups chunks by manual_type+version and returns summaries."""
    from src.storage.document_store import DocumentStorage

    class FakeStorage(DocumentStorage):
        def __init__(self):
            pass  # skip DB init

        async def get_chunks_by_manual(self, manual_type, manual_version=""):
            if manual_type == "intel_sdm":
                return [
                    _make_chunk("intel_sdm", "default", pdf_path="/docs/sdm.pdf", page_end=100),
                    _make_chunk("intel_sdm", "default", pdf_path="/docs/sdm.pdf", page_end=200),
                ]
            return []

        async def _get_distinct_manuals(self):
            return [("intel_sdm", "default"), ("other_manual", "v1")]

    import asyncio
    storage = FakeStorage()
    results = asyncio.run(storage.list_documents())

    assert len(results) == 2
    sdm = next(r for r in results if r["manual_type"] == "intel_sdm")
    assert sdm["document_id"] == "intel_sdm:default"
    assert sdm["chunk_count"] == 2
    assert sdm["page_count"] == 201  # MAX(page_end) + 1
    # has_pdf is False because /docs/sdm.pdf doesn't exist on disk in CI
    assert isinstance(sdm["has_pdf"], bool)


def _make_chunk(manual_type, manual_version, pdf_path="", page_end=10):
    from src.chunker.base import DocumentChunk, ContentType
    return DocumentChunk(
        chunk_id=f"{manual_type}:{manual_version}:{page_end}",
        manual_type=manual_type,
        manual_version=manual_version,
        content_type=ContentType.TEXT,
        content="test",
        section="s1",
        section_title="S1",
        page_start=0,
        page_end=page_end,
        token_count=1,
        metadata={"pdf_path": pdf_path} if pdf_path else {},
    )
