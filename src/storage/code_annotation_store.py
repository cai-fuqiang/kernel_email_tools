"""代码注释存储层 — 提供 CRUD、分页、搜索能力。

遵循 session_factory 模式（请求级 session），避免长生命周期 session 过期问题。
"""

import hashlib
import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import func as sa_func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.storage.code_annotation_models import (
    CodeAnnotationORM,
    CodeAnnotationBase,
    CodeAnnotationCreate,
    CodeAnnotationUpdate,
)

logger = logging.getLogger(__name__)


def _compute_context_hash(version: str, file_path: str, start_line: int, content: str) -> str:
    """计算上下文哈希，用于检测版本漂移。

    以 "version:path:line:content_prefix" 的前 64 字符 SHA256 作为锚点哈希。
    """
    prefix = content[:200] if content else ""
    raw = f"{version}:{file_path}:{start_line}:{prefix}"
    return hashlib.sha256(raw.encode()).hexdigest()[:64]


class CodeAnnotationStore:
    """代码注释存储层。

    Args:
        session_factory: async_sessionmaker 实例，每次操作创建新 session。
        default_author: 默认作者名称。
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        default_author: str = "me",
    ):
        self._session_factory = session_factory
        self._default_author = default_author

    async def create(
        self,
        data: CodeAnnotationCreate,
        content_for_hash: str = "",
    ) -> CodeAnnotationORM:
        """创建代码注释。

        Args:
            data: 注释创建数据。
            content_for_hash: 用于计算锚点哈希的代码内容（可空）。

        Returns:
            创建的注释 ORM 对象。

        Raises:
            ValueError: 参数无效。
        """
        if data.start_line > data.end_line:
            raise ValueError("start_line must not exceed end_line")

        annotation_id = f"code-annot-{uuid.uuid4().hex[:12]}"
        anchor_context = _compute_context_hash(
            data.version, data.file_path, data.start_line, content_for_hash
        )
        author = data.author or self._default_author

        async with self._session_factory() as session:
            now = datetime.utcnow()
            annotation = CodeAnnotationORM(
                annotation_id=annotation_id,
                version=data.version,
                file_path=data.file_path,
                start_line=data.start_line,
                end_line=data.end_line,
                anchor_context=anchor_context,
                body=data.body,
                author=author,
                created_at=now,
                updated_at=now,
            )
            session.add(annotation)
            try:
                await session.commit()
                await session.refresh(annotation)
                logger.info(f"Created code annotation {annotation_id} at {data.version}:{data.file_path}:{data.start_line}")
                return annotation
            except Exception as e:
                await session.rollback()
                # 忽略重复注释（唯一约束冲突）
                if "duplicate key" in str(e).lower() or "unique" in str(e).lower():
                    logger.warning(f"Duplicate annotation ignored: {annotation_id}")
                    # 查询已存在的
                    result = await session.execute(
                        select(CodeAnnotationORM).where(
                            CodeAnnotationORM.annotation_id == annotation_id
                        )
                    )
                    existing = result.scalar_one_or_none()
                    if existing:
                        return existing
                raise

    async def update(
        self,
        annotation_id: str,
        data: CodeAnnotationUpdate,
    ) -> Optional[CodeAnnotationORM]:
        """更新注释正文。

        Args:
            annotation_id: 注释 ID。
            data: 更新数据。

        Returns:
            更新后的 ORM 对象，或 None（不存在）。
        """
        async with self._session_factory() as session:
            result = await session.execute(
                select(CodeAnnotationORM).where(
                    CodeAnnotationORM.annotation_id == annotation_id
                )
            )
            annotation = result.scalar_one_or_none()
            if not annotation:
                return None

            annotation.body = data.body
            annotation.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(annotation)
            return annotation

    async def delete(self, annotation_id: str) -> bool:
        """删除注释。

        Args:
            annotation_id: 注释 ID。

        Returns:
            是否成功删除。
        """
        async with self._session_factory() as session:
            result = await session.execute(
                delete(CodeAnnotationORM).where(
                    CodeAnnotationORM.annotation_id == annotation_id
                )
            )
            await session.commit()
            deleted = result.rowcount > 0
            if deleted:
                logger.info(f"Deleted code annotation {annotation_id}")
            return deleted

    async def get(self, annotation_id: str) -> Optional[CodeAnnotationORM]:
        """获取单个注释。"""
        async with self._session_factory() as session:
            result = await session.execute(
                select(CodeAnnotationORM).where(
                    CodeAnnotationORM.annotation_id == annotation_id
                )
            )
            return result.scalar_one_or_none()

    async def list_by_file(
        self,
        version: str,
        file_path: str,
    ) -> list[CodeAnnotationORM]:
        """获取指定文件的注释列表。

        Args:
            version: 版本 tag。
            file_path: 文件路径。

        Returns:
            按 start_line 升序排列的注释列表。
        """
        async with self._session_factory() as session:
            result = await session.execute(
                select(CodeAnnotationORM)
                .where(CodeAnnotationORM.version == version)
                .where(CodeAnnotationORM.file_path == file_path)
                .order_by(CodeAnnotationORM.start_line)
            )
            return list(result.scalars().all())

    async def list_all(
        self,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[CodeAnnotationORM], int]:
        """全量分页列表（按时间倒序）。

        Returns:
            (注释列表, 总数) 元组。
        """
        async with self._session_factory() as session:
            # 总数
            count_result = await session.execute(
                select(sa_func.count()).select_from(CodeAnnotationORM)
            )
            total = count_result.scalar() or 0

            # 分页
            offset = (page - 1) * page_size
            result = await session.execute(
                select(CodeAnnotationORM)
                .order_by(CodeAnnotationORM.created_at.desc())
                .offset(offset)
                .limit(page_size)
            )
            return list(result.scalars().all()), total

    async def search(
        self,
        keyword: str,
        version: Optional[str] = None,
        author: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[CodeAnnotationORM], int]:
        """关键词搜索注释正文。

        Args:
            keyword: 搜索关键词（ILIKE）。
            version: 可选，限定版本。
            author: 可选，限定作者。
            page: 页码（从 1 开始）。
            page_size: 每页数量。

        Returns:
            (注释列表, 总数) 元组。
        """
        async with self._session_factory() as session:
            query = select(CodeAnnotationORM).where(
                CodeAnnotationORM.body.ilike(f"%{keyword}%")
            )
            if version:
                query = query.where(CodeAnnotationORM.version == version)
            if author:
                query = query.where(CodeAnnotationORM.author == author)

            # 总数
            count_result = await session.execute(
                select(sa_func.count()).select_from(CodeAnnotationORM)
                .where(CodeAnnotationORM.body.ilike(f"%{keyword}%"))
            )
            total = count_result.scalar() or 0

            offset = (page - 1) * page_size
            result = await session.execute(
                query.order_by(CodeAnnotationORM.created_at.desc())
                .offset(offset)
                .limit(page_size)
            )
            return list(result.scalars().all()), total