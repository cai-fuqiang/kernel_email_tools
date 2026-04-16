#!/usr/bin/env python3
"""数据采集入口脚本。

用法:
    python scripts/collect.py --list linux-mm --epoch 0
    python scripts/collect.py --list linux-mm --all-epochs
"""

import argparse
import logging
import sys
from pathlib import Path

import yaml

# 添加项目根目录到 Python 路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.collector.git_collector import GitCollector
from src.parser.email_parser import EmailParser
from src.parser.thread_builder import ThreadBuilder

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


def main() -> None:
    """主函数：解析参数并执行采集流程。"""
    config = load_config()
    collector_cfg = config.get("collector", {})

    parser = argparse.ArgumentParser(description="采集内核邮件列表数据")
    parser.add_argument("--list", required=True, help="邮件列表名称，如 linux-mm")
    parser.add_argument("--epoch", type=int, default=0, help="epoch 编号（默认 0）")
    parser.add_argument("--all-epochs", action="store_true", help="采集所有 epoch")
    parser.add_argument(
        "--data-dir",
        default=collector_cfg.get("data_dir", "./data/repos"),
        help="本地仓库存储路径（默认从 settings.yaml 读取）",
    )
    parser.add_argument(
        "--base-url",
        default=collector_cfg.get("base_url", "https://lore.kernel.org"),
        help="lore 基础 URL",
    )
    args = parser.parse_args()

    collector = GitCollector(base_url=args.base_url, data_dir=args.data_dir)
    email_parser = EmailParser()
    thread_builder = ThreadBuilder()

    epochs = range(collector.get_epoch_count(args.list)) if args.all_epochs else [args.epoch]

    all_parsed = []
    for epoch in epochs:
        logger.info("=== Collecting %s epoch %d ===", args.list, epoch)

        # 1. 采集原始邮件
        raw_emails = collector.collect(args.list, epoch)
        logger.info("Raw emails collected: %d", len(raw_emails))

        # 2. 解析邮件
        parsed_emails = email_parser.parse_batch(raw_emails)
        logger.info("Parsed emails: %d", len(parsed_emails))
        all_parsed.extend(parsed_emails)

        # 统计
        patch_count = sum(1 for e in parsed_emails if e.has_patch)
        logger.info("Emails with patches: %d", patch_count)

    # 3. 构建线程
    if all_parsed:
        threads = thread_builder.build_threads(all_parsed)
        logger.info("=== Summary ===")
        logger.info("Total emails: %d", len(all_parsed))
        logger.info("Total threads: %d", len(threads))
        logger.info("Top 5 threads by size:")
        for t in threads[:5]:
            logger.info("  [%d emails] %s", t.email_count, t.subject[:80])


if __name__ == "__main__":
    main()
