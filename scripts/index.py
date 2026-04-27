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
from itertools import islice

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.collector.git_collector import GitCollector
from src.parser.email_parser import EmailParser
from src.parser.thread_builder import ThreadBuilder
from src.storage.postgres import PostgresStorage
from src.storage.models import parsed_email_to_create
from src.indexer.email_chunks import EmailChunkIndexer
from src.indexer.email_vector import EmailVectorIndexer
from src.indexer.fulltext import FulltextIndexer
from src.qa.providers import DashScopeEmbeddingProvider, resolve_api_key

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
    collector_cfg = config.get("email_collector", {})
    storage_cfg = config.get("storage", {}).get("email", {})
    database_url = storage_cfg.get("database_url")
    if not database_url:
        logger.error("email storage database_url not configured")
        return

    # 初始化组件
    collector = GitCollector(
        base_url=collector_cfg.get("base_url", "https://lore.kernel.org"),
        data_dir=collector_cfg.get("data_dir", "./data/repos"),
    )
    email_parser = EmailParser()
    storage = PostgresStorage(
        database_url=database_url,
        pool_size=storage_cfg.get("pool_size", 5),
    )
    fulltext_indexer = FulltextIndexer(
        database_url=database_url,
    )

    try:
        # 1. 初始化数据库
        await storage.init_db()
        logger.info("Database initialized")
        fulltext_index_dropped = False
        if not args.keep_fulltext_index:
            await fulltext_indexer.drop_index()
            fulltext_index_dropped = True

        # 2. 确定 epoch 范围
        epochs = (
            range(collector.get_epoch_count(args.list))
            if args.all_epochs
            else [args.epoch]
        )

        total_collected = 0
        total_parsed = 0
        total_saved = 0
        trigger_disabled = await storage.set_email_search_trigger_enabled(False)
        for epoch in epochs:
            logger.info("=== Processing %s epoch %d ===", args.list, epoch)

            raw_iter = collector.collect_iter(args.list, epoch, limit=args.limit)
            epoch_collected = 0
            epoch_parsed = 0
            epoch_saved = 0
            while True:
                raw_batch = list(islice(raw_iter, args.ingest_batch_size))
                if not raw_batch:
                    break

                epoch_collected += len(raw_batch)
                total_collected += len(raw_batch)

                parsed_emails = email_parser.parse_batch(raw_batch)
                epoch_parsed += len(parsed_emails)
                total_parsed += len(parsed_emails)

                email_creates = [parsed_email_to_create(e) for e in parsed_emails]
                saved = await storage.save_emails(email_creates, batch_size=args.db_batch_size)
                epoch_saved += saved
                total_saved += saved

                logger.info(
                    "Ingest progress %s epoch %d: collected=%d parsed=%d saved_new=%d",
                    args.list, epoch, epoch_collected, epoch_parsed, epoch_saved,
                )

            logger.info(
                "Epoch %d done: collected=%d parsed=%d saved_new=%d",
                epoch, epoch_collected, epoch_parsed, epoch_saved,
            )

        # 3. 构建/回填全文索引
        indexed = await fulltext_indexer.build(list_name=args.list)
        logger.info("Fulltext index: %d emails indexed", indexed)
        if trigger_disabled:
            await storage.set_email_search_trigger_enabled(True)
            trigger_disabled = False
        if fulltext_index_dropped:
            await fulltext_indexer.create_index()
            fulltext_index_dropped = False

        # 4. RAG 索引很重，默认不在采集命令里构建，避免 LKML 大 epoch 导入被向量化拖慢。
        if args.rebuild_rag_index:
            await run_rebuild_rag_index(config, list_name=args.list, limit=args.limit or None)
        elif args.build_chunks:
            await run_build_chunks(config, list_name=args.list)
        elif args.build_vector:
            await run_build_vector(config, list_name=args.list, limit=args.limit or None)

        # 5. 显示统计
        count = await storage.get_email_count(args.list)
        logger.info(
            "=== Done === collected=%d parsed=%d saved_new=%d total emails in DB for %s: %d",
            total_collected, total_parsed, total_saved, args.list, count,
        )

    finally:
        try:
            if "trigger_disabled" in locals() and trigger_disabled:
                await storage.set_email_search_trigger_enabled(True)
        except Exception:
            pass
        try:
            if "fulltext_index_dropped" in locals() and fulltext_index_dropped:
                await fulltext_indexer.create_index()
        except Exception:
            logger.exception("Failed to recreate fulltext index after interrupted ingest")
        await storage.close()


