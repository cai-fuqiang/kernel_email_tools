"""Tests for AI agent research service."""

import asyncio
from datetime import datetime as dt_datetime

import pytest

from src.agent.research_service import (
    AGENT_CAPABILITIES,
    AgentResearchService,
    RELEVANCE_SYSTEM_PROMPT,
    RELEVANCE_USER_TEMPLATE,
    UNTRUSTED_EVIDENCE_PREFIX,
    UNTRUSTED_EVIDENCE_SUFFIX,
    _build_query,
    _format_knowledge_context,
    _format_results_for_judge,
    _wrap_untrusted,
)


# --------------------------------------------------------------------------------------
# Pure helpers
# --------------------------------------------------------------------------------------


class TestUntrustedEvidenceWrapping:
    def test_wrap_adds_prefix_and_suffix(self):
        result = _wrap_untrusted("Test", "some content")
        assert UNTRUSTED_EVIDENCE_PREFIX in result
        assert UNTRUSTED_EVIDENCE_SUFFIX in result
        assert "some content" in result
        assert "Test" in result

    def test_wrap_empty_keeps_markers_with_placeholder(self):
        # Empty content still gets wrapped so the LLM consistently sees the markers.
        result = _wrap_untrusted("Test", "")
        assert UNTRUSTED_EVIDENCE_PREFIX in result
        assert UNTRUSTED_EVIDENCE_SUFFIX in result
        assert "(no content)" in result

    def test_wrap_whitespace_treated_as_empty(self):
        result = _wrap_untrusted("Test", "  \n\t  ")
        assert "(no content)" in result


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
        # Empty source list yields a placeholder so the prompt doesn't hint at empty sections
        assert _format_results_for_judge([]) == "(no results)"


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


class TestBuildQuery:
    def test_uses_topic_when_query_text_empty(self):
        q = _build_query("my topic", {}, "", 5)
        assert q.text == "my topic"
        assert q.top_k == 5

    def test_filters_passed_through(self):
        q = _build_query("topic", {"list_name": "linux-mm", "sender": "alice", "has_patch": True}, "refined", 3)
        assert q.text == "refined"
        assert q.list_name == "linux-mm"
        assert q.sender == "alice"
        assert q.has_patch is True

    def test_empty_string_filters_become_none(self):
        q = _build_query("topic", {"list_name": "  ", "sender": ""}, "", 3)
        assert q.list_name is None
        assert q.sender is None


# --------------------------------------------------------------------------------------
# Capability checks
# --------------------------------------------------------------------------------------


class TestCapabilities:
    def test_agent_role_has_research_caps(self):
        svc = AgentResearchService(
            agent_store=None, knowledge_store=None, retriever=None,
            llm_client=None, qa=None,
            agent_user_id="agent:test", agent_name="Test", agent_role="agent",
        )
        assert svc._has_capability("agent:research") is True
        assert svc._has_capability("agent:create_draft") is True
        assert svc._has_capability("read") is True

    def test_agent_role_lacks_admin_caps(self):
        svc = AgentResearchService(
            agent_store=None, knowledge_store=None, retriever=None,
            llm_client=None, qa=None,
            agent_user_id="agent:test", agent_name="Test", agent_role="agent",
        )
        # agent role is NOT given write capability — bypasses draft review otherwise
        assert svc._has_capability("write") is False
        assert svc._has_capability("admin") is False

    def test_non_agent_role_blocked(self):
        for role in ["viewer", "editor", "admin", ""]:
            svc = AgentResearchService(
                agent_store=None, knowledge_store=None, retriever=None,
                llm_client=None, qa=None,
                agent_user_id="agent:test", agent_name="Test", agent_role=role,
            )
            assert svc._has_capability("agent:research") is False, f"role={role} should be blocked"
            assert svc._has_capability("read") is False

    def test_agent_capabilities_set_is_immutable(self):
        # frozenset means we cannot accidentally add capabilities at runtime.
        with pytest.raises(AttributeError):
            AGENT_CAPABILITIES.add("write")  # type: ignore[attr-defined]


# --------------------------------------------------------------------------------------
# execute() lifecycle
# --------------------------------------------------------------------------------------


def _make_run(run_id: str, status: str = "queued", budget: dict | None = None):
    """Build a minimal AgentResearchRunRead for tests."""
    from src.storage.models import AgentResearchRunRead
    now = dt_datetime.utcnow()
    return AgentResearchRunRead(
        run_id=run_id, topic="test topic", status=status,
        requested_by="tester", agent_user_id="agent:test", agent_name="Test Agent",
        budget=budget or {"max_iterations": 3, "max_searches": 6, "max_threads": 3},
        filters={},
        created_at=now, updated_at=now,
    )


class _BaseMockStore:
    """Common helper: exposes update history and configurable get_run sequence."""

    def __init__(self, run_states: list[str], budget: dict | None = None):
        self._run_states = list(run_states)
        self._budget = budget
        self.updates: list = []
        self.actions: list = []

    async def update_run(self, run_id, data):
        self.updates.append(data)
        return None

    async def get_run(self, run_id):
        if not self._run_states:
            return _make_run(run_id, "running", self._budget)
        state = self._run_states.pop(0) if len(self._run_states) > 1 else self._run_states[0]
        return _make_run(run_id, state, self._budget)

    async def add_action(self, data):
        self.actions.append(data)


