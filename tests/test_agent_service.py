"""Tests for AI agent research service."""

import asyncio
from datetime import datetime as dt_datetime

import pytest

from src.agent.research_service import (
    RELEVANCE_SYSTEM_PROMPT,
    RELEVANCE_USER_TEMPLATE,
    UNTRUSTED_EVIDENCE_PREFIX,
    UNTRUSTED_EVIDENCE_SUFFIX,
    _format_results_for_judge,
    _format_knowledge_context,
    _wrap_untrusted,
)


class TestUntrustedEvidenceWrapping:
    def test_wrap_adds_prefix_and_suffix(self):
        result = _wrap_untrusted("Test", "some content")
        assert UNTRUSTED_EVIDENCE_PREFIX in result
        assert UNTRUSTED_EVIDENCE_SUFFIX in result
        assert "some content" in result
        assert "Test" in result

    def test_wrap_empty_returns_empty(self):
        assert _wrap_untrusted("Test", "") == ""
        assert _wrap_untrusted("Test", "  ") == ""


class TestFormatResultsForJudge:
    def test_formats_single_result(self):
        sources = [{
            "subject": "Test subject",
            "sender": "Test <test@example.com>",
            "date": "2024-01-01",
            "list_name": "linux-mm",
            "snippet": "Test snippet",
        }]
        result = _format_results_for_judge(sources)
        assert "Test subject" in result
        assert "test@example.com" in result
        assert "linux-mm" in result
        assert "Test snippet" in result

    def test_formats_multiple_results(self):
        sources = [
            {"subject": "S1", "sender": "A", "date": "", "list_name": "", "snippet": "body1"},
            {"subject": "S2", "sender": "B", "date": "", "list_name": "", "snippet": "body2"},
        ]
        result = _format_results_for_judge(sources)
        assert "Result 0" in result
        assert "Result 1" in result
        assert "S1" in result
        assert "S2" in result

    def test_empty_sources(self):
        assert _format_results_for_judge([]) == ""


class TestFormatKnowledgeContext:
    def test_returns_none_for_empty(self):
        assert _format_knowledge_context([]) == "(none)"

    def test_formats_entities(self):
        entities = [
            {"canonical_name": "Entity1", "summary": "Summary 1"},
            {"entity_id": "e2", "summary": "Summary 2"},
        ]
        result = _format_knowledge_context(entities)
        assert "Entity1" in result
        assert "Summary 1" in result
        assert "e2" in result
        assert "Summary 2" in result


class TestRelevancePrompt:
    def test_system_prompt_mentions_untrusted(self):
        assert "UNTRUSTED" in RELEVANCE_SYSTEM_PROMPT

    def test_user_template_includes_topic(self):
        rendered = RELEVANCE_USER_TEMPLATE.format(
            topic="test topic",
            knowledge_context="(none)",
            results="some results",
        )
        assert "test topic" in rendered
        assert "some results" in rendered


