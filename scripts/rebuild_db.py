#!/usr/bin/env python3
"""重建数据库脚本 - 删除并重建所有表、索引和触发器。"""

import asyncio
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from src.storage.postgres import PostgresStorage
from src.storage.document_store import DocumentStorage
from config.settings import get_settings


async def drop_all_tables(database_url: str, table_names: list[str]) -> None:
    """删除指定数据库中的所有表。

    使用 CASCADE 直接删除表（会自动删除关联索引和触发器），
    无需单独删除索引。

    Args:
        database_url: 数据库连接字符串。
        table_names: 要删除的表名列表（按依赖顺序排列）。
    """
    engine = create_async_engine(database_url)
    async with engine.begin() as conn:
        for table in table_names:
            await conn.execute(text(f"DROP TABLE IF EXISTS {table} CASCADE"))
            print(f"  Dropped table: {table}")
    await engine.dispose()


async def rebuild_email_db() -> None:
    """重建邮件数据库。"""
    settings = get_settings()
    email_url = settings.storage["email"]["database_url"]

    print("Dropping email tables...")
    await drop_all_tables(email_url, ["email_tags", "tags", "emails"])

    print("Recreating email tables, indexes, triggers...")
    storage = PostgresStorage(email_url)
    await storage.init_db()
    await storage.close()
    print("Email database rebuilt successfully")


async def rebuild_manual_db() -> None:
    """重建手册数据库。"""
    settings = get_settings()
    manual_url = settings.storage["manual"]["database_url"]

    print("Dropping manual tables...")
    await drop_all_tables(manual_url, ["document_chunks"])

    print("Recreating manual tables, indexes...")
    storage = DocumentStorage(manual_url)
    await storage.init_db()
    await storage.close()
    print("Manual database rebuilt successfully")


async def rebuild() -> None:
    """重建所有数据库。"""
    print("=" * 50)
    print("Rebuilding email database...")
    print("=" * 50)
    await rebuild_email_db()

    print()
    print("=" * 50)
    print("Rebuilding manual database...")
    print("=" * 50)
    await rebuild_manual_db()

    print()
    print("All databases rebuilt successfully!")


if __name__ == "__main__":
    asyncio.run(rebuild())