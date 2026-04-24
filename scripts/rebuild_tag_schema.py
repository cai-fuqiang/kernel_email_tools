#!/usr/bin/env python3
"""重建通用标签 schema。

用途：
- 删除当前标签相关表：`tag_assignments`、`tag_aliases`、`tags`
- 按最新模型重新创建标签相关表

不会删除：
- `emails`
- `annotations`
- 手册相关表
"""

import asyncio
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# 添加项目根目录到 Python 路径
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from config.settings import get_settings
from src.storage.models import Base


TAG_TABLES = ["tags", "tag_aliases", "tag_assignments"]


async def rebuild_tag_schema() -> None:
    settings = get_settings()
    email_db_url = settings.storage["email"]["database_url"]

    engine = create_async_engine(email_db_url, echo=False)

    async with engine.begin() as conn:
        print("Dropping tag schema tables...")
        for table in reversed(TAG_TABLES):
            await conn.execute(text(f"DROP TABLE IF EXISTS {table} CASCADE"))
            print(f"  Dropped table: {table}")

        print("Recreating tag schema tables...")
        await conn.run_sync(
            Base.metadata.create_all,
            checkfirst=True,
            tables=[Base.metadata.tables[name] for name in TAG_TABLES],
        )

    await engine.dispose()
    print("Tag schema rebuilt successfully.")


if __name__ == "__main__":
    asyncio.run(rebuild_tag_schema())
