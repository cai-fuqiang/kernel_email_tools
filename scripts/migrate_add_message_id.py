"""迁移脚本: 为 translation_cache 表添加 message_id 列。

Usage:
    python scripts/migrate_add_message_id.py

该脚本会检查列是否已存在，不会重复添加。
"""

import asyncio
import sys
from pathlib import Path

import yaml

# 确保项目根目录在 sys.path 中
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))


async def migrate():
    """执行迁移：添加 message_id 列到 translation_cache 表。"""
    import asyncpg

    config_path = project_root / "config" / "settings.yaml"
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    dsn = cfg.get("storage", {}).get("email", {}).get("database_url", "")
    # asyncpg 不需要 +asyncpg 后缀
    dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")

    if not dsn:
        print("ERROR: storage.email.database_url not configured")
        return

    print(f"Connecting to: {dsn[:50]}...")
    conn = await asyncpg.connect(dsn)

    try:
        row = await conn.fetchrow(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'translation_cache' AND column_name = 'message_id'"
        )
        if row:
            print("Column 'message_id' already exists, skipping.")
        else:
            await conn.execute(
                "ALTER TABLE translation_cache ADD COLUMN message_id VARCHAR(512)"
            )
            await conn.execute(
                "CREATE INDEX ix_translation_cache_message_id "
                "ON translation_cache (message_id)"
            )
            print("SUCCESS: Column 'message_id' added with index.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(migrate())