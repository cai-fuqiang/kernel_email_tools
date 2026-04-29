"""Storage helpers for AI agent research runs."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.storage.models import (
    AgentResearchRunCreate,
    AgentResearchRunORM,
    AgentResearchRunRead,
    AgentResearchRunUpdate,
    AgentRunActionCreate,
    AgentRunActionORM,
    AgentRunActionRead,
)


class AgentStore:
    """Persistence layer for AI research runs and ordered trace actions."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._session_factory = session_factory

    async def create_run(self, data: AgentResearchRunCreate) -> AgentResearchRunRead:
        now = datetime.utcnow()
        run = AgentResearchRunORM(
            run_id=f"agent-run-{uuid.uuid4().hex}",
            topic=data.topic.strip(),
            status=data.status,
            requested_by_user_id=data.requested_by_user_id,
            requested_by=data.requested_by,
            agent_user_id=data.agent_user_id,
            agent_name=data.agent_name,
            filters=data.filters or {},
            budget=data.budget or {},
            confidence=data.confidence,
            summary=data.summary,
            failure_reason=data.failure_reason,
            draft_ids=data.draft_ids or [],
            heartbeat_at=now,
            created_at=now,
            updated_at=now,
        )
        async with self._session_factory() as session:
            session.add(run)
            await session.commit()
            await session.refresh(run)
            return AgentResearchRunRead.model_validate(run)

    async def get_run(self, run_id: str) -> Optional[AgentResearchRunRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(AgentResearchRunORM).where(AgentResearchRunORM.run_id == run_id)
            )
            row = result.scalar_one_or_none()
            return AgentResearchRunRead.model_validate(row) if row else None

    async def list_runs(
        self,
        status: str = "",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[AgentResearchRunRead], int]:
        async with self._session_factory() as session:
            stmt = select(AgentResearchRunORM)
            count_stmt = select(func.count()).select_from(AgentResearchRunORM)
            if status:
                stmt = stmt.where(AgentResearchRunORM.status == status)
                count_stmt = count_stmt.where(AgentResearchRunORM.status == status)
            total = int((await session.execute(count_stmt)).scalar_one() or 0)
            result = await session.execute(
                stmt.order_by(AgentResearchRunORM.updated_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
            rows = result.scalars().all()
            return [AgentResearchRunRead.model_validate(row) for row in rows], total

    async def update_run(
        self,
        run_id: str,
        data: AgentResearchRunUpdate,
    ) -> Optional[AgentResearchRunRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(AgentResearchRunORM).where(AgentResearchRunORM.run_id == run_id)
            )
            run = result.scalar_one_or_none()
            if not run:
                return None
            update = data.model_dump(exclude_unset=True)
            for key, value in update.items():
                setattr(run, key, value)
            run.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(run)
            return AgentResearchRunRead.model_validate(run)

    async def fail_running_runs_after_restart(self) -> int:
        async with self._session_factory() as session:
            result = await session.execute(
                select(AgentResearchRunORM).where(AgentResearchRunORM.status == "running")
            )
            rows = result.scalars().all()
            for run in rows:
                run.status = "failed"
                run.failure_reason = "server_restart"
                run.updated_at = datetime.utcnow()
            await session.commit()
            return len(rows)

    async def add_action(self, data: AgentRunActionCreate) -> AgentRunActionRead:
        action = AgentRunActionORM(
            action_id=f"agent-action-{uuid.uuid4().hex}",
            run_id=data.run_id,
            iteration_index=data.iteration_index,
            action_index=data.action_index,
            action_type=data.action_type,
            status=data.status,
            payload=data.payload or {},
            error=data.error,
            duration_ms=data.duration_ms,
            model=data.model,
            token_usage=data.token_usage or {},
            created_at=datetime.utcnow(),
        )
        async with self._session_factory() as session:
            session.add(action)
            await session.commit()
            await session.refresh(action)
            return AgentRunActionRead.model_validate(action)

    async def list_actions(self, run_id: str) -> list[AgentRunActionRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(AgentRunActionORM)
                .where(AgentRunActionORM.run_id == run_id)
                .order_by(AgentRunActionORM.action_index.asc(), AgentRunActionORM.created_at.asc())
            )
            return [AgentRunActionRead.model_validate(row) for row in result.scalars().all()]
