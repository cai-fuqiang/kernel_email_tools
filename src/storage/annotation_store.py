"""统一标注存储层。

核心抽象：
- annotation：评论/回复本体
- target：被标注对象，例如 email_thread、kernel_file、sdm_spec
- anchor：目标内的具体位置，例如 message_id、行号范围、页码范围
"""

import hashlib
import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.code_targets import build_code_target
from src.storage.annotation_links import (
    extract_annotation_links,
    normalize_relation_type,
    normalize_source_kind,
)
from src.storage.models import (
    AnnotationCreate,
    AnnotationORM,
    AnnotationRelationCreate,
    AnnotationRelationORM,
    AnnotationRelationRead,
    AnnotationRead,
    AnnotationUpdate,
    EmailORM,
    TagAssignmentORM,
)

logger = logging.getLogger(__name__)


def _compute_context_hash(version: str, file_path: str, start_line: int, content: str) -> str:
    """计算代码锚点上下文哈希。"""
    prefix = content[:200] if content else ""
    raw = f"{version}:{file_path}:{start_line}:{prefix}"
    return hashlib.sha256(raw.encode()).hexdigest()[:64]


def _normalize_annotation_payload(annotation: AnnotationCreate) -> AnnotationCreate:
    """将邮件/代码便捷字段折叠到统一 target/anchor 结构。"""
    data = annotation.model_copy(deep=True)

    if not data.annotation_type:
        data.annotation_type = "email"

    if data.annotation_type == "email":
        if not data.target_type:
            data.target_type = "email_thread"
        if not data.target_ref:
            data.target_ref = data.thread_id
        if not data.anchor and data.in_reply_to:
            data.anchor = {"message_id": data.in_reply_to}
        if not data.meta:
            data.meta = {}
    elif data.annotation_type == "code":
        if not data.target_type:
            data.target_type = "kernel_file"
        code_target = build_code_target(
            version=data.version,
            path=data.file_path,
            start_line=data.start_line,
            end_line=data.end_line,
            target_ref=data.target_ref,
            anchor=data.anchor,
            meta=data.meta,
        )
        if not data.target_ref:
            data.target_ref = code_target["target_ref"]
        if not data.target_label:
            data.target_label = code_target["path"]
        if not data.target_subtitle:
            data.target_subtitle = code_target["version"]
        if not data.anchor and data.start_line > 0:
            data.anchor = {
                "start_line": code_target["start_line"],
                "end_line": code_target["end_line"],
            }
        data.meta = {
            **(data.meta or {}),
            "code_target": code_target,
        }

    return data


