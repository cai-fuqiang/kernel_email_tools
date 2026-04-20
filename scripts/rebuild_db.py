#!/usr/bin/env python3
"""重建数据库脚本。"""

import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


async def rebuild():
    database_url = "postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email"
    engine = create_async_engine(database_url)
    
    async with engine.begin() as conn:
        # 删除所有索引
        result = await conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
        ))
        indexes = [row[0] for row in result.fetchall()]
        
        for idx in indexes:
            try:
                await conn.execute(text(f"DROP INDEX IF EXISTS {idx}"))
                print(f"Dropped index: {idx}")
            except Exception as e:
                print(f"Failed to drop index {idx}: {e}")
        
        # 删除所有表
        await conn.execute(text("DROP TABLE IF EXISTS email_tags CASCADE"))
        await conn.execute(text("DROP TABLE IF EXISTS tags CASCADE"))
        await conn.execute(text("DROP TABLE IF EXISTS emails CASCADE"))
        print("All tables dropped")
    
    await engine.dispose()
    print("Database cleaned successfully")


if __name__ == "__main__":
    asyncio.run(rebuild())