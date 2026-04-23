#!/usr/bin/env python3
"""迁移脚本：为 code_annotations 表添加 in_reply_to 字段
"""
import asyncio
import logging
from pathlib import Path
import sys
import yaml

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

# 添加项目根目录到 Python 路径
project_root = Path(__file__).resolve().parent
sys.path.insert(0, str(project_root))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    logger.info("开始迁移...")
    
    # 加载配置
    config_path = project_root / "config" / "settings.yaml"
    if not config_path.exists():
        logger.error(f"配置文件不存在: {config_path}")
        return 1

    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}

    storage_cfg = config.get("storage", {})
    
    # 读取 code_annotation 数据库配置
    code_annot_cfg = storage_cfg.get("code_annotation", {})
    database_url = code_annot_cfg.get("database_url")
    
    if not database_url:
        logger.error("storage.code_annotation.database_url 未配置")
        return 1
    
    # 创建数据库引擎
    engine = create_async_engine(database_url)
    
    async with engine.connect() as conn:
        # 检查字段是否已存在
        result = await conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'code_annotations' AND column_name = 'in_reply_to'"
        ))
        
        if result.scalar():
            logger.info("✅ in_reply_to 字段已存在，跳过迁移")
            return 0
        
        # 添加字段
        logger.info("正在添加 in_reply_to 字段...")
        await conn.execute(text(
            "ALTER TABLE code_annotations ADD COLUMN in_reply_to VARCHAR(64)"
        ))
        
        # 添加索引
        logger.info("正在添加索引...")
        await conn.execute(text(
            "CREATE INDEX idx_code_annotations_in_reply_to ON code_annotations(in_reply_to)"
        ))
        
        await conn.commit()
        logger.info("✅ 迁移完成：成功添加 in_reply_to 字段和索引")
        
        # 验证
        result = await conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'code_annotations' AND column_name = 'in_reply_to'"
        ))
        if result.scalar():
            logger.info("✅ 字段验证成功")
        else:
            logger.error("❌ 字段添加失败")
            return 1
    
    await engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))