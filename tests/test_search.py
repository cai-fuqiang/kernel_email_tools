"""Tests for search utilities: SearchQuery construction, query routing logic."""

from datetime import datetime, timezone

import pytest

from src.retriever.base import SearchQuery
from src.retriever.hybrid import HybridRetriever


class TestSearchQuery:
    def test_basic_query(self):
        q = SearchQuery(text="hello world")
        assert q.text == "hello world"
        assert q.page == 1
        assert q.page_size == 50
        assert q.tag_mode == "any"
        assert q.top_k == 20

    def test_full_query(self):
        q = SearchQuery(
            text="mmap",
            list_name="linux-mm",
            sender="akpm",
            date_from=datetime(2024, 1, 1, tzinfo=timezone.utc),
            date_to=datetime(2024, 12, 31, tzinfo=timezone.utc),
            has_patch=True,
            tags=["fix", "regression"],
            tag_mode="all",
            page=2,
            page_size=10,
            top_k=30,
        )
        assert q.text == "mmap"
        assert q.list_name == "linux-mm"
        assert q.sender == "akpm"
        assert q.has_patch is True
        assert q.tags == ["fix", "regression"]
        assert q.tag_mode == "all"
        assert q.page == 2
        assert q.page_size == 10
        assert q.top_k == 30

    def test_default_date_range_is_none(self):
        q = SearchQuery(text="test")
        assert q.date_from is None
        assert q.date_to is None

    def test_default_tags_is_none(self):
        q = SearchQuery(text="test")
        assert q.tags is None


class TestIsSemanticQuery:
    """Test query intent routing — whether a query should use semantic search."""

    @staticmethod
    def _make_retriever():
        return HybridRetriever(
            keyword_retriever=None,  # type: ignore
            semantic_retriever=None,  # type: ignore
        )

    def test_short_query_is_keyword_only(self):
        r = self._make_retriever()
        assert r._is_semantic_query("mmap") is False
        assert r._is_semantic_query("oom") is False

    def test_two_word_query_is_keyword_only(self):
        r = self._make_retriever()
        assert r._is_semantic_query("oom kill") is False

    def test_question_with_question_mark_is_semantic(self):
        r = self._make_retriever()
        assert r._is_semantic_query("Why was the shmem mount changed?") is True

    def test_short_chinese_with_question_mark_is_not_semantic(self):
        # _is_semantic_query splits on whitespace, so Chinese text without spaces
        # appears as one "word" and is classified as keyword-only.
        r = self._make_retriever()
        assert r._is_semantic_query("什么原因？") is False  # 1 whitespace-word

    def test_question_starting_with_keyword_is_semantic(self):
        r = self._make_retriever()
        assert r._is_semantic_query("why was shmem mount changed") is True
        assert r._is_semantic_query("how to fix oom") is True
        assert r._is_semantic_query("what is rcu") is True

    def test_question_keyword_mid_sentence_is_semantic(self):
        r = self._make_retriever()
        assert r._is_semantic_query("can you explain the memory reclaim flow to me") is True

    def test_chinese_question_with_spaces_is_semantic(self):
        # When Chinese tokens are space-separated they produce enough "words"
        r = self._make_retriever()
        assert r._is_semantic_query("如何 处理 内存 泄漏 问题") is True

    def test_three_word_phrase_without_question_is_not_semantic(self):
        r = self._make_retriever()
        # "linux kernel memory" has 3 words but no question keywords
        assert r._is_semantic_query("linux kernel memory") is False

    def test_long_query_without_question_keywords_is_still_keyword(self):
        r = self._make_retriever()
        assert r._is_semantic_query("rcu callback invocation from idle context") is False
