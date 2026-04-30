"""search API routes."""

from datetime import datetime
from typing import Literal, Optional

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

router = APIRouter(tags=["search"])

class SearchResponse(BaseModel):
    """搜索响应。"""
    query: str
    mode: str
    total: int
    page: int
    page_size: int
    hits: list[dict]


class SummarizeRequest(BaseModel):
    """AI 概括请求."""
    query: str = Field("", description="原始搜索关键词")
    hits: list[dict] = Field(default_factory=list, description="搜索结果列表")


class SummarizeResponse(BaseModel):
    """AI 概括响应."""
    answer: str
    sources: list[dict] = Field(default_factory=list)
    model: str = ""


class AskResponse(BaseModel):
    """邮件 Ask 响应。"""
    question: str
    answer: str
    sources: list[dict] = Field(default_factory=list)
    model: str = ""
    retrieval_mode: str = "agentic_rag"
    search_plan: dict = Field(default_factory=dict)
    executed_queries: list[dict] = Field(default_factory=list)
    threads: list[dict] = Field(default_factory=list)
    retrieval_stats: dict = Field(default_factory=dict)


class AskMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=12000)


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    history: list[AskMessage] = Field(default_factory=list, max_length=12)
    list_name: Optional[str] = None
    sender: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    tags: list[str] = Field(default_factory=list)


class DraftRequest(BaseModel):
    """生成草稿请求."""
    query: str = Field("", description="原始搜索关键词")
    summary: str = Field("", description="AI 概括文本")
    sources: list[dict] = Field(default_factory=list)


class DraftResponse(BaseModel):
    draft_id: str = ""
    knowledge_drafts: list[dict] = Field(default_factory=list)
    annotation_drafts: list[dict] = Field(default_factory=list)
    tag_assignment_drafts: list[dict] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


