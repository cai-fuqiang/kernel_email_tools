"""文档分片存储实现 — PostgreSQL。"""

import json
import logging
from datetime import datetime
from typing import List, Optional

from sqlalchemy import select, text, delete, func
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from src.chunker.base import ContentType, DocumentChunk
from src.storage.base import BaseStorage
from src.storage.document_models import DocumentBase, DocumentChunkModel

logger = logging.getLogger(__name__)


class DocumentStorage(BaseStorage):
    """PostgreSQL 文档分片存储实现。"""

    def __init__(self, database_url: str, pool_size: int = 5):
        """初始化 PostgreSQL 存储。

        Args:
            database_url: 数据库连接 URL
            pool_size: 连接池大小
        """
        self.engine: AsyncEngine = create_async_engine(
            database_url,
            pool_size=pool_size,
            pool_pre_ping=True,
            echo=False,
        )
        self.async_session = sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )

    async def init_db(self) -> None:
        """初始化数据库（创建表、索引等）。"""
        async with self.engine.begin() as conn:
            await conn.run_sync(DocumentBase.metadata.create_all)
        logger.info("Document storage tables created successfully")

    def _chunk_to_model(self, chunk: DocumentChunk) -> DocumentChunkModel:
        """将 DocumentChunk 转换为数据库模型。"""
        return DocumentChunkModel(
            chunk_id=chunk.chunk_id,
            manual_type=chunk.manual_type,
            manual_version=chunk.manual_version,
            volume=chunk.volume,
            chapter=chunk.chapter,
            section=chunk.section,
            section_title=chunk.section_title,
            content_type=chunk.content_type.value,
            content=chunk.content,
            context_prefix=chunk.context_prefix,
            content_zh=chunk.content_zh or None,
            page_start=chunk.page_start,
            page_end=chunk.page_end,
            token_count=chunk.token_count,
            extra_data=chunk.metadata,
            translated_at=chunk.translated_at,
        )

    def _model_to_chunk(self, model: DocumentChunkModel) -> DocumentChunk:
        """将数据库模型转换为 DocumentChunk。"""
        return DocumentChunk(
            chunk_id=model.chunk_id,
            manual_type=model.manual_type,
            manual_version=model.manual_version,
            volume=model.volume,
            chapter=model.chapter,
            section=model.section,
            section_title=model.section_title,
            content_type=ContentType(model.content_type),
            content=model.content,
            context_prefix=model.context_prefix,
            content_zh=model.content_zh or "",
            page_start=model.page_start,
            page_end=model.page_end,
            token_count=model.token_count,
            metadata=model.extra_data or {},
            translated_at=model.translated_at,
        )

    async def insert_chunk(self, chunk: DocumentChunk) -> None:
        """插入单个分片。"""
        async with self.async_session() as session:
            model = self._chunk_to_model(chunk)
            session.add(model)
            await session.commit()
            logger.debug(f"Inserted chunk: {chunk.chunk_id}")

    async def insert_chunks(self, chunks: List[DocumentChunk]) -> None:
        """批量插入分片。"""
        if not chunks:
            return

        async with self.async_session() as session:
            models = [self._chunk_to_model(chunk) for chunk in chunks]
            session.add_all(models)
            await session.commit()
            logger.info(f"Inserted {len(chunks)} chunks")

            # 更新全文搜索向量
            await self._update_search_vectors(session, [chunk.chunk_id for chunk in chunks])

    async def _update_search_vectors(self, session: AsyncSession, chunk_ids: List[str]) -> None:
        """更新指定分片的全文搜索向量。"""
        if not chunk_ids:
            return

        update_query = text(
            "UPDATE document_chunks "
            "SET search_vector = to_tsvector('english', "
            "    coalesce(section_title, '') || ' ' || "
            "    coalesce(content, '') || ' ' || "
            "    coalesce(context_prefix, '')) "
            "WHERE chunk_id = ANY(:chunk_ids)"
        )

        await session.execute(update_query, {"chunk_ids": chunk_ids})
        await session.commit()
        logger.debug(f"Updated search vectors for {len(chunk_ids)} chunks")

    async def get_chunk(self, chunk_id: str) -> Optional[DocumentChunk]:
        """根据 ID 获取分片。"""
        async with self.async_session() as session:
            result = await session.execute(
                select(DocumentChunkModel).where(DocumentChunkModel.chunk_id == chunk_id)
            )
            model = result.scalar_one_or_none()
            return self._model_to_chunk(model) if model else None

    async def get_chunks_by_section(self, section: str) -> List[DocumentChunk]:
        """根据章节获取分片。"""
        async with self.async_session() as session:
            result = await session.execute(
                select(DocumentChunkModel)
                .where(DocumentChunkModel.section == section)
                .order_by(DocumentChunkModel.page_start)
            )
            models = result.scalars().all()
            return [self._model_to_chunk(model) for model in models]

    async def get_chunks_by_manual(
        self, manual_type: str, manual_version: str = ""
    ) -> List[DocumentChunk]:
        """根据手册类型和版本获取分片。"""
        async with self.async_session() as session:
            query = select(DocumentChunkModel).where(
                DocumentChunkModel.manual_type == manual_type
            )

            if manual_version:
                query = query.where(DocumentChunkModel.manual_version == manual_version)

            query = query.order_by(
                DocumentChunkModel.volume, DocumentChunkModel.chapter, DocumentChunkModel.section
            )

            result = await session.execute(query)
            models = result.scalars().all()
            return [self._model_to_chunk(model) for model in models]

    async def search_chunks(
        self,
        query: str,
        manual_type: Optional[str] = None,
        content_type: Optional[str] = None,
        limit: int = 10,
    ) -> List[DocumentChunk]:
        """全文搜索分片（使用 PostgreSQL 全文搜索）。

        Args:
            query: 搜索关键词
            manual_type: 可选的手册类型过滤
            content_type: 可选的内容类型过滤
            limit: 返回结果数量

        Returns:
            匹配的分片列表
        """
        async with self.async_session() as session:
            stmt = select(DocumentChunkModel).where(
                text("search_vector @@ plainto_tsquery('english', :query)")
            )

            if manual_type:
                stmt = stmt.where(DocumentChunkModel.manual_type == manual_type)
            if content_type:
                stmt = stmt.where(DocumentChunkModel.content_type == content_type)

            stmt = stmt.order_by(
                text("ts_rank(search_vector, plainto_tsquery('english', :query)) DESC")
            ).limit(limit)

            result = await session.execute(stmt, {"query": query})
            models = result.scalars().all()
            return [self._model_to_chunk(model) for model in models]

    async def update_translation(self, chunk_id: str, content_zh: str) -> None:
        """更新分片的中文翻译。"""
        async with self.async_session() as session:
            result = await session.execute(
                select(DocumentChunkModel).where(DocumentChunkModel.chunk_id == chunk_id)
            )
            model = result.scalar_one_or_none()

            if model:
                model.content_zh = content_zh
                model.translated_at = datetime.now()
                await session.commit()
                logger.debug(f"Updated translation for chunk: {chunk_id}")

    async def delete_chunks_by_manual(self, manual_type: str, manual_version: str) -> int:
        """删除指定手册的分片，返回删除数量。"""
        async with self.async_session() as session:
            query = delete(DocumentChunkModel).where(
                DocumentChunkModel.manual_type == manual_type
            )

            if manual_version:
                query = query.where(DocumentChunkModel.manual_version == manual_version)

            result = await session.execute(query)
            await session.commit()

            deleted_count = result.rowcount
            logger.info(f"Deleted {deleted_count} chunks for manual: {manual_type}:{manual_version}")
            return deleted_count

    async def count_chunks(self) -> int:
        """统计总分片数量。"""
        async with self.async_session() as session:
            result = await session.execute(
                select(func.count()).select_from(DocumentChunkModel)
            )
            return result.scalar()

    async def get_stats(self) -> dict:
        """获取统计信息。"""
        async with self.async_session() as session:
            # 总数
            total_result = await session.execute(
                select(func.count()).select_from(DocumentChunkModel)
            )
            total = total_result.scalar()

            # 按手册类型统计
            type_result = await session.execute(
                select(
                    DocumentChunkModel.manual_type,
                    func.count().label("count")
                ).group_by(DocumentChunkModel.manual_type)
            )
            by_type = {row.manual_type: row.count for row in type_result}

            # 按内容类型统计
            content_result = await session.execute(
                select(
                    DocumentChunkModel.content_type,
                    func.count().label("count")
                ).group_by(DocumentChunkModel.content_type)
            )
            by_content_type = {row.content_type: row.count for row in content_result}

            return {
                "total": total,
                "by_manual_type": by_type,
                "by_content_type": by_content_type,
            }

    async def close(self) -> None:
        """关闭数据库连接。"""
        await self.engine.dispose()
        logger.info("Document storage connection closed")