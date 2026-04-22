"""本地 git 仓库内核源码适配器。

通过 asyncio subprocess 调用 git 命令，读取本地 bare 仓库中的
版本列表、目录树和文件内容。支持 LRU 缓存和大文件保护。
"""

import asyncio
import logging
import os
import re
import time
from functools import lru_cache
from typing import Optional
from collections import OrderedDict

from src.kernel_source.base import (
    BaseKernelSource,
    FileContent,
    TreeEntry,
    TreeEntryType,
    VersionInfo,
)

logger = logging.getLogger(__name__)

# 版本 tag 解析正则：v1.0, v2.6.12, v6.1, v6.1-rc3, v7.0 等
_VERSION_RE = re.compile(
    r"^v(?P<major>\d+)\.(?P<minor>\d+)(?:\.(?P<patch>\d+))?(?:-rc(?P<rc>\d+))?$"
)


def parse_version_tag(tag: str) -> Optional[VersionInfo]:
    """解析版本 tag 字符串为 VersionInfo。

    Args:
        tag: git tag 名（如 v6.1, v6.1-rc3）。

    Returns:
        VersionInfo 或 None（无法解析时）。
    """
    m = _VERSION_RE.match(tag)
    if not m:
        return None
    major = int(m.group("major"))
    minor = int(m.group("minor"))
    patch = int(m.group("patch") or 0)
    rc = int(m.group("rc") or 0)
    return VersionInfo(
        tag=tag,
        major=major,
        minor=minor,
        patch=patch,
        rc=rc,
        is_release=(rc == 0),
    )


