"""索引层抽象接口。"""

from abc import ABC, abstractmethod
from typing import Optional

from src.storage.models import EmailCreate


class BaseIndexer(ABC):
    """索引构建器抽象基类。

    全文索引和向量索引均实现此接口。
    """

    @abstractmethod
    async def build(
        self,
        list_name: Optional[str] = None,
        rebuild: bool = False,
    ) -> int:
        """构建或重建索引。

        Args:
            list_name: 限定邮件列表，None 表示全部。
            rebuild: 是否删除现有索引后重建。

        Returns:
            索引的邮件数量。
        """
        ...

    @abstractmethod
    async def update(self, emails: list[EmailCreate]) -> int:
        """增量更新索引。

        Args:
            emails: 新增或更新的邮件列表。

        Returns:
            更新的索引条目数量。
        """
        ...

    @abstractmethod
    async def get_stats(self) -> dict:
        """获取索引统计信息。

        Returns:
            包含索引状态的字典。
        """
        ...
