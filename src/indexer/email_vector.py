"""邮件 chunk 向量索引构建器。"""

import logging
from datetime import datetime
from typing import Optional

from src.qa.providers import DashScopeEmbeddingProvider
from src.storage.postgres import PostgresStorage

logger = logging.getLogger(__name__)


class EmailVectorIndexer:
    """为 email_chunks 构建 pgvector embedding。"""

    def __init__(
        self,
        storage: PostgresStorage,
        provider: DashScopeEmbeddingProvider,
        provider_name: str = "dashscope",
        batch_size: int = 16,
    ):
        self.storage = storage
        self.provider = provider
        self.provider_name = provider_name
        self.batch_size = batch_size

    async def build(
        self,
        list_name: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> int:
        """构建缺失或过期的 chunk embedding。"""
        total = 0
        while True:
            remaining = None if limit is None else max(0, limit - total)
            if remaining == 0:
                break
            batch_limit = min(self.batch_size, remaining) if remaining else self.batch_size
            chunks = await self.storage.get_chunks_needing_embeddings(
                provider=self.provider_name,
                model=self.provider.model,
                limit=batch_limit,
                list_name=list_name,
            )
            if not chunks:
                break

            vectors = await self.provider.embed_texts([chunk.content for chunk in chunks])
            rows = [
                {
                    "chunk_id": chunk.chunk_id,
                    "provider": self.provider_name,
                    "model": self.provider.model,
                    "dimension": self.provider.dimension,
                    "embedding": vector,
                    "content_hash": chunk.content_hash,
                    "created_at": datetime.utcnow(),
                }
                for chunk, vector in zip(chunks, vectors)
            ]
            total += await self.storage.upsert_chunk_embeddings(rows)
            logger.info("Built email vector embeddings: %d", total)

        return total
