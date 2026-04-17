#!/usr/bin/env python3
"""芯片手册数据导入入口脚本 — 解析 PDF → 分片 → 存储 → 统计输出。

用法:
    python scripts/ingest_manual.py --pdf ./manuals/intel_sdm/sdm.pdf
    python scripts/ingest_manual.py --pdf ./manuals/intel_sdm/sdm.pdf --max-pages 100
    python scripts/ingest_manual.py --pdf ./manuals/intel_sdm/sdm.pdf --sample 5
"""

import argparse
import logging
import sys
import textwrap
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.parser.intel_sdm.parser import IntelSDMParser
from src.chunker.pipeline import ChunkPipeline
from src.storage.document_store import DocumentStorage
import yaml

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def _load_config() -> dict:
    """加载配置文件。"""
    config_path = PROJECT_ROOT / "config" / "settings.yaml"
    if config_path.exists():
        with open(config_path, "r") as f:
            return yaml.safe_load(f) or {}
    return {}


async def main() -> None:
    parser = argparse.ArgumentParser(description="解析芯片手册 PDF 并执行分片")
    parser.add_argument("--pdf", required=True, help="PDF 文件路径")
    parser.add_argument("--manual-type", default="intel_sdm", help="手册类型标识")
    parser.add_argument("--manual-version", default="", help="手册版本号")
    parser.add_argument("--max-pages", type=int, default=0, help="最大解析页数（0=不限）")
    parser.add_argument("--target-tokens", type=int, default=512, help="L2 段落目标 token")
    parser.add_argument("--max-tokens", type=int, default=1024, help="L3 过长阈值")
    parser.add_argument("--min-tokens", type=int, default=128, help="L3 过短阈值")
    parser.add_argument("--sample", type=int, default=0, help="打印前 N 个分片内容（0=不打印）")
    parser.add_argument("--store", action="store_true", help="是否存储到数据库")
    parser.add_argument("--drop-existing", action="store_true", help="是否删除现有数据")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        logger.error("PDF file not found: %s", pdf_path)
        sys.exit(1)

    # 1. 解析 PDF → 章节树
    logger.info("=== Step 1: Parsing PDF ===")
    sdm_parser = IntelSDMParser()
    toc = sdm_parser.parse_toc(str(pdf_path))
    logger.info("TOC entries: %d", len(toc))

    # 如果限制页数，过滤 TOC
    if args.max_pages > 0:
        toc = [e for e in toc if e.page_num < args.max_pages]
        logger.info("TOC entries (filtered to %d pages): %d", args.max_pages, len(toc))

    sections = sdm_parser.build_section_tree(str(pdf_path), toc)
    total_nodes = _count_nodes(sections)
    logger.info("Section tree: %d roots, %d total nodes", len(sections), total_nodes)

    # 2. 分片管线
    logger.info("=== Step 2: Chunking ===")
    pipeline = ChunkPipeline(
        manual_type=args.manual_type,
        manual_version=args.manual_version,
        target_tokens=args.target_tokens,
        max_tokens=args.max_tokens,
        min_tokens=args.min_tokens,
    )
    chunks = pipeline.process(sections)

    # 3. 统计输出
    logger.info("=== Step 3: Statistics ===")
    ChunkPipeline.print_stats(chunks)

    # 4. 可选：存储到数据库
    if args.store:
        logger.info("=== Step 4: Storing to Database ===")
        await _store_chunks(chunks, args.manual_type, args.manual_version, args.drop_existing)

    # 5. 可选：打印示例分片
    if args.sample > 0:
        print(f"\n--- Sample chunks (first {args.sample}) ---\n")
        for i, chunk in enumerate(chunks[: args.sample]):
            print(f"[{i+1}] id={chunk.chunk_id}")
            print(f"    type={chunk.content_type.value}  tokens={chunk.token_count}")
            print(f"    section={chunk.section} title={chunk.section_title}")
            print(f"    pages={chunk.page_start}-{chunk.page_end}")
            preview = textwrap.shorten(chunk.content, width=200, placeholder="...")
            print(f"    content: {preview}")
            print()


def _count_nodes(sections) -> int:
    count = 0
    for s in sections:
        count += 1
        count += _count_nodes(s.children)
    return count


async def _store_chunks(chunks, manual_type, manual_version, drop_existing):
    """存储分片到数据库。"""
    config = _load_config()
    storage_cfg = config.get("storage", {}).get("manual", {})
    database_url = storage_cfg.get("database_url")

    if not database_url:
        logger.error("Manual storage not configured in settings.yaml")
        return

    storage = DocumentStorage(database_url=database_url)
    await storage.init_db()

    # 删除现有数据（如果指定）
    if drop_existing:
        deleted = await storage.delete_chunks_by_manual(manual_type, manual_version)
        logger.info("Deleted %d existing chunks", deleted)

    # 批量存储
    batch_size = 100
    total_stored = 0
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        await storage.insert_chunks(batch)
        total_stored += len(batch)
        logger.info("Stored batch %d-%d/%d", i + 1, min(i + batch_size, len(chunks)), len(chunks))

    logger.info("Total stored: %d chunks", total_stored)

    # 统计
    stats = await storage.get_stats()
    logger.info("Database stats: %s", stats)

    await storage.close()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())