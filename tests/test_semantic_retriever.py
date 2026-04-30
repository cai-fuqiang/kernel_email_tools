import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from src.api import server, state
from src.api.routers.search import search as search_handler
from src.retriever.base import SearchQuery
from src.retriever.semantic import SemanticRetriever
from src.storage.models import EmailChunkSearchResult


class FakeEmbeddingProvider:
    model = "text-embedding-v3"

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        assert texts == ["semantic kernel question"]
        return [[0.1, 0.2, 0.3]]


class FakeStorage:
    def __init__(self):
        self.kwargs = {}

    async def search_email_chunks_vector(self, **kwargs):
        self.kwargs = kwargs
        return [
            EmailChunkSearchResult(
                chunk_id="chunk-1",
                message_id="msg-1",
                thread_id="thread-1",
                list_name="kvm",
                subject="first",
                sender="a@example.com",
                date=datetime(2026, 1, 1, tzinfo=timezone.utc),
                chunk_index=0,
                content="lower score duplicate",
                content_hash="hash-1",
                score=0.5,
                snippet="lower score duplicate",
                source="chunk_vector",
            ),
            EmailChunkSearchResult(
                chunk_id="chunk-2",
                message_id="msg-1",
                thread_id="thread-1",
                list_name="kvm",
                subject="first",
                sender="a@example.com",
                date=datetime(2026, 1, 1, tzinfo=timezone.utc),
                chunk_index=1,
                content="higher score duplicate",
                content_hash="hash-2",
                score=0.9,
                snippet="higher score duplicate",
                source="chunk_vector",
            ),
            EmailChunkSearchResult(
                chunk_id="chunk-3",
                message_id="msg-2",
                thread_id="thread-2",
                list_name="kvm",
                subject="second",
                sender="b@example.com",
                date=datetime(2026, 1, 2, tzinfo=timezone.utc),
                chunk_index=0,
                content="second message",
                content_hash="hash-3",
                score=0.8,
                snippet="second message",
                source="chunk_vector",
            ),
        ]


def test_semantic_retriever_dedupes_chunks_and_forwards_filters():
    asyncio.run(_test_semantic_retriever_dedupes_chunks_and_forwards_filters())


async def _test_semantic_retriever_dedupes_chunks_and_forwards_filters():
    storage = FakeStorage()
    retriever = SemanticRetriever(
        enabled=True,
        storage=storage,
        embedding_provider=FakeEmbeddingProvider(),
        embedding_provider_name="dashscope",
    )

    result = await retriever.search(
        SearchQuery(
            text="semantic kernel question",
            list_name="kvm",
            sender="author",
            tags=["memory"],
            tag_mode="all",
            has_patch=True,
            page=1,
            page_size=10,
        )
    )

    assert result.mode == "semantic"
    assert result.total == 2
    assert [hit.message_id for hit in result.hits] == ["msg-1", "msg-2"]
    assert result.hits[0].score == 0.9
    assert result.hits[0].snippet == "higher score duplicate"
    assert result.hits[0].source == "semantic"
    assert storage.kwargs["embedding"] == [0.1, 0.2, 0.3]
    assert storage.kwargs["provider"] == "dashscope"
    assert storage.kwargs["model"] == "text-embedding-v3"
    assert storage.kwargs["list_name"] == "kvm"
    assert storage.kwargs["sender"] == "author"
    assert storage.kwargs["tags"] == ["memory"]
    assert storage.kwargs["tag_mode"] == "all"
    assert storage.kwargs["has_patch"] is True


def test_search_api_rejects_empty_semantic_query(monkeypatch):
    asyncio.run(_test_search_api_rejects_empty_semantic_query(monkeypatch))


async def _test_search_api_rejects_empty_semantic_query(monkeypatch):
    monkeypatch.setattr(state, "_retriever", object())

    with pytest.raises(HTTPException) as exc_info:
        await search_handler(
            q="",
            list_name=None,
            sender="author",
            date_from=None,
            date_to=None,
            has_patch=None,
            tags=None,
            tag_mode="any",
            page=1,
            page_size=20,
            mode="semantic",
        )

    assert exc_info.value.status_code == 400
    assert "Semantic search requires" in exc_info.value.detail
