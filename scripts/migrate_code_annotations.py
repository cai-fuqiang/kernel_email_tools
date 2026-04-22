"""数据库迁移：创建 code_annotations 表。

用法:
    python scripts/migrate_code_annotations.py [--drop]

选项:
    --drop  删除已存在的 code_annotations 表后重建
"""

import argparse
import asyncio
import sys
from pathlib import Path

# 将项目根目录加入 path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from src.storage.postgres import PostgresStorage


async def run_migration(drop: bool = False):
    config_path = Path(__file__).parent.parent / "config" / "settings.yaml"
    import yaml
    with open(config_path) as f:
        config = yaml.safe_load(f)

    email_storage_cfg = config.get("storage", {}).get("email", {})
    database_url = email_storage_cfg.get("database_url")
    if not database_url:
        print("ERROR: storage.email.database_url not configured in settings.yaml")
        return False

    storage = PostgresStorage(database_url=database_url, pool_size=1)
    await storage.init_db()

    async with storage.session_factory() as session:
        engine = session.bind
        async with engine.connect() as conn:
            # 检查表是否存在
            result = await conn.execute(
                text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'code_annotations')")
            )
            exists = result.scalar()

            if exists:
                if drop:
                    print("Dropping existing code_annotations table...")
                    await conn.execute(text("DROP TABLE code_annotations CASCADE"))
                    await conn.commit()
                    print("Dropped.")
                else:
                    print("code_annotations table already exists. Use --drop to recreate.")
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
            await conn.execute(text("CREATE INDEX ix_code_annotations_file ON code_annotations (version, file_path)"))
            await conn.execute(text("CREATE INDEX ix_code_annotations_version ON code_annotations (version)"))
            await conn.execute(text("CREATE INDEX ix_code_annotations_author ON code_annotations (author)"))
            await conn.commit()
            print("code_annotations table created successfully.")
            return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate code_annotations table")
    parser.add_argument("--drop", action="store_true", help="Drop and recreate table")
    args = parser.parse_args()

    success = asyncio.run(run_migration(drop=args.drop))
    sys.exit(0 if success else 1)