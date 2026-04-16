"""数据采集层抽象接口。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class RawEmail:
    """从数据源采集到的原始邮件数据。

    Attributes:
        message_id: 邮件唯一标识（Message-ID 头）。
        raw_headers: 原始邮件头文本。
        raw_body: 原始邮件体文本。
        list_name: 邮件列表名称（如 linux-mm）。
        epoch: 数据源 epoch 编号。
        commit_hash: git 仓库中的 commit hash（git 数据源专有）。
    """

    message_id: str
    raw_headers: str
    raw_body: str
    list_name: str
    epoch: int = 0
    commit_hash: str = ""


@dataclass
class CollectResult:
    """采集结果统计。

    Attributes:
        list_name: 邮件列表名称。
        epoch: epoch 编号。
        total: 本次采集的邮件总数。
        new: 新增邮件数（去重后）。
        errors: 解析失败的数量。
    """

    list_name: str
    epoch: int
    total: int = 0
    new: int = 0
    errors: int = 0


class BaseCollector(ABC):
    """数据采集器抽象基类。

    所有数据源（git mirror、lore API、NNTP 等）须实现此接口。
    """

    @abstractmethod
    def collect(
        self,
        list_name: str,
        epoch: int = 0,
        since: Optional[datetime] = None,
    ) -> list[RawEmail]:
        """采集指定邮件列表的原始邮件数据。

        Args:
            list_name: 邮件列表名称，如 "linux-mm"。
            epoch: epoch 编号，0 为最早的存档。
            since: 增量采集起始时间，None 表示全量采集。

        Returns:
            采集到的原始邮件列表。
        """
        ...

    @abstractmethod
    def get_epoch_count(self, list_name: str) -> int:
        """获取指定邮件列表的 epoch 总数。

        Args:
            list_name: 邮件列表名称。

        Returns:
            epoch 总数。
        """
        ...