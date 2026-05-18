"""统一知识实体存储层。"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Text, cast, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.storage.models import (
    AnnotationORM,
    KnowledgeEntityCreate,
    KnowledgeEntityORM,
    KnowledgeEntityRead,
    KnowledgeEntityUpdate,
    KnowledgeEntityVersionORM,
    KnowledgeEntityVersionRead,
    KnowledgeDraftCreate,
    KnowledgeDraftORM,
    KnowledgeDraftRead,
    KnowledgeDraftUpdate,
    KnowledgeEvidenceCreate,
    KnowledgeEvidenceORM,
    KnowledgeEvidenceRead,
    KnowledgeEvidenceUpdate,
    KnowledgeRelationCreate,
    KnowledgeRelationORM,
    KnowledgeRelationRead,
    KnowledgeRelationUpdate,
    TagAssignmentORM,
)

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def normalize_slug(value: str) -> str:
    slug = _SLUG_RE.sub("-", value.strip().lower()).strip("-")
    return slug or "entity"


def _knowledge_annotation_target_types(entity) -> set[str]:
    entity_type = str(getattr(entity, "entity_type", "") or "").strip()
    target_types = {"knowledge_entity"}
    if entity_type:
        target_types.add(entity_type)
    return target_types


def _annotation_target_matches_entity(target, entity) -> bool:
    if not target:
        return False
    return (
        str(target.get("target_ref", "") or "").strip() == str(getattr(entity, "entity_id", "") or "").strip()
        and str(target.get("target_type", "") or "").strip() in _knowledge_annotation_target_types(entity)
    )


def _annotation_references_entity(annotation, entity) -> bool:
    primary_target = {
        "target_type": getattr(annotation, "target_type", ""),
        "target_ref": getattr(annotation, "target_ref", ""),
    }
    if _annotation_target_matches_entity(primary_target, entity):
        return True

    for related_target in getattr(annotation, "related_targets", []) or []:
        if _annotation_target_matches_entity(related_target, entity):
            return True
    return False


def _retarget_annotation_entity(annotation, source_entity, target_entity) -> bool:
    changed = False
    source_target_types = _knowledge_annotation_target_types(source_entity)
    target_ref = str(getattr(target_entity, "entity_id", "") or "").strip()
    target_type = str(getattr(target_entity, "entity_type", "") or "").strip()
    target_label = str(getattr(target_entity, "canonical_name", "") or "").strip()

    if (
        str(getattr(annotation, "target_ref", "") or "").strip() == str(getattr(source_entity, "entity_id", "") or "").strip()
        and str(getattr(annotation, "target_type", "") or "").strip() in source_target_types
    ):
        annotation.target_type = target_type
        annotation.target_ref = target_ref
        annotation.target_label = target_label
        annotation.target_subtitle = target_type
        changed = True

    updated_related_targets = []
    for related_target in getattr(annotation, "related_targets", []) or []:
        normalized = dict(related_target or {})
        if _annotation_target_matches_entity(normalized, source_entity):
            normalized["target_type"] = target_type
            normalized["target_ref"] = target_ref
            normalized["target_label"] = target_label
            normalized["target_subtitle"] = target_type
            changed = True
        updated_related_targets.append(normalized)

    if changed:
        annotation.related_targets = updated_related_targets
    return changed


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

    async def delete_entity(self, entity_id: str, force: bool = False) -> tuple[bool, list[dict]]:
        """删除知识实体。

        Args:
            entity_id: 实体 ID。
            force: 是否强制删除（级联删除关联关系）。

        Returns:
            (是否已删除, 阻挡删除的关系列表)。每条关系包含
            relation_id, relation_type, other_entity_id, other_entity_name。
        """
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeEntityORM).where(KnowledgeEntityORM.entity_id == entity_id)
            )
            entity = result.scalar_one_or_none()
            if entity is None:
                return False, []

            # 查询关联关系
            blocking = await session.execute(
                select(KnowledgeRelationORM).where(
                    or_(
                        KnowledgeRelationORM.source_entity_id == entity_id,
                        KnowledgeRelationORM.target_entity_id == entity_id,
                    )
                )
            )
            blocking_relations = blocking.scalars().all()

            if blocking_relations and not force:
                entity_map = await self._get_entity_map(
                    session,
                    [
                        rel.source_entity_id if rel.source_entity_id != entity_id else rel.target_entity_id
                        for rel in blocking_relations
                    ],
                )
                blocked_by = [
                    {
                        "relation_id": rel.relation_id,
                        "relation_type": rel.relation_type,
                        "other_entity_id": rel.source_entity_id if rel.source_entity_id != entity_id else rel.target_entity_id,
                        "other_entity_name": (
                            entity_map.get(
                                rel.source_entity_id if rel.source_entity_id != entity_id else rel.target_entity_id
                            ).canonical_name
                        ) if (
                            rel.source_entity_id if rel.source_entity_id != entity_id else rel.target_entity_id
                        ) in entity_map else "",
                    }
                    for rel in blocking_relations
                ]
                return False, blocked_by

            # force 模式下级联删除关系
            if blocking_relations:
                for rel in blocking_relations:
                    await session.delete(rel)

            # 删除关联的标签分配（同时匹配 entity_id 和 slug，防止残留）
            await session.execute(
                delete(TagAssignmentORM).where(
                    TagAssignmentORM.target_type == "knowledge_entity",
                    or_(
                        TagAssignmentORM.target_ref == entity_id,
                        TagAssignmentORM.target_ref == entity.slug,
                    ),
                )
            )
            await session.execute(
                delete(KnowledgeEvidenceORM).where(KnowledgeEvidenceORM.entity_id == entity_id)
            )

            await session.delete(entity)
            await session.commit()
            return True, []

    async def update(
        self,
        entity_id: str,
        data: KnowledgeEntityUpdate,
        updated_by: str,
        updated_by_user_id: Optional[str] = None,
        change_note: str = "",
    ) -> Optional[KnowledgeEntityRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeEntityORM).where(KnowledgeEntityORM.entity_id == entity_id)
            )
            entity = result.scalar_one_or_none()
            if entity is None:
                return None

            # 检查是否真的有内容变更（避免空 PATCH 写无意义快照）
            mutated = False
            if data.canonical_name is not None and data.canonical_name.strip() != entity.canonical_name:
                mutated = True
            if data.aliases is not None:
                new_aliases = [a.strip() for a in data.aliases if a.strip()]
                if list(entity.aliases or []) != new_aliases:
                    mutated = True
            if data.summary is not None and data.summary.strip() != entity.summary:
                mutated = True
            if data.description is not None and data.description.strip() != entity.description:
                mutated = True
            if data.status is not None and data.status.strip() != entity.status:
                mutated = True
            if data.meta is not None and (entity.meta or {}) != data.meta:
                mutated = True

            if mutated:
                # PLAN-31001 Phase 4：写入旧值快照，version 单调递增
                next_version_result = await session.execute(
                    select(func.coalesce(func.max(KnowledgeEntityVersionORM.version), 0) + 1)
                    .where(KnowledgeEntityVersionORM.entity_id == entity_id)
                )
                next_version = int(next_version_result.scalar() or 1)

                snapshot = KnowledgeEntityVersionORM(
                    entity_id=entity_id,
                    version=next_version,
                    canonical_name=entity.canonical_name,
                    aliases=list(entity.aliases or []),
                    summary=entity.summary,
                    description=entity.description,
                    status=entity.status,
                    meta=dict(entity.meta or {}),
                    change_note=change_note or "",
                    changed_by=updated_by or entity.updated_by or "me",
                    changed_by_user_id=updated_by_user_id,
                    changed_at=datetime.utcnow(),
                )
                session.add(snapshot)

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
        search_mode: str = "simple",
    ) -> tuple[list[KnowledgeEntityRead], int]:
        """列出知识实体。

        Args:
            search_mode: "simple" 走 ILIKE 多列模糊匹配（默认，不需要索引）；
                         "fulltext" 走 search_vector tsvector GIN 索引，
                         按 ts_rank 降序返回。
        """
        async with self._session_factory() as session:
            stmt = select(KnowledgeEntityORM)
            if entity_type.strip():
                stmt = stmt.where(KnowledgeEntityORM.entity_type == entity_type.strip())

            query_text = q.strip()
            use_fulltext = search_mode == "fulltext" and bool(query_text)
            rank_col = None

            if query_text and not use_fulltext:
                like = f"%{query_text}%"
                stmt = stmt.where(
                    or_(
                        KnowledgeEntityORM.entity_id.ilike(like),
                        KnowledgeEntityORM.canonical_name.ilike(like),
                        KnowledgeEntityORM.slug.ilike(like),
                        KnowledgeEntityORM.summary.ilike(like),
                        cast(KnowledgeEntityORM.aliases, Text).ilike(like),
                    )
                )
            elif use_fulltext:
                from sqlalchemy import literal_column
                tsquery = func.plainto_tsquery("english", query_text)
                stmt = stmt.where(
                    literal_column("search_vector").op("@@")(tsquery)
                )
                rank_col = func.ts_rank(
                    literal_column("search_vector"),
                    tsquery,
                ).label("rank")

            count_stmt = select(func.count()).select_from(stmt.subquery())
            total = (await session.execute(count_stmt)).scalar() or 0

            if rank_col is not None:
                stmt = stmt.add_columns(rank_col).order_by(
                    rank_col.desc(), KnowledgeEntityORM.updated_at.desc()
                )
            else:
                stmt = stmt.order_by(
                    KnowledgeEntityORM.updated_at.desc(), KnowledgeEntityORM.entity_id.asc()
                )

            result = await session.execute(
                stmt.offset((page - 1) * page_size).limit(page_size)
            )
            if rank_col is not None:
                # add_columns 导致返回 Row 对象，取第一列 entity
                rows = result.all()
                entities = [row[0] for row in rows]
            else:
                entities = list(result.scalars().all())
            return [KnowledgeEntityRead.model_validate(row) for row in entities], total

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

    async def get_stats(self) -> dict:
        """获取知识库概览统计数据。"""
        async with self._session_factory() as session:
            # 按类型统计
            type_result = await session.execute(
                select(
                    KnowledgeEntityORM.entity_type,
                    func.count(KnowledgeEntityORM.id).label("cnt"),
                ).group_by(KnowledgeEntityORM.entity_type)
            )
            by_type = {row.entity_type: row.cnt for row in type_result.all()}

            # 按状态统计
            status_result = await session.execute(
                select(
                    KnowledgeEntityORM.status,
                    func.count(KnowledgeEntityORM.id).label("cnt"),
                ).group_by(KnowledgeEntityORM.status)
            )
            by_status = {row.status: row.cnt for row in status_result.all()}

            # 关系总数
            rel_total = (await session.execute(
                select(func.count(KnowledgeRelationORM.id))
            )).scalar() or 0

            # 最近更新的实体
            recent_result = await session.execute(
                select(KnowledgeEntityORM)
                .order_by(KnowledgeEntityORM.updated_at.desc())
                .limit(5)
            )
            recent = [
                KnowledgeEntityRead.model_validate(row)
                for row in recent_result.scalars().all()
            ]

            total = sum(by_type.values())

            return {
                "total_entities": total,
                "by_type": by_type,
                "by_status": by_status,
                "total_relations": rel_total,
                "recent": recent,
            }

    async def find_similar(
        self,
        canonical_name: str,
        entity_type: str = "",
    ) -> list[KnowledgeEntityRead]:
        """查找名称相似的可能重复实体。"""
        name = canonical_name.strip()
        if not name:
            return []
        async with self._session_factory() as session:
            like = f"%{name}%"
            stmt = select(KnowledgeEntityORM).where(
                or_(
                    KnowledgeEntityORM.canonical_name.ilike(like),
                    cast(KnowledgeEntityORM.aliases, Text).ilike(like),
                )
            )
            if entity_type:
                stmt = stmt.where(KnowledgeEntityORM.entity_type == entity_type)
            stmt = stmt.order_by(KnowledgeEntityORM.updated_at.desc()).limit(5)
            result = await session.execute(stmt)
            return [KnowledgeEntityRead.model_validate(row) for row in result.scalars().all()]

    async def search_entities(
        self,
        queries: list[str],
        limit: int = 10,
    ) -> list[KnowledgeEntityRead]:
        """用多个查询词搜索知识实体（匹配 canonical_name / aliases / summary）。"""
        if not queries:
            return []
        async with self._session_factory() as session:
            conditions = []
            for q in queries:
                like = f"%{q.strip()}%"
                conditions.append(KnowledgeEntityORM.canonical_name.ilike(like))
                conditions.append(cast(KnowledgeEntityORM.aliases, Text).ilike(like))
                conditions.append(KnowledgeEntityORM.summary.ilike(like))
            if not conditions:
                return []
            stmt = (
                select(KnowledgeEntityORM)
                .where(or_(*conditions))
                .order_by(KnowledgeEntityORM.updated_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            return [KnowledgeEntityRead.model_validate(row) for row in result.scalars().all()]

    async def create_relation(self, data: KnowledgeRelationCreate) -> KnowledgeRelationRead:
        source_entity_id = data.source_entity_id.strip()
        target_entity_id = data.target_entity_id.strip()
        relation_type = data.relation_type.strip()
        if source_entity_id == target_entity_id:
            raise ValueError("source_entity_id and target_entity_id must be different")

        async with self._session_factory() as session:
            existing_entities = await session.execute(
                select(KnowledgeEntityORM.entity_id).where(
                    KnowledgeEntityORM.entity_id.in_([source_entity_id, target_entity_id])
                )
            )
            existing_ids = set(existing_entities.scalars().all())
            missing = [entity_id for entity_id in [source_entity_id, target_entity_id] if entity_id not in existing_ids]
            if missing:
                raise ValueError(f"Knowledge entity not found: {', '.join(missing)}")

            now = datetime.utcnow()
            relation = KnowledgeRelationORM(
                relation_id=f"rel:{uuid.uuid4().hex}",
                source_entity_id=source_entity_id,
                target_entity_id=target_entity_id,
                relation_type=relation_type,
                description=data.description.strip(),
                evidence_id=data.evidence_id.strip(),
                meta=data.meta or {},
                created_by=data.created_by,
                updated_by=data.updated_by,
                created_by_user_id=data.created_by_user_id,
                updated_by_user_id=data.updated_by_user_id,
                created_at=now,
                updated_at=now,
            )
            session.add(relation)
            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                raise ValueError("Knowledge relation already exists") from exc
            await session.refresh(relation)
            return await self._relation_read(session, relation)

    async def create_evidence(self, data: KnowledgeEvidenceCreate) -> KnowledgeEvidenceRead:
        entity_id = data.entity_id.strip()
        async with self._session_factory() as session:
            exists = await session.execute(
                select(KnowledgeEntityORM.entity_id).where(KnowledgeEntityORM.entity_id == entity_id)
            )
            if not exists.scalar_one_or_none():
                raise ValueError(f"Knowledge entity not found: {entity_id}")

            now = datetime.utcnow()
            evidence = KnowledgeEvidenceORM(
                evidence_id=f"ev:{uuid.uuid4().hex}",
                entity_id=entity_id,
                source_type=(data.source_type or "email").strip(),
                message_id=data.message_id.strip(),
                thread_id=data.thread_id.strip(),
                claim=data.claim.strip(),
                quote=data.quote.strip(),
                confidence=str(data.confidence or "").strip(),
                meta=data.meta or {},
                created_by=data.created_by,
                updated_by=data.updated_by,
                created_by_user_id=data.created_by_user_id,
                updated_by_user_id=data.updated_by_user_id,
                created_at=now,
                updated_at=now,
            )
            session.add(evidence)
            await session.commit()
            await session.refresh(evidence)
            return KnowledgeEvidenceRead.model_validate(evidence)

    async def create_evidence_many(
        self,
        items: list[KnowledgeEvidenceCreate],
    ) -> list[KnowledgeEvidenceRead]:
        created: list[KnowledgeEvidenceRead] = []
        for item in items:
            try:
                created.append(await self.create_evidence(item))
            except ValueError:
                continue
        return created

    async def list_evidence(self, entity_id: str) -> list[KnowledgeEvidenceRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeEvidenceORM)
                .where(KnowledgeEvidenceORM.entity_id == entity_id)
                .order_by(KnowledgeEvidenceORM.created_at.desc())
            )
            return [KnowledgeEvidenceRead.model_validate(row) for row in result.scalars().all()]

    async def find_entities_by_message_id(
        self,
        message_id: str,
    ) -> list[KnowledgeEntityRead]:
        """查找引用了指定 message_id 的知识实体（通过证据关联）。"""
        normalized = message_id.strip()
        if not normalized:
            return []
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeEntityORM)
                .distinct()
                .join(
                    KnowledgeEvidenceORM,
                    KnowledgeEvidenceORM.entity_id == KnowledgeEntityORM.entity_id,
                )
                .where(KnowledgeEvidenceORM.message_id == normalized)
                .order_by(KnowledgeEntityORM.updated_at.desc())
                .limit(20)
            )
            return [KnowledgeEntityRead.model_validate(row) for row in result.scalars().all()]

    async def update_evidence(
        self,
        evidence_id: str,
        data: KnowledgeEvidenceUpdate,
        updated_by: str,
        updated_by_user_id: Optional[str] = None,
    ) -> Optional[KnowledgeEvidenceRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeEvidenceORM).where(KnowledgeEvidenceORM.evidence_id == evidence_id)
            )
            evidence = result.scalar_one_or_none()
            if evidence is None:
                return None
            if data.source_type is not None:
                evidence.source_type = data.source_type.strip()
            if data.message_id is not None:
                evidence.message_id = data.message_id.strip()
            if data.thread_id is not None:
                evidence.thread_id = data.thread_id.strip()
            if data.claim is not None:
                evidence.claim = data.claim.strip()
            if data.quote is not None:
                evidence.quote = data.quote.strip()
            if data.confidence is not None:
                evidence.confidence = str(data.confidence).strip()
            if data.meta is not None:
                evidence.meta = data.meta
            evidence.updated_by = updated_by
            evidence.updated_by_user_id = updated_by_user_id
            evidence.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(evidence)
            return KnowledgeEvidenceRead.model_validate(evidence)

    async def delete_evidence(self, evidence_id: str) -> bool:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeEvidenceORM).where(KnowledgeEvidenceORM.evidence_id == evidence_id)
            )
            evidence = result.scalar_one_or_none()
            if evidence is None:
                return False
            await session.delete(evidence)
            await session.commit()
            return True

    async def create_draft(self, data: KnowledgeDraftCreate) -> KnowledgeDraftRead:
        now = datetime.utcnow()
        draft = KnowledgeDraftORM(
            draft_id=f"kdraft:{uuid.uuid4().hex}",
            source_type=(data.source_type or "manual").strip(),
            source_ref=data.source_ref.strip(),
            question=data.question.strip(),
            payload=data.payload or {},
            status=(data.status or "new").strip(),
            review_note=data.review_note.strip(),
            created_by=data.created_by,
            updated_by=data.updated_by,
            created_by_user_id=data.created_by_user_id,
            updated_by_user_id=data.updated_by_user_id,
            created_at=now,
            updated_at=now,
        )
        async with self._session_factory() as session:
            session.add(draft)
            await session.commit()
            await session.refresh(draft)
            return KnowledgeDraftRead.model_validate(draft)

    async def list_drafts(
        self,
        status: str = "",
        source_type: str = "",
        created_by_user_id: str = "",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[KnowledgeDraftRead], int]:
        async with self._session_factory() as session:
            stmt = select(KnowledgeDraftORM)
            if status.strip():
                stmt = stmt.where(KnowledgeDraftORM.status == status.strip())
            if source_type.strip():
                stmt = stmt.where(KnowledgeDraftORM.source_type == source_type.strip())
            if created_by_user_id.strip():
                stmt = stmt.where(KnowledgeDraftORM.created_by_user_id == created_by_user_id.strip())
            count_stmt = select(func.count()).select_from(stmt.subquery())
            total = (await session.execute(count_stmt)).scalar() or 0
            result = await session.execute(
                stmt.order_by(KnowledgeDraftORM.updated_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
            return [KnowledgeDraftRead.model_validate(row) for row in result.scalars().all()], total

    async def get_draft(self, draft_id: str) -> Optional[KnowledgeDraftRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeDraftORM).where(KnowledgeDraftORM.draft_id == draft_id)
            )
            draft = result.scalar_one_or_none()
            return KnowledgeDraftRead.model_validate(draft) if draft else None

    async def update_draft(
        self,
        draft_id: str,
        data: KnowledgeDraftUpdate,
        updated_by: str,
        updated_by_user_id: Optional[str] = None,
    ) -> Optional[KnowledgeDraftRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeDraftORM).where(KnowledgeDraftORM.draft_id == draft_id)
            )
            draft = result.scalar_one_or_none()
            if draft is None:
                return None
            if data.payload is not None:
                draft.payload = data.payload
            if data.status is not None:
                draft.status = data.status.strip()
            if data.review_note is not None:
                draft.review_note = data.review_note.strip()
            draft.updated_by = updated_by
            draft.updated_by_user_id = updated_by_user_id
            draft.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(draft)
            return KnowledgeDraftRead.model_validate(draft)

    async def merge_entities(
        self,
        source_entity_id: str,
        target_entity_id: str,
        updated_by: str,
        updated_by_user_id: Optional[str] = None,
    ) -> dict:
        source_entity_id = source_entity_id.strip()
        target_entity_id = target_entity_id.strip()
        if source_entity_id == target_entity_id:
            raise ValueError("source_entity_id and target_entity_id must be different")

        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeEntityORM).where(
                    KnowledgeEntityORM.entity_id.in_([source_entity_id, target_entity_id])
                )
            )
            entities = {row.entity_id: row for row in result.scalars().all()}
            source = entities.get(source_entity_id)
            target = entities.get(target_entity_id)
            if source is None or target is None:
                missing = source_entity_id if source is None else target_entity_id
                raise ValueError(f"Knowledge entity not found: {missing}")

            counts = {"relations": 0, "tag_assignments": 0, "annotations": 0, "evidence": 0}

            rel_result = await session.execute(
                select(KnowledgeRelationORM).where(
                    or_(
                        KnowledgeRelationORM.source_entity_id == source_entity_id,
                        KnowledgeRelationORM.target_entity_id == source_entity_id,
                    )
                )
            )
            for rel in rel_result.scalars().all():
                new_source = target_entity_id if rel.source_entity_id == source_entity_id else rel.source_entity_id
                new_target = target_entity_id if rel.target_entity_id == source_entity_id else rel.target_entity_id
                if new_source == new_target:
                    await session.delete(rel)
                    continue
                duplicate = await session.execute(
                    select(KnowledgeRelationORM).where(
                        KnowledgeRelationORM.source_entity_id == new_source,
                        KnowledgeRelationORM.target_entity_id == new_target,
                        KnowledgeRelationORM.relation_type == rel.relation_type,
                        KnowledgeRelationORM.relation_id != rel.relation_id,
                    )
                )
                if duplicate.scalar_one_or_none():
                    await session.delete(rel)
                    continue
                rel.source_entity_id = new_source
                rel.target_entity_id = new_target
                rel.updated_by = updated_by
                rel.updated_by_user_id = updated_by_user_id
                rel.updated_at = datetime.utcnow()
                counts["relations"] += 1

            tag_result = await session.execute(
                select(TagAssignmentORM).where(
                    TagAssignmentORM.target_type == "knowledge_entity",
                    TagAssignmentORM.target_ref == source_entity_id,
                )
            )
            for assignment in tag_result.scalars().all():
                duplicate = await session.execute(
                    select(TagAssignmentORM).where(
                        TagAssignmentORM.tag_id == assignment.tag_id,
                        TagAssignmentORM.target_type == "knowledge_entity",
                        TagAssignmentORM.target_ref == target_entity_id,
                        TagAssignmentORM.anchor_hash == assignment.anchor_hash,
                    )
                )
                if duplicate.scalar_one_or_none():
                    await session.delete(assignment)
                    continue
                assignment.target_ref = target_entity_id
                counts["tag_assignments"] += 1

            ann_result = await session.execute(select(AnnotationORM))
            for annotation in ann_result.scalars().all():
                if _retarget_annotation_entity(annotation, source, target):
                    counts["annotations"] += 1

            ev_result = await session.execute(
                select(KnowledgeEvidenceORM).where(KnowledgeEvidenceORM.entity_id == source_entity_id)
            )
            for evidence in ev_result.scalars().all():
                evidence.entity_id = target_entity_id
                evidence.updated_by = updated_by
                evidence.updated_by_user_id = updated_by_user_id
                evidence.updated_at = datetime.utcnow()
                counts["evidence"] += 1

            aliases = list(dict.fromkeys([
                *(target.aliases or []),
                source.canonical_name,
                *(source.aliases or []),
            ]))
            target.aliases = [alias for alias in aliases if alias and alias != target.canonical_name]
            target.updated_by = updated_by
            target.updated_by_user_id = updated_by_user_id
            target.updated_at = datetime.utcnow()

            source.status = "deprecated"
            source.meta = {
                **(source.meta or {}),
                "merged_into": target_entity_id,
                "merged_at": datetime.utcnow().isoformat(),
            }
            source.updated_by = updated_by
            source.updated_by_user_id = updated_by_user_id
            source.updated_at = datetime.utcnow()

            await session.commit()
            await session.refresh(target)
            await session.refresh(source)
            return {
                "source": KnowledgeEntityRead.model_validate(source),
                "target": KnowledgeEntityRead.model_validate(target),
                "moved": counts,
            }

    async def list_relations(
        self,
        entity_id: str,
        relation_types: Optional[list[str]] = None,
    ) -> tuple[list[KnowledgeRelationRead], list[KnowledgeRelationRead]]:
        """列出实体的所有关系（区分出向 / 入向）。

        Args:
            relation_types: 可选的关系类型白名单（None 表示不过滤）。
        """
        async with self._session_factory() as session:
            stmt = select(KnowledgeRelationORM).where(
                or_(
                    KnowledgeRelationORM.source_entity_id == entity_id,
                    KnowledgeRelationORM.target_entity_id == entity_id,
                )
            )
            if relation_types:
                stmt = stmt.where(KnowledgeRelationORM.relation_type.in_(relation_types))
            stmt = stmt.order_by(
                KnowledgeRelationORM.relation_type.asc(),
                KnowledgeRelationORM.updated_at.desc(),
            )
            result = await session.execute(stmt)
            relations = result.scalars().all()
            reads = [await self._relation_read(session, relation) for relation in relations]
            outgoing = [relation for relation in reads if relation.source_entity_id == entity_id]
            incoming = [relation for relation in reads if relation.target_entity_id == entity_id]
            return outgoing, incoming

    async def get_graph(
        self,
        entity_id: str,
        depth: int = 2,
        relation_types: Optional[list[str]] = None,
    ) -> dict:
        """BFS 遍历获取实体邻域子图。

        Args:
            entity_id: 中心实体 ID。
            depth: 遍历深度（1-3）。
            relation_types: 可选的关系类型过滤。

        Returns:
            dict with nodes (list[KnowledgeEntityRead]),
            edges (list[KnowledgeRelationRead]), center, depth.
        """
        depth = max(1, min(depth, 3))
        async with self._session_factory() as session:
            visited_entities: set[str] = set()
            visited_relations: dict[str, KnowledgeRelationORM] = {}
            frontier: set[str] = {entity_id}

            for _ in range(depth):
                if not frontier:
                    break

                stmt = select(KnowledgeRelationORM).where(
                    or_(
                        KnowledgeRelationORM.source_entity_id.in_(frontier),
                        KnowledgeRelationORM.target_entity_id.in_(frontier),
                    )
                )
                if relation_types:
                    stmt = stmt.where(KnowledgeRelationORM.relation_type.in_(relation_types))

                result = await session.execute(stmt)
                batch_relations = result.scalars().all()

                next_frontier: set[str] = set()
                for rel in batch_relations:
                    if rel.relation_id not in visited_relations:
                        visited_relations[rel.relation_id] = rel
                    if rel.source_entity_id not in visited_entities:
                        next_frontier.add(rel.source_entity_id)
                    if rel.target_entity_id not in visited_entities:
                        next_frontier.add(rel.target_entity_id)

                visited_entities.update(frontier)
                frontier = next_frontier - visited_entities

            # 确保中心实体在 nodes 中
            visited_entities.add(entity_id)
            # 最终一步产生的实体
            visited_entities.update(frontier)

            entity_map = await self._get_entity_map(session, list(visited_entities))

            edges: list[KnowledgeRelationRead] = []
            for rel in visited_relations.values():
                edges.append(KnowledgeRelationRead(
                    relation_id=rel.relation_id,
                    source_entity_id=rel.source_entity_id,
                    target_entity_id=rel.target_entity_id,
                    relation_type=rel.relation_type,
                    description=rel.description,
                    evidence_id=rel.evidence_id,
                    meta=rel.meta,
                    created_by=rel.created_by,
                    updated_by=rel.updated_by,
                    created_by_user_id=rel.created_by_user_id,
                    updated_by_user_id=rel.updated_by_user_id,
                    created_at=rel.created_at,
                    updated_at=rel.updated_at,
                    source_entity=entity_map.get(rel.source_entity_id),
                    target_entity=entity_map.get(rel.target_entity_id),
                ))

            return {
                "nodes": [entity_map[eid] for eid in visited_entities if eid in entity_map],
                "edges": edges,
                "center": entity_id,
                "depth": depth,
            }

    async def update_relation(
        self,
        relation_id: str,
        data: KnowledgeRelationUpdate,
        updated_by: str,
        updated_by_user_id: Optional[str] = None,
    ) -> Optional[KnowledgeRelationRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeRelationORM).where(KnowledgeRelationORM.relation_id == relation_id)
            )
            relation = result.scalar_one_or_none()
            if relation is None:
                return None
            if data.relation_type is not None:
                relation.relation_type = data.relation_type.strip()
            if data.description is not None:
                relation.description = data.description.strip()
            if data.evidence_id is not None:
                relation.evidence_id = data.evidence_id.strip()
            if data.meta is not None:
                relation.meta = data.meta
            relation.updated_by = updated_by
            relation.updated_by_user_id = updated_by_user_id
            relation.updated_at = datetime.utcnow()
            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                raise ValueError("Knowledge relation already exists") from exc
            await session.refresh(relation)
            return await self._relation_read(session, relation)

    async def delete_relation(self, relation_id: str) -> bool:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeRelationORM).where(KnowledgeRelationORM.relation_id == relation_id)
            )
            relation = result.scalar_one_or_none()
            if relation is None:
                return False
            await session.delete(relation)
            await session.commit()
            return True

    async def _relation_read(
        self,
        session: AsyncSession,
        relation: KnowledgeRelationORM,
    ) -> KnowledgeRelationRead:
        entity_map = await self._get_entity_map(
            session,
            [relation.source_entity_id, relation.target_entity_id],
        )
        return KnowledgeRelationRead(
            relation_id=relation.relation_id,
            source_entity_id=relation.source_entity_id,
            target_entity_id=relation.target_entity_id,
            relation_type=relation.relation_type,
            description=relation.description,
            evidence_id=relation.evidence_id,
            meta=relation.meta,
            created_by=relation.created_by,
            updated_by=relation.updated_by,
            created_by_user_id=relation.created_by_user_id,
            updated_by_user_id=relation.updated_by_user_id,
            created_at=relation.created_at,
            updated_at=relation.updated_at,
            source_entity=entity_map.get(relation.source_entity_id),
            target_entity=entity_map.get(relation.target_entity_id),
        )

    async def _get_entity_map(
        self,
        session: AsyncSession,
        entity_ids: list[str],
    ) -> dict[str, KnowledgeEntityRead]:
        if not entity_ids:
            return {}
        result = await session.execute(
            select(KnowledgeEntityORM).where(KnowledgeEntityORM.entity_id.in_(list(dict.fromkeys(entity_ids))))
        )
        return {
            entity.entity_id: KnowledgeEntityRead.model_validate(entity)
            for entity in result.scalars().all()
        }

    # ------------------------------------------------------------------
    # PLAN-31001 Phase 4：变更历史 + 导入导出
    # ------------------------------------------------------------------

    async def list_entity_versions(
        self,
        entity_id: str,
        limit: int = 50,
    ) -> list[KnowledgeEntityVersionRead]:
        """获取实体的历史快照列表，按 version 降序。"""
        async with self._session_factory() as session:
            stmt = (
                select(KnowledgeEntityVersionORM)
                .where(KnowledgeEntityVersionORM.entity_id == entity_id)
                .order_by(KnowledgeEntityVersionORM.version.desc())
                .limit(max(1, min(limit, 500)))
            )
            result = await session.execute(stmt)
            return [
                KnowledgeEntityVersionRead.model_validate(row)
                for row in result.scalars().all()
            ]

    async def export_all(
        self,
        entity_type: str = "",
        status: str = "",
    ) -> dict:
        """导出所有知识实体和关系为可序列化字典。

        Args:
            entity_type: 可选实体类型过滤。
            status: 可选状态过滤。

        Returns:
            dict with schema_version, exported_at, entities, relations。
            不包含 evidence/drafts/versions（减小体积；若需可按 entity_id 再次拉取）。
        """
        async with self._session_factory() as session:
            ent_stmt = select(KnowledgeEntityORM)
            if entity_type.strip():
                ent_stmt = ent_stmt.where(KnowledgeEntityORM.entity_type == entity_type.strip())
            if status.strip():
                ent_stmt = ent_stmt.where(KnowledgeEntityORM.status == status.strip())
            ent_stmt = ent_stmt.order_by(KnowledgeEntityORM.entity_id.asc())
            entities = (await session.execute(ent_stmt)).scalars().all()
            entity_ids = [e.entity_id for e in entities]

            # 只导出两端都在选中集中的关系，保持一致性
            rel_rows: list[KnowledgeRelationORM] = []
            if entity_ids:
                rel_stmt = select(KnowledgeRelationORM).where(
                    KnowledgeRelationORM.source_entity_id.in_(entity_ids),
                    KnowledgeRelationORM.target_entity_id.in_(entity_ids),
                )
                rel_rows = list((await session.execute(rel_stmt)).scalars().all())

        return {
            "schema_version": 1,
            "exported_at": datetime.utcnow().isoformat(),
            "entity_count": len(entities),
            "relation_count": len(rel_rows),
            "entities": [
                {
                    "entity_id": e.entity_id,
                    "entity_type": e.entity_type,
                    "canonical_name": e.canonical_name,
                    "slug": e.slug,
                    "aliases": list(e.aliases or []),
                    "summary": e.summary,
                    "description": e.description,
                    "status": e.status,
                    "meta": dict(e.meta or {}),
                    "created_by": e.created_by,
                    "updated_by": e.updated_by,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                    "updated_at": e.updated_at.isoformat() if e.updated_at else None,
                }
                for e in entities
            ],
            "relations": [
                {
                    "relation_id": r.relation_id,
                    "source_entity_id": r.source_entity_id,
                    "target_entity_id": r.target_entity_id,
                    "relation_type": r.relation_type,
                    "description": r.description,
                    "evidence_id": r.evidence_id,
                    "meta": dict(r.meta or {}),
                    "created_by": r.created_by,
                    "updated_by": r.updated_by,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                }
                for r in rel_rows
            ],
        }

    async def import_bulk(
        self,
        payload: dict,
        actor: str = "me",
        actor_user_id: Optional[str] = None,
        strategy: str = "upsert",
    ) -> dict:
        """从 export_all 产出的字典批量导入实体和关系。

        Args:
            payload: 来自 export_all 的字典，必须包含 `entities` 列表。
            strategy: "upsert" → 已存在则更新；"skip" → 已存在则跳过。

        Returns:
            dict with entities_created / entities_updated / entities_skipped /
            relations_created / relations_skipped / errors。
        """
        if not isinstance(payload, dict):
            raise ValueError("payload must be a dict")
        strategy = strategy.strip().lower()
        if strategy not in ("upsert", "skip"):
            raise ValueError("strategy must be 'upsert' or 'skip'")

        entities_in = payload.get("entities") or []
        relations_in = payload.get("relations") or []
        if not isinstance(entities_in, list) or not isinstance(relations_in, list):
            raise ValueError("entities and relations must be lists")

        summary = {
            "entities_created": 0,
            "entities_updated": 0,
            "entities_skipped": 0,
            "relations_created": 0,
            "relations_skipped": 0,
            "errors": [],
        }

        now = datetime.utcnow()

        async with self._session_factory() as session:
            # 实体
            existing_ids: set[str] = set()
            if entities_in:
                ids = [str(item.get("entity_id") or "").strip() for item in entities_in if item.get("entity_id")]
                if ids:
                    existing_result = await session.execute(
                        select(KnowledgeEntityORM.entity_id).where(
                            KnowledgeEntityORM.entity_id.in_(ids)
                        )
                    )
                    existing_ids = {row[0] for row in existing_result.all()}

            for item in entities_in:
                try:
                    entity_id = str(item.get("entity_id") or "").strip()
                    entity_type = str(item.get("entity_type") or "").strip()
                    canonical_name = str(item.get("canonical_name") or "").strip()
                    if not entity_id or not entity_type or not canonical_name:
                        summary["errors"].append(
                            f"skip entity: missing required field (entity_id/entity_type/canonical_name)"
                        )
                        summary["entities_skipped"] += 1
                        continue

                    if entity_id in existing_ids:
                        if strategy == "skip":
                            summary["entities_skipped"] += 1
                            continue
                        # upsert
                        result = await session.execute(
                            select(KnowledgeEntityORM).where(
                                KnowledgeEntityORM.entity_id == entity_id
                            )
                        )
                        orm = result.scalar_one_or_none()
                        if orm is None:
                            summary["entities_skipped"] += 1
                            continue
                        orm.canonical_name = canonical_name
                        orm.aliases = list(item.get("aliases") or [])
                        orm.summary = str(item.get("summary") or "")
                        orm.description = str(item.get("description") or "")
                        orm.status = str(item.get("status") or "active")
                        orm.meta = dict(item.get("meta") or {})
                        orm.updated_by = actor
                        orm.updated_by_user_id = actor_user_id
                        orm.updated_at = now
                        summary["entities_updated"] += 1
                    else:
                        slug = str(item.get("slug") or "").strip() or normalize_slug(canonical_name)
                        orm = KnowledgeEntityORM(
                            entity_id=entity_id,
                            entity_type=entity_type,
                            canonical_name=canonical_name,
                            slug=slug,
                            aliases=list(item.get("aliases") or []),
                            summary=str(item.get("summary") or ""),
                            description=str(item.get("description") or ""),
                            status=str(item.get("status") or "active"),
                            meta=dict(item.get("meta") or {}),
                            created_by=actor,
                            updated_by=actor,
                            created_by_user_id=actor_user_id,
                            updated_by_user_id=actor_user_id,
                            created_at=now,
                            updated_at=now,
                        )
                        session.add(orm)
                        summary["entities_created"] += 1
                except Exception as exc:
                    summary["errors"].append(f"entity {item.get('entity_id')}: {exc}")
                    summary["entities_skipped"] += 1

            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                summary["errors"].append(f"entity commit integrity error: {exc}")

            # 关系
            existing_rel_keys: set[tuple[str, str, str]] = set()
            if relations_in:
                keys = [
                    (
                        str(r.get("source_entity_id") or "").strip(),
                        str(r.get("target_entity_id") or "").strip(),
                        str(r.get("relation_type") or "").strip(),
                    )
                    for r in relations_in
                ]
                keys = [k for k in keys if all(k)]
                if keys:
                    existing_rel_result = await session.execute(
                        select(
                            KnowledgeRelationORM.source_entity_id,
                            KnowledgeRelationORM.target_entity_id,
                            KnowledgeRelationORM.relation_type,
                        )
                    )
                    existing_rel_keys = {tuple(row) for row in existing_rel_result.all()}

            for r in relations_in:
                try:
                    src = str(r.get("source_entity_id") or "").strip()
                    tgt = str(r.get("target_entity_id") or "").strip()
                    rtype = str(r.get("relation_type") or "").strip()
                    if not src or not tgt or not rtype:
                        summary["relations_skipped"] += 1
                        continue
                    key = (src, tgt, rtype)
                    if key in existing_rel_keys:
                        summary["relations_skipped"] += 1
                        continue
                    relation_id = str(r.get("relation_id") or "").strip() or f"rel-{uuid.uuid4().hex[:12]}"
                    orm = KnowledgeRelationORM(
                        relation_id=relation_id,
                        source_entity_id=src,
                        target_entity_id=tgt,
                        relation_type=rtype,
                        description=str(r.get("description") or ""),
                        evidence_id=str(r.get("evidence_id") or ""),
                        meta=dict(r.get("meta") or {}),
                        created_by=actor,
                        updated_by=actor,
                        created_by_user_id=actor_user_id,
                        updated_by_user_id=actor_user_id,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(orm)
                    existing_rel_keys.add(key)
                    summary["relations_created"] += 1
                except Exception as exc:
                    summary["errors"].append(f"relation {r.get('relation_id')}: {exc}")
                    summary["relations_skipped"] += 1

            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                summary["errors"].append(f"relation commit integrity error: {exc}")

        return summary
