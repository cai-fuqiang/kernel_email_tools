"""问答层抽象接口。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class SourceReference:
    """答案来源引用。

    Attributes:
        message_id: 邮件 Message-ID。
        subject: 邮件主题。
        sender: 发件人。
        date: 发送时间。
        snippet: 引用片段。
    """

    message_id: str
    subject: str = ""
    sender: str = ""
    date: str = ""
    snippet: str = ""


@dataclass
class Answer:
    """问答结果。

    Attributes:
        question: 原始问题。
        answer: 生成的回答文本。
        sources: 来源引用列表。
        model: 使用的 LLM 模型。
        retrieval_mode: 检索模式。
    """

    question: str
    answer: str = ""
    sources: list[SourceReference] = field(default_factory=list)
    model: str = ""
    retrieval_mode: str = ""


class BaseQA(ABC):
    """问答抽象基类。

    所有问答实现（RAG、直接 LLM 等）须实现此接口。
    """

    @abstractmethod
    async def ask(
        self,
        question: str,
        list_name: Optional[str] = None,
        sender: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        tags: Optional[list[str]] = None,
    ) -> Answer:
        """回答问题。

        Args:
            question: 用户问题。
            list_name: 限定邮件列表。
            sender: 发件人模糊匹配。
            date_from: 起始日期过滤。
            date_to: 结束日期过滤。
            tags: 标签列表过滤。

        Returns:
            包含回答和来源的 Answer 对象。
        """
        ...