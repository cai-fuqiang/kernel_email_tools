#!/usr/bin/env python3
"""端到端数据入库与索引构建脚本。

整合采集 → 解析 → 入库 → 索引全流程。

用法:
    # 采集 linux-mm epoch 0 并入库（限100条测试）
    python scripts/index.py --list linux-mm --epoch 0 --limit 100

    # 采集所有 epoch 并入库
    python scripts/index.py --list linux-mm --all-epochs

    # 仅重建全文索引（不采集）
    python scripts/index.py --rebuild-fulltext

    # 查看数据库统计
    python scripts/index.py --stats
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.collector.git_collector import GitCollector
from src.parser.email_parser import EmailParser
from src.parser.thread_builder import ThreadBuilder
from src.storage.postgres import PostgresStorage
from src.storage.models import parsed_email_to_create
from src.indexer.fulltext import FulltextIndexer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def load_config() -> dict:
    """从 config/settings.yaml 加载配置。"""
    config_path = PROJECT_ROOT / "config" / "settings.yaml"
    if config_path.exists():
        with open(config_path, "r") as f:
            return yaml.safe_load(f) or {}
    return {}


async def run_collect_and_store(args, config: dict) -> None:
    """采集 → 解析 → 入库 → 索引 全流程。"""
    collector_cfg = config.get("collector", {})
    storage_cfg = config.get("storage", {})

    # 初始化组件
    collector = GitCollector(
        base_url=collector_cfg.get("base_url", "https://lore.kernel.org"),
        data_dir=collector_cfg.get("data_dir", "./data/repos"),
    )
    email_parser = EmailParser()
    storage = PostgresStorage(
        database_url=storage_cfg.get("database_url"),
        pool_size=storage_cfg.get("pool_size", 5),
    )
    fulltext_indexer = FulltextIndexer(
        database_url=storage_cfg.get("database_url"),
    )

    try:
        # 1. 初始化数据库
        await storage.init_db()
        logger.info("Database initialized")

        # 2. 确定 epoch 范围
        epochs = (
            range(collector.get_epoch_count(args.list))
            if args.all_epochs
            else [args.epoch]
        )

        total_saved = 0
        for epoch in epochs:
            logger.info("=== Processing %s epoch %d ===", args.list, epoch)

            # 采集
            raw_emails = collector.collect(args.list, epoch, limit=args.limit)
            logger.info("Collected %d raw emails", len(raw_emails))

            # 解析
            parsed_emails = email_parser.parse_batch(raw_emails)
            logger.info("Parsed %d emails", len(parsed_emails))

            # 转换为入库模型
            email_creates = [parsed_email_to_create(e) for e in parsed_emails]

            # 入库（自动去重）
            saved = await storage.save_emails(email_creates)
            total_saved += saved
            logger.info("Saved %d new emails to database", saved)

        # 3. 构建/回填全文索引
        indexed = await fulltext_indexer.build(list_name=args.list)
        logger.info("Fulltext index: %d emails indexed", indexed)

        # 4. 显示统计
        count = await storage.get_email_count(args.list)
        logger.info("=== Done === Total emails in DB for %s: %d", args.list, count)

    finally:
        await storage.close()


async def run_rebuild_fulltext(config: dict) -> None:
    """仅重建全文索引。"""
    storage_cfg = config.get("storage", {})
    indexer = FulltextIndexer(database_url=storage_cfg.get("database_url"))
    count = await indexer.build(rebuild=True)
    logger.info("Fulltext index rebuilt: %d emails", count)


async def run_stats(config: dict) -> None:
    """显示数据库和索引统计信息。"""
    storage_cfg = config.get("storage", {})
    storage = PostgresStorage(
        database_url=storage_cfg.get("database_url"),
        pool_size=1,
    )
    indexer = FulltextIndexer(database_url=storage_cfg.get("database_url"), pool_size=1)

    try:
        count = await storage.get_email_count()
        ft_stats = await indexer.get_stats()
        logger.info("=== Database Stats ===")
        logger.info("Total emails: %d", count)
        logger.info("Fulltext index: %s", ft_stats)
    finally:
        await storage.close()


def main() -> None:
    """主函数。"""
    config = load_config()

    parser = argparse.ArgumentParser(description="数据入库与索引构建")
    parser.add_argument("--list", help="邮件列表名称")
    parser.add_argument("--epoch", type=int, default=0, help="epoch 编号")
    parser.add_argument("--all-epochs", action="store_true", help="处理所有 epoch")
    parser.add_argument("--limit", type=int, default=0, help="每个 epoch 最大采集数量")
    parser.add_argument("--rebuild-fulltext", action="store_true", help="重建全文索引")
    parser.add_argument("--stats", action="store_true", help="显示统计信息")
    args = parser.parse_args()

    if args.stats:
        asyncio.run(run_stats(config))
    elif args.rebuild_fulltext:
        asyncio.run(run_rebuild_fulltext(config))
    elif args.list:
        asyncio.run(run_collect_and_store(args, config))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
