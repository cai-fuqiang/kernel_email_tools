"""Contribution lookup API — 查询邮件/线程在知识库中已留下的痕迹.

PLAN-34001: 在 Search 命中卡片、结果来源区、ThreadDrawer 标题栏向用户展示
该 message_id / thread_id 已经被引用为多少 knowledge evidence、附了多少 annotation、
有多少 pending knowledge draft。

设计原则:
- 一次请求批量返回，避免 N+1
- 计数查询是「轻提示」, lookup 失败必须不阻塞主流程（前端容错）
- 遵守 visibility: 用户只能看到自己可见的 annotation 计数
- knowledge_evidence / knowledge_drafts 当前没有 visibility 字段，全部计入
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from src.api import state
from src.api.deps import CurrentUser, get_optional_current_user
from src.storage.models import (
    AnnotationORM,
    KnowledgeDraftORM,
    KnowledgeEvidenceORM,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["contributions"])

# 防滥用上限
MAX_MESSAGE_IDS = 200
MAX_THREAD_IDS = 100

# Annotation 中关联到邮件的 target_type 集合
EMAIL_ANNOTATION_TARGET_TYPES = ("email_thread", "email_message", "email_paragraph")


class ContributionLookupRequest(BaseModel):
    """贡献度批量查询请求."""

    message_ids: list[str] = Field(
        default_factory=list,
        description="邮件 Message-ID 列表",
    )
    thread_ids: list[str] = Field(
        default_factory=list,
        description="线程 ID 列表",
    )


class ContributionStats(BaseModel):
    """单个 message_id 或 thread_id 的贡献统计."""

    knowledge_evidence_count: int = 0
    annotation_count: int = 0
    draft_count: Optional[int] = None  # 仅 thread 级返回


class ContributionLookupResponse(BaseModel):
    """贡献度批量查询响应."""

    by_message_id: dict[str, ContributionStats] = Field(default_factory=dict)
    by_thread_id: dict[str, ContributionStats] = Field(default_factory=dict)


def _annotation_visibility_filters(viewer_user_id: Optional[str]):
    """与 UnifiedAnnotationStore._visibility_filters 保持一致的可见性过滤."""
    if viewer_user_id:
        return [
            or_(
                AnnotationORM.visibility == "public",
                AnnotationORM.author_user_id == viewer_user_id,
            )
        ]
    return [AnnotationORM.visibility == "public"]


@router.post("/api/contributions/lookup", response_model=ContributionLookupResponse)
async def lookup_contributions(
    payload: ContributionLookupRequest,
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
) -> ContributionLookupResponse:
    """批量查询 message_id / thread_id 的知识库贡献度.

    返回:
      - by_message_id: 每个 message_id 被多少 evidence 引用、有多少 annotation
      - by_thread_id: 每个 thread_id 被多少 evidence 引用、有多少 annotation、
        有多少 pending knowledge draft

    访问控制:
      - 不需要登录, 但匿名用户只能看到 public annotation 的计数
      - knowledge_evidence / knowledge_drafts 当前无 visibility 字段, 全部计入
    """
    # 去重 + 截断 + 去除空字符串
    message_ids = list({mid for mid in payload.message_ids if mid})
    thread_ids = list({tid for tid in payload.thread_ids if tid})

    if len(message_ids) > MAX_MESSAGE_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"message_ids exceeds limit {MAX_MESSAGE_IDS}",
        )
    if len(thread_ids) > MAX_THREAD_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"thread_ids exceeds limit {MAX_THREAD_IDS}",
        )

    by_message_id: dict[str, ContributionStats] = {}
    by_thread_id: dict[str, ContributionStats] = {}

    if not message_ids and not thread_ids:
        return ContributionLookupResponse(
            by_message_id=by_message_id,
            by_thread_id=by_thread_id,
        )

    storage = state._storage
    if storage is None:
        raise HTTPException(status_code=503, detail="storage not ready")

    viewer_user_id = current_user.user_id if current_user else None

    try:
        async with storage.session_factory() as session:
            # ============================================================
            # message_id 维度
            # ============================================================
            if message_ids:
                # knowledge_evidence count by message_id
                ev_msg_stmt = (
                    select(
                        KnowledgeEvidenceORM.message_id,
                        func.count(KnowledgeEvidenceORM.id),
                    )
                    .where(KnowledgeEvidenceORM.message_id.in_(message_ids))
                    .group_by(KnowledgeEvidenceORM.message_id)
                )
                ev_msg_rows = (await session.execute(ev_msg_stmt)).all()
                ev_msg_count: dict[str, int] = {row[0]: int(row[1]) for row in ev_msg_rows}

                # annotation count by target_ref (target_type in email_message/paragraph)
                # email_paragraph 的 target_ref 形如 "<message_id>#<paragraph>",
                # 单纯按 target_ref == message_id 会漏掉; 因此用 LIKE 兜底匹配。
                # 为了简化, 第一版仅匹配 target_type=email_message AND target_ref==message_id
                # paragraph 级 annotation 归属到 thread (thread_id 维度) 更合适。
                ann_msg_stmt = (
                    select(
                        AnnotationORM.target_ref,
                        func.count(AnnotationORM.id),
                    )
                    .where(
                        AnnotationORM.target_type == "email_message",
                        AnnotationORM.target_ref.in_(message_ids),
                        *_annotation_visibility_filters(viewer_user_id),
                    )
                    .group_by(AnnotationORM.target_ref)
                )
                ann_msg_rows = (await session.execute(ann_msg_stmt)).all()
                ann_msg_count: dict[str, int] = {row[0]: int(row[1]) for row in ann_msg_rows}

                for mid in message_ids:
                    ev = ev_msg_count.get(mid, 0)
                    an = ann_msg_count.get(mid, 0)
                    if ev or an:
                        by_message_id[mid] = ContributionStats(
                            knowledge_evidence_count=ev,
                            annotation_count=an,
                        )

            # ============================================================
            # thread_id 维度
            # ============================================================
            if thread_ids:
                ev_thread_stmt = (
                    select(
                        KnowledgeEvidenceORM.thread_id,
                        func.count(KnowledgeEvidenceORM.id),
                    )
                    .where(KnowledgeEvidenceORM.thread_id.in_(thread_ids))
                    .group_by(KnowledgeEvidenceORM.thread_id)
                )
                ev_thread_rows = (await session.execute(ev_thread_stmt)).all()
                ev_thread_count: dict[str, int] = {row[0]: int(row[1]) for row in ev_thread_rows}

                # thread 级 annotation 计数: 用冗余字段 thread_id 一次拿到全部
                # (覆盖 email_thread / email_message / email_paragraph 三种 target_type)
                ann_thread_stmt = (
                    select(
                        AnnotationORM.thread_id,
                        func.count(AnnotationORM.id),
                    )
                    .where(
                        AnnotationORM.thread_id.in_(thread_ids),
                        AnnotationORM.annotation_type == "email",
                        *_annotation_visibility_filters(viewer_user_id),
                    )
                    .group_by(AnnotationORM.thread_id)
                )
                ann_thread_rows = (await session.execute(ann_thread_stmt)).all()
                ann_thread_count: dict[str, int] = {
                    row[0]: int(row[1]) for row in ann_thread_rows
                }

                # knowledge draft 计数: source_ref 包含 thread_id 视为命中
                # status='new' 或 'pending' 视为待审核
                draft_stmt = (
                    select(
                        KnowledgeDraftORM.source_ref,
                        func.count(KnowledgeDraftORM.id),
                    )
                    .where(
                        KnowledgeDraftORM.source_ref.in_(thread_ids),
                        KnowledgeDraftORM.status.in_(("new", "pending")),
                    )
                    .group_by(KnowledgeDraftORM.source_ref)
                )
                draft_rows = (await session.execute(draft_stmt)).all()
                draft_count: dict[str, int] = {row[0]: int(row[1]) for row in draft_rows}

                for tid in thread_ids:
                    ev = ev_thread_count.get(tid, 0)
                    an = ann_thread_count.get(tid, 0)
                    dr = draft_count.get(tid, 0)
                    if ev or an or dr:
                        by_thread_id[tid] = ContributionStats(
                            knowledge_evidence_count=ev,
                            annotation_count=an,
                            draft_count=dr,
                        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("contribution lookup failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="contribution lookup failed")

    return ContributionLookupResponse(
        by_message_id=by_message_id,
        by_thread_id=by_thread_id,
    )
