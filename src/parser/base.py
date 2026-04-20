"""文档解析层抽象接口。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


# ============================================================
# 邮件解析器接口和数据类
# ============================================================

@dataclass
class ParsedEmail:
    """解析后的邮件数据。

    Attributes:
        message_id: 邮件唯一标识。
        subject: 邮件主题。
        sender: 发件人（格式: "Name <email>"）。
        date: 发送时间。
        in_reply_to: 回复目标 Message-ID。
        references: 线程引用链。
        body: 清洗后的邮件正文。
        body_raw: 原始邮件正文。
        patch_content: 提取的补丁内容（无则为""）。
        has_patch: 是否包含补丁。
        list_name: 邮件列表名称。
        thread_id: 线程根 ID。
        epoch: epoch 编号。
    """

    message_id: str
    subject: str = ""
    sender: str = ""
    date: Optional[datetime] = None
    in_reply_to: str = ""
    references: list[str] = field(default_factory=list)
    body: str = ""
    body_raw: str = ""
    patch_content: str = ""
    has_patch: bool = False
    list_name: str = ""
    thread_id: str = ""
    epoch: int = 0


class BaseParser(ABC):
    """邮件解析器抽象基类。

    所有邮件解析器须实现此接口。
    """

    @abstractmethod
    def parse(self, raw_email) -> Optional[ParsedEmail]:
        """解析原始邮件。

        Args:
            raw_email: 采集层输出的原始邮件。

        Returns:
            解析成功返回 ParsedEmail，失败返回 None。
        """
        ...


# ============================================================
# 手册解析器接口和数据类
# ============================================================


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