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
                query_text = q.strip()
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

            count_stmt = select(func.count()).select_from(stmt.subquery())
            total = (await session.execute(count_stmt)).scalar() or 0

            stmt = stmt.order_by(
                KnowledgeEntityORM.updated_at.desc(), KnowledgeEntityORM.entity_id.asc()
            )

            result = await session.execute(
                stmt.offset((page - 1) * page_size).limit(page_size)
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
            source_type=(data.source_type or "ask").strip(),
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

            ann_result = await session.execute(
                select(AnnotationORM).where(
                    AnnotationORM.target_type == "knowledge_entity",
                    AnnotationORM.target_ref == source_entity_id,
                )
            )
            for annotation in ann_result.scalars().all():
                annotation.target_ref = target_entity_id
                annotation.target_label = target.canonical_name
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

    async def list_relations(self, entity_id: str) -> tuple[list[KnowledgeRelationRead], list[KnowledgeRelationRead]]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KnowledgeRelationORM)
                .where(
                    or_(
                        KnowledgeRelationORM.source_entity_id == entity_id,
                        KnowledgeRelationORM.target_entity_id == entity_id,
                    )
                )
                .order_by(KnowledgeRelationORM.relation_type.asc(), KnowledgeRelationORM.updated_at.desc())
            )
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
