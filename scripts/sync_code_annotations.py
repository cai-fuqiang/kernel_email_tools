"""从 Neon 云数据库同步 code_annotations 到本地数据库。

用法:
    python scripts/sync_code_annotations.py [--neon-url URL]

选项:
    --neon-url  Neon 数据库连接 URL（可选，默认从配置读取）
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
import yaml


# Neon 数据库连接 URL（从之前的配置）
DEFAULT_NEON_URL = "postgresql+asyncpg://neondb_owner:npg_Ec4bSNkhvdj7@ep-round-term-amz81fpj.c-5.us-east-1.aws.neon.tech/neondb"


async def sync_annotations(neon_url: str, local_url: str, batch_size: int = 100):
    """从 Neon 同步数据到本地。"""
    print(f"Connecting to Neon cloud DB...")
    neon_engine = create_async_engine(
        neon_url,
        pool_size=2,
        echo=False,
        connect_args={"ssl": True},
    )
    
    print(f"Connecting to local DB...")
    local_engine = create_async_engine(
        local_url,
        pool_size=2,
        echo=False,
    )
    
    neon_session = async_sessionmaker(neon_engine, class_=AsyncSession, expire_on_commit=False)
    local_session = async_sessionmaker(local_engine, class_=AsyncSession, expire_on_commit=False)
    
    total_synced = 0
    total_errors = 0
    
    try:
        async with neon_session() as session:
            # 获取总数
            count_result = await session.execute(text("SELECT COUNT(*) FROM code_annotations"))
            total_count = count_result.scalar()
            print(f"Neon DB has {total_count} annotations to sync")
            
            if total_count == 0:
                print("No annotations to sync")
                return True
            
            # 分批获取并同步
            offset = 0
            while True:
                result = await session.execute(
                    text("""
                        SELECT annotation_id, version, file_path, start_line, end_line,
                               anchor_context, body, author, created_at, updated_at
                        FROM code_annotations
                        ORDER BY id
                        LIMIT :batch_size OFFSET :offset
                    """),
                    {"batch_size": batch_size, "offset": offset}
                )
                rows = result.fetchall()
                
                if not rows:
                    break
                
                print(f"Syncing batch {offset // batch_size + 1}: {len(rows)} records...")
                
                # 插入到本地数据库
                async with local_session() as local_conn:
                    for row in rows:
                        try:
                            await local_conn.execute(
                                text("""
                                    INSERT INTO code_annotations 
                                    (annotation_id, version, file_path, start_line, end_line,
                                     anchor_context, body, author, created_at, updated_at)
                                    VALUES 
                                    (:annotation_id, :version, :file_path, :start_line, :end_line,
                                     :anchor_context, :body, :author, :created_at, :updated_at)
                                    ON CONFLICT (annotation_id) DO UPDATE SET
                                        body = EXCLUDED.body,
                                        updated_at = EXCLUDED.updated_at
                                """),
                                {
                                    "annotation_id": row.annotation_id,
                                    "version": row.version,
                                    "file_path": row.file_path,
                                    "start_line": row.start_line,
                                    "end_line": row.end_line,
                                    "anchor_context": row.anchor_context,
                                    "body": row.body,
                                    "author": row.author,
                                    "created_at": row.created_at,
                                    "updated_at": row.updated_at,
                                }
                            )
                            total_synced += 1
                        except Exception as e:
                            total_errors += 1
                            print(f"Error syncing {row.annotation_id}: {e}")
                    
                    await local_conn.commit()
                
                offset += batch_size
                
                if len(rows) < batch_size:
                    break
    finally:
        await neon_engine.dispose()
        await local_engine.dispose()
    
    print(f"\nSync complete: {total_synced} synced, {total_errors} errors")
    return total_errors == 0


async def main():
    parser = argparse.ArgumentParser(description="Sync code_annotations from Neon to local")
    parser.add_argument("--neon-url", help="Neon database URL")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size (default: 100)")
    args = parser.parse_args()
    
    # 加载配置
    config_path = Path(__file__).parent.parent / "config" / "settings.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)
    
    storage_cfg = config.get("storage", {})
    
    # 本地数据库 URL
    local_cfg = storage_cfg.get("code_annotation", {})
    local_url = local_cfg.get("database_url", "")
    
    if not local_url:
        print("ERROR: code_annotation.database_url not configured")
        return 1
    
    # Neon 数据库 URL
    neon_url = args.neon_url or DEFAULT_NEON_URL
    
    success = await sync_annotations(neon_url, local_url, args.batch_size)
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))