class TestAgentResearchService:
    def test_capability_check_blocks_execution(self):
        from src.agent.research_service import AgentResearchService

        class MockStore:
            async def update_run(self, rid, data):
                self.last_update = data
                return None
            async def get_run(self, rid):
                from src.storage.models import AgentResearchRunRead
                now = dt_datetime.utcnow()
                return AgentResearchRunRead(
                    run_id=rid, topic="test", status="queued",
                    requested_by="tester", agent_user_id="agent:test",
                    agent_name="Test Agent",
                    created_at=now, updated_at=now,
                )

        store = MockStore()
        svc = AgentResearchService(
            agent_store=store,
            knowledge_store=None,
            retriever=None,
            llm_client=None,
            qa=None,
            agent_user_id="agent:test",
            agent_name="Test",
            agent_role="viewer",
        )

        async def run():
            await svc.execute("test-run")

        asyncio.run(run())
        assert hasattr(store, "last_update")
        assert store.last_update.status == "failed"
        assert "capability" in store.last_update.failure_reason

    def test_cancel_stops_execution(self):
        from src.agent.research_service import AgentResearchService

        call_count = {"calls": 0}

        class MockStore:
            def __init__(self):
                self.updates = []

            async def update_run(self, rid, data):
                self.updates.append(data)
                return None

            async def get_run(self, rid):
                call_count["calls"] += 1
                from src.storage.models import AgentResearchRunRead
                now = dt_datetime.utcnow()
                status = "running"
                if call_count["calls"] > 1:
                    status = "cancelled"
                return AgentResearchRunRead(
                    run_id=rid, topic="test", status=status,
                    requested_by="tester", agent_user_id="agent:test",
                    agent_name="Test Agent",
                    budget={"max_iterations": 3, "max_searches": 6, "max_threads": 3},
                    created_at=now, updated_at=now,
                )

            async def add_action(self, data):
                pass

        store = MockStore()
        svc = AgentResearchService(
            agent_store=store,
            knowledge_store=None,
            retriever=None,
            llm_client=None,
            qa=None,
            agent_user_id="agent:test",
            agent_name="Test",
            agent_role="agent",
        )

        async def run():
            await svc.execute("test-run")

        asyncio.run(run())
        assert any(u.status == "cancelled" for u in store.updates), f"Updates: {[u.status for u in store.updates]}"

    def test_execute_checks_agent_capabilities(self):
        from src.agent.research_service import AgentResearchService

        svc = AgentResearchService(
            agent_store=None, knowledge_store=None, retriever=None,
            llm_client=None, qa=None,
            agent_user_id="agent:test", agent_name="Test", agent_role="viewer",
        )
        assert svc._has_capability("agent:research") is False

        svc2 = AgentResearchService(
            agent_store=None, knowledge_store=None, retriever=None,
            llm_client=None, qa=None,
            agent_user_id="agent:test", agent_name="Test", agent_role="agent",
        )
        assert svc2._has_capability("agent:research") is True
        assert svc2._has_capability("agent:create_draft") is True
        assert svc2._has_capability("write") is False

    def test_budget_bounds_are_respected(self):
        from src.agent.research_service import AgentResearchService

        iteration_count = {"count": 0}

        class MockStore:
            def __init__(self):
                self.updates = []

            async def update_run(self, rid, data):
                self.updates.append(data)
                return None

            async def get_run(self, rid):
                from src.storage.models import AgentResearchRunRead
                now = dt_datetime.utcnow()
                return AgentResearchRunRead(
                    run_id=rid, topic="test", status="running",
                    requested_by="tester", agent_user_id="agent:test",
                    agent_name="Test Agent",
                    budget={"max_iterations": 1, "max_searches": 1, "max_threads": 1},
                    created_at=now, updated_at=now,
                )

            async def add_action(self, data):
                if data.action_type == "search":
                    iteration_count["count"] += 1

        class MockRetriever:
            class Semantic:
                async def search(self, query):
                    return None

            semantic_retriever = Semantic()

            async def search(self, query):
                from src.retriever.base import SearchHit, SearchResult
                hit = SearchHit(
                    message_id="msg-1", subject="test", sender="tester",
                    date="2024-01-01", list_name="test-list", score=0.8,
                    snippet="test snippet", source="keyword",
                )
                return SearchResult(hits=[hit], mode="keyword", total=1)

        class MockLLM:
            model = "test-model"

            async def complete_with_usage(self, sys, user, temp, max_tok):
                return ('{"sufficient": false, "judgments": [], "reasoning": "test"}', {"total_tokens": 10})

        class MockKnowledgeStore:
            async def search_entities(self, queries, limit):
                return []

        store = MockStore()
        svc = AgentResearchService(
            agent_store=store,
            knowledge_store=MockKnowledgeStore(),
            retriever=MockRetriever(),
            llm_client=MockLLM(),
            qa=None,
            agent_user_id="agent:test",
            agent_name="Test",
            agent_role="agent",
        )

        async def run():
            await svc.execute("test-run")

        asyncio.run(run())
        assert iteration_count["count"] <= 1
