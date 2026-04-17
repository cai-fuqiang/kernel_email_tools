"""手册检索器 — 基于 PostgreSQL GIN 全文索引的文档检索。"""

import logging
from dataclasses import dataclass, field
from typing import Optional

from src.retriever.base import BaseRetriever
from src.storage.document_store import DocumentStorage

logger = logging.getLogger(__name__)


@dataclass
class ManualSearchQuery:
    """手册检索查询参数。"""

    text: str
    manual_type: Optional[str] = None  # 手册类型，如 "intel_sdm"
    manual_version: Optional[str] = None  # 手册版本
    content_type: Optional[str] = None  # 内容类型过滤
    page: int = 1
    page_size: int = 20


@dataclass
class ManualSearchHit:
    """单条手册检索结果。"""

    chunk_id: str
    manual_type: str = ""
    manual_version: str = ""
    volume: str = ""
    chapter: str = ""
    section: str = ""
    section_title: str = ""
    content_type: str = ""
    content: str = ""
    page_start: int = 0
    page_end: int = 0
    score: float = 0.0
    snippet: str = ""


@dataclass
class ManualSearchResult:
    """手册检索结果集。"""

    hits: list[ManualSearchHit] = field(default_factory=list)
    total: int = 0
    query: str = ""
    mode: str = ""


class ManualRetriever(BaseRetriever):
    """手册文档检索器。

    使用 PostgreSQL GIN 全文索引，支持按手册类型、内容类型过滤。

    Attributes:
        storage: DocumentStorage 实例。
    """

    def __init__(self, storage: DocumentStorage):
        """初始化 ManualRetriever。

        Args:
            storage: DocumentStorage 实例，提供全文搜索能力。
        """
        self.storage = storage

    async def search(self, query: ManualSearchQuery) -> ManualSearchResult:
        """执行手册文档检索。

        Args:
            query: 检索查询参数。

        Returns:
            检索结果集。
        """
        # 执行搜索
        chunks = await self.storage.search_chunks(
            query=query.text,
            manual_type=query.manual_type,
            content_type=query.content_type,
            limit=query.page_size,
        )

        hits = [
            ManualSearchHit(
                chunk_id=chunk.chunk_id,
                manual_type=chunk.manual_type,
                manual_version=chunk.manual_version,
                volume=chunk.volume,
                chapter=chunk.chapter,
                section=chunk.section,
                section_title=chunk.section_title,
                content_type=chunk.content_type.value,
                content=chunk.content,
                page_start=chunk.page_start,
                page_end=chunk.page_end,
                score=1.0,  # 暂时使用固定分数，后续可加 ts_rank
                snippet=self._make_snippet(chunk.content, query.text),
            )
            for chunk in chunks
        ]

        # 获取总数
        total = await self.storage.count_chunks()

        logger.info(
            "Manual search '%s' (type=%s): %d hits",
            query.text,
            query.manual_type or "all",
            len(hits),
        )

        return ManualSearchResult(
            hits=hits,
            total=total,
            query=query.text,
            mode="manual_keyword",
        )

    def _make_snippet(self, content: str, query: str, max_len: int = 300) -> str:
        """生成搜索片段。"""
        if not content:
            return ""
        # 简单策略：取内容前 max_len 字符
        if len(content) <= max_len:
            return content
        return content[:max_len] + "..."