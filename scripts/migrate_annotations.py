"""迁移脚本：drop 并重建 annotations 表（修复索引冲突）。"""
import asyncio
import sys
sys.path.insert(0, ".")

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from src.storage.models import Base


async def main():
    url = "postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email"
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.execute(text("DROP TABLE IF EXISTS annotations CASCADE"))
        print("annotations table dropped")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)
        print("annotations table recreated successfully")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())