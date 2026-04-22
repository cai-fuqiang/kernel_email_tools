"""内核源码浏览抽象接口。

定义版本列表、目录树、文件内容的统一接口契约，
实现类可替换（本地 git / 远端 HTTP / ...）。
"""

import abc
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class TreeEntryType(str, Enum):
    """目录树条目类型。"""
    DIR = "dir"
    FILE = "file"
    SYMLINK = "symlink"


@dataclass
class VersionInfo:
    """内核版本信息。

    Attributes:
        tag: git tag 名称（如 v6.1）。
        major: 主版本号。
        minor: 次版本号。
        patch: 补丁版本号（可选）。
        rc: rc 编号（0 表示正式发布）。
        is_release: 是否为正式发布版（非 rc）。
    """
    tag: str
    major: int = 0
    minor: int = 0
    patch: int = 0
    rc: int = 0
    is_release: bool = True

    @property
    def sort_key(self) -> tuple:
        """用于版本排序的 key（降序排列时取反）。"""
        return (self.major, self.minor, self.patch, 0 if self.is_release else 1, self.rc)


@dataclass
class TreeEntry:
    """目录树条目。

    Attributes:
        name: 文件/目录名。
        path: 相对于仓库根的完整路径。
        entry_type: 条目类型（dir/file/symlink）。
        size: 文件大小（字节，目录为 0）。
    """
    name: str
    path: str
    entry_type: TreeEntryType
    size: int = 0


@dataclass
class FileContent:
    """文件内容。

    Attributes:
        path: 文件路径。
        version: 所属版本。
        content: 文件文本内容。
        line_count: 总行数。
        size: 文件大小（字节）。
        truncated: 是否被截断（超过大小限制）。
    """
    path: str
    version: str
    content: str
    line_count: int = 0
    size: int = 0
    truncated: bool = False


class BaseKernelSource(abc.ABC):
    """内核源码数据源抽象基类。"""

    @abc.abstractmethod
    async def list_versions(self, include_rc: bool = False) -> list[VersionInfo]:
        """获取所有可用的内核版本列表。

        Args:
            include_rc: 是否包含 rc 版本。

        Returns:
            按版本号降序排列的版本信息列表。
        """

    @abc.abstractmethod
    async def list_tree(self, version: str, path: str = "") -> list[TreeEntry]:
        """获取指定版本、指定路径下的目录树。

        Args:
            version: 版本 tag（如 v6.1）。
            path: 相对路径（空字符串表示根目录）。

        Returns:
            目录树条目列表（目录在前，文件在后，各自按名称排序）。

        Raises:
            ValueError: 版本或路径不存在。
        """

    @abc.abstractmethod
    async def get_file(self, version: str, path: str) -> FileContent:
        """获取指定版本、指定路径的文件内容。

        Args:
            version: 版本 tag。
            path: 文件相对路径。

        Returns:
            文件内容对象。

        Raises:
            ValueError: 版本或文件不存在。
            FileNotFoundError: 文件路径不存在。
        """