"""pgvector 向量索引构建器。

使用 pgvector 扩展存储邮件的文本嵌入向量，支持语义相似度搜索。
MVP 阶段通过 settings.yaml 的 indexer.vector.enabled 控制是否启用。
"""

import logging
from typing import Optional

from sqlalchemy import Column, ForeignKey, Integer, String, Text, text
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from src.indexer.base import BaseIndexer
from src.storage.models import EmailCreate, EmailORM

logger = logging.getLogger(__name__)

# pgvector 需要单独的模型定义，因为依赖 pgvector 扩展
try:
    from pgvector.sqlalchemy import Vector

    PGVECTOR_AVAILABLE = True
except ImportError:
    PGVECTOR_AVAILABLE = False
    logger.warning("pgvector not installed, vector indexer will be disabled")


class VectorBase(DeclarativeBase):
    """向量表的声明式基类。"""
    pass


if PGVECTOR_AVAILABLE:
    class EmailEmbeddingORM(VectorBase):
        """邮件嵌入向量 ORM 模型，对应 email_embeddings 表。"""

        __tablename__ = "email_embeddings"

        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        message_id: Mapped[str] = mapped_column(
            String(512), nullable=False, unique=True, index=True
        )
        content_hash: Mapped[str] = mapped_column(
            String(64), nullable=False, default=""
        )
        embedding = Column(Vector(1536))  # 默认维度，可配置

        def __repr__(self) -> str:
            return f"<EmailEmbeddingORM message_id={self.message_id!r}>"


class VectorIndexer(BaseIndexer):
    """pgvector 向量索引构建器。

    Attributes:
        session_factory: SQLAlchemy 异步 session 工厂。
        model: embedding 模型名称。
        dimension: 向量维度。
        embed_fn: 文本转向量的回调函数。
    """

    def __init__(
        self,
        database_url: str,
        model: str = "text-embedding-3-small",
        dimension: int = 1536,
        pool_size: int = 5,
    ):
        """初始化 VectorIndexer。

        Args:
            database_url: PostgreSQL 连接字符串。
            model: embedding 模型名称。
            dimension: 向量维度。
            pool_size: 连接池大小。
        """
        self.engine = create_async_engine(database_url, pool_size=pool_size, echo=False)
        self.session_factory = async_sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )
        self.model = model
        self.dimension = dimension
        self._embed_fn = None

    async def init_vector_extension(self) -> None:
        """初始化 pgvector 扩展和向量表。"""
        if not PGVECTOR_AVAILABLE:
            logger.warning("pgvector not available, skipping vector extension init")
            return

        async with self.engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await conn.run_sync(VectorBase.metadata.create_all)

            # 创建 IVFFlat 索引（数据量大时性能更优）
            await conn.execute(text("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_indexes
                        WHERE indexname = 'ix_email_embeddings_vector'
                    ) THEN
                        CREATE INDEX ix_email_embeddings_vector
                        ON email_embeddings USING ivfflat (embedding vector_cosine_ops)
                        WITH (lists = 100);
                    END IF;
                END
                $$;
            """))

        logger.info("Vector extension and tables initialized")

    async def build(
        self,
        list_name: Optional[str] = None,
        rebuild: bool = False,
    ) -> int:
        """构建向量索引。

        遍历 emails 表中尚未生成嵌入的邮件，调用 embedding API 生成向量。

        Args:
            list_name: 限定邮件列表。
            rebuild: 是否重建全部。

        Returns:
            新建向量的邮件数量。
        """
        if not PGVECTOR_AVAILABLE:
            logger.warning("pgvector not available, cannot build vector index")
            return 0

        # TODO: Phase 2 MVP 先不启用向量索引
        logger.info("Vector index build: not yet implemented in MVP")
        return 0

    async def update(self, emails: list[EmailCreate]) -> int:
        """增量更新向量索引。"""
        if not PGVECTOR_AVAILABLE:
            return 0

        # TODO: 增量向量化
        logger.debug("Vector index update: %d emails (not yet implemented)", len(emails))
        return 0

    async def get_stats(self) -> dict:
        """获取向量索引统计信息。"""
        if not PGVECTOR_AVAILABLE:
            return {"type": "vector", "status": "disabled", "reason": "pgvector not installed"}

        async with self.session_factory() as session:
            try:
                total = (await session.execute(
                    text("SELECT COUNT(*) FROM email_embeddings")
                )).scalar() or 0
            except Exception:
                logger.warning("Failed to query email_embeddings count")
                total = 0

        return {
            "type": "vector",
            "engine": "pgvector",
            "model": self.model,
            "dimension": self.dimension,
            "indexed_emails": total,
        }
