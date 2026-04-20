#!/usr/bin/env python3
"""全新初始化数据库脚本。"""

import sys
import asyncio
from sqlalchemy import text, MetaData
from sqlalchemy.engine import create_engine
from sqlalchemy.orm import declarative_base

# 使用不同的 Base 实例避免缓存问题
Base = declarative_base()

# 直接定义表结构（不导入 models.py）
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, ARRAY
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import relationship, Mapped, mapped_column
from datetime import datetime
from typing import Optional

class TagORM(Base):
    __tablename__ = "tags"
    id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = Column(String(64), nullable=False, unique=True)
    parent_id: Mapped[Optional[int]] = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=True, index=True)
    color: Mapped[str] = Column(String(7), nullable=False, default="#6366f1")
    created_at: Mapped[datetime] = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

class EmailORM(Base):
    __tablename__ = "emails"
    id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = Column(String(512), nullable=False, unique=True)
    subject: Mapped[str] = Column(String(1024), nullable=False, default="")
    sender: Mapped[str] = Column(String(512), nullable=False, default="")
    date: Mapped[Optional[datetime]] = Column(DateTime(timezone=True), nullable=True)
    in_reply_to: Mapped[str] = Column(String(512), nullable=False, default="")
    references: Mapped[list] = Column(ARRAY(String), nullable=False, default=[])
    body: Mapped[str] = Column(String, nullable=False, default="")
    body_raw: Mapped[str] = Column(String, nullable=False, default="")
    patch_content: Mapped[str] = Column(String, nullable=False, default="")
    has_patch: Mapped[bool] = Column(Boolean, nullable=False, default=False)
    list_name: Mapped[str] = Column(String(128), nullable=False, default="")
    thread_id: Mapped[str] = Column(String(512), nullable=False, default="")
    epoch: Mapped[int] = Column(Integer, nullable=False, default=0)
    tags: Mapped[list] = Column(ARRAY(String), nullable=False, default=[])
    search_vector: Mapped[str] = Column(TSVECTOR, nullable=True)

class EmailTagORM(Base):
    __tablename__ = "email_tags"
    id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    email_id: Mapped[int] = Column(Integer, ForeignKey("emails.id", ondelete="CASCADE"), nullable=False)
    tag_id: Mapped[int] = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False)

async def init():
    database_url = "postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email"
    from sqlalchemy.ext.asyncio import create_async_engine
    
    engine = create_async_engine(database_url)
    
    async with engine.begin() as conn:
        # 创建表
        await conn.run_sync(Base.metadata.create_all)
        print("Tables created successfully")
        
        # 创建全文搜索函数
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
        
        # 创建触发器
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
        print("Trigger created successfully")
    
    await engine.dispose()
    print("Database initialized successfully!")

if __name__ == "__main__":
    asyncio.run(init())