class UnifiedAnnotationStore:
    """统一标注存储器。"""

    def __init__(self, session_factory: async_sessionmaker, default_author: str = "me"):
        self.session_factory = session_factory
        self.default_author = default_author

    def _visibility_filters(self, viewer_user_id: Optional[str], include_all_private: bool = False) -> list:
        if include_all_private:
            return []
        if viewer_user_id:
            return [
                or_(
                    AnnotationORM.visibility == "public",
                    AnnotationORM.author_user_id == viewer_user_id,
                )
            ]
        return [AnnotationORM.visibility == "public"]

    def _to_annotation_read(self, ann: AnnotationORM) -> AnnotationRead:
        """Normalize nullable ORM fields to the API's stable read shape."""
        anchor = ann.anchor or {}
        return AnnotationRead.model_validate(
            {
                "id": ann.id,
                "annotation_id": ann.annotation_id,
                "annotation_type": ann.annotation_type,
                "author": ann.author,
                "author_user_id": ann.author_user_id,
                "visibility": ann.visibility or "public",
                "publish_status": ann.publish_status or "none",
                "body": ann.body,
                "parent_annotation_id": ann.parent_annotation_id or "",
                "publish_requested_at": ann.publish_requested_at,
                "publish_requested_by_user_id": ann.publish_requested_by_user_id,
                "publish_reviewed_at": ann.publish_reviewed_at,
                "publish_reviewed_by_user_id": ann.publish_reviewed_by_user_id,
                "publish_review_comment": ann.publish_review_comment or "",
                "created_at": ann.created_at,
                "updated_at": ann.updated_at,
                "target_type": ann.target_type or "",
                "target_ref": ann.target_ref or "",
                "target_label": ann.target_label or "",
                "target_subtitle": ann.target_subtitle or "",
                "anchor": anchor,
                "thread_id": ann.thread_id or "",
                "in_reply_to": ann.in_reply_to or "",
                "version": ann.version or "",
                "file_path": ann.file_path or "",
                "start_line": ann.start_line or int(anchor.get("start_line", 0) or 0),
                "end_line": ann.end_line or int(anchor.get("end_line", 0) or 0),
                "code_target": build_code_target(
                    version=ann.version or "",
                    path=ann.file_path or "",
                    start_line=ann.start_line or int(anchor.get("start_line", 0) or 0),
                    end_line=ann.end_line or int(anchor.get("end_line", 0) or 0),
                    target_ref=ann.target_ref or "",
                    anchor=anchor,
                    meta=ann.meta or {},
                ) if ann.annotation_type == "code" else {},
                "meta": {
                    **(ann.meta or {}),
                    **(
                        {
                            "code_target": build_code_target(
                                version=ann.version or "",
                                path=ann.file_path or "",
                                start_line=ann.start_line or int(anchor.get("start_line", 0) or 0),
                                end_line=ann.end_line or int(anchor.get("end_line", 0) or 0),
                                target_ref=ann.target_ref or "",
                                anchor=anchor,
                                meta=ann.meta or {},
                            )
                        }
                        if ann.annotation_type == "code"
                        else {}
                    ),
                },
            }
        )

    def _to_relation_read(self, rel: AnnotationRelationORM) -> AnnotationRelationRead:
        return AnnotationRelationRead.model_validate(
            {
                "relation_id": rel.relation_id,
                "source_annotation_id": rel.source_annotation_id,
                "target_annotation_id": rel.target_annotation_id,
                "relation_type": rel.relation_type,
                "source_kind": rel.source_kind,
                "description": rel.description,
                "meta": rel.meta or {},
                "created_by": rel.created_by,
                "updated_by": rel.updated_by,
                "created_by_user_id": rel.created_by_user_id,
                "updated_by_user_id": rel.updated_by_user_id,
                "created_at": rel.created_at,
                "updated_at": rel.updated_at,
            }
        )

    async def create(
        self,
        annotation: AnnotationCreate,
        content_for_hash: str = "",
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> AnnotationRead:
        """创建标注或回复。"""
        data = _normalize_annotation_payload(annotation)
        now = datetime.utcnow()

        async with self.session_factory() as session:
            parent = None
            if data.parent_annotation_id:
                result = await session.execute(
                    select(AnnotationORM).where(AnnotationORM.annotation_id == data.parent_annotation_id)
                )
                parent = result.scalar_one_or_none()
                if not parent:
                    raise ValueError(f"parent annotation not found: {data.parent_annotation_id}")

            if parent:
                if not data.target_type:
                    data.target_type = parent.target_type
                if not data.target_ref:
                    data.target_ref = parent.target_ref
                if not data.target_label:
                    data.target_label = parent.target_label
                if not data.target_subtitle:
                    data.target_subtitle = parent.target_subtitle
                if not data.anchor:
                    data.anchor = parent.anchor or {}
                if not data.thread_id:
                    data.thread_id = parent.thread_id or ""
                if not data.in_reply_to:
                    data.in_reply_to = parent.annotation_id
                if not data.version:
                    data.version = parent.version or ""
                if not data.file_path:
                    data.file_path = parent.file_path or ""
                if not data.start_line and parent.start_line:
                    data.start_line = parent.start_line
                if not data.end_line and parent.end_line:
                    data.end_line = parent.end_line

            if not data.target_type or not data.target_ref:
                raise ValueError("target_type and target_ref are required")

            annotation_id = f"annotation-{uuid.uuid4().hex[:12]}"
            if data.annotation_type == "code":
                annotation_id = f"code-annot-{uuid.uuid4().hex[:12]}"

            anchor_context = None
            if data.annotation_type == "code" and data.version and data.file_path and data.start_line:
                anchor_context = _compute_context_hash(
                    data.version,
                    data.file_path,
                    data.start_line,
                    content_for_hash,
                )

            publish_status = "none"
            publish_reviewed_at = None
            publish_reviewed_by_user_id = None
            if data.visibility == "public":
                publish_status = "approved"
                publish_reviewed_at = now
                publish_reviewed_by_user_id = actor_user_id or data.author_user_id

            orm = AnnotationORM(
                annotation_id=annotation_id,
                annotation_type=data.annotation_type,
                author=actor_display_name or data.author or self.default_author,
                author_user_id=actor_user_id or data.author_user_id,
                visibility=data.visibility or "public",
                publish_status=publish_status,
                body=data.body,
                parent_annotation_id=data.parent_annotation_id or None,
                publish_requested_at=None,
                publish_requested_by_user_id=None,
                publish_reviewed_at=publish_reviewed_at,
                publish_reviewed_by_user_id=publish_reviewed_by_user_id,
                publish_review_comment="",
                target_type=data.target_type,
                target_ref=data.target_ref,
                target_label=data.target_label or "",
                target_subtitle=data.target_subtitle or "",
                anchor=data.anchor or {},
                meta=data.meta or {},
                thread_id=data.thread_id or "",
                in_reply_to=data.in_reply_to or "",
                version=data.version or None,
                file_path=data.file_path or None,
                start_line=data.start_line or None,
                end_line=data.end_line or None,
                anchor_context=anchor_context,
                created_at=now,
                updated_at=now,
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            logger.info("Created %s annotation %s", data.annotation_type, annotation_id)
            return self._to_annotation_read(orm)

    async def list_by_thread(
        self,
        thread_id: str,
        viewer_user_id: Optional[str] = None,
        include_all_private: bool = False,
    ) -> list[AnnotationRead]:
        async with self.session_factory() as session:
            stmt = (
                select(AnnotationORM)
                .where(AnnotationORM.thread_id == thread_id)
                .where(*self._visibility_filters(viewer_user_id, include_all_private=include_all_private))
                .order_by(AnnotationORM.created_at.asc())
            )
            result = await session.execute(stmt)
            return [self._to_annotation_read(row) for row in result.scalars().all()]

    async def list_by_code(
        self,
        version: str,
        file_path: str,
        viewer_user_id: Optional[str] = None,
        include_all_private: bool = False,
    ) -> list[AnnotationRead]:
        async with self.session_factory() as session:
            stmt = (
                select(AnnotationORM)
                .where(AnnotationORM.annotation_type == "code")
                .where(AnnotationORM.version == version)
                .where(AnnotationORM.file_path == file_path)
                .where(*self._visibility_filters(viewer_user_id, include_all_private=include_all_private))
                .order_by(AnnotationORM.start_line.asc(), AnnotationORM.created_at.asc())
            )
            result = await session.execute(stmt)
            return [self._to_annotation_read(row) for row in result.scalars().all()]

    async def list_all(
        self,
        annotation_type: str = "all",
        page: int = 1,
        page_size: int = 20,
        extra_filters: Optional[list] = None,
        viewer_user_id: Optional[str] = None,
        include_all_private: bool = False,
    ) -> tuple[list[dict], int]:
        filters = [*self._visibility_filters(viewer_user_id, include_all_private=include_all_private), *(extra_filters or [])]
        if annotation_type != "all":
            filters.append(AnnotationORM.annotation_type == annotation_type)
        return await self._list_with_filters(filters, page, page_size)

    async def search(
        self,
        keyword: str,
        annotation_type: str = "all",
        page: int = 1,
        page_size: int = 20,
        extra_filters: Optional[list] = None,
        viewer_user_id: Optional[str] = None,
        include_all_private: bool = False,
    ) -> tuple[list[dict], int]:
        filters = [
            AnnotationORM.body.ilike(f"%{keyword}%"),
            *self._visibility_filters(viewer_user_id, include_all_private=include_all_private),
            *(extra_filters or []),
        ]
        if annotation_type != "all":
            filters.append(AnnotationORM.annotation_type == annotation_type)
        return await self._list_with_filters(filters, page, page_size)

    async def _list_with_filters(
        self,
        filters: list,
        page: int,
        page_size: int,
    ) -> tuple[list[dict], int]:
        async with self.session_factory() as session:
            count_stmt = select(func.count()).select_from(AnnotationORM)
            if filters:
                count_stmt = count_stmt.where(and_(*filters))
            total = (await session.execute(count_stmt)).scalar() or 0
            if total == 0:
                return [], 0

            stmt = (
                select(AnnotationORM, EmailORM.subject, EmailORM.sender)
                .outerjoin(EmailORM, AnnotationORM.in_reply_to == EmailORM.message_id)
                .order_by(AnnotationORM.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
            if filters:
                stmt = stmt.where(and_(*filters))

            result = await session.execute(stmt)
            rows = result.all()
            return [self._serialize_row(ann, email_subject, email_sender) for ann, email_subject, email_sender in rows], total

    def _serialize_row(
        self,
        ann: AnnotationORM,
        email_subject: Optional[str] = None,
        email_sender: Optional[str] = None,
    ) -> dict:
        anchor = ann.anchor or {}
        return {
            "annotation_id": ann.annotation_id,
            "annotation_type": ann.annotation_type,
            "author": ann.author,
            "author_user_id": ann.author_user_id,
            "visibility": ann.visibility or "public",
            "publish_status": ann.publish_status or "none",
            "body": ann.body,
            "parent_annotation_id": ann.parent_annotation_id or "",
            "publish_requested_at": ann.publish_requested_at.isoformat() if ann.publish_requested_at else None,
            "publish_requested_by_user_id": ann.publish_requested_by_user_id,
            "publish_reviewed_at": ann.publish_reviewed_at.isoformat() if ann.publish_reviewed_at else None,
            "publish_reviewed_by_user_id": ann.publish_reviewed_by_user_id,
            "publish_review_comment": ann.publish_review_comment or "",
            "created_at": ann.created_at.isoformat(),
            "updated_at": ann.updated_at.isoformat(),
            "target_type": ann.target_type,
            "target_ref": ann.target_ref,
            "target_label": ann.target_label or "",
            "target_subtitle": ann.target_subtitle or "",
            "anchor": anchor,
            "thread_id": ann.thread_id or "",
            "in_reply_to": ann.in_reply_to or "",
            "version": ann.version or "",
            "file_path": ann.file_path or "",
            "start_line": ann.start_line or int(anchor.get("start_line", 0) or 0),
            "end_line": ann.end_line or int(anchor.get("end_line", 0) or 0),
            "email_subject": email_subject or "",
            "email_sender": email_sender or "",
            "code_target": build_code_target(
                version=ann.version or "",
                path=ann.file_path or "",
                start_line=ann.start_line or int(anchor.get("start_line", 0) or 0),
                end_line=ann.end_line or int(anchor.get("end_line", 0) or 0),
                target_ref=ann.target_ref or "",
                anchor=anchor,
                meta=ann.meta or {},
            ) if ann.annotation_type == "code" else None,
            "meta": {
                **(ann.meta or {}),
                **(
                    {
                        "code_target": build_code_target(
                            version=ann.version or "",
                            path=ann.file_path or "",
                            start_line=ann.start_line or int(anchor.get("start_line", 0) or 0),
                            end_line=ann.end_line or int(anchor.get("end_line", 0) or 0),
                            target_ref=ann.target_ref or "",
                            anchor=anchor,
                            meta=ann.meta or {},
                        )
                    }
                    if ann.annotation_type == "code"
                    else {}
                ),
            },
        }

    async def update(self, annotation_id: str, data: AnnotationUpdate) -> Optional[AnnotationRead]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(AnnotationORM).where(AnnotationORM.annotation_id == annotation_id)
            )
            orm = result.scalar_one_or_none()
            if not orm:
                return None

            orm.body = data.body
            if data.visibility is not None:
                orm.visibility = data.visibility
            orm.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(orm)
            return self._to_annotation_read(orm)

    async def create_relation(
        self,
        relation: AnnotationRelationCreate,
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> AnnotationRelationRead:
        source_annotation_id = relation.source_annotation_id.strip()
        target_annotation_id = relation.target_annotation_id.strip()
        relation_type = normalize_relation_type(relation.relation_type)
        source_kind = normalize_source_kind(relation.source_kind)
        if source_annotation_id == target_annotation_id:
            raise ValueError("source_annotation_id and target_annotation_id must differ")

        async with self.session_factory() as session:
            existing_annotations = await session.execute(
                select(AnnotationORM.annotation_id).where(
                    AnnotationORM.annotation_id.in_([source_annotation_id, target_annotation_id])
                )
            )
            existing_ids = set(existing_annotations.scalars().all())
            if source_annotation_id not in existing_ids:
                raise ValueError(f"source annotation not found: {source_annotation_id}")
            if target_annotation_id not in existing_ids:
                raise ValueError(f"target annotation not found: {target_annotation_id}")

            stmt = select(AnnotationRelationORM).where(
                AnnotationRelationORM.source_annotation_id == source_annotation_id,
                AnnotationRelationORM.target_annotation_id == target_annotation_id,
                AnnotationRelationORM.relation_type == relation_type,
                AnnotationRelationORM.source_kind == source_kind,
            )
            existing_relation = (await session.execute(stmt)).scalar_one_or_none()
            if existing_relation:
                return self._to_relation_read(existing_relation)

            now = datetime.utcnow()
            actor_name = actor_display_name or self.default_author
            actor_id = actor_user_id or relation.created_by_user_id
            orm = AnnotationRelationORM(
                relation_id=f"annot-rel-{uuid.uuid4().hex[:12]}",
                source_annotation_id=source_annotation_id,
                target_annotation_id=target_annotation_id,
                relation_type=relation_type,
                source_kind=source_kind,
                description=relation.description.strip(),
                meta=relation.meta or {},
                created_by=actor_name,
                updated_by=actor_name,
                created_by_user_id=actor_id,
                updated_by_user_id=actor_id,
                created_at=now,
                updated_at=now,
            )
            session.add(orm)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                existing_relation = (await session.execute(stmt)).scalar_one_or_none()
                if existing_relation:
                    return self._to_relation_read(existing_relation)
                raise
            await session.refresh(orm)
            return self._to_relation_read(orm)

    async def list_relations(
        self,
        annotation_id: str,
        direction: str = "both",
        viewer_user_id: Optional[str] = None,
        include_all_private: bool = False,
    ) -> list[AnnotationRelationRead]:
        normalized_direction = (direction or "both").strip().lower()
        if normalized_direction not in {"out", "in", "both"}:
            raise ValueError("direction must be one of: out, in, both")

        visible_annotation_ids = select(AnnotationORM.annotation_id)
        visibility_filters = self._visibility_filters(
            viewer_user_id,
            include_all_private=include_all_private,
        )
        if visibility_filters:
            visible_annotation_ids = visible_annotation_ids.where(*visibility_filters)

        async with self.session_factory() as session:
            stmt = (
                select(AnnotationRelationORM)
                .where(
                    AnnotationRelationORM.source_annotation_id.in_(visible_annotation_ids),
                    AnnotationRelationORM.target_annotation_id.in_(visible_annotation_ids),
                )
                .order_by(AnnotationRelationORM.created_at.asc())
            )
            if normalized_direction == "out":
                stmt = stmt.where(AnnotationRelationORM.source_annotation_id == annotation_id)
            elif normalized_direction == "in":
                stmt = stmt.where(AnnotationRelationORM.target_annotation_id == annotation_id)
            else:
                stmt = stmt.where(
                    or_(
                        AnnotationRelationORM.source_annotation_id == annotation_id,
                        AnnotationRelationORM.target_annotation_id == annotation_id,
                    )
                )

            result = await session.execute(stmt)
            return [self._to_relation_read(rel) for rel in result.scalars().all()]

    async def delete_relation(self, relation_id: str) -> bool:
        async with self.session_factory() as session:
            result = await session.execute(
                delete(AnnotationRelationORM).where(AnnotationRelationORM.relation_id == relation_id)
            )
            await session.commit()
            return result.rowcount > 0

    async def sync_markdown_reference_relations(
        self,
        source_annotation_id: str,
        body: str,
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> None:
        desired_relations = {
            (match["annotation_id"], normalize_relation_type(match["relation_type"]))
            for match in extract_annotation_links(body)
            if match["annotation_id"] != source_annotation_id
        }
        actor_name = actor_display_name or self.default_author
        actor_id = actor_user_id or None

        async with self.session_factory() as session:
            source_exists = await session.execute(
                select(AnnotationORM.annotation_id).where(AnnotationORM.annotation_id == source_annotation_id)
            )
            if not source_exists.scalar_one_or_none():
                raise ValueError(f"source annotation not found: {source_annotation_id}")

            existing_rows = (
                await session.execute(
                    select(AnnotationRelationORM).where(
                        AnnotationRelationORM.source_annotation_id == source_annotation_id,
                        AnnotationRelationORM.source_kind == "markdown_link",
                    )
                )
            ).scalars().all()
            existing_keys = {
                (row.target_annotation_id, row.relation_type): row
                for row in existing_rows
            }

            for key, row in existing_keys.items():
                if key not in desired_relations:
                    await session.delete(row)

            desired_target_ids = [target_annotation_id for target_annotation_id, _ in desired_relations]
            existing_target_ids: set[str] = set()
            if desired_target_ids:
                target_rows = await session.execute(
                    select(AnnotationORM.annotation_id).where(AnnotationORM.annotation_id.in_(desired_target_ids))
                )
                existing_target_ids = set(target_rows.scalars().all())

            now = datetime.utcnow()
            for target_annotation_id, relation_type in sorted(desired_relations):
                if target_annotation_id not in existing_target_ids:
                    continue
                if (target_annotation_id, relation_type) in existing_keys:
                    continue
                session.add(
                    AnnotationRelationORM(
                        relation_id=f"annot-rel-{uuid.uuid4().hex[:12]}",
                        source_annotation_id=source_annotation_id,
                        target_annotation_id=target_annotation_id,
                        relation_type=relation_type,
                        source_kind="markdown_link",
                        description="",
                        meta={},
                        created_by=actor_name,
                        updated_by=actor_name,
                        created_by_user_id=actor_id,
                        updated_by_user_id=actor_id,
                        created_at=now,
                        updated_at=now,
                    )
                )

            await session.commit()

    async def request_publication(self, annotation_id: str, request_user_id: str) -> Optional[AnnotationRead]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(AnnotationORM).where(AnnotationORM.annotation_id == annotation_id)
            )
            orm = result.scalar_one_or_none()
            if not orm:
                return None

            now = datetime.utcnow()
            orm.publish_status = "pending"
            orm.publish_requested_at = now
            orm.publish_requested_by_user_id = request_user_id
            orm.publish_reviewed_at = None
            orm.publish_reviewed_by_user_id = None
            orm.publish_review_comment = ""
            orm.updated_at = now
            await session.commit()
            await session.refresh(orm)
            return self._to_annotation_read(orm)

    async def withdraw_publication_request(self, annotation_id: str) -> Optional[AnnotationRead]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(AnnotationORM).where(AnnotationORM.annotation_id == annotation_id)
            )
            orm = result.scalar_one_or_none()
            if not orm:
                return None

            now = datetime.utcnow()
            orm.publish_status = "none"
            orm.publish_requested_at = None
            orm.publish_requested_by_user_id = None
            orm.publish_reviewed_at = None
            orm.publish_reviewed_by_user_id = None
            orm.publish_review_comment = ""
            orm.updated_at = now
            await session.commit()
            await session.refresh(orm)
            return self._to_annotation_read(orm)

    async def review_publication(
        self,
        annotation_id: str,
        *,
        approved: bool,
        reviewer_user_id: str,
        review_comment: str = "",
    ) -> Optional[AnnotationRead]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(AnnotationORM).where(AnnotationORM.annotation_id == annotation_id)
            )
            orm = result.scalar_one_or_none()
            if not orm:
                return None

            now = datetime.utcnow()
            orm.publish_status = "approved" if approved else "rejected"
            orm.visibility = "public" if approved else "private"
            orm.publish_reviewed_at = now
            orm.publish_reviewed_by_user_id = reviewer_user_id
            orm.publish_review_comment = review_comment.strip()
            orm.updated_at = now
            await session.commit()
            await session.refresh(orm)
            return self._to_annotation_read(orm)

    async def delete(self, annotation_id: str) -> bool:
        async with self.session_factory() as session:
            await session.execute(
                delete(TagAssignmentORM)
                .where(TagAssignmentORM.target_type == "annotation")
                .where(TagAssignmentORM.target_ref == annotation_id)
            )
            await session.execute(
                delete(AnnotationRelationORM).where(
                    or_(
                        AnnotationRelationORM.source_annotation_id == annotation_id,
                        AnnotationRelationORM.target_annotation_id == annotation_id,
                    )
                )
            )
            result = await session.execute(
                delete(AnnotationORM).where(AnnotationORM.annotation_id == annotation_id)
            )
            await session.commit()
            return result.rowcount > 0

    async def get(self, annotation_id: str) -> Optional[AnnotationRead]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(AnnotationORM).where(AnnotationORM.annotation_id == annotation_id)
            )
            orm = result.scalar_one_or_none()
            return self._to_annotation_read(orm) if orm else None

    async def export_thread(self, thread_id: str) -> dict:
        annotations = await self.list_by_thread(thread_id)
        return {
            "thread_id": thread_id,
            "exported_at": datetime.utcnow().isoformat(),
            "annotations": [item.model_dump(mode="json") for item in annotations],
        }

    async def import_thread(self, data: dict) -> int:
        items = data.get("annotations", [])
        count = 0
        for item in items:
            await self.create(AnnotationCreate(**item))
            count += 1
        return count

    async def import_all(self, data: dict) -> dict:
        groups = data.get("targets", {})
        total = 0
        for _, annotations in groups.items():
            for item in annotations:
                await self.create(AnnotationCreate(**item))
                total += 1
        return {"total_imported": total, "targets_count": len(groups)}

    async def export_all(self, annotation_type: str = "all") -> dict:
        items, _ = await self.list_all(annotation_type=annotation_type, page=1, page_size=10_000)
        grouped: dict[str, list[dict]] = {}
        for item in items:
            grouped.setdefault(item["target_ref"], []).append(item)
        return {
            "exported_at": datetime.utcnow().isoformat(),
            "total_annotations": len(items),
            "targets": grouped,
        }


AnnotationStore = UnifiedAnnotationStore
