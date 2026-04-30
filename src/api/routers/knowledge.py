"""knowledge API routes."""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response

logger = logging.getLogger(__name__)
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from src.api import state
from src.storage.models import (
    KnowledgeRelationRead, KnowledgeEntityRead, KnowledgeEvidenceRead,
    KnowledgeDraftRead, KnowledgeDraftCreate, KnowledgeDraftUpdate,
    KnowledgeEntityCreate, KnowledgeEntityUpdate, KnowledgeRelationCreate,
    KnowledgeRelationUpdate, KnowledgeEvidenceCreate, KnowledgeEvidenceUpdate,
)

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

router = APIRouter(tags=["knowledge"])

class KnowledgeRelationCreateRequest(BaseModel):
    source_entity_id: str = Field(..., min_length=1, max_length=160)
    target_entity_id: str = Field(..., min_length=1, max_length=160)
    relation_type: str = Field(..., min_length=1, max_length=64)
    description: str = Field("", max_length=4000)
    evidence_id: str = Field("", max_length=160)
    meta: dict = Field(default_factory=dict)


class KnowledgeRelationUpdateRequest(BaseModel):
    relation_type: Optional[str] = Field(None, min_length=1, max_length=64)
    description: Optional[str] = Field(None, max_length=4000)
    evidence_id: Optional[str] = Field(None, max_length=160)
    meta: Optional[dict] = None


class KnowledgeRelationListResponse(BaseModel):
    outgoing: list[KnowledgeRelationRead] = Field(default_factory=list)
    incoming: list[KnowledgeRelationRead] = Field(default_factory=list)


class KnowledgeEvidenceCreateRequest(BaseModel):
    source_type: str = Field("email", max_length=64)
    message_id: str = Field("", max_length=512)
    thread_id: str = Field("", max_length=512)
    claim: str = Field("", max_length=4000)
    quote: str = Field("", max_length=12000)
    confidence: str = Field("", max_length=32)
    meta: dict = Field(default_factory=dict)


class KnowledgeEvidenceUpdateRequest(BaseModel):
    source_type: Optional[str] = Field(None, max_length=64)
    message_id: Optional[str] = Field(None, max_length=512)
    thread_id: Optional[str] = Field(None, max_length=512)
    claim: Optional[str] = Field(None, max_length=4000)
    quote: Optional[str] = Field(None, max_length=12000)
    confidence: Optional[str] = Field(None, max_length=32)
    meta: Optional[dict] = None


class KnowledgeDraftListResponse(BaseModel):
    drafts: list[KnowledgeDraftRead] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class KnowledgeDraftCreateRequest(BaseModel):
    source_type: str = Field("manual", max_length=64)
    source_ref: str = Field("", max_length=512)
    question: str = ""
    payload: dict = Field(default_factory=dict)
    status: str = Field("new", max_length=32)
    review_note: str = ""


class KnowledgeDraftUpdateRequest(BaseModel):
    payload: Optional[dict] = None
    status: Optional[str] = Field(None, max_length=32)
    review_note: Optional[str] = None



class KnowledgeEntityMergeRequest(BaseModel):
    source_entity_id: str = Field(..., min_length=1, max_length=160)
    target_entity_id: str = Field(..., min_length=1, max_length=160)


