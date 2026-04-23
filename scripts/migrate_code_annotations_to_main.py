"""迁移独立 code_annotations 表数据到主库 annotations 表。

用法:
    python scripts/migrate_code_annotations_to_main.py [--dry-run]

选项:
    --dry-run  仅显示迁移统计，不实际执行迁移
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
import yaml
from src.storage.models import AnnotationORM


async def run_migration(dry_run: bool = False):
    config_path = Path(__file__).parent.parent / "config" / "settings.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    storage_cfg = config.get("storage", {})
    
    # 1. 连接代码标注数据库（源）
    code_annot_cfg = storage_cfg.get("code_annotation", {})
    source_db_url = code_annot_cfg.get("database_url", "")
    if not source_db_url:
        print("ERROR: storage.code_annotation.database_url not configured")
        return False
    
    # 2. 连接主数据库（目标）
    email_cfg = storage_cfg.get("email", {})
    target_db_url = email_cfg.get("database_url", "")
    if not target_db_url:
        print("ERROR: storage.email.database_url not configured")
        return False

    # 确保使用 asyncpg 驱动
    def ensure_asyncpg(url: str) -> str:
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url
    
    source_db_url = ensure_asyncpg(source_db_url)
    target_db_url = ensure_asyncpg(target_db_url)

    # 创建引擎
    source_engine = create_async_engine(
        source_db_url,
        pool_size=1,
        echo=False,
        connect_args={"ssl": not "localhost" in source_db_url} if "http" not in source_db_url else {},
    )
    
    target_engine = create_async_engine(
        target_db_url,
        pool_size=2,
        echo=False,
        connect_args={"ssl": not "localhost" in target_db_url} if "http" not in target_db_url else {},
    )

    SourceSession = async_sessionmaker(source_engine, expire_on_commit=False)
    TargetSession = async_sessionmaker(target_engine, expire_on_commit=False)

    try:
        # 读取源数据
        async with SourceSession() as source_session:
            result = await source_session.execute(text("""
                SELECT 
                    annotation_id,
                    version,
                    file_path,
                    start_line,
                    end_line,
                    anchor_context,
                    body,
                    author,
                    created_at,
                    updated_at
                FROM code_annotations
                ORDER BY created_at ASC
            """))
            source_rows = result.all()
        
        print(f"Found {len(source_rows)} code annotations in source database")
        
        if not source_rows:
            print("No code annotations to migrate")
            return True

        # 检查目标库中已存在的
        async with TargetSession() as target_session:
            existing_ids = await target_session.execute(
                select(AnnotationORM.annotation_id)
                .where(AnnotationORM.annotation_type == "code")
            )
            existing_id_set = {row[0] for row in existing_ids.all()}
        
        print(f"Found {len(existing_id_set)} existing code annotations in target database")

        # 过滤需要迁移的
        to_migrate = [row for row in source_rows if row.annotation_id not in existing_id_set]
        print(f"Will migrate {len(to_migrate)} new code annotations")

        if dry_run:
            print("Dry run mode - no changes will be made")
            for row in to_migrate[:5]:
                print(f"  - {row.annotation_id}: {row.version}:{row.file_path}:{row.start_line}")
            if len(to_migrate) > 5:
                print(f"  ... and {len(to_migrate) - 5} more")
            return True

        # 执行迁移
        async with TargetSession() as target_session:
            for row in to_migrate:
                ann = AnnotationORM(
                    annotation_id=row.annotation_id,
                    annotation_type="code",
                    author=row.author,
                    body=row.body,
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                    # 邮件字段留空
                    thread_id="",
                    in_reply_to="",
                    # 代码字段
                    version=row.version,
                    file_path=row.file_path,
                    start_line=row.start_line,
                    end_line=row.end_line,
                    anchor_context=row.anchor_context,
                )
                target_session.add(ann)
            
            await target_session.commit()
        
        print(f"Successfully migrated {len(to_migrate)} code annotations")
        
        # 验证
        async with TargetSession() as target_session:
            count = await target_session.scalar(
                select(text("COUNT(*)"))
                .select_from(AnnotationORM)
                .where(AnnotationORM.annotation_type == "code")
            )
            print(f"Total code annotations in target database: {count}")

        return True

    except Exception as e:
        print(f"Migration failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        await source_engine.dispose()
        await target_engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate code annotations to main database")
    parser.add_argument("--dry-run", action="store_true", help="Only show migration stats, don't apply changes")
    args = parser.parse_args()
    success = asyncio.run(run_migration(dry_run=args.dry_run))
    sys.exit(0 if success else 1)