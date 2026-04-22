"""批注存储层 — 管理邮件线程中的本地批注（回复）。

遵循 session_factory 模式，每次操作创建新 session，避免长生命周期 session 过期。
"""

import json
import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import delete, select, func, or_
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.orm import aliased

from src.storage.models import AnnotationCreate, AnnotationORM, AnnotationRead, AnnotationUpdate, EmailORM

logger = logging.getLogger(__name__)


class AnnotationStore:
    """批注存储器。

    提供批注的 CRUD 操作和导出功能。
    使用 session_factory 每次操作创建新 session。

    Attributes:
        session_factory: SQLAlchemy 异步会话工厂。
        default_author: 默认批注作者名。
    """

    def __init__(self, session_factory: async_sessionmaker, default_author: str = "me"):
        """初始化批注存储器。

        Args:
            session_factory: SQLAlchemy 异步会话工厂（async context manager）。
            default_author: 默认批注作者名称。
        """
        self.session_factory = session_factory
        self.default_author = default_author

    async def create(self, annotation: AnnotationCreate) -> AnnotationRead:
        """创建新批注。

        Args:
            annotation: 批注创建模型。

        Returns:
            创建后的批注读取模型。
        """
        annotation_id = f"annotation-{uuid.uuid4().hex[:12]}"
        author = annotation.author or self.default_author
        now = datetime.utcnow()

        orm = AnnotationORM(
            annotation_id=annotation_id,
            thread_id=annotation.thread_id,
            in_reply_to=annotation.in_reply_to,
            author=author,
            body=annotation.body,
            created_at=now,
            updated_at=now,
        )

        async with self.session_factory() as session:
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            logger.info(f"Created annotation {annotation_id} in thread {annotation.thread_id}")
            return AnnotationRead.model_validate(orm)

    async def list_by_thread(self, thread_id: str) -> list[AnnotationRead]:
        """获取线程下所有批注（按创建时间排序）。

        Args:
            thread_id: 线程 ID。

        Returns:
            批注列表。
        """
        async with self.session_factory() as session:
            stmt = (
                select(AnnotationORM)
                .where(AnnotationORM.thread_id == thread_id)
                .order_by(AnnotationORM.created_at.asc())
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [AnnotationRead.model_validate(r) for r in rows]

    async def list_all(self, page: int = 1, page_size: int = 20) -> tuple[list[dict], int]:
        """全量批注分页列表，按 created_at 倒序。

        关联 emails 表（通过 in_reply_to 匹配 message_id）获取 subject / sender。

        Args:
            page: 页码（从 1 开始）。
            page_size: 每页数量。

        Returns:
            (批注列表, 总数) 元组。
        """
        async with self.session_factory() as session:
            # 计算总数
            count_stmt = select(func.count()).select_from(AnnotationORM)
            total = (await session.execute(count_stmt)).scalar() or 0

            if total == 0:
                return [], 0

            # 分页查询批注 + LEFT JOIN emails
            offset = (page - 1) * page_size
            stmt = (
                select(AnnotationORM, EmailORM.subject, EmailORM.sender)
                .outerjoin(EmailORM, AnnotationORM.in_reply_to == EmailORM.message_id)
                .order_by(AnnotationORM.created_at.desc())
                .offset(offset)
                .limit(page_size)
            )
            result = await session.execute(stmt)
            rows = result.all()

            items = []
            for ann, email_subject, email_sender in rows:
                items.append({
                    "annotation_id": ann.annotation_id,
                    "thread_id": ann.thread_id,
                    "in_reply_to": ann.in_reply_to,
                    "author": ann.author,
                    "body": ann.body,
                    "created_at": ann.created_at.isoformat(),
                    "updated_at": ann.updated_at.isoformat(),
                    "email_subject": email_subject or "",
                    "email_sender": email_sender or "",
                })

            return items, total

    async def search(self, keyword: str, page: int = 1, page_size: int = 20) -> tuple[list[dict], int]:
        """按批注 body 内容模糊搜索。

        使用 ILIKE 进行大小写不敏感模糊匹配，同样关联 emails 表返回上下文信息。

        Args:
            keyword: 搜索关键词。
            page: 页码（从 1 开始）。
            page_size: 每页数量。

        Returns:
            (匹配批注列表, 总数) 元组。
        """
        pattern = f"%{keyword}%"
        async with self.session_factory() as session:
            # 计算匹配总数
            count_stmt = (
                select(func.count())
                .select_from(AnnotationORM)
                .where(AnnotationORM.body.ilike(pattern))
            )
            total = (await session.execute(count_stmt)).scalar() or 0

            if total == 0:
                return [], 0

            # 分页查询
            offset = (page - 1) * page_size
            stmt = (
                select(AnnotationORM, EmailORM.subject, EmailORM.sender)
                .outerjoin(EmailORM, AnnotationORM.in_reply_to == EmailORM.message_id)
                .where(AnnotationORM.body.ilike(pattern))
                .order_by(AnnotationORM.created_at.desc())
                .offset(offset)
                .limit(page_size)
            )
            result = await session.execute(stmt)
            rows = result.all()

            items = []
            for ann, email_subject, email_sender in rows:
                items.append({
                    "annotation_id": ann.annotation_id,
                    "thread_id": ann.thread_id,
                    "in_reply_to": ann.in_reply_to,
                    "author": ann.author,
                    "body": ann.body,
                    "created_at": ann.created_at.isoformat(),
                    "updated_at": ann.updated_at.isoformat(),
                    "email_subject": email_subject or "",
                    "email_sender": email_sender or "",
                })

            return items, total

    async def update(self, annotation_id: str, data: AnnotationUpdate) -> Optional[AnnotationRead]:
        """更新批注内容。

        Args:
            annotation_id: 批注唯一标识。
            data: 更新数据。

        Returns:
            更新后的批注读取模型，不存在返回 None。
        """
        async with self.session_factory() as session:
            stmt = select(AnnotationORM).where(AnnotationORM.annotation_id == annotation_id)
            result = await session.execute(stmt)
            orm = result.scalar_one_or_none()
            if not orm:
                return None

            orm.body = data.body
            orm.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(orm)
            logger.info(f"Updated annotation {annotation_id}")
            return AnnotationRead.model_validate(orm)

    async def delete(self, annotation_id: str) -> bool:
        """删除批注。

        Args:
            annotation_id: 批注唯一标识。

        Returns:
            是否成功删除。
        """
        async with self.session_factory() as session:
            stmt = delete(AnnotationORM).where(AnnotationORM.annotation_id == annotation_id)
            result = await session.execute(stmt)
            await session.commit()
            deleted = result.rowcount > 0
            if deleted:
                logger.info(f"Deleted annotation {annotation_id}")
            return deleted

    async def export_thread(self, thread_id: str) -> dict:
        """导出线程的所有批注为 JSON 格式。

        Args:
            thread_id: 线程 ID。

        Returns:
            包含线程 ID、批注列表、导出时间的字典。
        """
        annotations = await self.list_by_thread(thread_id)
        return {
            "thread_id": thread_id,
            "exported_at": datetime.utcnow().isoformat(),
            "annotations": [
                {
                    "annotation_id": a.annotation_id,
                    "in_reply_to": a.in_reply_to,
                    "author": a.author,
                    "body": a.body,
                    "created_at": a.created_at.isoformat(),
                    "updated_at": a.updated_at.isoformat(),
                }
                for a in annotations
            ],
        }

    async def import_thread(self, data: dict) -> int:
        """从 JSON 导入单个线程的批注（跳过已存在的）。

        Args:
            data: 导出格式的字典，包含 thread_id 和 annotations 列表。

        Returns:
            成功导入的批注数量。
        """
        thread_id = data.get("thread_id", "")
        items = data.get("annotations", [])
        if not thread_id or not items:
            return 0

        count = 0
        async with self.session_factory() as session:
            for item in items:
                aid = item.get("annotation_id", "")
                if not aid:
                    continue
                # 检查是否已存在
                stmt = select(AnnotationORM).where(AnnotationORM.annotation_id == aid)
                result = await session.execute(stmt)
                if result.scalar_one_or_none():
                    continue

                orm = AnnotationORM(
                    annotation_id=aid,
                    thread_id=thread_id,
                    in_reply_to=item.get("in_reply_to", ""),
                    author=item.get("author", self.default_author),
                    body=item.get("body", ""),
                    created_at=datetime.fromisoformat(item["created_at"]) if item.get("created_at") else datetime.utcnow(),
                    updated_at=datetime.fromisoformat(item["updated_at"]) if item.get("updated_at") else datetime.utcnow(),
                )
                session.add(orm)
                count += 1

            if count > 0:
                await session.commit()
            logger.info(f"Imported {count} annotations for thread {thread_id}")
        return count

    async def import_all(self, data: dict) -> dict:
        """从 JSON 导入所有线程的批注。

        Args:
            data: 导出格式的字典，包含 threads 字典（thread_id -> annotations 列表）。

        Returns:
            导入统计：total_imported, threads_count。
        """
        threads = data.get("threads", {})
        total = 0
        for thread_id, annotations in threads.items():
            count = await self.import_thread({
                "thread_id": thread_id,
                "annotations": annotations,
            })
            total += count

        return {
            "total_imported": total,
            "threads_count": len(threads),
        }

    async def export_all(self) -> dict:
        """导出所有批注为 JSON 格式（按线程分组）。

        Returns:
            包含所有线程批注的字典。
        """
        async with self.session_factory() as session:
            stmt = select(AnnotationORM).order_by(AnnotationORM.thread_id, AnnotationORM.created_at)
            result = await session.execute(stmt)
            rows = result.scalars().all()

        threads: dict[str, list] = {}
        for orm in rows:
            tid = orm.thread_id
            if tid not in threads:
                threads[tid] = []
            threads[tid].append({
                "annotation_id": orm.annotation_id,
                "in_reply_to": orm.in_reply_to,
                "author": orm.author,
                "body": orm.body,
                "created_at": orm.created_at.isoformat(),
                "updated_at": orm.updated_at.isoformat(),
            })

        return {
            "exported_at": datetime.utcnow().isoformat(),
            "total_annotations": len(rows),
            "threads": threads,
        }