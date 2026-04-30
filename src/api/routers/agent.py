"""AI Research Agent API routes.

Endpoints:
- POST /api/agent/research-runs        — start a new research run (admin/editor)
- GET  /api/agent/research-runs        — list runs with optional status filter
- GET  /api/agent/research-runs/{id}   — get one run with full action trace
- POST /api/agent/research-runs/{id}/cancel — cooperatively cancel a run
- POST /api/agent/research-runs/{id}/retry  — retry a failed run with same scope

All endpoints require admin or editor role. Cancellation is cooperative: the cancel API
flips the run status, and the running orchestrator task detects that on its next
checkpoint and exits cleanly.
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from src.api import state
from src.api.deps import CurrentUser, require_roles
from src.storage.models import (
    AgentResearchRunCreate,
    AgentResearchRunRead,
    AgentRunActionRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["agent"])


# --------------------------------------------------------------------------------------
# Request / response schemas
# --------------------------------------------------------------------------------------


class AgentResearchBudget(BaseModel):
    max_iterations: int = Field(3, ge=1, le=10)
    max_searches: int = Field(6, ge=1, le=50)
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


# --------------------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------------------


def _ensure_service_ready() -> None:
    if not state._agent_store or not state._agent_user or not state._agent_service:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")


@router.post("/api/agent/research-runs", response_model=AgentResearchRunRead)
async def create_agent_research_run(
    request: AgentResearchRunCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
) -> AgentResearchRunRead:
    _ensure_service_ready()
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
    state._agent_service.schedule_run(run.run_id)
    return run


@router.get("/api/agent/research-runs", response_model=AgentResearchRunListResponse)
async def list_agent_research_runs(
    status: str = Query("", description="run status filter"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
) -> AgentResearchRunListResponse:
    _ensure_service_ready()
    runs, total = await state._agent_store.list_runs(status=status, page=page, page_size=page_size)
    return AgentResearchRunListResponse(runs=runs, total=total, page=page, page_size=page_size)


@router.get("/api/agent/research-runs/{run_id}", response_model=AgentResearchRunDetailResponse)
async def get_agent_research_run(
    run_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
) -> AgentResearchRunDetailResponse:
    _ensure_service_ready()
    run = await state._agent_store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent research run not found")
    actions = await state._agent_store.list_actions(run_id)
    return AgentResearchRunDetailResponse(run=run, actions=actions)


@router.post("/api/agent/research-runs/{run_id}/cancel", response_model=AgentResearchRunRead)
async def cancel_agent_research_run(
    run_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
) -> AgentResearchRunRead:
    _ensure_service_ready()
    run = await state._agent_service.cancel(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent research run not found")
    return run


@router.post("/api/agent/research-runs/{run_id}/retry", response_model=AgentResearchRunRead)
async def retry_agent_research_run(
    run_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
) -> AgentResearchRunRead:
    _ensure_service_ready()
    retry = await state._agent_service.retry(run_id, current_user.user_id, current_user.display_name)
    if not retry:
        raise HTTPException(status_code=404, detail="Agent research run not found")
    return retry