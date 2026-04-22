"""数据库迁移：创建 code_annotations 表（支持本地或 Neon 云数据库）。

用法:
    python scripts/migrate_code_annotations.py [--drop]

选项:
    --drop  删除已存在的 code_annotations 表后重建
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
import yaml


async def run_migration(drop: bool = False):
    config_path = Path(__file__).parent.parent / "config" / "settings.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    storage_cfg = config.get("storage", {})
    code_annot_cfg = storage_cfg.get("code_annotation", {})
    database_url = code_annot_cfg.get("database_url", "")

    if not database_url:
        email_cfg = storage_cfg.get("email", {})
        database_url = email_cfg.get("database_url", "")
        print("WARNING: code_annotation database not configured, using email database")

    if not database_url:
        print("ERROR: No database_url configured in settings.yaml")
        print("  - Set storage.code_annotation.database_url for Neon cloud DB")
        print("  - Or set storage.email.database_url for local PostgreSQL")
        return False

    # 确保使用 asyncpg 驱动
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    # 本地数据库禁用 SSL，云端（如 Neon）启用 SSL
    is_local = "localhost" in database_url or "127.0.0.1" in database_url
    ssl_mode = not is_local  # 本地 False，云端 True
    engine = create_async_engine(
        database_url,
        pool_size=1,
        echo=False,
        connect_args={"ssl": ssl_mode} if ssl_mode else {},
    )

    async with engine.begin() as conn:
        result = await conn.execute(
            text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'code_annotations')")
        )
        exists = result.scalar()

        if exists:
            if drop:
                print("Dropping existing code_annotations table...")
                await conn.execute(text("DROP TABLE code_annotations CASCADE"))
                # 不要单独 commit，保持事务连贯；后续建表会在同一事务中完成
                print("Dropped. Proceeding to create new table...")
            else:
                print("code_annotations table already exists. Use --drop to recreate.")
                await engine.dispose()
                return True

        print("Creating code_annotations table...")
        await conn.execute(text("""
            CREATE TABLE code_annotations (
                id SERIAL PRIMARY KEY,
                annotation_id VARCHAR(64) NOT NULL UNIQUE,
                version VARCHAR(32) NOT NULL,
                file_path VARCHAR(512) NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                anchor_context VARCHAR(128),
                body TEXT NOT NULL,
                author VARCHAR(128) NOT NULL DEFAULT 'me',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_annotation_position_body
                    UNIQUE (version, file_path, start_line, end_line, body)
            )
        """))
        # 批量创建索引（使用 IF NOT EXISTS 避免重复创建报错）
        for sql in [
            "CREATE INDEX IF NOT EXISTS ix_code_annotations_file ON code_annotations (version, file_path)",
            "CREATE INDEX IF NOT EXISTS ix_code_annotations_version ON code_annotations (version)",
            "CREATE INDEX IF NOT EXISTS ix_code_annotations_author ON code_annotations (author)",
        ]:
            await conn.execute(text(sql))
        await conn.commit()
        print("code_annotations table and indexes ready.")

    await engine.dispose()
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate code_annotations table")
    parser.add_argument("--drop", action="store_true", help="Drop and recreate table")
    args = parser.parse_args()
    success = asyncio.run(run_migration(drop=args.drop))
    sys.exit(0 if success else 1)