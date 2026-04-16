#!/usr/bin/env python3
"""API 服务启动入口脚本。

用法:
    python scripts/serve.py
    python scripts/serve.py --host 0.0.0.0 --port 8000
    python scripts/serve.py --reload  # 开发模式
"""

import argparse
import logging
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def main() -> None:
    """解析参数并启动 uvicorn 服务。"""
    parser = argparse.ArgumentParser(description="启动内核邮件知识库 API 服务")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0）")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000）")
    parser.add_argument("--reload", action="store_true", help="启用热重载（开发模式）")
    parser.add_argument("--workers", type=int, default=1, help="工作进程数")
    args = parser.parse_args()

    try:
        import uvicorn
    except ImportError:
        logger.error("uvicorn not installed. Run: pip install uvicorn")
        sys.exit(1)

    logger.info(
        "Starting API server at http://%s:%d (reload=%s, workers=%d)",
        args.host, args.port, args.reload, args.workers,
    )
    uvicorn.run(
        "src.api.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        workers=args.workers,
        log_level="info",
    )


if __name__ == "__main__":
    main()