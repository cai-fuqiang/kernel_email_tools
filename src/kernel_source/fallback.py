"""内核源码回退适配器。

当主数据源（本地 git）找不到指定版本时，自动回退到备用数据源（如 elixir.bootlin.com）。
"""

import logging

from src.kernel_source.base import (
    BaseKernelSource,
    FileContent,
    TreeEntry,
    VersionInfo,
)

logger = logging.getLogger(__name__)


class FallbackKernelSource(BaseKernelSource):
    """组合两个数据源，优先使用主源，失败时回退到备用源。

    Args:
        primary: 主数据源（如本地 git）。
        fallback: 备用数据源（如 elixir.bootlin.com）。
    """

    def __init__(self, primary: BaseKernelSource, fallback: BaseKernelSource):
        self._primary = primary
        self._fallback = fallback

    async def list_versions(self, include_rc: bool = False) -> list[VersionInfo]:
        """版本列表仅使用主数据源。"""
        return await self._primary.list_versions(include_rc)

    async def list_tree(self, version: str, path: str = "") -> list[TreeEntry]:
        """获取目录树，主源失败时回退到备用源。"""
        try:
            return await self._primary.list_tree(version, path)
        except ValueError as e:
            logger.info(f"Primary source failed for tree {version}:{path}, trying fallback — {e}")
            return await self._fallback.list_tree(version, path)

    async def get_file(self, version: str, path: str) -> FileContent:
        """获取文件内容，主源失败时回退到备用源。"""
        try:
            return await self._primary.get_file(version, path)
        except (ValueError, FileNotFoundError) as e:
            logger.info(f"Primary source failed for file {version}:{path}, trying fallback — {e}")
            return await self._fallback.get_file(version, path)
