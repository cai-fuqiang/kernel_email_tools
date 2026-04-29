"""PostgreSQL 存储层实现 — 支持批量写入、去重、全文搜索。"""

import logging
from datetime import datetime
from collections import defaultdict
from typing import Optional

from sqlalchemy import func, literal, or_, select, text, union
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.storage.base import BaseStorage
from src.storage.models import (
    AnnotationORM,
    Base,
    EmailCreate,
    EmailChunkEmbeddingORM,
    EmailChunkORM,
    EmailChunkRead,
    EmailChunkSearchResult,
    EmailORM,
    EmailRead,
    EmailSearchResult,
    TagAliasORM,
    TagAssignmentORM,
    TagORM,
)
from src.storage.tag_store import (
    TARGET_TYPE_ANNOTATION,
    TARGET_TYPE_EMAIL_MESSAGE,
    TARGET_TYPE_EMAIL_PARAGRAPH,
    TARGET_TYPE_EMAIL_THREAD,
    TagStore,
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
        self.tag_store = TagStore(self.session_factory)

    async def init_db(self) -> None:
        """创建表和索引，设置全文搜索触发器。"""
        async with self.engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await conn.run_sync(Base.metadata.create_all, checkfirst=True)
            await self._ensure_multi_user_columns(conn)

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

            await conn.execute(text("""
                CREATE OR REPLACE FUNCTION email_chunks_search_vector_update() RETURNS trigger AS $$
                BEGIN
                    NEW.search_vector :=
                        setweight(to_tsvector('english', COALESCE(NEW.subject, '')), 'A') ||
                        setweight(to_tsvector('english', COALESCE(NEW.sender, '')), 'B') ||
                        setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'C');
                    RETURN NEW;
                END
                $$ LANGUAGE plpgsql;
            """))

            await conn.execute(text("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_trigger WHERE tgname = 'email_chunks_search_vector_trigger'
                    ) THEN
                        CREATE TRIGGER email_chunks_search_vector_trigger
                        BEFORE INSERT OR UPDATE ON email_chunks
                        FOR EACH ROW EXECUTE FUNCTION email_chunks_search_vector_update();
                    END IF;
                END
                $$;
            """))

            await conn.execute(text("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM pg_extension WHERE extname = 'vector'
                    ) AND NOT EXISTS (
                        SELECT 1 FROM pg_indexes
                        WHERE indexname = 'ix_email_chunk_embeddings_vector'
                    ) THEN
                        CREATE INDEX ix_email_chunk_embeddings_vector
                        ON email_chunk_embeddings USING ivfflat (embedding vector_cosine_ops)
                        WITH (lists = 100);
                    END IF;
                EXCEPTION WHEN others THEN
                    RAISE NOTICE 'Skipping email chunk vector index: %', SQLERRM;
                END
                $$;
            """))

        logger.info("Database initialized: tables, indexes, and triggers created")

    async def _ensure_multi_user_columns(self, conn) -> None:
        """为已有部署补充多用户相关列。"""
        statements = [
            "ALTER TABLE tags ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'public'",
            "ALTER TABLE tags ADD COLUMN IF NOT EXISTS owner_user_id VARCHAR(128)",
            "ALTER TABLE tags ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(128)",
            "ALTER TABLE tags ADD COLUMN IF NOT EXISTS updated_by_user_id VARCHAR(128)",
            "CREATE INDEX IF NOT EXISTS ix_tags_visibility ON tags (visibility)",
            "CREATE INDEX IF NOT EXISTS ix_tags_owner_user_id ON tags (owner_user_id)",
            "CREATE INDEX IF NOT EXISTS ix_tags_created_by_user_id ON tags (created_by_user_id)",
            "CREATE INDEX IF NOT EXISTS ix_tags_updated_by_user_id ON tags (updated_by_user_id)",
            "ALTER TABLE tag_assignments ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(128)",
            "CREATE INDEX IF NOT EXISTS ix_tag_assignments_created_by_user_id ON tag_assignments (created_by_user_id)",
            "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS author_user_id VARCHAR(128)",
            "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'public'",
            "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS publish_status VARCHAR(16) NOT NULL DEFAULT 'none'",
            "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS publish_requested_at TIMESTAMPTZ",
            "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS publish_requested_by_user_id VARCHAR(128)",
            "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS publish_reviewed_at TIMESTAMPTZ",
            "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS publish_reviewed_by_user_id VARCHAR(128)",
            "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS publish_review_comment TEXT NOT NULL DEFAULT ''",
            "CREATE INDEX IF NOT EXISTS ix_annotations_author_user_id ON annotations (author_user_id)",
            "CREATE INDEX IF NOT EXISTS ix_annotations_visibility ON annotations (visibility)",
            "CREATE INDEX IF NOT EXISTS ix_annotations_publish_status ON annotations (publish_status)",
            "CREATE INDEX IF NOT EXISTS ix_annotations_publish_requested_by_user_id ON annotations (publish_requested_by_user_id)",
            "CREATE INDEX IF NOT EXISTS ix_annotations_publish_reviewed_by_user_id ON annotations (publish_reviewed_by_user_id)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(128) NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(128) NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(256) NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_algo VARCHAR(32) NOT NULL DEFAULT 'pbkdf2_sha256'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status VARCHAR(32) NOT NULL DEFAULT 'approved'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by_user_id VARCHAR(128)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'viewer'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_source VARCHAR(32) NOT NULL DEFAULT 'header'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
            "CREATE INDEX IF NOT EXISTS ix_users_approval_status ON users (approval_status)",
            "CREATE INDEX IF NOT EXISTS ix_users_approved_by_user_id ON users (approved_by_user_id)",
            "CREATE TABLE IF NOT EXISTS user_sessions ("
            "id SERIAL PRIMARY KEY, "
            "session_id VARCHAR(64) NOT NULL UNIQUE, "
            "user_id VARCHAR(128) NOT NULL, "
            "session_token_hash VARCHAR(64) NOT NULL UNIQUE, "
            "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), "
            "expires_at TIMESTAMPTZ NOT NULL, "
            "revoked_at TIMESTAMPTZ NULL, "
            "ip VARCHAR(128) NOT NULL DEFAULT '', "
            "user_agent TEXT NOT NULL DEFAULT ''"
            ")",
            "CREATE INDEX IF NOT EXISTS ix_user_sessions_user_id ON user_sessions (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_user_sessions_revoked_at ON user_sessions (revoked_at)",
        ]
        for statement in statements:
            await conn.execute(text(statement))

        # 老数据里可能存在空 username 或重复 username，先整理后再加唯一索引。
        existing_users = (
            await conn.execute(
                text("SELECT id, user_id, username FROM users ORDER BY id ASC")
            )
        ).mappings().all()
        used_usernames: set[str] = set()
        for row in existing_users:
            raw_username = str(row.get("username") or "").strip()
            base_username = raw_username or str(row.get("user_id") or "").strip() or f"user-{row['id']}"
            candidate = base_username
            suffix = 1
            while candidate in used_usernames:
                suffix += 1
                candidate = f"{base_username}-{suffix}"
            used_usernames.add(candidate)
            if candidate != raw_username:
                await conn.execute(
                    text("UPDATE users SET username = :username WHERE id = :id"),
                    {"username": candidate, "id": row["id"]},
                )

        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users (username)"))

    async def set_email_search_trigger_enabled(self, enabled: bool) -> bool:
        """启用/禁用 emails search_vector 触发器，用于大批量导入加速。"""
        action = "ENABLE" if enabled else "DISABLE"
        try:
            async with self.engine.begin() as conn:
                await conn.execute(text(f"ALTER TABLE emails {action} TRIGGER emails_search_vector_trigger"))
            logger.info("%s emails search_vector trigger", "Enabled" if enabled else "Disabled")
            return True
        except Exception as exc:
            logger.warning("Failed to %s emails search_vector trigger: %s", action.lower(), exc)
            return False

    async def save_emails(self, emails: list[EmailCreate], batch_size: int = 2000) -> int:
        """批量写入邮件，基于 message_id 去重（ON CONFLICT DO NOTHING）。

        Args:
            emails: 待保存的邮件列表。
            batch_size: 每批 INSERT 的邮件数量。

        Returns:
            实际新增的邮件数量。
        """
        if not emails:
            return 0

        total_inserted = 0

        for i in range(0, len(emails), batch_size):
            batch = emails[i:i + batch_size]
            # 截断超长字段，避免 VARCHAR 溢出
            values = []
            for e in batch:
                d = e.model_dump()
                d["subject"] = d.get("subject", "")[:1024]
                d["sender"] = d.get("sender", "")[:512]
                d["message_id"] = d.get("message_id", "")[:512]
                d["in_reply_to"] = d.get("in_reply_to", "")[:512]
                d["thread_id"] = d.get("thread_id", "")[:512]
                d["list_name"] = d.get("list_name", "")[:128]
                d["body"] = d.get("body", "")[:1000000]
                d["body_raw"] = d.get("body_raw", "")[:1000000]
                d["patch_content"] = d.get("patch_content", "")[:1000000]
                d.pop("tags", None)
                values.append(d)

            # 每批独立 session，失败不影响其他批次
            async with self.session_factory() as session:
                stmt = pg_insert(EmailORM).values(values)
                stmt = stmt.on_conflict_do_nothing(index_elements=["message_id"])
                try:
                    result = await session.execute(stmt)
                    await session.commit()
                    total_inserted += result.rowcount
                except Exception as ex:
                    await session.rollback()
                    logger.error(f"Batch insert failed: {ex}, falling back to single insert")
                    # 单条重试，每条独立提交
                    for v in values:
                        async with self.session_factory() as retry_session:
                            try:
                                stmt = pg_insert(EmailORM).values(v)
                                stmt = stmt.on_conflict_do_nothing(index_elements=["message_id"])
                                result = await retry_session.execute(stmt)
                                await retry_session.commit()
                                total_inserted += result.rowcount
                            except Exception as e:
                                await retry_session.rollback()
                                logger.warning(f"Single insert failed for {v.get('message_id', '?')}: {e}")

            # 进度日志
            if (i // batch_size + 1) % 100 == 0:
                logger.info("Progress: %d / %d emails processed", i + batch_size, len(emails))

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
        sort_by: str = "",
        sort_order: str = "",
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

            # 标签过滤：统一走 tag_assignments
            if tags:
                if tag_mode == "all":
                    for tag in tags:
                        conditions.append(EmailORM.message_id.in_(self._message_ids_for_tag(tag)))
                else:
                    subqueries = [self._message_ids_for_tag(tag) for tag in tags]
                    merged = subqueries[0] if len(subqueries) == 1 else union(*subqueries)
                    conditions.append(EmailORM.message_id.in_(merged))

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
                if sort_by == "date":
                    order_col = EmailORM.date.desc() if sort_order != "asc" else EmailORM.date.asc()
                else:
                    order_col = rank_col.desc()
            else:
                # 无关键词时，使用固定的 rank 值 0，按日期倒序排序
                rank_col = literal(0.0)
                snippet_col = func.substring(EmailORM.body, 1, 500)
                order_col = EmailORM.date.desc() if sort_order != "asc" else EmailORM.date.asc()

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
            tag_map = await self._get_message_tag_map(
                session,
                [(row.message_id, row.thread_id) for row in rows],
            )

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
                    tags=tag_map.get(row.message_id, []),
                    rank=float(row.rank),
                    snippet=row.snippet or "",
                )
                for row in rows
            ]

        return results, total

    async def search_email_chunks_fulltext(
        self,
        query: str,
        list_name: Optional[str] = None,
        sender: Optional[str] = None,
        date_from=None,
        date_to=None,
        tags: Optional[list[str]] = None,
        tag_mode: str = "any",
        limit: int = 30,
    ) -> list[EmailChunkSearchResult]:
        """使用 email_chunks 的 GIN 全文索引检索 RAG 分片。"""
        if not query.strip():
            return []

        async with self.session_factory() as session:
            tsquery = func.plainto_tsquery("english", query)
            conditions = [EmailChunkORM.search_vector.op("@@")(tsquery)]
            if list_name:
                conditions.append(EmailChunkORM.list_name == list_name)
            if sender:
                conditions.append(EmailChunkORM.sender.ilike(f"%{sender}%"))
            if date_from:
                if isinstance(date_from, str):
                    date_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
                conditions.append(EmailChunkORM.date >= date_from)
            if date_to:
                if isinstance(date_to, str):
                    date_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
                conditions.append(EmailChunkORM.date <= date_to)
            if tags:
                if tag_mode == "all":
                    for tag in tags:
                        conditions.append(EmailChunkORM.message_id.in_(self._message_ids_for_tag(tag)))
                else:
                    subqueries = [self._message_ids_for_tag(tag) for tag in tags]
                    merged = subqueries[0] if len(subqueries) == 1 else union(*subqueries)
                    conditions.append(EmailChunkORM.message_id.in_(merged))

            rank_col = func.ts_rank(EmailChunkORM.search_vector, tsquery)
            snippet_col = func.ts_headline(
                "english",
                EmailChunkORM.content,
                tsquery,
                text("'StartSel=<<, StopSel=>>, MaxWords=70, MinWords=25'"),
            )
            stmt = (
                select(
                    EmailChunkORM.chunk_id,
                    EmailChunkORM.message_id,
                    EmailChunkORM.thread_id,
                    EmailChunkORM.list_name,
                    EmailChunkORM.subject,
                    EmailChunkORM.sender,
                    EmailChunkORM.date,
                    EmailChunkORM.chunk_index,
                    EmailChunkORM.content,
                    EmailChunkORM.content_hash,
                    rank_col.label("score"),
                    snippet_col.label("snippet"),
                )
                .where(*conditions)
                .order_by(rank_col.desc(), EmailChunkORM.date.desc())
                .limit(limit)
            )
            rows = (await session.execute(stmt)).all()

        return [
            EmailChunkSearchResult(
                chunk_id=row.chunk_id,
                message_id=row.message_id,
                thread_id=row.thread_id,
                list_name=row.list_name,
                subject=row.subject,
                sender=row.sender,
                date=row.date,
                chunk_index=row.chunk_index,
                content=row.content,
                content_hash=row.content_hash,
                score=float(row.score or 0.0),
                snippet=row.snippet or row.content[:300],
                source="chunk_keyword",
            )
            for row in rows
        ]

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
        """使用 pgvector 余弦距离检索 RAG 分片。"""
        if not embedding:
            return []

        try:
            distance_col = EmailChunkEmbeddingORM.embedding.cosine_distance(embedding)
        except AttributeError:
            logger.warning("pgvector SQLAlchemy comparator unavailable; skipping vector search")
            return []

        async with self.session_factory() as session:
            conditions = [
                EmailChunkEmbeddingORM.provider == provider,
                EmailChunkEmbeddingORM.model == model,
            ]
            if list_name:
                conditions.append(EmailChunkORM.list_name == list_name)
            if sender:
                conditions.append(EmailChunkORM.sender.ilike(f"%{sender}%"))
            if date_from:
                if isinstance(date_from, str):
                    date_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
                conditions.append(EmailChunkORM.date >= date_from)
            if date_to:
                if isinstance(date_to, str):
                    date_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
                conditions.append(EmailChunkORM.date <= date_to)
            if tags:
                if tag_mode == "all":
                    for tag in tags:
                        conditions.append(EmailChunkORM.message_id.in_(self._message_ids_for_tag(tag)))
                else:
                    subqueries = [self._message_ids_for_tag(tag) for tag in tags]
                    merged = subqueries[0] if len(subqueries) == 1 else union(*subqueries)
                    conditions.append(EmailChunkORM.message_id.in_(merged))
            if has_patch is not None:
                conditions.append(EmailORM.has_patch == has_patch)

            stmt = (
                select(
                    EmailChunkORM.chunk_id,
                    EmailChunkORM.message_id,
                    EmailChunkORM.thread_id,
                    EmailChunkORM.list_name,
                    EmailChunkORM.subject,
                    EmailChunkORM.sender,
                    EmailChunkORM.date,
                    EmailChunkORM.chunk_index,
                    EmailChunkORM.content,
                    EmailChunkORM.content_hash,
                    EmailORM.has_patch,
                    distance_col.label("distance"),
                )
                .join(EmailChunkEmbeddingORM, EmailChunkEmbeddingORM.chunk_id == EmailChunkORM.chunk_id)
                .join(EmailORM, EmailORM.message_id == EmailChunkORM.message_id)
                .where(*conditions)
                .order_by(distance_col.asc())
                .limit(limit)
            )
            rows = (await session.execute(stmt)).all()

        return [
            EmailChunkSearchResult(
                chunk_id=row.chunk_id,
                message_id=row.message_id,
                thread_id=row.thread_id,
                list_name=row.list_name,
                subject=row.subject,
                sender=row.sender,
                date=row.date,
                chunk_index=row.chunk_index,
                content=row.content,
                content_hash=row.content_hash,
                has_patch=bool(row.has_patch),
                score=max(0.0, 1.0 - float(row.distance or 0.0)),
                snippet=row.content[:300],
                source="chunk_vector",
            )
            for row in rows
        ]

    async def get_chunks_needing_embeddings(
        self,
        provider: str,
        model: str,
        limit: int = 100,
        list_name: Optional[str] = None,
    ) -> list[EmailChunkRead]:
        """获取尚未有最新 embedding 的 chunk。"""
        async with self.session_factory() as session:
            conditions = []
            if list_name:
                conditions.append(EmailChunkORM.list_name == list_name)
            stmt = (
                select(EmailChunkORM)
                .outerjoin(
                    EmailChunkEmbeddingORM,
                    (EmailChunkEmbeddingORM.chunk_id == EmailChunkORM.chunk_id)
                    & (EmailChunkEmbeddingORM.provider == provider)
                    & (EmailChunkEmbeddingORM.model == model)
                    & (EmailChunkEmbeddingORM.content_hash == EmailChunkORM.content_hash),
                )
                .where(EmailChunkEmbeddingORM.id.is_(None), *conditions)
                .order_by(EmailChunkORM.date.desc().nullslast(), EmailChunkORM.id.asc())
                .limit(limit)
            )
            rows = (await session.execute(stmt)).scalars().all()
            return [EmailChunkRead.model_validate(row) for row in rows]

    async def upsert_chunk_embeddings(
        self,
        embeddings: list[dict],
    ) -> int:
        """批量 upsert chunk embedding。"""
        if not embeddings:
            return 0
        async with self.session_factory() as session:
            stmt = pg_insert(EmailChunkEmbeddingORM).values(embeddings)
            update_cols = {
                "provider": stmt.excluded.provider,
                "model": stmt.excluded.model,
                "dimension": stmt.excluded.dimension,
                "embedding": stmt.excluded.embedding,
                "content_hash": stmt.excluded.content_hash,
                "created_at": stmt.excluded.created_at,
            }
            stmt = stmt.on_conflict_do_update(
                index_elements=[EmailChunkEmbeddingORM.chunk_id],
                set_=update_cols,
            )
            await session.execute(stmt)
            await session.commit()
        return len(embeddings)

    async def get_chunk_count(self, list_name: Optional[str] = None) -> int:
        """获取邮件 RAG chunk 数量。"""
        async with self.session_factory() as session:
            stmt = select(func.count()).select_from(EmailChunkORM)
            if list_name:
                stmt = stmt.where(EmailChunkORM.list_name == list_name)
            return (await session.execute(stmt)).scalar() or 0

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

    async def get_email_tags(self, message_id: str, viewer_user_id: Optional[str] = None) -> list[str]:
        """获取邮件的标签列表。

        Args:
            message_id: 邮件的 Message-ID。

        Returns:
            标签名称列表。
        """
        return await self.tag_store.get_email_tags(message_id, viewer_user_id=viewer_user_id)

    async def add_email_tag(
        self,
        message_id: str,
        tag_name: str,
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> bool:
        """为邮件添加标签。

        Args:
            message_id: 邮件的 Message-ID。
            tag_name: 标签名称。

        Returns:
            添加成功返回 True，邮件不存在或已达上限返回 False。
        """
        return await self.tag_store.add_email_tag(
            message_id,
            tag_name,
            actor_user_id=actor_user_id,
            actor_display_name=actor_display_name,
        )

    async def remove_email_tag(self, message_id: str, tag_name: str) -> bool:
        """从邮件移除标签。

        Args:
            message_id: 邮件的 Message-ID。
            tag_name: 标签名称。

        Returns:
            移除成功返回 True，邮件不存在返回 False。
        """
        return await self.tag_store.remove_email_tag(message_id, tag_name)

    async def get_emails_by_tag(
        self,
        tag_name: str,
        page: int = 1,
        page_size: int = 20,
        viewer_user_id: Optional[str] = None,
    ) -> tuple[list[EmailSearchResult], int]:
        """获取某个标签下的所有邮件。

        Args:
            tag_name: 标签名称。
            page: 页码（从 1 开始）。
            page_size: 每页数量。

        Returns:
            (邮件列表, 总数)。
        """
        items, total = await self.tag_store.get_emails_by_tag(
            tag_name,
            page,
            page_size,
            viewer_user_id=viewer_user_id,
        )
        results = [
            EmailSearchResult(
                id=0,
                message_id=item["message_id"],
                subject=item["subject"],
                sender=item["sender"],
                date=item["date"],
                list_name=item["list_name"],
                thread_id=item["thread_id"],
                has_patch=item["has_patch"],
                tags=[],
                rank=0.0,
                snippet=item["snippet"] or "",
            )
            for item in items
        ]
        return results, total

    async def get_all_tags_with_count(self, viewer_user_id: Optional[str] = None) -> list[dict]:
        """获取所有标签及其邮件数量。

        Returns:
            [{name: str, count: int}] 列表。
        """
        return await self.tag_store.get_tag_stats(viewer_user_id=viewer_user_id)

    def _tag_match_query(self, tag_value: str):
        return or_(TagORM.name == tag_value, TagORM.slug == tag_value, TagAliasORM.alias == tag_value)

    def _message_ids_for_tag(self, tag_value: str):
        tag_ids = (
            select(TagORM.id)
            .select_from(TagORM)
            .outerjoin(TagAliasORM, TagAliasORM.tag_id == TagORM.id)
            .where(self._tag_match_query(tag_value))
        )
        direct_messages = (
            select(TagAssignmentORM.target_ref.label("message_id"))
            .select_from(TagAssignmentORM)
            .where(TagAssignmentORM.tag_id.in_(tag_ids))
            .where(TagAssignmentORM.target_type.in_([TARGET_TYPE_EMAIL_MESSAGE, TARGET_TYPE_EMAIL_PARAGRAPH]))
        )
        from_thread = (
            select(EmailORM.message_id.label("message_id"))
            .where(
                EmailORM.thread_id.in_(
                    select(TagAssignmentORM.target_ref)
                        .select_from(TagAssignmentORM)
                    .where(TagAssignmentORM.tag_id.in_(tag_ids))
                    .where(TagAssignmentORM.target_type == TARGET_TYPE_EMAIL_THREAD)
                )
            )
        )
        from_annotations = (
            select(AnnotationORM.in_reply_to.label("message_id"))
            .select_from(AnnotationORM)
            .join(TagAssignmentORM, TagAssignmentORM.target_ref == AnnotationORM.annotation_id)
            .where(TagAssignmentORM.tag_id.in_(tag_ids))
            .where(TagAssignmentORM.target_type == TARGET_TYPE_ANNOTATION)
            .where(AnnotationORM.in_reply_to != "")
        )
        from_annotation_threads = (
            select(EmailORM.message_id.label("message_id"))
            .where(
                EmailORM.thread_id.in_(
                    select(AnnotationORM.thread_id)
                    .select_from(AnnotationORM)
                    .join(TagAssignmentORM, TagAssignmentORM.target_ref == AnnotationORM.annotation_id)
                    .where(TagAssignmentORM.tag_id.in_(tag_ids))
                    .where(TagAssignmentORM.target_type == TARGET_TYPE_ANNOTATION)
                    .where(AnnotationORM.thread_id != "")
                )
            )
        )
        return union(direct_messages, from_thread, from_annotations, from_annotation_threads)

    async def _get_message_tag_map(
        self,
        session: AsyncSession,
        message_pairs: list[tuple[str, str]],
    ) -> dict[str, list[str]]:
        if not message_pairs:
            return {}

        message_ids = [message_id for message_id, _ in message_pairs]
        thread_map = {message_id: thread_id for message_id, thread_id in message_pairs}
        thread_ids = {thread_id for _, thread_id in message_pairs if thread_id}
        tags_by_message: dict[str, set[str]] = defaultdict(set)

        direct_stmt = (
            select(TagAssignmentORM.target_ref, TagAssignmentORM.target_type, TagORM.name)
            .join(TagORM, TagORM.id == TagAssignmentORM.tag_id)
            .where(TagAssignmentORM.target_type.in_([TARGET_TYPE_EMAIL_MESSAGE, TARGET_TYPE_EMAIL_PARAGRAPH]))
            .where(TagAssignmentORM.target_ref.in_(message_ids))
        )
        for target_ref, _, tag_name in (await session.execute(direct_stmt)).all():
            tags_by_message[target_ref].add(tag_name)

        if thread_ids:
            thread_stmt = (
                select(TagAssignmentORM.target_ref, TagORM.name)
                .join(TagORM, TagORM.id == TagAssignmentORM.tag_id)
                .where(TagAssignmentORM.target_type == TARGET_TYPE_EMAIL_THREAD)
                .where(TagAssignmentORM.target_ref.in_(thread_ids))
            )
            thread_tags: dict[str, set[str]] = defaultdict(set)
            for thread_id, tag_name in (await session.execute(thread_stmt)).all():
                thread_tags[thread_id].add(tag_name)
            for message_id, thread_id in thread_map.items():
                tags_by_message[message_id].update(thread_tags.get(thread_id, set()))

        annotation_stmt = (
            select(AnnotationORM.in_reply_to, AnnotationORM.thread_id, TagORM.name)
            .select_from(AnnotationORM)
            .join(TagAssignmentORM, TagAssignmentORM.target_ref == AnnotationORM.annotation_id)
            .join(TagORM, TagORM.id == TagAssignmentORM.tag_id)
            .where(TagAssignmentORM.target_type == TARGET_TYPE_ANNOTATION)
            .where(or_(AnnotationORM.in_reply_to.in_(message_ids), AnnotationORM.thread_id.in_(thread_ids)))
        )
        for in_reply_to, thread_id, tag_name in (await session.execute(annotation_stmt)).all():
            if in_reply_to and in_reply_to in tags_by_message:
                tags_by_message[in_reply_to].add(tag_name)
            elif thread_id:
                for message_id, mapped_thread_id in thread_map.items():
                    if mapped_thread_id == thread_id:
                        tags_by_message[message_id].add(tag_name)

        return {message_id: sorted(values) for message_id, values in tags_by_message.items()}

    async def close(self) -> None:
        """关闭连接池。"""
        await self.engine.dispose()
        logger.info("Database connection pool closed")
