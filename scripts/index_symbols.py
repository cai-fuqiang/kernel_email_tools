"""为指定 kernel 版本建立符号索引。"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from config.settings import load_config
from src.storage.postgres import PostgresStorage
from src.storage.symbol_store import KernelSymbolStore
from src.symbol_indexer.ctags import CtagsSymbolIndexer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Index kernel symbols for one version")
    parser.add_argument("--version", required=True, help="Kernel git tag, e.g. v6.1")
    parser.add_argument("--repo-path", default="", help="Override kernel bare repo path")
    parser.add_argument("--ctags-bin", default="ctags", help="ctags binary path")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    config = load_config()

    database_url = (
        config.get("storage", {})
        .get("email", {})
        .get("database_url", "")
    )
    if not database_url:
        raise RuntimeError("storage.email.database_url not configured")

    repo_path = args.repo_path or config.get("kernel_source", {}).get("repo_path", "")
    if not repo_path:
        raise RuntimeError("kernel_source.repo_path not configured")

    storage = PostgresStorage(database_url=database_url)
    await storage.init_db()

    try:
        indexer = CtagsSymbolIndexer(repo_path=repo_path, ctags_bin=args.ctags_bin)
        symbols = indexer.build_version_index(args.version)
        store = KernelSymbolStore(storage.session_factory)
        inserted = await store.replace_version(
            args.version,
            (symbol.to_row() for symbol in symbols),
        )
        print(f"Indexed {inserted} symbols for {args.version}")
    finally:
        await storage.close()


if __name__ == "__main__":
    asyncio.run(main())
