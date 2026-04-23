"""统一批注存储层 — 支持邮件批注和代码标注。

将 AnnotationStore 和 CodeAnnotationStore 合并为单一存储类。
遵循 session_factory 模式，每次操作创建新 session，避免长生命周期 session 过期。
"""

import hashlib
import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import delete, select, func, or_, and_
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.storage.models import AnnotationCreate, AnnotationORM, AnnotationRead, AnnotationUpdate, EmailORM

logger = logging.getLogger(__name__)


def _compute_context_hash(version: str, file_path: str, start_line: int, content: str) -> str:
    """计算上下文哈希，用于检测版本漂移。

    以 "version:path:line:content_prefix" 的前 64 字符 SHA256 作为锚点哈希。
    """
    prefix = content[:200] if content else ""
    raw = f"{version}:{file_path}:{start_line}:{prefix}"
    return hashlib.sha256(raw.encode()).hexdigest()[:64]


class UnifiedAnnotationStore:
    """统一批注存储器。

    支持两种批注类型：
    - 'email': 邮件批注，存储在线程树中的本地评论
    - 'code': 代码标注，对内核源码的行级/范围级注释

    使用 session_factory 每次操作创建新 session。

    Attributes:
        session_factory: SQLAlchemy 异步会话工厂。
        default_author: 默认批注作者名。
    """

    def __init__(self, session_factory: async_sessionmaker, default_author: str = "me"):
        """初始化统一批注存储器。

        Args:
            session_factory: SQLAlchemy 异步会话工厂（async context manager）。
            default_author: 默认批注作者名称。
        """
        self.session_factory = session_factory
        self.default_author = default_author

    async def create(self, annotation: AnnotationCreate, content_for_hash: str = "") -> AnnotationRead:
        """创建新批注。

        Args:
            annotation: 批注创建模型。
            content_for_hash: 用于计算代码标注锚点哈希的代码内容。

        Returns:
            创建后的批注读取模型。
        """
        annotation_id = f"annotation-{uuid.uuid4().hex[:12]}"
        author = annotation.author or self.default_author
        now = datetime.utcnow()
        annotation_type = annotation.annotation_type or "email"

        # 计算代码标注的锚点哈希
        anchor_context = None
        if annotation_type == "code" and annotation.version and annotation.file_path:
            anchor_context = _compute_context_hash(
                annotation.version, annotation.file_path, annotation.start_line, content_for_hash
            )
            annotation_id = f"code-annot-{uuid.uuid4().hex[:12]}"

        orm = AnnotationORM(
            annotation_id=annotation_id,
            annotation_type=annotation_type,
            author=author,
            body=annotation.body,
            created_at=now,
            updated_at=now,
            # email 类型字段
            thread_id=annotation.thread_id or "",
            in_reply_to=annotation.in_reply_to or "",
            # code 类型字段
            version=annotation.version or None,
            file_path=annotation.file_path or None,
            start_line=annotation.start_line or None,
            end_line=annotation.end_line or None,
            anchor_context=anchor_context,
        )

        async with self.session_factory() as session:
            session.add(orm)
            try:
                await session.commit()
                await session.refresh(orm)
                logger.info(f"Created {annotation_type} annotation {annotation_id}")
                return AnnotationRead.model_validate(orm)
            except Exception as e:
                await session.rollback()
                # 忽略重复注释（唯一约束冲突）
                if "duplicate key" in str(e).lower() or "unique" in str(e).lower():
                    logger.warning(f"Duplicate annotation ignored: {annotation_id}")
                    # 查询已存在的
                    result = await session.execute(
                        select(AnnotationORM).where(AnnotationORM.annotation_id == annotation_id)
                    )
                    existing = result.scalar_one_or_none()
                    if existing:
                        return AnnotationRead.model_validate(existing)
                raise

    async def list_by_thread(self, thread_id: str) -> list[AnnotationRead]:
        """获取线程下所有批注（email 类型，按创建时间排序）。

        Args:
            thread_id: 线程 ID。

        Returns:
            批注列表。
        """
        async with self.session_factory() as session:
            stmt = (
                select(AnnotationORM)
                .where(AnnotationORM.annotation_type == "email")
                .where(AnnotationORM.thread_id == thread_id)
                .order_by(AnnotationORM.created_at.asc())
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            
            # 处理 None 值，避免 Pydantic 验证错误
            annotations = []
            for r in rows:
                annotations.append(AnnotationRead(
                    id=r.id,
                    annotation_id=r.annotation_id,
                    annotation_type=r.annotation_type,
                    author=r.author,
                    body=r.body,
                    created_at=r.created_at,
                    updated_at=r.updated_at,
                    thread_id=r.thread_id or "",
                    in_reply_to=r.in_reply_to or "",
                    version=r.version or "",
                    file_path=r.file_path or "",
                    start_line=r.start_line or 0,
                    end_line=r.end_line or 0,
                ))
            
            return annotations

    async def list_by_code(
        self,
        version: str,
        file_path: str,
    ) -> list[AnnotationRead]:
        """获取指定文件的代码标注列表（code 类型，按行号排序）。

        Args:
            version: 版本 tag。
            file_path: 文件路径。

        Returns:
            标注列表。
        """
        async with self.session_factory() as session:
            stmt = (
                select(AnnotationORM)
                .where(AnnotationORM.annotation_type == "code")
                .where(AnnotationORM.version == version)
                .where(AnnotationORM.file_path == file_path)
                .order_by(AnnotationORM.start_line)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [AnnotationRead.model_validate(r) for r in rows]

    async def list_all(
        self,
        annotation_type: str = "all",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict], int]:
        """全量批注分页列表，按 created_at 倒序。

        Args:
            annotation_type: 批注类型过滤：'email' | 'code' | 'all'
            page: 页码（从 1 开始）。
            page_size: 每页数量。

        Returns:
            (批注列表, 总数) 元组。
        """
        async with self.session_factory() as session:
            # 构建查询条件
            base_filter = []
            if annotation_type == "email":
                base_filter.append(AnnotationORM.annotation_type == "email")
            elif annotation_type == "code":
                base_filter.append(AnnotationORM.annotation_type == "code")

            # 计算总数
            count_stmt = select(func.count()).select_from(AnnotationORM)
            if base_filter:
                count_stmt = count_stmt.where(and_(*base_filter))
            total = (await session.execute(count_stmt)).scalar() or 0

            if total == 0:
                return [], 0

            # 分页查询
            offset = (page - 1) * page_size

            if annotation_type == "email":
                # email 类型：LEFT JOIN emails 获取 subject/sender
                stmt = (
                    select(AnnotationORM, EmailORM.subject, EmailORM.sender)
                    .outerjoin(EmailORM, AnnotationORM.in_reply_to == EmailORM.message_id)
                    .where(and_(*base_filter))
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
                        "annotation_type": ann.annotation_type,
                        "thread_id": ann.thread_id,
                        "in_reply_to": ann.in_reply_to,
                        "author": ann.author,
                        "body": ann.body,
                        "created_at": ann.created_at.isoformat(),
                        "updated_at": ann.updated_at.isoformat(),
                        "email_subject": email_subject or "",
                        "email_sender": email_sender or "",
                    })
            else:
                # code 类型或其他：直接查询
                stmt = (
                    select(AnnotationORM)
                    .where(and_(*base_filter)) if base_filter else select(AnnotationORM)
                    .order_by(AnnotationORM.created_at.desc())
                    .offset(offset)
                    .limit(page_size)
                )
                result = await session.execute(stmt)
                rows = result.scalars().all()

                items = []
                for ann in rows:
                    items.append({
                        "annotation_id": ann.annotation_id,
                        "annotation_type": ann.annotation_type,
                        "thread_id": ann.thread_id or "",
                        "in_reply_to": ann.in_reply_to or "",
                        "author": ann.author,
                        "body": ann.body,
                        "created_at": ann.created_at.isoformat(),
                        "updated_at": ann.updated_at.isoformat(),
                        "version": ann.version or "",
                        "file_path": ann.file_path or "",
                        "start_line": ann.start_line or 0,
                        "end_line": ann.end_line or 0,
                    })

            return items, total

    async def search(
        self,
        keyword: str,
        annotation_type: str = "all",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict], int]:
        """按批注 body 内容模糊搜索。

        Args:
            keyword: 搜索关键词。
            annotation_type: 批注类型过滤：'email' | 'code' | 'all'
            page: 页码（从 1 开始）。
            page_size: 每页数量。

        Returns:
            (匹配批注列表, 总数) 元组。
        """
        pattern = f"%{keyword}%"
        async with self.session_factory() as session:
            # 构建查询条件
            base_filter = [AnnotationORM.body.ilike(pattern)]
            if annotation_type == "email":
                base_filter.append(AnnotationORM.annotation_type == "email")
            elif annotation_type == "code":
                base_filter.append(AnnotationORM.annotation_type == "code")

            # 计算总数
            count_stmt = select(func.count()).select_from(AnnotationORM)
            count_stmt = count_stmt.where(and_(*base_filter))
            total = (await session.execute(count_stmt)).scalar() or 0

            if total == 0:
                return [], 0

            # 分页查询
            offset = (page - 1) * page_size

            if annotation_type == "email":
                stmt = (
                    select(AnnotationORM, EmailORM.subject, EmailORM.sender)
                    .outerjoin(EmailORM, AnnotationORM.in_reply_to == EmailORM.message_id)
                    .where(and_(*base_filter))
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
                        "annotation_type": ann.annotation_type,
                        "thread_id": ann.thread_id,
                        "in_reply_to": ann.in_reply_to,
                        "author": ann.author,
                        "body": ann.body,
                        "created_at": ann.created_at.isoformat(),
                        "updated_at": ann.updated_at.isoformat(),
                        "email_subject": email_subject or "",
                        "email_sender": email_sender or "",
                    })
            else:
                stmt = (
                    select(AnnotationORM)
                    .where(and_(*base_filter))
                    .order_by(AnnotationORM.created_at.desc())
                    .offset(offset)
                    .limit(page_size)
                )
                result = await session.execute(stmt)
                rows = result.scalars().all()

                items = []
                for ann in rows:
                    items.append({
                        "annotation_id": ann.annotation_id,
                        "annotation_type": ann.annotation_type,
                        "thread_id": ann.thread_id or "",
                        "in_reply_to": ann.in_reply_to or "",
                        "author": ann.author,
                        "body": ann.body,
                        "created_at": ann.created_at.isoformat(),
                        "updated_at": ann.updated_at.isoformat(),
                        "version": ann.version or "",
                        "file_path": ann.file_path or "",
                        "start_line": ann.start_line or 0,
                        "end_line": ann.end_line or 0,
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

    async def get(self, annotation_id: str) -> Optional[AnnotationRead]:
        """获取单个批注。

        Args:
            annotation_id: 批注 ID。

        Returns:
            批注读取模型，或 None（不存在）。
        """
        async with self.session_factory() as session:
            stmt = select(AnnotationORM).where(AnnotationORM.annotation_id == annotation_id)
            result = await session.execute(stmt)
            orm = result.scalar_one_or_none()
            if orm:
                return AnnotationRead.model_validate(orm)
            return None

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
                    "annotation_type": a.annotation_type,
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
                    annotation_type=item.get("annotation_type", "email"),
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
        """从 JSON 导入所有批注。

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

    async def export_all(self, annotation_type: str = "all") -> dict:
        """导出所有批注为 JSON 格式（按线程分组）。

        Args:
            annotation_type: 批注类型过滤：'email' | 'code' | 'all'

        Returns:
            包含所有批注的字典。
        """
        async with self.session_factory() as session:
            # 构建查询条件
            filter_cond = []
            if annotation_type == "email":
                filter_cond.append(AnnotationORM.annotation_type == "email")
            elif annotation_type == "code":
                filter_cond.append(AnnotationORM.annotation_type == "code")

            stmt = select(AnnotationORM).order_by(AnnotationORM.thread_id, AnnotationORM.created_at)
            if filter_cond:
                stmt = stmt.where(and_(*filter_cond))
            result = await session.execute(stmt)
            rows = result.scalars().all()

        # 按类型分组导出
        email_threads: dict[str, list] = {}
        code_annotations: list = []

        for orm in rows:
            if orm.annotation_type == "code":
                code_annotations.append({
                    "annotation_id": orm.annotation_id,
                    "version": orm.version,
                    "file_path": orm.file_path,
                    "start_line": orm.start_line,
                    "end_line": orm.end_line,
                    "author": orm.author,
                    "body": orm.body,
                    "created_at": orm.created_at.isoformat(),
                    "updated_at": orm.updated_at.isoformat(),
                })
            else:
                tid = orm.thread_id
                if tid not in email_threads:
                    email_threads[tid] = []
                email_threads[tid].append({
                    "annotation_id": orm.annotation_id,
                    "annotation_type": orm.annotation_type,
                    "in_reply_to": orm.in_reply_to,
                    "author": orm.author,
                    "body": orm.body,
                    "created_at": orm.created_at.isoformat(),
                    "updated_at": orm.updated_at.isoformat(),
                })

        return {
            "exported_at": datetime.utcnow().isoformat(),
            "total_annotations": len(rows),
            "email_threads": email_threads if annotation_type != "code" else {},
            "code_annotations": code_annotations if annotation_type != "email" else [],
        }


# 向后兼容别名
AnnotationStore = UnifiedAnnotationStore