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

from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.storage.models import AnnotationCreate, AnnotationORM, AnnotationRead, AnnotationUpdate, EmailORM

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
        if not data.target_ref and data.version and data.file_path:
            data.target_ref = f"{data.version}:{data.file_path}"
        if not data.target_label:
            data.target_label = data.file_path
        if not data.target_subtitle:
            data.target_subtitle = data.version
        if not data.anchor and data.start_line > 0:
            data.anchor = {
                "start_line": data.start_line,
                "end_line": data.end_line or data.start_line,
            }

    return data


class UnifiedAnnotationStore:
    """统一标注存储器。"""

    def __init__(self, session_factory: async_sessionmaker, default_author: str = "me"):
        self.session_factory = session_factory
        self.default_author = default_author

    async def create(self, annotation: AnnotationCreate, content_for_hash: str = "") -> AnnotationRead:
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

            orm = AnnotationORM(
                annotation_id=annotation_id,
                annotation_type=data.annotation_type,
                author=data.author or self.default_author,
                body=data.body,
                parent_annotation_id=data.parent_annotation_id or None,
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
            return AnnotationRead.model_validate(orm)

    async def list_by_thread(self, thread_id: str) -> list[AnnotationRead]:
        async with self.session_factory() as session:
            stmt = (
                select(AnnotationORM)
                .where(AnnotationORM.thread_id == thread_id)
                .order_by(AnnotationORM.created_at.asc())
            )
            result = await session.execute(stmt)
            return [AnnotationRead.model_validate(row) for row in result.scalars().all()]

    async def list_by_code(self, version: str, file_path: str) -> list[AnnotationRead]:
        async with self.session_factory() as session:
            stmt = (
                select(AnnotationORM)
                .where(AnnotationORM.annotation_type == "code")
                .where(AnnotationORM.version == version)
                .where(AnnotationORM.file_path == file_path)
                .order_by(AnnotationORM.start_line.asc(), AnnotationORM.created_at.asc())
            )
            result = await session.execute(stmt)
            return [AnnotationRead.model_validate(row) for row in result.scalars().all()]

    async def list_all(
        self,
        annotation_type: str = "all",
        page: int = 1,
        page_size: int = 20,
        extra_filters: Optional[list] = None,
    ) -> tuple[list[dict], int]:
        filters = list(extra_filters or [])
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
    ) -> tuple[list[dict], int]:
        filters = [AnnotationORM.body.ilike(f"%{keyword}%"), *(extra_filters or [])]
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
            "body": ann.body,
            "parent_annotation_id": ann.parent_annotation_id or "",
            "created_at": ann.created_at.isoformat(),
            "updated_at": ann.updated_at.isoformat(),
            "target_type": ann.target_type,
            "target_ref": ann.target_ref,
            "target_label": ann.target_label or "",
            "target_subtitle": ann.target_subtitle or "",
            "anchor": anchor,
            "meta": ann.meta or {},
            "thread_id": ann.thread_id or "",
            "in_reply_to": ann.in_reply_to or "",
            "version": ann.version or "",
            "file_path": ann.file_path or "",
            "start_line": ann.start_line or int(anchor.get("start_line", 0) or 0),
            "end_line": ann.end_line or int(anchor.get("end_line", 0) or 0),
            "email_subject": email_subject or "",
            "email_sender": email_sender or "",
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
            orm.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(orm)
            return AnnotationRead.model_validate(orm)

    async def delete(self, annotation_id: str) -> bool:
        async with self.session_factory() as session:
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
            return AnnotationRead.model_validate(orm) if orm else None

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