@router.get("/api/search", response_model=SearchResponse)
async def search(
    q: str = Query("", description="搜索关键词"),
    list_name: Optional[str] = Query(None, description="限定邮件列表"),
    sender: Optional[str] = Query(None, description="发件人模糊匹配"),
    date_from: Optional[datetime] = Query(None, description="起始日期 (ISO 格式)"),
    date_to: Optional[datetime] = Query(None, description="结束日期 (ISO 格式)"),
    has_patch: Optional[bool] = Query(None, description="是否必须包含补丁"),
    tags: Optional[str] = Query(None, description="标签列表（逗号分隔，如 memory,vm）"),
    tag_mode: str = Query("any", description="标签匹配模式: any(任一匹配) 或 all(全部匹配)"),
    sort_by: str = Query("", description="排序字段: relevance(默认) 或 date"),
    sort_order: str = Query("", description="排序顺序: desc(默认) 或 asc"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    mode: str = Query("hybrid", description="检索模式: keyword/semantic/hybrid"),
):
    """全文搜索邮件。

    支持三种模式：
    - keyword: 精确关键词检索（PostgreSQL GIN 全文索引）
    - semantic: 语义向量检索（pgvector，需启用）
    - hybrid: 混合检索（自动路由 + 结果融合）

    支持高级过滤：
    - sender: 发件人模糊匹配
    - date_from/date_to: 日期范围过滤
    - has_patch: 是否包含补丁
    - tags: 标签过滤（逗号分隔）
    - tag_mode: 标签匹配模式（any/all）
    """
    if not state._retriever:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # 解析标签列表
    tag_list = None
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    # 至少要有关键词或过滤条件
    if not q.strip() and not sender and not date_from and not date_to and has_patch is None and not tag_list:
        raise HTTPException(status_code=400, detail="At least one search condition is required")
    if mode == "semantic" and not q.strip():
        raise HTTPException(status_code=400, detail="Semantic search requires a non-empty query")

    query = SearchQuery(
        text=q,
        list_name=list_name,
        sender=sender,
        date_from=date_from,
        date_to=date_to,
        has_patch=has_patch,
        tags=tag_list,
        tag_mode=tag_mode,
        sort_by=sort_by,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
    )

    # 根据 mode 选择检索器
    if mode == "keyword":
        result = await state._retriever.keyword_retriever.search(query)
    elif mode == "semantic":
        result = await state._retriever.semantic_retriever.search(query)
    else:
        result = await state._retriever.search(query)

    return SearchResponse(
        query=q,
        mode=result.mode,
        total=result.total,
        page=page,
        page_size=page_size,
        hits=[
            {
                "message_id": h.message_id,
                "subject": h.subject,
                "sender": h.sender,
                "date": h.date,
                "list_name": h.list_name,
                "thread_id": h.thread_id,
                "has_patch": h.has_patch,
                "tags": h.tags,
                "score": round(h.score, 4),
                "snippet": h.snippet,
                "source": h.source,
            }
            for h in result.hits
        ],
    )


@router.post("/api/ask", response_model=AskResponse)
async def ask(request: AskRequest):
    """Agentic Ask — 生成检索计划、多路召回邮件证据并回答。"""
    if not state._qa:
        raise HTTPException(status_code=503, detail="Ask service not initialized")

    answer = await state._qa.ask(
        question=request.question,
        list_name=request.list_name,
        sender=request.sender,
        date_from=request.date_from,
        date_to=request.date_to,
        tags=[tag.strip() for tag in request.tags if tag.strip()],
        history=[item.model_dump() for item in request.history],
    )

    return AskResponse(
        question=answer.question,
        answer=answer.answer,
        sources=[
            {
                "chunk_id": s.chunk_id,
                "message_id": s.message_id,
                "subject": s.subject,
                "sender": s.sender,
                "date": s.date,
                "list_name": s.list_name,
                "thread_id": s.thread_id,
                "chunk_index": s.chunk_index,
                "snippet": s.snippet,
                "score": round(s.score, 4),
                "source": s.source,
            }
            for s in answer.sources
        ],
        model=answer.model,
        retrieval_mode=answer.retrieval_mode,
        search_plan=answer.search_plan,
        executed_queries=[
            {"query": item.query, "mode": item.mode, "hits": item.hits}
            for item in answer.executed_queries
        ],
        threads=[
            {
                "thread_id": thread.thread_id,
                "subject": thread.subject,
                "message_count": thread.message_count,
                "messages": thread.messages,
            }
            for thread in answer.threads
        ],
        retrieval_stats=answer.retrieval_stats,
    )


@router.post("/api/search/summarize", response_model=SummarizeResponse)
async def summarize_search(request: SummarizeRequest):
    """AI 概括搜索结果 — 基于搜索命中邮件生成引用式概览。

    输入搜索命中的邮件列表，由 LLM 生成带 [Message-ID] 引用的概括。
    """
    if not state._llm_client or not state._llm_client.available:
        raise HTTPException(status_code=503, detail="LLM service not available")

    hits = request.hits[:12]
    if not hits:
        raise HTTPException(status_code=400, detail="No search hits provided")

    evidence_text = "\n\n".join(
        f"[{hit.get('message_id', '')}]\n"
        f"Subject: {hit.get('subject', '')}\n"
        f"From: {hit.get('sender', '')}\n"
        f"Date: {hit.get('date', '')}\n"
        f"Snippet: {hit.get('snippet', '')}"
        for hit in hits
    )

    system_prompt = (
        "You are an expert Linux kernel mailing list research assistant. "
        "Answer based ONLY on the provided evidence. If evidence is insufficient, say so clearly. "
        "Cite sources with Message-ID in square brackets. Keep the answer concise and technical."
    )
    user_prompt = (
        f"Question:\n{request.query}\n\n"
        f"Evidence:\n{evidence_text[:12000]}\n\n"
        "Write a concise answer using only the evidence above. Include citations like [Message-ID]."
    )

    answer_text = await state._llm_client.complete(system_prompt, user_prompt, temperature=0.2, max_tokens=1500)

    if not answer_text:
        answer_text = f"Found {len(hits)} relevant emails but LLM summarization is unavailable. Please review the results manually."

    sources = [
        {
            "message_id": hit.get("message_id", ""),
            "subject": hit.get("subject", ""),
            "sender": hit.get("sender", ""),
            "date": hit.get("date", ""),
            "snippet": hit.get("snippet", ""),
            "thread_id": hit.get("thread_id", ""),
            "list_name": hit.get("list_name", ""),
        }
        for hit in hits
    ]

    return SummarizeResponse(
        answer=answer_text,
        sources=sources,
        model=state._llm_client.model,
    )


@router.post("/api/search/summarize/draft", response_model=DraftResponse)
async def create_summary_draft(
    request: DraftRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """基于 AI 概括结果生成可编辑的 Knowledge / Annotation / Tag 草稿。"""
    if not state._llm_client:
        raise HTTPException(status_code=503, detail="LLM service not initialized")
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    async def tag_exists(tag_name: str) -> bool:
        return await state._tag_store.get_tag_by_name(tag_name) is not None

    bundle = await AskDraftService(llm=state._llm_client).generate(
        query=request.query,
        summary=request.summary,
        sources=request.sources,
        tag_exists=tag_exists,
    )
    response = DraftResponse(
        knowledge_drafts=bundle.knowledge_drafts,
        annotation_drafts=bundle.annotation_drafts,
        tag_assignment_drafts=bundle.tag_assignment_drafts,
        warnings=bundle.warnings,
    )
    response.draft_id = await _persist_draft_response(
        source_type="search_summarize",
        source_ref=request.query,
        question=request.query,
        response=response,
        current_user=current_user,
    )
    return response


@router.post("/api/search/summarize/draft/apply", response_model=DraftApplyResponse)
async def apply_summary_draft(
    request: DraftApplyRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """保存用户确认后的 AI 概括草稿。"""
    return await _apply_draft_request(request, current_user)


@router.post("/api/ask/draft", response_model=DraftResponse)
async def create_ask_draft(
    request: AskResponse,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """基于 Ask 结果生成可编辑的 Knowledge / Annotation / Tag 草稿。"""
    if not state._llm_client:
        raise HTTPException(status_code=503, detail="LLM service not initialized")
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    async def tag_exists(tag_name: str) -> bool:
        return await state._tag_store.get_tag_by_name(tag_name) is not None

    bundle = await AskDraftService(llm=state._llm_client).generate(
        query=request.question,
        summary=request.answer,
        sources=request.sources,
        search_plan=request.search_plan,
        threads=request.threads,
        retrieval_stats=request.retrieval_stats,
        tag_exists=tag_exists,
    )
    response = DraftResponse(
        knowledge_drafts=bundle.knowledge_drafts,
        annotation_drafts=bundle.annotation_drafts,
        tag_assignment_drafts=bundle.tag_assignment_drafts,
        warnings=bundle.warnings,
    )
    response.draft_id = await _persist_draft_response(
        source_type="ask",
        source_ref=request.question,
        question=request.question,
        response=response,
        current_user=current_user,
    )
    return response


@router.post("/api/ask/draft/apply", response_model=DraftApplyResponse)
async def apply_ask_draft(
    request: DraftApplyRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """保存用户确认后的 Ask 草稿。"""
    return await _apply_draft_request(request, current_user)


