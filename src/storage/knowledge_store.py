"""统一知识实体存储层。"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.storage.models import (
    KnowledgeEntityCreate,
    KnowledgeEntityORM,
    KnowledgeEntityRead,
    KnowledgeEntityUpdate,
)

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def normalize_slug(value: str) -> str:
    slug = _SLUG_RE.sub("-", value.strip().lower()).strip("-")
    return slug or "entity"


class KnowledgeStore:
    """知识实体 CRUD 与检索。"""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._session_factory = session_factory

    async def create(self, data: KnowledgeEntityCreate) -> KnowledgeEntityRead:
        entity_type = data.entity_type.strip()
        canonical_name = data.canonical_name.strip()
        slug = normalize_slug(data.slug or canonical_name)
        entity_id = (data.entity_id or f"{entity_type}:{slug}").strip()
        now = datetime.utcnow()

        entity = KnowledgeEntityORM(
            entity_id=entity_id,
            entity_type=entity_type,
            canonical_name=canonical_name,
            slug=slug,
            aliases=[alias.strip() for alias in data.aliases if alias.strip()],
            summary=data.summary.strip(),
            description=data.description.strip(),
            status=(data.status or "active").strip(),
            meta=data.meta or {},
            created_by=data.created_by,
            updated_by=data.updated_by,
            created_by_user_id=data.created_by_user_id,
            updated_by_user_id=data.updated_by_user_id,
            created_at=now,
            updated_at=now,
        )

        async with self._session_factory() as session:
            session.add(entity)
            await session.commit()
            await session.refresh(entity)
            return KnowledgeEntityRead.model_validate(entity)

    async def get(self, entity_id: str) -> Optional[KnowledgeEntityRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeEntityORM).where(KnowledgeEntityORM.entity_id == entity_id)
            )
            entity = result.scalar_one_or_none()
            return KnowledgeEntityRead.model_validate(entity) if entity else None

    async def update(
        self,
        entity_id: str,
        data: KnowledgeEntityUpdate,
        updated_by: str,
        updated_by_user_id: Optional[str] = None,
    ) -> Optional[KnowledgeEntityRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeEntityORM).where(KnowledgeEntityORM.entity_id == entity_id)
            )
            entity = result.scalar_one_or_none()
            if entity is None:
                return None

            if data.canonical_name is not None:
                entity.canonical_name = data.canonical_name.strip()
            if data.aliases is not None:
                entity.aliases = [alias.strip() for alias in data.aliases if alias.strip()]
            if data.summary is not None:
                entity.summary = data.summary.strip()
            if data.description is not None:
                entity.description = data.description.strip()
            if data.status is not None:
                entity.status = data.status.strip()
            if data.meta is not None:
                entity.meta = data.meta
            entity.updated_by = updated_by
            entity.updated_by_user_id = updated_by_user_id
            entity.updated_at = datetime.utcnow()

            await session.commit()
            await session.refresh(entity)
            return KnowledgeEntityRead.model_validate(entity)

    async def list_entities(
        self,
        q: str = "",
        entity_type: str = "",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[KnowledgeEntityRead], int]:
        async with self._session_factory() as session:
            stmt = select(KnowledgeEntityORM)
            if entity_type.strip():
                stmt = stmt.where(KnowledgeEntityORM.entity_type == entity_type.strip())
            if q.strip():
                like = f"%{q.strip()}%"
                stmt = stmt.where(
                    or_(
                        KnowledgeEntityORM.entity_id.ilike(like),
                        KnowledgeEntityORM.canonical_name.ilike(like),
                        KnowledgeEntityORM.slug.ilike(like),
                        KnowledgeEntityORM.summary.ilike(like),
                        cast(KnowledgeEntityORM.aliases, Text).ilike(like),
                    )
                )

            count_stmt = select(func.count()).select_from(stmt.subquery())
            total = (await session.execute(count_stmt)).scalar() or 0
            result = await session.execute(
                stmt.order_by(KnowledgeEntityORM.updated_at.desc(), KnowledgeEntityORM.entity_id.asc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
            return [KnowledgeEntityRead.model_validate(row) for row in result.scalars().all()], total

    async def get_many(self, entity_ids: list[str]) -> dict[str, KnowledgeEntityRead]:
        if not entity_ids:
            return {}
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeEntityORM).where(KnowledgeEntityORM.entity_id.in_(entity_ids))
            )
            return {
                entity.entity_id: KnowledgeEntityRead.model_validate(entity)
                for entity in result.scalars().all()
            }