@router.get("/api/knowledge/entities")
async def list_knowledge_entities(
    q: str = Query("", description="搜索关键词"),
    entity_type: str = Query("", description="实体类型过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    items, total = await state._knowledge_store.list_entities(
        q=q,
        entity_type=entity_type,
        page=page,
        page_size=page_size,
    )
    return {
        "entities": [item.model_dump(mode="json") for item in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/api/knowledge/entities/by-message/{message_id:path}")
async def get_knowledge_entities_by_message(message_id: str):
    """根据邮件 Message-ID 反向查找引用了该邮件的知识实体。"""
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    entities = await state._knowledge_store.find_entities_by_message_id(message_id)
    return {
        "message_id": message_id,
        "entities": [e.model_dump(mode="json") for e in entities],
    }


@router.get("/api/knowledge/stats")
async def get_knowledge_stats():
    """获取知识库概览统计数据。"""
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    return await state._knowledge_store.get_stats()


@router.get("/api/knowledge/drafts", response_model=KnowledgeDraftListResponse)
async def list_knowledge_drafts(
    status: str = Query("", description="草稿状态过滤"),
    source_type: str = Query("", description="按来源类型过滤，如 agent_research"),
    created_by_user_id: str = Query("", description="按创建者用户 ID 过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    drafts, total = await state._knowledge_store.list_drafts(
        status=status,
        source_type=source_type,
        created_by_user_id=created_by_user_id,
        page=page,
        page_size=page_size,
    )
    return KnowledgeDraftListResponse(drafts=drafts, total=total, page=page, page_size=page_size)


@router.post("/api/knowledge/drafts", response_model=KnowledgeDraftRead)
async def create_knowledge_draft(
    request: KnowledgeDraftCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    return await state._knowledge_store.create_draft(
        KnowledgeDraftCreate(
            source_type=request.source_type,
            source_ref=request.source_ref,
            question=request.question,
            payload=request.payload,
            status=request.status,
            review_note=request.review_note,
            created_by=current_user.display_name,
            updated_by=current_user.display_name,
            created_by_user_id=current_user.user_id,
            updated_by_user_id=current_user.user_id,
        )
    )


@router.patch("/api/knowledge/drafts/{draft_id}", response_model=KnowledgeDraftRead)
async def update_knowledge_draft(
    draft_id: str,
    request: KnowledgeDraftUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    draft = await state._knowledge_store.update_draft(
        draft_id,
        KnowledgeDraftUpdate(
            payload=request.payload,
            status=request.status,
            review_note=request.review_note,
        ),
        updated_by=current_user.display_name,
        updated_by_user_id=current_user.user_id,
    )
    if draft is None:
        raise HTTPException(status_code=404, detail="Knowledge draft not found")
    return draft


@router.post("/api/knowledge/drafts/{draft_id}/accept", response_model=DraftApplyResponse)
async def accept_knowledge_draft(
    draft_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    draft = await state._knowledge_store.get_draft(draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Knowledge draft not found")
    payload = draft.payload if isinstance(draft.payload, dict) else {}
    result = await _apply_draft_request(
        DraftApplyRequest(
            knowledge_drafts=payload.get("knowledge_drafts") if isinstance(payload.get("knowledge_drafts"), list) else [],
            annotation_drafts=payload.get("annotation_drafts") if isinstance(payload.get("annotation_drafts"), list) else [],
            tag_assignment_drafts=payload.get("tag_assignment_drafts") if isinstance(payload.get("tag_assignment_drafts"), list) else [],
        ),
        current_user,
    )
    await state._knowledge_store.update_draft(
        draft_id,
        KnowledgeDraftUpdate(status="accepted" if not result.errors else "reviewing"),
        updated_by=current_user.display_name,
        updated_by_user_id=current_user.user_id,
    )
    return result


@router.post("/api/knowledge/drafts/{draft_id}/reject", response_model=KnowledgeDraftRead)
async def reject_knowledge_draft(
    draft_id: str,
    request: KnowledgeDraftUpdateRequest = Body(default=KnowledgeDraftUpdateRequest()),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    draft = await state._knowledge_store.update_draft(
        draft_id,
        KnowledgeDraftUpdate(status="rejected", review_note=request.review_note),
        updated_by=current_user.display_name,
        updated_by_user_id=current_user.user_id,
    )
    if draft is None:
        raise HTTPException(status_code=404, detail="Knowledge draft not found")
    return draft


@router.post("/api/knowledge/entities/merge")
async def merge_knowledge_entities(
    request: KnowledgeEntityMergeRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    try:
        result = await state._knowledge_store.merge_entities(
            source_entity_id=request.source_entity_id,
            target_entity_id=request.target_entity_id,
            updated_by=current_user.display_name,
            updated_by_user_id=current_user.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "source": result["source"].model_dump(mode="json"),
        "target": result["target"].model_dump(mode="json"),
        "moved": result["moved"],
    }


@router.post("/api/knowledge/entities")
async def create_knowledge_entity(
    request: "KnowledgeEntityCreateRequest",
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    try:
        entity = await state._knowledge_store.create(
            KnowledgeEntityCreate(
                entity_type=request.entity_type,
                canonical_name=request.canonical_name,
                slug=request.slug,
                entity_id=request.entity_id,
                aliases=request.aliases,
                summary=request.summary,
                description=request.description,
                status=request.status,
                meta=request.meta,
                created_by=current_user.display_name,
                updated_by=current_user.display_name,
                created_by_user_id=current_user.user_id,
                updated_by_user_id=current_user.user_id,
            )
        )
    except Exception as e:
        logger.exception("Failed to create knowledge entity")
        raise HTTPException(status_code=400, detail=str(e))

    similar = await state._knowledge_store.find_similar(
        entity.canonical_name,
        entity.entity_type,
    )
    similar = [s for s in similar if s.entity_id != entity.entity_id]
    return {
        "entity": entity.model_dump(mode="json"),
        "suggestions": {
            "duplicates": [s.model_dump(mode="json") for s in similar],
        },
    }


@router.get("/api/knowledge/entities/{entity_id}/relations", response_model=KnowledgeRelationListResponse)
async def list_knowledge_relations(entity_id: str):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    entity = await state._knowledge_store.get(entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    outgoing, incoming = await state._knowledge_store.list_relations(entity_id)
    return KnowledgeRelationListResponse(outgoing=outgoing, incoming=incoming)


@router.get("/api/knowledge/entities/{entity_id}/evidence", response_model=list[KnowledgeEvidenceRead])
async def list_knowledge_evidence(entity_id: str):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    entity = await state._knowledge_store.get(entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    return await state._knowledge_store.list_evidence(entity_id)


@router.post("/api/knowledge/entities/{entity_id}/evidence", response_model=KnowledgeEvidenceRead)
async def create_knowledge_evidence(
    entity_id: str,
    request: KnowledgeEvidenceCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    try:
        return await state._knowledge_store.create_evidence(
            KnowledgeEvidenceCreate(
                entity_id=entity_id,
                source_type=request.source_type,
                message_id=request.message_id,
                thread_id=request.thread_id,
                claim=request.claim,
                quote=request.quote,
                confidence=request.confidence,
                meta=request.meta,
                created_by=current_user.display_name,
                updated_by=current_user.display_name,
                created_by_user_id=current_user.user_id,
                updated_by_user_id=current_user.user_id,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/knowledge/entities/{entity_id}", response_model=KnowledgeEntityRead)
async def get_knowledge_entity(entity_id: str):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    entity = await state._knowledge_store.get(entity_id.strip())
    if entity is None:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    return entity


@router.patch("/api/knowledge/evidence/{evidence_id}", response_model=KnowledgeEvidenceRead)
async def update_knowledge_evidence(
    evidence_id: str,
    request: KnowledgeEvidenceUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    evidence = await state._knowledge_store.update_evidence(
        evidence_id,
        KnowledgeEvidenceUpdate(
            source_type=request.source_type,
            message_id=request.message_id,
            thread_id=request.thread_id,
            claim=request.claim,
            quote=request.quote,
            confidence=request.confidence,
            meta=request.meta,
        ),
        updated_by=current_user.display_name,
        updated_by_user_id=current_user.user_id,
    )
    if evidence is None:
        raise HTTPException(status_code=404, detail="Knowledge evidence not found")
    return evidence


@router.delete("/api/knowledge/evidence/{evidence_id}")
async def delete_knowledge_evidence(
    evidence_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    deleted = await state._knowledge_store.delete_evidence(evidence_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Knowledge evidence not found")
    return {"deleted": True}


@router.post("/api/knowledge/relations", response_model=KnowledgeRelationRead)
async def create_knowledge_relation(
    request: KnowledgeRelationCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    try:
        return await state._knowledge_store.create_relation(
            KnowledgeRelationCreate(
                source_entity_id=request.source_entity_id,
                target_entity_id=request.target_entity_id,
                relation_type=request.relation_type,
                description=request.description,
                evidence_id=request.evidence_id,
                meta=request.meta,
                created_by=current_user.display_name,
                updated_by=current_user.display_name,
                created_by_user_id=current_user.user_id,
                updated_by_user_id=current_user.user_id,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/api/knowledge/relations/{relation_id}", response_model=KnowledgeRelationRead)
async def update_knowledge_relation(
    relation_id: str,
    request: KnowledgeRelationUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    try:
        relation = await state._knowledge_store.update_relation(
            relation_id=relation_id,
            data=KnowledgeRelationUpdate(
                relation_type=request.relation_type,
                description=request.description,
                evidence_id=request.evidence_id,
                meta=request.meta,
            ),
            updated_by=current_user.display_name,
            updated_by_user_id=current_user.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if relation is None:
        raise HTTPException(status_code=404, detail="Knowledge relation not found")
    return relation


@router.delete("/api/knowledge/relations/{relation_id}")
async def delete_knowledge_relation(
    relation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    deleted = await state._knowledge_store.delete_relation(relation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Knowledge relation not found")
    return {"deleted": True}


@router.patch("/api/knowledge/entities/{entity_id}", response_model=KnowledgeEntityRead)
async def update_knowledge_entity(
    entity_id: str,
    request: "KnowledgeEntityUpdateRequest",
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    entity = await state._knowledge_store.update(
        entity_id=entity_id.strip(),
        data=KnowledgeEntityUpdate(
            canonical_name=request.canonical_name,
            aliases=request.aliases,
            summary=request.summary,
            description=request.description,
            status=request.status,
            meta=request.meta,
        ),
        updated_by=current_user.display_name,
        updated_by_user_id=current_user.user_id,
    )
    if entity is None:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    return entity


@router.delete("/api/knowledge/entities/{entity_id}")
async def delete_knowledge_entity(
    entity_id: str,
    force: bool = Query(False, description="强制删除，级联删除关联关系"),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """删除知识实体。

    - force=false: 若存在关联关系则返回 409，列出阻挡的关系。
    - force=true: 级联删除所有关联关系和标签分配。
    """
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    ok, blocked = await state._knowledge_store.delete_entity(entity_id.strip(), force=force)
    if not ok and not blocked:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    if not ok:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Entity has relations. Use force=true to cascade delete.",
                "blocked_by": blocked,
            },
        )
    return {"deleted": True}


@router.get("/api/knowledge/entities/{entity_id}/graph")
async def get_knowledge_graph(
    entity_id: str,
    depth: int = Query(2, ge=1, le=3, description="遍历深度（1-3）"),
    relation_type: str = Query("", description="关系类型过滤，逗号分隔"),
):
    """获取以指定实体为中心的邻域子图（BFS 遍历）。

    Returns:
        nodes: 子图中的所有实体。
        edges: 子图中的所有关系（含 source_entity/target_entity 详情）。
        center: 中心实体 ID。
        depth: 实际遍历深度。
    """
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    types = [t.strip() for t in relation_type.split(",") if t.strip()] if relation_type else None
    graph = await state._knowledge_store.get_graph(entity_id, depth=depth, relation_types=types)
    return graph


class KnowledgeEntityCreateRequest(BaseModel):
    entity_type: str = Field(..., min_length=1, max_length=64)
    canonical_name: str = Field(..., min_length=1, max_length=256)
    slug: str = Field("", max_length=160)
    entity_id: str = Field("", max_length=160)
    aliases: list[str] = Field(default_factory=list)
    summary: str = Field("", max_length=2000)
    description: str = Field("", max_length=20000)
    status: str = Field("active", max_length=32)
    meta: dict = Field(default_factory=dict)


class KnowledgeEntityUpdateRequest(BaseModel):
    canonical_name: Optional[str] = Field(None, min_length=1, max_length=256)
    aliases: Optional[list[str]] = None
    summary: Optional[str] = Field(None, max_length=2000)
    description: Optional[str] = Field(None, max_length=20000)
    status: Optional[str] = Field(None, max_length=32)
    meta: Optional[dict] = None


