#!/usr/bin/env python3
"""数据库迁移脚本：统一批注存储。

将 code_annotations 数据迁移到 annotations 表，并修改 annotations 表结构。
"""
import asyncio
import logging
from pathlib import Path
import sys

# 添加项目根目录到 Python 路径
project_root = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(project_root))

import yaml
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    # 加载配置
    config_path = project_root / "config" / "settings.yaml"
    if not config_path.exists():
        logger.error(f"Config file not found: {config_path}")
        return 1

    with open(config_path, "r") as f:
        config = yaml.safe_load(f) or {}

    storage_cfg = config.get("storage", {})
    email_storage_cfg = storage_cfg.get("email", {})
    email_database_url = email_storage_cfg.get("database_url")
    
    if not email_database_url:
        logger.error("storage.email.database_url not configured in settings.yaml")
        return 1

    # 创建数据库引擎
    engine = create_async_engine(
        email_database_url,
        pool_size=2,
        echo=False,
    )
    
    async with engine.begin() as conn:
        # 1. 修改 annotations 表结构
        logger.info("Modifying annotations table structure...")
        
        # 添加新字段 - 逐个执行避免多命令问题
        await conn.execute(text("""
            ALTER TABLE annotations 
            ADD COLUMN IF NOT EXISTS annotation_type VARCHAR(20) NOT NULL DEFAULT 'email';
        """))
        
        await conn.execute(text("""
            ALTER TABLE annotations 
            ADD COLUMN IF NOT EXISTS version VARCHAR(32);
        """))
        
        await conn.execute(text("""
            ALTER TABLE annotations 
            ADD COLUMN IF NOT EXISTS file_path VARCHAR(512);
        """))
        
        await conn.execute(text("""
            ALTER TABLE annotations 
            ADD COLUMN IF NOT EXISTS start_line INTEGER;
        """))
        
        await conn.execute(text("""
            ALTER TABLE annotations 
            ADD COLUMN IF NOT EXISTS end_line INTEGER;
        """))
        
        await conn.execute(text("""
            ALTER TABLE annotations 
            ADD COLUMN IF NOT EXISTS anchor_context VARCHAR(128);
        """))
        
        await conn.execute(text("""
            ALTER TABLE annotations 
            ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::JSONB;
        """))
        
        # 添加索引
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_annotations_type ON annotations(annotation_type);
        """))
        
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_annotations_code ON annotations(version, file_path);
        """))
        
        # 添加代码标注唯一约束（忽略 NULL）
        await conn.execute(text("""
            ALTER TABLE annotations 
            ADD CONSTRAINT uq_annotation_position_body 
            UNIQUE (version, file_path, start_line, end_line, body)
            DEFERRABLE INITIALLY DEFERRED;
        """))
        
        logger.info("Annotations table structure updated successfully.")

    logger.info("Migration completed successfully.")
    await engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))