class TestExecute:
    def test_capability_failure_marks_run_failed(self):
        store = _BaseMockStore(["queued"])
        svc = AgentResearchService(
            agent_store=store, knowledge_store=None, retriever=None,
            llm_client=None, qa=None,
            agent_user_id="agent:test", agent_name="Test", agent_role="viewer",
        )
        asyncio.run(svc.execute("test-run"))
        assert any(u.status == "failed" for u in store.updates)
        assert any("capability" in (u.failure_reason or "") for u in store.updates)

    def test_cancel_during_loop_stops_execution(self):
        # First get_run = running (start), subsequent = cancelled
        store = _BaseMockStore(["running", "cancelled"])
        svc = AgentResearchService(
            agent_store=store, knowledge_store=None, retriever=None,
            llm_client=None, qa=None,
            agent_user_id="agent:test", agent_name="Test", agent_role="agent",
        )
        asyncio.run(svc.execute("test-run"))
        assert any(u.status == "cancelled" for u in store.updates)
        # No search action recorded because we cancelled before the first iteration
        assert not any(getattr(a, "action_type", "") == "search" for a in store.actions)

    def test_budget_caps_iterations(self):
        budget = {"max_iterations": 1, "max_searches": 1, "max_threads": 1}
        store = _BaseMockStore(["running"], budget=budget)
        svc = AgentResearchService(
            agent_store=store,
            knowledge_store=_MockKnowledgeStore(),
            retriever=_MockRetriever(),
            llm_client=_MockLLM(sufficient=False),
            qa=None,
            agent_user_id="agent:test", agent_name="Test", agent_role="agent",
        )
        asyncio.run(svc.execute("test-run"))
        # With max_iterations=1, max_searches=1 we should see exactly 1 search action.
        search_actions = [a for a in store.actions if getattr(a, "action_type", "") == "search"]
        assert len(search_actions) == 1

    def test_sufficient_evidence_breaks_loop_early(self):
        budget = {"max_iterations": 5, "max_searches": 5, "max_threads": 3}
        store = _BaseMockStore(["running"], budget=budget)
        svc = AgentResearchService(
            agent_store=store,
            knowledge_store=_MockKnowledgeStore(),
            retriever=_MockRetriever(),
            llm_client=_MockLLM(sufficient=True),
            qa=None,
            agent_user_id="agent:test", agent_name="Test", agent_role="agent",
        )
        asyncio.run(svc.execute("test-run"))
        # Only the first iteration should run search since judge says sufficient
        search_actions = [a for a in store.actions if getattr(a, "action_type", "") == "search"]
        assert len(search_actions) == 1


# --------------------------------------------------------------------------------------
# Mock collaborators
# --------------------------------------------------------------------------------------


class _MockSemantic:
    async def search(self, query):
        return None


class _MockRetriever:
    semantic_retriever = _MockSemantic()

    async def search(self, query):
        from src.retriever.base import SearchHit, SearchResult
        hit = SearchHit(
            message_id="msg-1", subject="test", sender="tester",
            date="2024-01-01", list_name="test-list", score=0.8,
            snippet="test snippet", source="keyword",
        )
        return SearchResult(hits=[hit], mode="keyword", total=1)


class _MockKnowledgeStore:
    async def search_entities(self, queries, limit):
        return []

    async def create_draft(self, data):
        from src.storage.models import KnowledgeDraftRead
        now = dt_datetime.utcnow()
        return KnowledgeDraftRead(
            draft_id="kdraft:test",
            source_type=data.source_type,
            source_ref=data.source_ref,
            question=data.question,
            payload=data.payload,
            status=data.status,
            created_by=data.created_by,
            updated_by=data.updated_by,
            created_at=now,
            updated_at=now,
        )

    async def update_draft(self, draft_id, data, updated_by, updated_by_user_id=None):
        return None


class _MockLLM:
    model = "test-model"

    def __init__(self, sufficient: bool = True):
        self._sufficient = sufficient

    @property
    def available(self) -> bool:
        return True

    async def complete_with_usage(self, system, user, temperature=0.2, max_tokens=1500):
        if "sufficient" in user.lower():
            # relevance judge call
            payload = (
                '{"sufficient": ' + ("true" if self._sufficient else "false")
                + ', "judgments": [], "suggested_queries": [], "reasoning": "test"}'
            )
        else:
            # query refinement call
            payload = '{"refined_queries": [], "rationale": "test"}'
        return payload, {"total_tokens": 10}

    async def complete(self, system, user, temperature=0.2, max_tokens=1500):
        # Fallback for AskDraftService
        return ""


# --------------------------------------------------------------------------------------
# Cancel / retry public API
# --------------------------------------------------------------------------------------


class TestCancelRetry:
    def test_cancel_marks_run_cancelled(self):
        store = _BaseMockStore(["running"])
        svc = AgentResearchService(
            agent_store=store, knowledge_store=None, retriever=None,
            llm_client=None, qa=None,
            agent_user_id="agent:test", agent_name="Test", agent_role="agent",
        )
        asyncio.run(svc.cancel("test-run"))
        assert store.updates
        assert store.updates[-1].status == "cancelled"
        assert store.updates[-1].failure_reason == "cancelled_by_user"

    def test_retry_returns_none_for_missing_run(self):
        class EmptyStore(_BaseMockStore):
            async def get_run(self, run_id):
                return None

        store = EmptyStore([])
        svc = AgentResearchService(
            agent_store=store, knowledge_store=None, retriever=None,
            llm_client=None, qa=None,
            agent_user_id="agent:test", agent_name="Test", agent_role="agent",
        )
        result = asyncio.run(svc.retry("missing", "user-1", "user-1"))
        assert result is None