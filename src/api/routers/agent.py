"""agent API routes."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from src.storage.models import AgentResearchRunCreate, AgentResearchRunRead, AgentResearchRunUpdate, AgentRunActionRead

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

router = APIRouter(tags=["agent"])

class AgentResearchBudget(BaseModel):
    max_iterations: int = Field(1, ge=1, le=10)
    max_searches: int = Field(3, ge=1, le=50)
    max_threads: int = Field(6, ge=1, le=30)


class AgentResearchRunCreateRequest(BaseModel):
    topic: str = Field(..., min_length=3, max_length=4000)
    list_name: str = Field("", max_length=128)
    sender: str = Field("", max_length=512)
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    tags: list[str] = Field(default_factory=list, max_length=20)
    has_patch: Optional[bool] = None
    budget: AgentResearchBudget = Field(default_factory=AgentResearchBudget)


class AgentResearchRunListResponse(BaseModel):
    runs: list[AgentResearchRunRead] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class AgentResearchRunDetailResponse(BaseModel):
    run: AgentResearchRunRead
    actions: list[AgentRunActionRead] = Field(default_factory=list)


@router.post("/api/agent/research-runs", response_model=AgentResearchRunRead)
async def create_agent_research_run(
    request: AgentResearchRunCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._agent_store or not state._agent_user or not state._agent_service:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")
    filters = {
        "list_name": request.list_name.strip(),
        "sender": request.sender.strip(),
        "date_from": request.date_from.isoformat() if request.date_from else "",
        "date_to": request.date_to.isoformat() if request.date_to else "",
        "tags": request.tags,
        "has_patch": request.has_patch,
        "read_scope": "public",
    }
    run = await state._agent_store.create_run(
        AgentResearchRunCreate(
            topic=request.topic,
            requested_by_user_id=current_user.user_id,
            requested_by=current_user.display_name,
            agent_user_id=state._agent_user.user_id,
            agent_name=state._agent_user.display_name,
            filters=filters,
            budget=request.budget.model_dump(),
        )
    )
    asyncio.create_task(state._agent_service.execute(run.run_id))
    return run


@router.get("/api/agent/research-runs", response_model=AgentResearchRunListResponse)
async def list_agent_research_runs(
    status: str = Query("", description="run status filter"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._agent_store:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")
    runs, total = await state._agent_store.list_runs(status=status, page=page, page_size=page_size)
    return AgentResearchRunListResponse(runs=runs, total=total, page=page, page_size=page_size)


@router.get("/api/agent/research-runs/{run_id}", response_model=AgentResearchRunDetailResponse)
async def get_agent_research_run(
    run_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._agent_store:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")
    run = await state._agent_store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent research run not found")
    actions = await state._agent_store.list_actions(run_id)
    return AgentResearchRunDetailResponse(run=run, actions=actions)


@router.post("/api/agent/research-runs/{run_id}/cancel", response_model=AgentResearchRunRead)
async def cancel_agent_research_run(
    run_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._agent_service:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")
    run = await state._agent_service.cancel(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent research run not found")
    return run


@router.post("/api/agent/research-runs/{run_id}/retry", response_model=AgentResearchRunRead)
async def retry_agent_research_run(
    run_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._agent_service:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")
    retry = await state._agent_service.retry(run_id, current_user.user_id, current_user.display_name)
    if not retry:
        raise HTTPException(status_code=404, detail="Agent research run not found")
    return retry


