"""分片层抽象接口与核心数据模型。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional

import tiktoken


class ContentType(str, Enum):
    """分片内容类型。"""

    TEXT = "text"                # 普通文本段落
    TABLE = "table"             # 表格
    INSTRUCTION = "instruction"  # 指令参考页
    REGISTER = "register"       # 寄存器位域
    PSEUDOCODE = "pseudocode"   # 伪代码块
    FIGURE = "figure"           # 图+说明


@dataclass
class DocumentChunk:
    """文档分片 — 通用数据模型，手册无关。

    Attributes:
        chunk_id: 唯一标识（manual_type:section:seq）。
        manual_type: 手册类型标识。
        manual_version: 手册版本号。
        volume: 卷标识。
        chapter: 章标识。
        section: 节编号。
        section_title: 节标题。
        content_type: 内容类型。
        content: 文本内容。
        context_prefix: 层级路径前缀，用于检索增强。
        page_start: 起始页码。
        page_end: 结束页码。
        token_count: token 数量。
        metadata: 扩展元数据。
        content_zh: 中文翻译缓存。
        translated_at: 翻译时间。
    """

    chunk_id: str = ""
    manual_type: str = ""
    manual_version: str = ""
    volume: str = ""
    chapter: str = ""
    section: str = ""
    section_title: str = ""
    content_type: ContentType = ContentType.TEXT
    content: str = ""
    context_prefix: str = ""
    page_start: int = 0
    page_end: int = 0
    token_count: int = 0
    metadata: dict = field(default_factory=dict)
    content_zh: str = ""
    translated_at: Optional[datetime] = None


# ============================================================
# Token 计数工具
# ============================================================

_tokenizer_cache: dict[str, tiktoken.Encoding] = {}


def count_tokens(text: str, model: str = "cl100k_base") -> int:
    """计算文本的 token 数量。"""
    if model not in _tokenizer_cache:
        _tokenizer_cache[model] = tiktoken.get_encoding(model)
    return len(_tokenizer_cache[model].encode(text))


# ============================================================
# 抽象接口
# ============================================================

class BaseChunker(ABC):
    """分片器抽象基类。"""

    @abstractmethod
    def split(self, content: str, **kwargs) -> list[DocumentChunk]:
        """将内容切分为分片列表。"""
        ...


class BaseSectionChunker(ABC):
    """L1 章节分片器接口。"""

    @abstractmethod
    def split_sections(self, sections, **kwargs) -> list[DocumentChunk]:
        """将章节树切分为初始分片。"""
        ...


class BaseContentTypeChunker(ABC):
    """L2 内容类型分片器接口。"""

    @abstractmethod
    def split_by_type(self, chunk: DocumentChunk) -> list[DocumentChunk]:
        """按内容类型对单个分片进行差异化再切分。"""
        ...