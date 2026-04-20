"""数据采集入口脚本。

用法:
    # 从 lore.kernel.org 采集（默认）
    python scripts/collect.py --list linux-mm --epoch 0
    python scripts/collect.py --list linux-mm --all-epochs
    python scripts/collect.py --list linux-mm --epoch 0 --limit 100

    # 从本地目录采集多个 channel
    python scripts/collect.py --all-channels --local
    python scripts/collect.py --list kvm --local --epoch 0
    python scripts/collect.py --list linux-mm --local --all-epochs
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
    collector_cfg = config.get("email_collector", {})

    parser = argparse.ArgumentParser(description="采集内核邮件列表数据")
    parser.add_argument("--list", help="邮件列表名称，如 linux-mm, kvm, lkml")
    parser.add_argument("--epoch", type=int, default=0, help="epoch 编号（默认 0）")
    parser.add_argument("--all-epochs", action="store_true", help="采集所有 epoch")
    parser.add_argument("--limit", type=int, default=0, help="每个 epoch 最大采集数量（0=不限制）")
    parser.add_argument(
        "--data-dir",
        default=collector_cfg.get("data_dir", "./data/repos"),
        help="本地仓库存储路径（默认从 settings.yaml 读取）",
    )
    parser.add_argument(
        "--base-url",
        default=collector_cfg.get("base_url", "https://lore.kernel.org"),
        help="lore 基础 URL（local 模式下忽略）",
    )
    parser.add_argument(
        "--local",
        action="store_true",
        help="使用本地目录模式，从 settings.yaml 的 local_channels 配置读取",
    )
    parser.add_argument(
        "--all-channels",
        action="store_true",
        help="采集所有配置的本地 channel（需配合 --local 使用）",
    )
    args = parser.parse_args()

    # 获取 local_channels 配置
    local_channels = collector_cfg.get("local_channels", [])

    # 验证参数
    if args.all_channels and not args.local:
        parser.error("--all-channels 必须配合 --local 使用")

    if args.all_channels and not local_channels:
        logger.error("settings.yaml 中未配置 local_channels，请先添加配置")
        return

    if not args.list and not args.all_channels:
        parser.error("必须指定 --list 或使用 --all-channels")

    # 构建 collector 实例
    collector = GitCollector(base_url=args.base_url, data_dir=args.data_dir)
    email_parser = EmailParser()
    thread_builder = ThreadBuilder()

    # 确定要采集的 channel 列表
    if args.all_channels:
        channels_to_collect = [(ch["name"], ch["path"]) for ch in local_channels]
    else:
        # 单一 channel，优先使用命令行指定路径，否则使用默认 data_dir
        list_name = args.list
        channel_path = None
        for ch in local_channels:
            if ch["name"] == list_name:
                channel_path = ch.get("path")
                break
        channels_to_collect = [(list_name, channel_path)]

    # 执行采集
    all_total = 0
    for list_name, channel_path in channels_to_collect:
        # 如果指定了 channel 路径，设置 collector 的 data_dir
        if channel_path:
            collector.data_dir = Path(channel_path)
            logger.info("Using local path: %s", channel_path)

        # 确定要采集的 epochs
        if args.all_epochs:
            epoch_count = collector.get_epoch_count(list_name)
            if epoch_count == 0:
                logger.warning("无法获取 %s 的 epoch 数量，跳过", list_name)
                continue
            epochs = range(epoch_count)
        else:
            epochs = [args.epoch]

        logger.info("=== Processing channel: %s ===", list_name)

        for epoch in epochs:
            logger.info("=== Collecting %s epoch %d ===", list_name, epoch)

            # 1. 采集原始邮件
            raw_emails = collector.collect(list_name, epoch, limit=args.limit)
            logger.info("Raw emails collected: %d", len(raw_emails))

            # 2. 解析邮件
            parsed_emails = email_parser.parse_batch(raw_emails)
            logger.info("Parsed emails: %d", len(parsed_emails))

            # 统计
            patch_count = sum(1 for e in parsed_emails if e.has_patch)
            logger.info("Emails with patches: %d", patch_count)

            # 3. 构建线程（可选，这里仅做统计）
            if parsed_emails:
                threads = thread_builder.build_threads(parsed_emails)
                logger.info("Threads built: %d", len(threads))
                all_total += len(parsed_emails)

        # 恢复默认 data_dir（为下一个 channel 准备）
        if channel_path:
            collector.data_dir = Path(args.data_dir)

    logger.info("=== 总计采集邮件数: %d ===", all_total)


if __name__ == "__main__":
    main()