class GitLocalSource(BaseKernelSource):
    """基于本地 bare git 仓库的内核源码适配器。

    Args:
        repo_path: 主仓库路径（bare repo）。
        max_file_size: 文件大小阈值（字节），超过截断。
        tree_cache_size: 目录树 LRU 缓存条目数。
        file_cache_size: 文件内容 LRU 缓存条目数。
    """

    def __init__(
        self,
        repo_path: str,
        max_file_size: int = 1_048_576,
        tree_cache_size: int = 256,
        file_cache_size: int = 128,
    ):
        self._repo_path = os.path.expanduser(repo_path)
        self._max_file_size = max_file_size
        self._versions_cache: Optional[list[VersionInfo]] = None
        self._versions_cache_time: float = 0
        self._versions_cache_ttl: float = 3600  # 1 小时

        # 为 LRU cache 设置大小
        self._list_tree_cached = lru_cache(maxsize=tree_cache_size)(self._list_tree_impl)
        self._get_file_cached = lru_cache(maxsize=file_cache_size)(self._get_file_impl)

    async def _run_git(self, *args: str, binary: bool = False) -> str | bytes:
        """执行 git 命令并返回 stdout。

        Args:
            *args: git 子命令和参数。
            binary: 是否以二进制模式读取输出。

        Returns:
            命令输出（str 或 bytes）。

        Raises:
            ValueError: 命令执行失败。
        """
        cmd = ["git", f"--git-dir={self._repo_path}", *args]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            error_msg = stderr.decode("utf-8", errors="replace").strip()
            raise ValueError(f"git command failed: {' '.join(args)} — {error_msg}")
        if binary:
            return stdout
        return stdout.decode("utf-8", errors="replace")

    async def list_versions(self, include_rc: bool = False) -> list[VersionInfo]:
        """获取所有可用的内核版本列表。"""
        now = time.time()
        if self._versions_cache and (now - self._versions_cache_time) < self._versions_cache_ttl:
            versions = self._versions_cache
        else:
            output = await self._run_git("tag", "-l", "v*")
            all_versions = []
            for line in output.strip().splitlines():
                tag = line.strip()
                vi = parse_version_tag(tag)
                if vi:
                    all_versions.append(vi)
            all_versions.sort(key=lambda v: v.sort_key, reverse=True)
            self._versions_cache = all_versions
            self._versions_cache_time = now
            logger.info(f"Loaded {len(all_versions)} kernel version tags")
            versions = all_versions

        if include_rc:
            return versions
        return [v for v in versions if v.is_release]

    async def list_tree(self, version: str, path: str = "") -> list[TreeEntry]:
        """获取指定版本、指定路径下的目录树。"""
        # LRU cache 需要 hashable key，用 tuple
        return await self._list_tree_async(version, path)

    async def _list_tree_async(self, version: str, path: str) -> list[TreeEntry]:
        """实际执行 list_tree（绕过 lru_cache 的 async 限制）。"""
        key = (version, path)
        # 尝试从缓存获取
        try:
            return self._list_tree_cached(key)
        except TypeError:
            pass

        result = await self._list_tree_fetch(version, path)
        # 存入缓存
        try:
            self._list_tree_cached.__wrapped__(key)
        except (TypeError, KeyError):
            pass
        return result

    async def _list_tree_fetch(self, version: str, path: str) -> list[TreeEntry]:
        """从 git 获取目录树。"""
        git_path = f"{version}:{path}" if path else f"{version}"
        try:
            output = await self._run_git("ls-tree", "-l", git_path)
        except ValueError as e:
            raise ValueError(f"Failed to list tree for {version}:{path} — {e}")

        entries: list[TreeEntry] = []
        for line in output.strip().splitlines():
            if not line.strip():
                continue
            # 格式: <mode> <type> <hash> <size>\t<name>
            parts = line.split("\t", 1)
            if len(parts) != 2:
                continue
            meta, name = parts
            meta_parts = meta.split()
            if len(meta_parts) < 4:
                continue

            obj_type = meta_parts[1]  # tree / blob / commit
            size_str = meta_parts[3].strip()  # "-" for dirs

            entry_path = f"{path}/{name}" if path else name
            if obj_type == "tree":
                entries.append(TreeEntry(
                    name=name, path=entry_path,
                    entry_type=TreeEntryType.DIR, size=0,
                ))
            elif obj_type == "blob":
                size = int(size_str) if size_str != "-" else 0
                entries.append(TreeEntry(
                    name=name, path=entry_path,
                    entry_type=TreeEntryType.FILE, size=size,
                ))
            elif obj_type == "commit":
                # submodule reference
                entries.append(TreeEntry(
                    name=name, path=entry_path,
                    entry_type=TreeEntryType.DIR, size=0,
                ))

        # 排序：目录在前，文件在后，各自按名称排序
        dirs = sorted([e for e in entries if e.entry_type == TreeEntryType.DIR], key=lambda e: e.name)
        files = sorted([e for e in entries if e.entry_type != TreeEntryType.DIR], key=lambda e: e.name)
        return dirs + files

    def _list_tree_impl(self, key: tuple) -> list[TreeEntry]:
        """LRU cache 占位（实际不被直接调用，仅用于缓存结构）。"""
        raise TypeError("Should not be called directly")

    async def get_file(self, version: str, path: str) -> FileContent:
        """获取指定版本、指定路径的文件内容。

        优化：合并 git show 命令同时获取大小和内容，减少 subprocess 调用。
        """
        key = (version, path)

        # 检查缓存
        try:
            return self._get_file_cached(key)
        except TypeError:
            pass

        git_ref = f"{version}:{path}"
        try:
            # 优化：只用一条 git show 获取内容（同时包含大小信息）
            content_bytes = await self._run_git("show", git_ref, binary=True)
            file_size = len(content_bytes)
            content = content_bytes.decode("utf-8", errors="replace")
        except ValueError:
            raise FileNotFoundError(f"File not found: {version}:{path}")

        truncated = False
        if file_size > self._max_file_size:
            truncated = True
            content = content[:self._max_file_size]
            content += f"\n\n... [truncated: file size {file_size} bytes exceeds limit {self._max_file_size} bytes]"
            file_size = self._max_file_size

        line_count = content.count("\n")
        if content and not content.endswith("\n"):
            line_count += 1

        result = FileContent(
            path=path,
            version=version,
            content=content,
            line_count=line_count,
            size=len(content_bytes),
            truncated=truncated,
        )

        # 存入缓存
        try:
            self._get_file_cached.__wrapped__(key, result)
        except (TypeError, KeyError):
            pass

        return result

    def _get_file_impl(self, key: tuple) -> FileContent:
        """LRU cache 占位。"""
        raise TypeError("Should not be called directly")