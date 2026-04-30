"""ask API routes."""

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

router = APIRouter(tags=["ask"])

@router.get("/api/ask/conversations")
async def list_ask_conversations(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取当前用户的 Ask 对话历史列表。"""
    if not state._ask_store:
        raise HTTPException(status_code=503, detail="Ask store not initialized")
    items, total = await state._ask_store.list_conversations(
        user_id=current_user.user_id,
        page=page,
        page_size=page_size,
    )
    return {
        "conversations": [item.model_dump(mode="json") for item in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/api/ask/conversations/{conversation_id}")
async def get_ask_conversation(
    conversation_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取完整对话（含所有轮次）。"""
    if not state._ask_store:
        raise HTTPException(status_code=503, detail="Ask store not initialized")
    conv = await state._ask_store.get_conversation(conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.user_id != current_user.user_id and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    return conv.model_dump(mode="json")


@router.post("/api/ask/conversations")
async def save_ask_conversation(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    """保存或更新 Ask 对话（upsert by conversation_id）。"""
    if not state._ask_store:
        raise HTTPException(status_code=503, detail="Ask store not initialized")
    body = await request.json()
    conv = await state._ask_store.save_conversation(
        conversation_id=body.get("conversation_id"),
        user_id=current_user.user_id,
        display_name=current_user.display_name,
        title=str(body.get("title") or ""),
        model=str(body.get("model") or ""),
        turns=body.get("turns") if isinstance(body.get("turns"), list) else [],
    )
    return conv.model_dump(mode="json")


@router.delete("/api/ask/conversations/{conversation_id}")
async def delete_ask_conversation(
    conversation_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """删除对话及其所有轮次。"""
    if not state._ask_store:
        raise HTTPException(status_code=503, detail="Ask store not initialized")
    conv = await state._ask_store.get_conversation(conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.user_id != current_user.user_id and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    await state._ask_store.delete_conversation(conversation_id)
    return {"deleted": True}


