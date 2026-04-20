"""PostgreSQL 存储层实现 — 支持批量写入、去重、全文搜索。"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import func, literal, select, text
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
        self,
        query: str,
        list_name: Optional[str] = None,
        sender: Optional[str] = None,
        date_from=None,
        date_to=None,
        has_patch: Optional[bool] = None,
        tags: Optional[list[str]] = None,
        tag_mode: str = "any",
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[EmailSearchResult], int]:
        """使用 PostgreSQL 全文搜索。

        当 query 为空时，仅基于过滤条件进行筛选。

        Args:
            query: 搜索关键词（可为空）。
            list_name: 限定邮件列表。
            sender: 发件人模糊匹配（可选）。
            date_from: 起始日期（可选）。
            date_to: 结束日期（可选）。
            has_patch: 是否必须包含补丁（可选）。
            tags: 标签列表（可选）。
            tag_mode: 标签匹配模式，"any"（任一匹配）或 "all"（全部匹配）。
            page: 页码（从 1 开始）。
            page_size: 每页数量。

        Returns:
            (搜索结果列表, 总匹配数)。
        """
        async with self.session_factory() as session:
            # 过滤条件列表
            conditions = []

            # 只有当关键词非空时才添加全文搜索条件
            if query and query.strip():
                tsquery = func.plainto_tsquery("english", query)
                conditions.append(EmailORM.search_vector.op("@@")(tsquery))

            if list_name:
                conditions.append(EmailORM.list_name == list_name)
            # 发件人模糊匹配
            if sender:
                conditions.append(EmailORM.sender.ilike(f"%{sender}%"))
            # 日期范围过滤
            if date_from:
                if isinstance(date_from, str):
                    date_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
                conditions.append(EmailORM.date >= date_from)
            if date_to:
                if isinstance(date_to, str):
                    date_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
                conditions.append(EmailORM.date <= date_to)
            # 补丁状态过滤
            if has_patch is not None:
                conditions.append(EmailORM.has_patch == has_patch)

            # 标签过滤
            if tags:
                if tag_mode == "all":
                    # 全部匹配：邮件必须包含所有指定标签
                    for tag in tags:
                        conditions.append(EmailORM.tags.contains([tag]))
                else:
                    # 任一匹配：邮件包含任一指定标签
                    conditions.append(EmailORM.tags.overlap(tags))

            # 计算总匹配数
            count_stmt = select(func.count()).select_from(EmailORM).where(*conditions)
            total = (await session.execute(count_stmt)).scalar() or 0

            if total == 0:
                return [], 0

            # 搜索结果（带排名和片段）
            # 有关键词时用 ts_rank 排序，无关键词时按日期倒序
            if query and query.strip():
                rank_col = func.ts_rank(EmailORM.search_vector, tsquery)
                snippet_col = func.ts_headline(
                    "english",
                    EmailORM.body,
                    tsquery,
                    text("'StartSel=<<, StopSel=>>, MaxWords=50, MinWords=20'"),
                )
                order_col = rank_col.desc()
            else:
                # 无关键词时，使用固定的 rank 值 0，按日期倒序排序
                rank_col = literal(0.0)
                snippet_col = func.substring(EmailORM.body, 1, 500)
                order_col = EmailORM.date.desc()

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
                    rank_col.label("rank"),
                    snippet_col.label("snippet"),
                )
                .where(*conditions)
                .order_by(order_col)
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

    # ============================================================
    # 邮件标签管理
    # ============================================================

    async def get_email_tags(self, message_id: str) -> list[str]:
        """获取邮件的标签列表。

        Args:
            message_id: 邮件的 Message-ID。

        Returns:
            标签名称列表。
        """
        async with self.session_factory() as session:
            stmt = select(EmailORM.tags).where(EmailORM.message_id == message_id)
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return row or []

    async def add_email_tag(self, message_id: str, tag_name: str) -> bool:
        """为邮件添加标签。

        Args:
            message_id: 邮件的 Message-ID。
            tag_name: 标签名称。

        Returns:
            添加成功返回 True，邮件不存在或已达上限返回 False。
        """
        from src.storage.tag_store import MAX_TAGS_PER_EMAIL

        async with self.session_factory() as session:
            stmt = select(EmailORM).where(EmailORM.message_id == message_id)
            result = await session.execute(stmt)
            email = result.scalar_one_or_none()

            if not email:
                logger.warning(f"Email not found: {message_id}")
                return False

            # 获取当前标签
            current_tags = email.tags or []

            # 检查是否已达上限
            if len(current_tags) >= MAX_TAGS_PER_EMAIL:
                logger.warning(
                    f"Max tags ({MAX_TAGS_PER_EMAIL}) reached for email: {message_id}"
                )
                return False

            # 检查标签是否已存在
            if tag_name in current_tags:
                return True  # 已存在，视为成功

            # 添加标签
            email.tags = current_tags + [tag_name]
            await session.commit()
            logger.info(f"Added tag '{tag_name}' to email: {message_id}")
            return True

    async def remove_email_tag(self, message_id: str, tag_name: str) -> bool:
        """从邮件移除标签。

        Args:
            message_id: 邮件的 Message-ID。
            tag_name: 标签名称。

        Returns:
            移除成功返回 True，邮件不存在返回 False。
        """
        async with self.session_factory() as session:
            stmt = select(EmailORM).where(EmailORM.message_id == message_id)
            result = await session.execute(stmt)
            email = result.scalar_one_or_none()

            if not email:
                logger.warning(f"Email not found: {message_id}")
                return False

            current_tags = email.tags or []
            if tag_name not in current_tags:
                return True  # 不存在，视为成功

            email.tags = [t for t in current_tags if t != tag_name]
            await session.commit()
            logger.info(f"Removed tag '{tag_name}' from email: {message_id}")
            return True

    async def get_all_tags_with_count(self) -> list[dict]:
        """获取所有标签及其邮件数量。

        Returns:
            [{name: str, count: int}] 列表。
        """
        async with self.session_factory() as session:
            # PostgreSQL unnest 展开 tags 数组并统计
            stmt = text("""
                SELECT tag, COUNT(*) as count
                FROM emails,
                     LATERAL unnest(COALESCE(tags, ARRAY[]::text[])) as tag
                GROUP BY tag
                ORDER BY count DESC, tag ASC
            """)
            result = await session.execute(stmt)
            return [{"name": row.tag, "count": row.count} for row in result.all()]

    async def close(self) -> None:
        """关闭连接池。"""
        await self.engine.dispose()
        logger.info("Database connection pool closed")