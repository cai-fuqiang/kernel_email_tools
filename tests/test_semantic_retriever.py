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


# ---------------------------------------------------------------------------
# Additional coverage for PLAN-34000 Test Plan items
# ---------------------------------------------------------------------------


class FakeStorageMulti:
    """Returns multiple distinct messages for pagination/filter tests."""

    def __init__(self):
        self.kwargs: dict = {}

    async def search_email_chunks_vector(self, **kwargs):
        self.kwargs = kwargs
        # 5 distinct messages with descending scores 0.9 .. 0.5
        results = []
        for idx, score in enumerate([0.9, 0.8, 0.7, 0.6, 0.5], start=1):
            results.append(
                EmailChunkSearchResult(
                    chunk_id=f"chunk-{idx}",
                    message_id=f"msg-{idx}",
                    thread_id=f"thread-{idx}",
                    list_name="kvm",
                    subject=f"subject {idx}",
                    sender=f"sender-{idx}@example.com",
                    date=datetime(2026, 1, idx, tzinfo=timezone.utc),
                    chunk_index=0,
                    content=f"content {idx}",
                    content_hash=f"hash-{idx}",
                    score=score,
                    snippet=f"snippet {idx}",
                    source="chunk_vector",
                )
            )
        return results


def test_semantic_retriever_pagination():
    asyncio.run(_test_semantic_retriever_pagination())


async def _test_semantic_retriever_pagination():
    """Page slicing happens after dedupe and is sorted by score descending."""
    storage = FakeStorageMulti()
    retriever = SemanticRetriever(
        enabled=True,
        storage=storage,
        embedding_provider=FakeEmbeddingProvider(),
        embedding_provider_name="dashscope",
    )

    # Page 1: page_size=2 -> top-2 messages by score
    page1 = await retriever.search(
        SearchQuery(text="semantic kernel question", page=1, page_size=2)
    )
    assert page1.total == 5
    assert [hit.message_id for hit in page1.hits] == ["msg-1", "msg-2"]

    # Page 2: page_size=2 -> messages 3-4
    page2 = await retriever.search(
        SearchQuery(text="semantic kernel question", page=2, page_size=2)
    )
    assert page2.total == 5
    assert [hit.message_id for hit in page2.hits] == ["msg-3", "msg-4"]

    # Page 3: page_size=2 -> last message only
    page3 = await retriever.search(
        SearchQuery(text="semantic kernel question", page=3, page_size=2)
    )
    assert [hit.message_id for hit in page3.hits] == ["msg-5"]


def test_semantic_retriever_forwards_date_filters():
    asyncio.run(_test_semantic_retriever_forwards_date_filters())


async def _test_semantic_retriever_forwards_date_filters():
    """date_from / date_to are passed through to the chunk vector search."""
    storage = FakeStorageMulti()
    retriever = SemanticRetriever(
        enabled=True,
        storage=storage,
        embedding_provider=FakeEmbeddingProvider(),
        embedding_provider_name="dashscope",
    )

    date_from = datetime(2026, 1, 1, tzinfo=timezone.utc)
    date_to = datetime(2026, 12, 31, tzinfo=timezone.utc)

    await retriever.search(
        SearchQuery(
            text="semantic kernel question",
            date_from=date_from,
            date_to=date_to,
        )
    )

    assert storage.kwargs["date_from"] == date_from
    assert storage.kwargs["date_to"] == date_to


def test_semantic_retriever_missing_embedding_provider_returns_empty(caplog):
    asyncio.run(_test_semantic_retriever_missing_embedding_provider_returns_empty(caplog))


async def _test_semantic_retriever_missing_embedding_provider_returns_empty(caplog):
    """Enabled retriever without embedding provider returns empty + logs warning."""
    import logging

    storage = FakeStorageMulti()
    retriever = SemanticRetriever(
        enabled=True,
        storage=storage,
        embedding_provider=None,
        embedding_provider_name="dashscope",
    )

    with caplog.at_level(logging.WARNING, logger="src.retriever.semantic"):
        result = await retriever.search(SearchQuery(text="anything"))

    assert result.total == 0
    assert result.hits == []
    assert result.mode == "semantic"
    # Storage should not have been called
    assert storage.kwargs == {}
    assert any("embedding provider is missing" in rec.message for rec in caplog.records)


def test_semantic_retriever_disabled_returns_empty():
    asyncio.run(_test_semantic_retriever_disabled_returns_empty())


async def _test_semantic_retriever_disabled_returns_empty():
    """Disabled retriever short-circuits without touching storage or provider."""
    storage = FakeStorageMulti()
    retriever = SemanticRetriever(
        enabled=False,
        storage=storage,
        embedding_provider=FakeEmbeddingProvider(),
        embedding_provider_name="dashscope",
    )

    result = await retriever.search(SearchQuery(text="anything"))

    assert result.total == 0
    assert result.hits == []
    assert result.mode == "semantic"
    assert storage.kwargs == {}
