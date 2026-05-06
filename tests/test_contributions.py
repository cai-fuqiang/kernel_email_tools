"""Tests for contributions lookup API.

PLAN-34001: 验证请求参数、超限、visibility 过滤的纯函数级行为.
DB 集成测试在 SQL 上层运行时验证；此处保留可在不连库情况下运行的单元测试。
"""

import pytest

from src.api.routers.contributions import (
    ContributionLookupRequest,
    ContributionLookupResponse,
    ContributionStats,
    MAX_MESSAGE_IDS,
    MAX_THREAD_IDS,
    _annotation_visibility_filters,
)
from src.storage.models import AnnotationORM


class TestRequestValidation:
    def test_empty_request_defaults(self):
        req = ContributionLookupRequest()
        assert req.message_ids == []
        assert req.thread_ids == []

    def test_explicit_lists(self):
        req = ContributionLookupRequest(
            message_ids=["<m1>", "<m2>"],
            thread_ids=["<t1>"],
        )
        assert req.message_ids == ["<m1>", "<m2>"]
        assert req.thread_ids == ["<t1>"]

    def test_response_default_empty(self):
        resp = ContributionLookupResponse()
        assert resp.by_message_id == {}
        assert resp.by_thread_id == {}


class TestContributionStats:
    def test_default_zero(self):
        s = ContributionStats()
        assert s.knowledge_evidence_count == 0
        assert s.annotation_count == 0
        assert s.draft_count is None

    def test_thread_stats_with_draft(self):
        s = ContributionStats(
            knowledge_evidence_count=3,
            annotation_count=2,
            draft_count=1,
        )
        assert s.knowledge_evidence_count == 3
        assert s.annotation_count == 2
        assert s.draft_count == 1


class TestVisibilityFilters:
    def test_anonymous_user_only_public(self):
        filters = _annotation_visibility_filters(None)
        # 匿名只看 public
        assert len(filters) == 1
        # 不便于直接检查 SQL 表达式内容；通过 str() 包含 visibility 即可
        s = str(filters[0])
        assert "visibility" in s

    def test_logged_in_user_sees_public_or_own(self):
        filters = _annotation_visibility_filters("user-abc")
        assert len(filters) == 1
        s = str(filters[0])
        # 应该是 OR 表达式：visibility=public 或 author_user_id=...
        assert "visibility" in s
        assert "author_user_id" in s


class TestLimits:
    def test_max_message_ids_constant(self):
        # 防止后续无意降低上限
        assert MAX_MESSAGE_IDS == 200

    def test_max_thread_ids_constant(self):
        assert MAX_THREAD_IDS == 100


class TestAnnotationORMHasVisibilityField:
    """烟雾测试：保证 AnnotationORM 上仍存在 visibility / author_user_id 字段，
    避免 contributions 视图随意失效。"""

    def test_orm_has_visibility(self):
        assert hasattr(AnnotationORM, "visibility")

    def test_orm_has_author_user_id(self):
        assert hasattr(AnnotationORM, "author_user_id")

    def test_orm_has_thread_id(self):
        assert hasattr(AnnotationORM, "thread_id")