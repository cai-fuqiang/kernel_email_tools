"""PostgreSQL 存储层实现 — 支持批量写入、去重、全文搜索。"""

import logging
from typing import Optional

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.storage.base import BaseStorage
from src.storage.models import (
    Base,
    EmailCreate,
    EmailORM,
    EmailRead,
    EmailSearchResult,
)

logger = logging.getLogger(__name__)


class PostgresStorage(BaseStorage):
    """PostgreSQL 存储后端。

    使用 SQLAlchemy async + asyncpg，支持：
    - 批量 upsert（基于 message_id 去重）
    - GIN 全文搜索
    - 线程查询

    Attributes:
        engine: SQLAlchemy 异步引擎。
        session_factory: 异步 session 工厂。
    """

    def __init__(self, database_url: str, pool_size: int = 5):
        """初始化 PostgresStorage。

        Args:
            database_url: PostgreSQL 连接字符串（asyncpg 格式）。
            pool_size: 连接池大小。
        """
        self.engine = create_async_engine(
            database_url,
            pool_size=pool_size,
            echo=False,
        )
        self.session_factory = async_sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )

    async def init_db(self) -> None:
        """创建表和索引，设置全文搜索触发器。"""
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

            # 创建全文搜索触发器：自动更新 search_vector 列
            await conn.execute(text("""
                CREATE OR REPLACE FUNCTION emails_search_vector_update() RETURNS trigger AS $$
                BEGIN
                    NEW.search_vector :=
                        setweight(to_tsvector('english', COALESCE(NEW.subject, '')), 'A') ||
                        setweight(to_tsvector('english', COALESCE(NEW.sender, '')), 'B') ||
                        setweight(to_tsvector('english', COALESCE(NEW.body, '')), 'C');
                    RETURN NEW;
                END
                $$ LANGUAGE plpgsql;
            """))

            await conn.execute(text("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_trigger WHERE tgname = 'emails_search_vector_trigger'
                    ) THEN
                        CREATE TRIGGER emails_search_vector_trigger
                        BEFORE INSERT OR UPDATE ON emails
                        FOR EACH ROW EXECUTE FUNCTION emails_search_vector_update();
                    END IF;
                END
                $$;
            """))

        logger.info("Database initialized: tables, indexes, and triggers created")

    async def save_emails(self, emails: list[EmailCreate]) -> int:
        """批量写入邮件，基于 message_id 去重（ON CONFLICT DO NOTHING）。

        Args:
            emails: 待保存的邮件列表。

        Returns:
            实际新增的邮件数量。
        """
        if not emails:
            return 0

        async with self.session_factory() as session:
            # 分批处理，每批 500 条
            batch_size = 500
            total_inserted = 0

            for i in range(0, len(emails), batch_size):
                batch = emails[i:i + batch_size]
                values = [e.model_dump() for e in batch]

                stmt = pg_insert(EmailORM).values(values)
                stmt = stmt.on_conflict_do_nothing(index_elements=["message_id"])
                result = await session.execute(stmt)
                total_inserted += result.rowcount

            await session.commit()

        logger.info("Saved %d new emails (total submitted: %d)", total_inserted, len(emails))
        return total_inserted

    async def get_email(self, message_id: str) -> Optional[EmailRead]:
        """根据 message_id 获取单封邮件。"""
        async with self.session_factory() as session:
            stmt = select(EmailORM).where(EmailORM.message_id == message_id)
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                return None
            return EmailRead.model_validate(row)

    async def get_thread(self, thread_id: str) -> list[EmailRead]:
        """获取线程内所有邮件，按时间排序。"""
        async with self.session_factory() as session:
            stmt = (
                select(EmailORM)
                .where(EmailORM.thread_id == thread_id)
                .order_by(EmailORM.date.asc())
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [EmailRead.model_validate(row) for row in rows]

    async def search_fulltext(
        self, query: str, list_name: Optional[str] = None,
        page: int = 1, page_size: int = 50,
    ) -> tuple[list[EmailSearchResult], int]:
        """使用 PostgreSQL 全文搜索。

        使用 plainto_tsquery 将用户输入转换为搜索表达式，
        ts_rank 计算相关性排名，ts_headline 生成匹配片段。

        Args:
            query: 搜索关键词。
            list_name: 限定邮件列表。
            page: 页码（从 1 开始）。
            page_size: 每页数量。

        Returns:
            (搜索结果列表, 总匹配数)。
        """
        async with self.session_factory() as session:
            tsquery = func.plainto_tsquery("english", query)

            # 基础过滤条件
            conditions = [EmailORM.search_vector.op("@@")(tsquery)]
            if list_name:
                conditions.append(EmailORM.list_name == list_name)

            # 计算总匹配数
            count_stmt = select(func.count()).select_from(EmailORM).where(*conditions)
            total = (await session.execute(count_stmt)).scalar() or 0

            if total == 0:
                return [], 0

            # 搜索结果（带排名和片段）
            rank = func.ts_rank(EmailORM.search_vector, tsquery).label("rank")
            snippet = func.ts_headline(
                "english",
                EmailORM.body,
                tsquery,
                text("'StartSel=<<, StopSel=>>, MaxWords=50, MinWords=20'"),
            ).label("snippet")

            search_stmt = (
                select(
                    EmailORM.id,
                    EmailORM.message_id,
                    EmailORM.subject,
                    EmailORM.sender,
                    EmailORM.date,
                    EmailORM.list_name,
                    EmailORM.thread_id,
                    EmailORM.has_patch,
                    rank,
                    snippet,
                )
                .where(*conditions)
                .order_by(rank.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
            result = await session.execute(search_stmt)
            rows = result.all()

            results = [
                EmailSearchResult(
                    id=row.id,
                    message_id=row.message_id,
                    subject=row.subject,
                    sender=row.sender,
                    date=row.date,
                    list_name=row.list_name,
                    thread_id=row.thread_id,
                    has_patch=row.has_patch,
                    rank=float(row.rank),
                    snippet=row.snippet or "",
                )
                for row in rows
            ]

        return results, total

    async def get_email_count(self, list_name: Optional[str] = None) -> int:
        """获取邮件总数。"""
        async with self.session_factory() as session:
            stmt = select(func.count()).select_from(EmailORM)
            if list_name:
                stmt = stmt.where(EmailORM.list_name == list_name)
            result = await session.execute(stmt)
            return result.scalar() or 0

    async def close(self) -> None:
        """关闭连接池。"""
        await self.engine.dispose()
        logger.info("Database connection pool closed")
