"""文档解析层抽象接口。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PageContent:
    """单页提取结果。

    Attributes:
        page_num: 页码（从 0 开始）。
        text: 页面纯文本内容。
        tables: 该页检测到的表格列表，每个表格为二维字符串列表。
        images: 该页图片的元信息列表。
    """

    page_num: int
    text: str = ""
    tables: list[list[list[str]]] = field(default_factory=list)
    images: list[dict] = field(default_factory=list)


@dataclass
class TOCEntry:
    """目录/书签条目。

    Attributes:
        level: 层级深度（1=顶级）。
        title: 标题文本。
        page_num: 起始页码（从 0 开始）。
    """

    level: int
    title: str
    page_num: int


@dataclass
class SectionNode:
    """章节树节点。

    Attributes:
        level: 层级深度（1=Volume, 2=Chapter, 3=Section ...）。
        title: 节标题。
        number: 节编号（如 "3.2.1"）。
        page_start: 起始页码。
        page_end: 结束页码（含）。
        content: 该节的原始文本内容。
        tables: 该节包含的表格。
        children: 子节列表。
    """

    level: int
    title: str
    number: str = ""
    page_start: int = 0
    page_end: int = 0
    content: str = ""
    tables: list[list[list[str]]] = field(default_factory=list)
    children: list["SectionNode"] = field(default_factory=list)


class BaseManualParser(ABC):
    """手册解析器抽象基类。

    每种芯片手册（Intel SDM、ARM ARM 等）须实现此接口。
    """

    @abstractmethod
    def parse_toc(self, pdf_path: str) -> list[TOCEntry]:
        """解析 PDF 目录/书签，返回目录条目列表。"""
        ...

    @abstractmethod
    def build_section_tree(
        self, pdf_path: str, toc: list[TOCEntry]
    ) -> list[SectionNode]:
        """基于目录构建章节树，并填充每节的文本内容。"""
        ...

    @abstractmethod
    def parse(self, pdf_path: str) -> list[SectionNode]:
        """完整解析：提取目录 → 构建章节树 → 填充内容。

        Returns:
            顶层章节节点列表。
        """
        ...