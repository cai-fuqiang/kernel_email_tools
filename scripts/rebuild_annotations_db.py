#!/usr/bin/env python3
"""重建标注相关数据库表。

用途：
- 删除当前通用标注表 `annotations`
- 清理旧版代码标注表 `code_annotations`（如果还存在）
- 按最新模型重新创建标注表

不会删除邮件主表、标签表、手册表。
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


async def rebuild_annotations() -> None:
    settings = get_settings()
    email_db_url = settings.storage["email"]["database_url"]

    engine = create_async_engine(email_db_url, echo=False)

    async with engine.begin() as conn:
        print("Dropping old annotation tables...")
        await conn.execute(text("DROP TABLE IF EXISTS code_annotations CASCADE"))
        await conn.execute(text("DROP TABLE IF EXISTS annotations CASCADE"))

        print("Recreating annotations table...")
        await conn.run_sync(Base.metadata.create_all, checkfirst=True, tables=[Base.metadata.tables["annotations"]])

    await engine.dispose()
    print("Annotation tables rebuilt successfully.")


if __name__ == "__main__":
    asyncio.run(rebuild_annotations())
