"""语义检索器 — 基于 email chunk pgvector 相似度的 top-K 检索。"""

import logging
from datetime import datetime
from typing import Optional, Protocol

from src.retriever.base import BaseRetriever, SearchHit, SearchQuery, SearchResult
from src.storage.models import EmailChunkSearchResult

logger = logging.getLogger(__name__)


class EmbeddingProvider(Protocol):
    model: str

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        ...


class ChunkVectorStorage(Protocol):
    async def search_email_chunks_vector(
        self,
        embedding: list[float],
        provider: str,
        model: str,
        list_name: Optional[str] = None,
        sender: Optional[str] = None,
        date_from=None,
        date_to=None,
        tags: Optional[list[str]] = None,
        tag_mode: str = "any",
        has_patch: Optional[bool] = None,
        limit: int = 30,
    ) -> list[EmailChunkSearchResult]:
        ...


class SemanticRetriever(BaseRetriever):
    """语义向量检索器。

    使用 pgvector 计算查询文本与邮件 chunk embedding 的余弦相似度，
    再聚合为邮件级搜索结果。
    """

    def __init__(
        self,
        database_url: str = "",
        model: str = "text-embedding-3-small",
        enabled: bool = False,
        storage: Optional[ChunkVectorStorage] = None,
        embedding_provider: Optional[EmbeddingProvider] = None,
        embedding_provider_name: str = "dashscope",
    ):
        self.database_url = database_url
        self.model = model
        self.enabled = enabled
        self.storage = storage
        self.embedding_provider = embedding_provider
        self.embedding_provider_name = embedding_provider_name

    async def _get_embedding(self, text: str) -> Optional[list[float]]:
        """将文本转换为嵌入向量。"""
        if not self.embedding_provider:
            logger.warning("Semantic retriever enabled but embedding provider is missing")
            return None

        try:
            vectors = await self.embedding_provider.embed_texts([text])
        except Exception as exc:
            logger.warning("Semantic embedding generation failed: %s", exc)
            return None
        return vectors[0] if vectors else None

    def _to_search_hit(self, chunk: EmailChunkSearchResult) -> SearchHit:
        date_value = chunk.date
        date = date_value.isoformat() if isinstance(date_value, datetime) else str(date_value or "")

        return SearchHit(
            message_id=chunk.message_id,
            subject=chunk.subject,
            sender=chunk.sender,
            date=date,
            list_name=chunk.list_name,
            thread_id=chunk.thread_id,
            has_patch=chunk.has_patch,
            tags=[],
            score=chunk.score,
            snippet=chunk.snippet or chunk.content[:300],
            source="semantic",
        )

    async def search(self, query: SearchQuery) -> SearchResult:
        """执行语义向量检索。"""
        if not self.enabled:
            logger.debug("Semantic retriever disabled, returning empty result")
            return SearchResult(hits=[], total=0, query=query.text, mode="semantic")

        if not query.text.strip():
            logger.debug("Semantic search requires non-empty query text")
            return SearchResult(hits=[], total=0, query=query.text, mode="semantic")

        if not self.storage:
            logger.warning("Semantic retriever enabled but storage is missing")
            return SearchResult(hits=[], total=0, query=query.text, mode="semantic")

        embedding = await self._get_embedding(query.text.strip())
        if not embedding:
            return SearchResult(hits=[], total=0, query=query.text, mode="semantic")

        retrieval_limit = max(query.top_k, query.page * query.page_size * 3)
        chunks = await self.storage.search_email_chunks_vector(
            embedding=embedding,
            provider=self.embedding_provider_name,
            model=self.embedding_provider.model if self.embedding_provider else self.model,
            list_name=query.list_name,
            sender=query.sender,
            date_from=query.date_from,
            date_to=query.date_to,
            tags=query.tags,
            tag_mode=query.tag_mode,
            has_patch=query.has_patch,
            limit=retrieval_limit,
        )

        by_message_id: dict[str, EmailChunkSearchResult] = {}
        for chunk in chunks:
            existing = by_message_id.get(chunk.message_id)
            if not existing or chunk.score > existing.score:
                by_message_id[chunk.message_id] = chunk

        sorted_chunks = sorted(by_message_id.values(), key=lambda item: item.score, reverse=True)
        start = (query.page - 1) * query.page_size
        end = start + query.page_size
        hits = [self._to_search_hit(chunk) for chunk in sorted_chunks[start:end]]

        logger.info(
            "Semantic search '%s': chunks=%d deduped=%d page_hits=%d",
            query.text,
            len(chunks),
            len(sorted_chunks),
            len(hits),
        )
        return SearchResult(
            hits=hits,
            total=len(sorted_chunks),
            query=query.text,
            mode="semantic",
        )
