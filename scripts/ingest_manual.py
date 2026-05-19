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
from collections.abc import Mapping
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from sqlalchemy.exc import IntegrityError

from src.parser.intel_sdm.parser import IntelSDMParser
from src.chunker.pipeline import ChunkPipeline
from src.storage.document_store import DocumentStorage
import yaml

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


class ProgressReporter:
    """统一打印手册导入的总体进度和当前章节进度。"""

    PARSING_START = 0.0
    PARSING_END = 45.0
    CHUNKING_END = 65.0
    STORING_END = 100.0

    def log(self, percent: float, message: str) -> None:
        clamped = max(0, min(100, round(percent)))
        logger.info("[%3d%%] %s", clamped, message)

    def start_import(self, manual_type: str, pdf_path: Path) -> None:
        self.log(self.PARSING_START, f"Start import: {manual_type} {pdf_path}")

    def toc_extracted(self, toc_count: int) -> None:
        self.log(8, f"TOC extracted: {toc_count} entries")

    def section_progress(self, payload: Mapping[str, object]) -> None:
        current_section = int(payload["current_section"])
        total_sections = max(int(payload["total_sections"]), 1)
        percent = self.PARSING_START + (current_section / total_sections) * (
            self.PARSING_END - self.PARSING_START
        )
        self.log(
            percent,
            "Parsing section "
            f"{current_section}/{total_sections}: "
            f"{payload['section_title']} "
            f"(pages {payload['page_start']}-{payload['page_end']})",
        )

    def section_parsing_complete(self, total_sections: int, total_nodes: int) -> None:
        self.log(
            self.PARSING_END,
            f"Section parsing complete: {total_sections} roots, {total_nodes} total sections",
        )

    def chunking_complete(self, chunk_count: int) -> None:
        self.log(self.CHUNKING_END, f"Chunking complete: {chunk_count} chunks")

    def storing_progress(self, stored_chunks: int, total_chunks: int) -> None:
        if total_chunks <= 0:
            self.log(self.STORING_END, "Storing skipped: no chunks to store")
            return
        percent = self.CHUNKING_END + (stored_chunks / total_chunks) * (
            self.STORING_END - self.CHUNKING_END
        )
        self.log(percent, f"Storing chunks: {stored_chunks}/{total_chunks}")

    def import_complete(self, stored_chunks: int, *, stored: bool) -> None:
        if stored:
            self.log(self.STORING_END, f"Import complete: stored {stored_chunks} chunks")
        else:
            self.log(self.STORING_END, f"Import complete: generated {stored_chunks} chunks")


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

    reporter = ProgressReporter()
    reporter.start_import(args.manual_type, pdf_path)

    # 1. 解析 PDF → 章节树
    logger.info("=== Step 1: Parsing PDF ===")
    sdm_parser = IntelSDMParser()
    toc = sdm_parser.parse_toc(str(pdf_path))
    logger.info("TOC entries: %d", len(toc))
    reporter.toc_extracted(len(toc))

    # 如果限制页数，过滤 TOC
    if args.max_pages > 0:
        toc = [e for e in toc if e.page_num < args.max_pages]
        logger.info("TOC entries (filtered to %d pages): %d", args.max_pages, len(toc))

    sections = sdm_parser.build_section_tree(
        str(pdf_path),
        toc,
        progress_callback=reporter.section_progress,
    )
    total_nodes = _count_nodes(sections)
    logger.info("Section tree: %d roots, %d total nodes", len(sections), total_nodes)
    reporter.section_parsing_complete(len(sections), total_nodes)

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
    reporter.chunking_complete(len(chunks))

    # 3. 统计输出
    logger.info("=== Step 3: Statistics ===")
    ChunkPipeline.print_stats(chunks)

    # 4. 可选：存储到数据库
    if args.store:
        logger.info("=== Step 4: Storing to Database ===")
        await _store_chunks(
            chunks,
            args.manual_type,
            args.manual_version,
            args.drop_existing,
            reporter=reporter,
        )

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

    reporter.import_complete(len(chunks), stored=args.store)


def _count_nodes(sections) -> int:
    count = 0
    for s in sections:
        count += 1
        count += _count_nodes(s.children)
    return count


def _is_duplicate_chunk_error(exc: IntegrityError) -> bool:
    message = str(getattr(exc, "orig", exc))
    return (
        "ix_document_chunks_chunk_id" in message
        or "duplicate key value violates unique constraint" in message
        and "chunk_id" in message
    )


async def _store_chunks(chunks, manual_type, manual_version, drop_existing, reporter: ProgressReporter):
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
        try:
            await storage.insert_chunks(batch)
        except IntegrityError as exc:
            await storage.close()
            if _is_duplicate_chunk_error(exc):
                scope = f"manual_type={manual_type!r}, manual_version={manual_version!r}"
                raise RuntimeError(
                    "Duplicate document chunk IDs detected while storing PDF chunks. "
                    "This usually means the same PDF content has already been imported for "
                    f"{scope}. Re-run with --drop-existing to replace the existing chunks "
                    "for that import scope, or change --manual-type/--manual-version if "
                    "you intended to store this PDF as a separate document."
                ) from exc
            raise
        total_stored += len(batch)
        logger.info("Stored batch %d-%d/%d", i + 1, min(i + batch_size, len(chunks)), len(chunks))
        reporter.storing_progress(total_stored, len(chunks))

    logger.info("Total stored: %d chunks", total_stored)

    # 统计
    stats = await storage.get_stats()
    logger.info("Database stats: %s", stats)

    await storage.close()


if __name__ == "__main__":
    import asyncio
    try:
        asyncio.run(main())
    except RuntimeError as exc:
        logger.error("%s", exc)
        sys.exit(1)
