"""检索层抽象接口。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class SearchQuery:
    """检索查询参数。

    Attributes:
        text: 查询文本。
        list_name: 限定邮件列表。
        page: 页码（从 1 开始）。
        page_size: 每页数量。
        top_k: 语义检索 top-K 数量。
        sender: 发件人模糊匹配（可选）。
        date_from: 起始日期（ISO 格式，可选）。
        date_to: 结束日期（ISO 格式，可选）。
        has_patch: 是否必须包含补丁（可选）。
        tags: 标签列表（可选）。
        tag_mode: 标签匹配模式，"any"（任一匹配）或 "all"（全部匹配）。
    """

    text: str
    list_name: Optional[str] = None
    page: int = 1
    page_size: int = 50
    top_k: int = 20
    sender: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    has_patch: Optional[bool] = None
    tags: Optional[list[str]] = None
    tag_mode: str = "any"
    sort_by: str = ""       # "" 或 "relevance" 或 "date"
    sort_order: str = ""    # "" 或 "desc" 或 "asc"


@dataclass
class SearchHit:
    """单条检索结果。

    Attributes:
        message_id: 邮件 Message-ID。
        subject: 邮件主题。
        sender: 发件人。
        date: 发送时间字符串。
        list_name: 邮件列表名称。
        thread_id: 线程根 ID。
        has_patch: 是否包含补丁。
        tags: 邮件标签列表。
        score: 相关性分数。
        snippet: 匹配片段。
        source: 结果来源（keyword / semantic / hybrid）。
    """

    message_id: str
    subject: str = ""
    sender: str = ""
    date: str = ""
    list_name: str = ""
    thread_id: str = ""
    has_patch: bool = False
    tags: list[str] = field(default_factory=list)
    score: float = 0.0
    snippet: str = ""
    source: str = ""


@dataclass
class SearchResult:
    """检索结果集。

    Attributes:
        hits: 命中列表。
        total: 总匹配数。
        query: 原始查询文本。
        mode: 检索模式。
    """

    hits: list[SearchHit] = field(default_factory=list)
    total: int = 0
    query: str = ""
    mode: str = ""


class BaseRetriever(ABC):
    """检索器抽象基类。

    所有检索策略（关键词、语义、混合）须实现此接口。
    """

    @abstractmethod
    async def search(self, query: SearchQuery) -> SearchResult:
        """执行检索。

        Args:
            query: 检索查询参数。

        Returns:
            检索结果集。
        """
        ...