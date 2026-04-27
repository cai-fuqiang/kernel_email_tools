"""PostgreSQL GIN 全文索引构建器。

全文索引通过 emails 表的 search_vector (TSVECTOR) 列 + GIN 索引实现，
search_vector 由 PostgreSQL 触发器在 INSERT/UPDATE 时自动维护。
本模块负责：
1. 确保 GIN 索引存在
2. 对已有数据回填 search_vector
3. 提供索引统计信息
"""

import logging
from typing import Optional

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.indexer.base import BaseIndexer
from src.storage.models import EmailCreate, EmailORM

logger = logging.getLogger(__name__)


class FulltextIndexer(BaseIndexer):
    """PostgreSQL GIN 全文索引构建器。

    Attributes:
        session_factory: SQLAlchemy 异步 session 工厂。
    """

    def __init__(self, database_url: str, pool_size: int = 5):
        """初始化 FulltextIndexer。

        Args:
            database_url: PostgreSQL 连接字符串。
            pool_size: 连接池大小。
        """
        self.engine = create_async_engine(database_url, pool_size=pool_size, echo=False)
        self.session_factory = async_sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )

    async def build(
        self,
        list_name: Optional[str] = None,
        rebuild: bool = False,
    ) -> int:
        """构建全文索引。

        实际上 GIN 索引已在 init_db 时创建，此方法负责回填 search_vector。

        Args:
            list_name: 限定邮件列表。
            rebuild: 是否强制重建所有 search_vector。

        Returns:
            更新的邮件数量。
        """
        async with self.session_factory() as session:
            # asyncpg 需要明确参数类型，分两种情况构造 SQL 避免类型歧义
            if list_name:
                sql = text("""
                    UPDATE emails SET search_vector =
                        setweight(to_tsvector('english', COALESCE(subject, '')), 'A') ||
                        setweight(to_tsvector('english', COALESCE(sender, '')), 'B') ||
                        setweight(to_tsvector('english', COALESCE(body, '')), 'C')
                    WHERE (:rebuild OR search_vector IS NULL)
                      AND list_name = :list_name
                """)
                result = await session.execute(
                    sql, {"rebuild": rebuild, "list_name": list_name}
                )
            else:
                sql = text("""
                    UPDATE emails SET search_vector =
                        setweight(to_tsvector('english', COALESCE(subject, '')), 'A') ||
                        setweight(to_tsvector('english', COALESCE(sender, '')), 'B') ||
                        setweight(to_tsvector('english', COALESCE(body, '')), 'C')
                    WHERE (:rebuild OR search_vector IS NULL)
                """)
                result = await session.execute(sql, {"rebuild": rebuild})
            count = result.rowcount
            await session.commit()

        logger.info(
            "Fulltext index built: %d emails updated (list=%s, rebuild=%s)",
            count, list_name or "all", rebuild,
        )
        return count

    async def drop_index(self) -> None:
        """临时删除全文 GIN 索引，用于大批量导入加速。"""
        async with self.engine.begin() as conn:
            await conn.execute(text("DROP INDEX IF EXISTS ix_emails_search_vector"))
        logger.info("Dropped fulltext GIN index ix_emails_search_vector")

    async def create_index(self) -> None:
        """创建全文 GIN 索引。"""
        async with self.engine.begin() as conn:
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_emails_search_vector "
                "ON emails USING GIN (search_vector)"
            ))
        logger.info("Created fulltext GIN index ix_emails_search_vector")

    async def update(self, emails: list[EmailCreate]) -> int:
        """增量更新全文索引（触发器已自动处理，此处为空操作）。

        search_vector 由 INSERT 触发器自动维护，
        所以只要数据正确写入 emails 表，索引就会自动更新。
        """
        logger.debug(
            "Fulltext index auto-updated via trigger for %d emails", len(emails)
        )
        return len(emails)

    async def get_stats(self) -> dict:
        """获取全文索引统计信息。"""
        async with self.session_factory() as session:
            total = (await session.execute(
                select(func.count()).select_from(EmailORM)
            )).scalar() or 0

            indexed = (await session.execute(
                select(func.count()).select_from(EmailORM).where(
                    EmailORM.search_vector.isnot(None)
                )
            )).scalar() or 0

        return {
            "type": "fulltext",
            "engine": "postgresql_gin",
            "total_emails": total,
            "indexed_emails": indexed,
            "coverage": f"{indexed / total * 100:.1f}%" if total > 0 else "0%",
        }
