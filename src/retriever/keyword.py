"""关键词检索器 — 基于 PostgreSQL GIN 全文索引的精确检索。"""

import logging

from src.retriever.base import BaseRetriever, SearchHit, SearchQuery, SearchResult
from src.storage.postgres import PostgresStorage

logger = logging.getLogger(__name__)


class KeywordRetriever(BaseRetriever):
    """关键词精确检索器。

    使用 PostgreSQL GIN 全文索引，支持分页返回全量匹配结果。

    Attributes:
        storage: PostgresStorage 实例。
    """

    def __init__(self, storage: PostgresStorage):
        """初始化 KeywordRetriever。

        Args:
            storage: PostgresStorage 实例，提供全文搜索能力。
        """
        self.storage = storage

    async def search(self, query: SearchQuery) -> SearchResult:
        """执行关键词精确检索。

        利用 PostgreSQL plainto_tsquery + GIN 索引，
        返回所有匹配结果（支持分页）。

        Args:
            query: 检索查询参数。

        Returns:
            检索结果集，mode='keyword'。
        """
        results, total = await self.storage.search_fulltext(
            query=query.text,
            list_name=query.list_name,
            page=query.page,
            page_size=query.page_size,
        )

        hits = [
            SearchHit(
                message_id=r.message_id,
                subject=r.subject,
                sender=r.sender,
                date=r.date.isoformat() if r.date else "",
                list_name=r.list_name,
                thread_id=r.thread_id,
                has_patch=r.has_patch,
                score=r.rank,
                snippet=r.snippet,
                source="keyword",
            )
            for r in results
        ]

        logger.info(
            "Keyword search '%s': %d hits (total %d, page %d/%d)",
            query.text,
            len(hits),
            total,
            query.page,
            (total + query.page_size - 1) // query.page_size if total > 0 else 1,
        )

        return SearchResult(
            hits=hits,
            total=total,
            query=query.text,
            mode="keyword",
        )