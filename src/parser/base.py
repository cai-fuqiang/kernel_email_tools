"""邮件解析层抽象接口。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from src.collector.base import RawEmail


@dataclass
class ParsedEmail:
    """解析后的结构化邮件数据。

    Attributes:
        message_id: 邮件唯一标识。
        subject: 邮件主题。
        sender: 发件人（"Name <email>" 格式）。
        date: 发送时间。
        in_reply_to: 回复目标的 Message-ID。
        references: 引用链中的所有 Message-ID。
        body: 纯文本正文（去除引用和签名后）。
        body_raw: 原始正文（未清洗）。
        patch_content: 提取的 diff/patch 内容。
        has_patch: 是否包含补丁。
        list_name: 邮件列表名称。
        thread_id: 线程根 Message-ID。
        epoch: 数据源 epoch 编号。
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

    负责将原始邮件数据解析为结构化的 ParsedEmail。
    """

    @abstractmethod
    def parse(self, raw_email: RawEmail) -> Optional[ParsedEmail]:
        """解析单封原始邮件。

        Args:
            raw_email: 采集层输出的原始邮件数据。

        Returns:
            解析成功返回 ParsedEmail，失败返回 None。
        """
        ...

    def parse_batch(self, raw_emails: list[RawEmail]) -> list[ParsedEmail]:
        """批量解析邮件。

        Args:
            raw_emails: 原始邮件列表。

        Returns:
            成功解析的 ParsedEmail 列表（跳过失败的）。
        """
        results = []
        for raw in raw_emails:
            parsed = self.parse(raw)
            if parsed:
                results.append(parsed)
        return results