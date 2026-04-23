#!/usr/bin/env python3
"""数据迁移脚本：将 code_annotations 数据迁移到统一 annotations 表。

从独立的 code_annotation 数据库读取所有标注，写入到主数据库的 annotations 表。
"""
import asyncio
import logging
from pathlib import Path
import sys
from typing import Optional
import uuid

# 添加项目根目录到 Python 路径
project_root = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(project_root))

import yaml
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from src.storage.annotation_store import AnnotationStore
from src.storage.models import AnnotationCreate

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    # 加载配置
    config_path = project_root / "config" / "settings.yaml"
    if not config_path.exists():
        logger.error(f"Config file not found: {config_path}")
        return 1

    with open(config_path, "r") as f:
        config = yaml.safe_load(f) or {}

    storage_cfg = config.get("storage", {})
    
    # 读取 code_annotation 数据库配置
    code_annot_cfg = storage_cfg.get("code_annotation", {})
    code_annot_url = code_annot_cfg.get("database_url", "")
    
    if not code_annot_url:
        logger.error("storage.code_annotation.database_url not configured in settings.yaml")
        return 1
    
    # 读取主数据库配置
    email_storage_cfg = storage_cfg.get("email", {})
    email_database_url = email_storage_cfg.get("database_url")
    
    if not email_database_url:
        logger.error("storage.email.database_url not configured in settings.yaml")
        return 1

    # 1. 连接 code_annotation 数据库读取所有标注
    logger.info(f"Connecting to code_annotation database: {code_annot_url}")
    code_engine = create_async_engine(
        code_annot_url,
        pool_size=2,
        echo=False,
    )
    
    async with code_engine.connect() as code_conn:
        # 读取所有 code_annotations
        logger.info("Reading all code annotations from source database...")
        result = await code_conn.execute(text("""
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
        code_annotations = result.mappings().all()
        logger.info(f"Found {len(code_annotations)} code annotations to migrate")

    await code_engine.dispose()

    if not code_annotations:
        logger.info("No code annotations to migrate, exiting.")
        return 0

    # 2. 连接主数据库并初始化 AnnotationStore
    email_engine = create_async_engine(
        email_database_url,
        pool_size=2,
        echo=False,
    )
    session_factory = sessionmaker(email_engine, class_=AsyncSession, expire_on_commit=False)
    annotation_store = AnnotationStore(session_factory=session_factory)

    # 3. 迁移标注
    migrated_count = 0
    skipped_count = 0
    error_count = 0

    for ann in code_annotations:
        try:
            # 检查是否已存在（避免重复迁移）
            async with session_factory() as session:
                existing = await session.execute(
                    text("SELECT id FROM annotations WHERE annotation_id = :aid"),
                    {"aid": ann["annotation_id"]}
                )
                if existing.scalar_one_or_none():
                    skipped_count += 1
                    continue

            # 创建新的统一 annotation
            annotation_create = AnnotationCreate(
                annotation_type="code",
                version=ann["version"],
                file_path=ann["file_path"],
                start_line=ann["start_line"],
                end_line=ann["end_line"],
                body=ann["body"],
                author=ann["author"] or "me",
                # 非必要字段留空
                thread_id="",
                in_reply_to="",
            )
            
            # 创建时使用原始 ID
            annotation_create.annotation_id = ann["annotation_id"]
            
            # 创建时手动设置时间戳
            created_annotation = await annotation_store.create(annotation_create)
            
            # 手动更新时间戳匹配原始
            async with session_factory() as session:
                await session.execute(
                    text("""
                        UPDATE annotations 
                        SET created_at = :created_at, updated_at = :updated_at
                        WHERE annotation_id = :aid
                    """),
                    {
                        "created_at": ann["created_at"],
                        "updated_at": ann["updated_at"],
                        "aid": created_annotation.annotation_id
                    }
                )
                await session.commit()

            migrated_count += 1
            if migrated_count % 100 == 0:
                logger.info(f"Migrated {migrated_count}/{len(code_annotations)} annotations")

        except Exception as e:
            logger.error(f"Failed to migrate annotation {ann['annotation_id']}: {str(e)}")
            error_count += 1

    await email_engine.dispose()

    # 4. 输出统计
    logger.info("=" * 50)
    logger.info(f"Migration completed:")
    logger.info(f"Total code annotations: {len(code_annotations)}")
    logger.info(f"Successfully migrated: {migrated_count}")
    logger.info(f"Skipped (already exists): {skipped_count}")
    logger.info(f"Failed: {error_count}")
    logger.info("=" * 50)

    return error_count


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))