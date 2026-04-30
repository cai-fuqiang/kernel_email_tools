"""manual API routes."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from src.api import state
from src.api.deps import (
    CurrentUser, get_current_user, get_optional_current_user, require_roles,
    _is_admin, _normalize_role, _normalize_visibility, _normalize_approval_status,
    _normalize_publish_status, _ensure_public_write_allowed, _capabilities_for_role,
    _ensure_tag_manage_access, _resolve_tag_for_write, _ensure_tag_assignment_write_allowed,
    _ensure_tag_assignment_delete_access, _ensure_annotation_manage_access,
    _ensure_annotation_publish_request_access, _to_current_user_read, _get_user_orm,
    _hash_password, _verify_password, _hash_session_token, _serialize_user,
    _create_user_session, _clear_session_cookie, _revoke_session_by_token,
    _set_session_cookie, _session_cookie_name, _session_ttl_hours,
    _allow_public_registration, _require_admin_approval, _allow_header_auth_fallback,
    _local_auth_config, _header_name, _pbkdf2_iterations, _fallback_user,
    _resolve_user_from_session,
)
from src.api.schemas import AnnotationResponse, DraftApplyRequest, DraftApplyResponse

router = APIRouter(tags=["manual"])

class ManualSearchResponse(BaseModel):
    """手册搜索响应。"""
    query: str
    mode: str
    total: int
    hits: list[dict]


class ManualAskResponse(BaseModel):
    """手册问答响应。"""
    question: str
    answer: str
    sources: list[dict]
    model: str
    retrieval_mode: str


class ManualStatsResponse(BaseModel):
    """手册统计信息响应。"""
    total_chunks: int
    by_manual_type: dict
    by_content_type: dict


@router.get("/api/manual/search", response_model=ManualSearchResponse)
async def manual_search(
    q: str = Query(..., min_length=1, description="搜索关键词"),
    manual_type: Optional[str] = Query(None, description="手册类型 (如 intel_sdm)"),
    content_type: Optional[str] = Query(None, description="内容类型过滤"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
):
    """全文搜索芯片手册文档。

    支持按手册类型、内容类型过滤。
    """
    if not state._manual_retriever:
        raise HTTPException(
            status_code=503,
            detail="Manual storage not initialized. Please configure storage.manual in settings.yaml"
        )

    query = ManualSearchQuery(
        text=q,
        manual_type=manual_type,
        content_type=content_type,
        page=page,
        page_size=page_size,
    )

    result = await state._manual_retriever.search(query)

    return ManualSearchResponse(
        query=q,
        mode=result.mode,
        total=result.total,
        hits=[
            {
                "chunk_id": h.chunk_id,
                "manual_type": h.manual_type,
                "manual_version": h.manual_version,
                "volume": h.volume,
                "chapter": h.chapter,
                "section": h.section,
                "section_title": h.section_title,
                "content_type": h.content_type,
                "content": h.content[:500],  # 限制内容长度
                "page_start": h.page_start + 1,  # 转为 1-based
                "page_end": h.page_end + 1,
                "score": round(h.score, 4),
                "snippet": h.snippet,
            }
            for h in result.hits
        ],
    )


@router.get("/api/manual/ask", response_model=ManualAskResponse)
async def manual_ask(
    q: str = Query(..., min_length=1, description="问题"),
    manual_type: Optional[str] = Query(None, description="限定手册类型"),
    content_type: Optional[str] = Query(None, description="限定内容类型"),
):
    """RAG 问答 — 基于芯片手册上下文回答问题。

    Pipeline: 问题 → 文档检索 → 上下文构建 → LLM 生成（或 fallback 到摘要）
    """
    if not state._manual_qa:
        raise HTTPException(
            status_code=503,
            detail="Manual storage not initialized. Please configure storage.manual in settings.yaml"
        )

    answer = await state._manual_qa.ask(
        question=q,
        manual_type=manual_type,
        content_type=content_type,
    )

    return ManualAskResponse(
        question=answer.question,
        answer=answer.answer,
        sources=[
            {
                "chunk_id": s.chunk_id,
                "section": s.section,
                "section_title": s.section_title,
                "manual_type": s.manual_type,
                "page_start": s.page_start + 1,
                "page_end": s.page_end + 1,
                "snippet": s.snippet,
            }
            for s in answer.sources
        ],
        model=answer.model,
        retrieval_mode=answer.retrieval_mode,
    )


@router.get("/api/manual/stats", response_model=ManualStatsResponse)
async def manual_stats():
    """获取芯片手册数据库统计信息。"""
    if not state._manual_storage:
        raise HTTPException(
            status_code=503,
            detail="Manual storage not initialized"
        )

    stats = await state._manual_storage.get_stats()

    return ManualStatsResponse(
        total_chunks=stats["total"],
        by_manual_type=stats["by_manual_type"],
        by_content_type=stats["by_content_type"],
    )