async def run_rebuild_fulltext(config: dict) -> None:
    """仅重建全文索引。"""
    storage_cfg = config.get("storage", {}).get("email", {})
    database_url = storage_cfg.get("database_url")
    if not database_url:
        logger.error("email storage database_url not configured")
        return
    indexer = FulltextIndexer(database_url=database_url)
    count = await indexer.build(rebuild=True)
    logger.info("Fulltext index rebuilt: %d emails", count)


async def run_build_chunks(config: dict, list_name: str | None = None) -> None:
    """构建邮件 RAG chunks。"""
    storage_cfg = config.get("storage", {}).get("email", {})
    database_url = storage_cfg.get("database_url")
    if not database_url:
        logger.error("email storage database_url not configured")
        return
    storage = PostgresStorage(database_url=database_url, pool_size=storage_cfg.get("pool_size", 5))
    try:
        await storage.init_db()
        count = await EmailChunkIndexer(storage).rebuild(list_name=list_name)
        logger.info("Email chunks rebuilt: %d", count)
    finally:
        await storage.close()


async def run_build_vector(config: dict, list_name: str | None = None, limit: int | None = None) -> None:
    """构建邮件 RAG vector index。"""
    storage_cfg = config.get("storage", {}).get("email", {})
    vector_cfg = config.get("indexer", {}).get("vector", {})
    qa_cfg = config.get("qa", {}).get("email", {})
    database_url = storage_cfg.get("database_url")
    if not database_url:
        logger.error("email storage database_url not configured")
        return
    if vector_cfg.get("provider", "dashscope") != "dashscope":
        logger.error("Only dashscope embedding provider is implemented")
        return
    api_key = resolve_api_key(
        "dashscope",
        vector_cfg.get("api_key", "") or qa_cfg.get("api_key", ""),
    )
    if not api_key:
        logger.error("DashScope API key is required for vector indexing")
        return

    storage = PostgresStorage(database_url=database_url, pool_size=storage_cfg.get("pool_size", 5))
    provider = DashScopeEmbeddingProvider(
        api_key=api_key,
        model=vector_cfg.get("model", "text-embedding-v3"),
        dimension=vector_cfg.get("dimension", 1536),
    )
    try:
        await storage.init_db()
        count = await EmailVectorIndexer(
            storage=storage,
            provider=provider,
            provider_name="dashscope",
            batch_size=vector_cfg.get("batch_size", 16),
        ).build(list_name=list_name, limit=limit)
        logger.info("Email vector embeddings built: %d", count)
    finally:
        await storage.close()


async def run_rebuild_rag_index(config: dict, list_name: str | None = None, limit: int | None = None) -> None:
    """重建邮件 RAG chunk + vector index。"""
    await run_build_chunks(config, list_name=list_name)
    await run_build_vector(config, list_name=list_name, limit=limit)


async def run_stats(config: dict) -> None:
    """显示数据库和索引统计信息。"""
    storage_cfg = config.get("storage", {}).get("email", {})
    database_url = storage_cfg.get("database_url")
    if not database_url:
        logger.error("email storage database_url not configured")
        return
    storage = PostgresStorage(
        database_url=database_url,
        pool_size=1,
    )
    indexer = FulltextIndexer(database_url=database_url, pool_size=1)

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
    parser.add_argument("--ingest-batch-size", type=int, default=5000, help="采集/解析/入库流水线批大小")
    parser.add_argument("--db-batch-size", type=int, default=2000, help="数据库批量 INSERT 大小")
    parser.add_argument("--keep-fulltext-index", action="store_true", help="导入时保留全文 GIN 索引（更安全但更慢）")
    parser.add_argument("--rebuild-fulltext", action="store_true", help="重建全文索引")
    parser.add_argument("--build-chunks", action="store_true", help="构建邮件 RAG chunks")
    parser.add_argument("--build-vector", action="store_true", help="构建邮件 RAG 向量索引")
    parser.add_argument("--rebuild-rag-index", action="store_true", help="重建邮件 RAG chunks 和向量索引")
    parser.add_argument("--stats", action="store_true", help="显示统计信息")
    args = parser.parse_args()

    if args.stats:
        asyncio.run(run_stats(config))
    elif args.rebuild_fulltext:
        asyncio.run(run_rebuild_fulltext(config))
    elif args.build_chunks:
        asyncio.run(run_build_chunks(config, list_name=args.list))
    elif args.build_vector:
        asyncio.run(run_build_vector(config, list_name=args.list, limit=args.limit or None))
    elif args.rebuild_rag_index:
        asyncio.run(run_rebuild_rag_index(config, list_name=args.list, limit=args.limit or None))
    elif args.list:
        asyncio.run(run_collect_and_store(args, config))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
