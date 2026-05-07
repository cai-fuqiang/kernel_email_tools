"""Tests for search router runtime wiring."""

import asyncio

from src.api import state
from src.api.routers import search as search_router
from src.retriever.base import SearchHit, SearchResult


class _FakeHybridRetriever:
    def __init__(self):
        self.seen_query = None
        self.keyword_retriever = self
        self.semantic_retriever = self

    async def search(self, query):
        self.seen_query = query
        return SearchResult(
            hits=[
                SearchHit(
                    message_id="<m1>",
                    subject="Subject",
                    sender="Alice <a@example.com>",
                    date="2026-05-07T00:00:00",
                    list_name="linux-mm",
                    thread_id="thread-1",
                    has_patch=True,
                    tags=["mm", "patch"],
                    score=0.98765,
                    snippet="hello",
                    source="hybrid",
                )
            ],
            total=1,
            query=query.text,
            mode="hybrid",
        )


def test_search_route_constructs_search_query(monkeypatch):
    retriever = _FakeHybridRetriever()
    monkeypatch.setattr(state, "_retriever", retriever)

    response = asyncio.run(
        search_router.search(
            q="mmap",
            list_name="linux-mm",
            sender="alice",
            tags="mm, patch",
            tag_mode="all",
            page=2,
            page_size=10,
        )
    )

    assert retriever.seen_query.text == "mmap"
    assert retriever.seen_query.list_name == "linux-mm"
    assert retriever.seen_query.sender == "alice"
    assert retriever.seen_query.tags == ["mm", "patch"]
    assert retriever.seen_query.tag_mode == "all"
    assert retriever.seen_query.page == 2
    assert retriever.seen_query.page_size == 10
    assert response.total == 1
    assert response.hits[0]["score"] == 0.9877
