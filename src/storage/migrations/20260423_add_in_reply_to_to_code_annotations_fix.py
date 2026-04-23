"""迁移脚本：为 code_annotations 表添加 in_reply_to 字段
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from src.config.settings import settings


async def run_migration():
    from sqlalchemy.ext.asyncio import create_async_engine
    
    # 使用配置中的数据库连接
    engine = create_async_engine(settings.postgres.dsn)
    
    async with engine.connect() as conn:
        # 检查字段是否已存在
        result = await conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'code_annotations' AND column_name = 'in_reply_to'"
        ))
        if result.scalar():
            print("✅ in_reply_to 字段已存在，跳过迁移")
            return
        
        # 添加字段
        await conn.execute(text(
            "ALTER TABLE code_annotations "
            "ADD COLUMN in_reply_to VARCHAR(64), "
            "ADD INDEX idx_code_annotations_in_reply_to (in_reply_to)"
        ))
        await conn.commit()
        print("✅ 成功添加 in_reply_to 字段和索引")


if __name__ == "__main__":
    asyncio.run(run_migration())
