"""存储层抽象接口。"""

from abc import ABC, abstractmethod
from typing import Optional

from src.storage.models import EmailCreate, EmailRead, EmailSearchResult


class BaseStorage(ABC):
    """存储层抽象基类。

    所有存储后端（PostgreSQL、SQLite、Elasticsearch 等）须实现此接口。
    """

    @abstractmethod
    async def init_db(self) -> None:
        """初始化数据库（创建表、索引等）。"""
        ...

    @abstractmethod
    async def save_emails(self, emails: list[EmailCreate]) -> int:
        """批量保存邮件，基于 message_id 去重。

        Args:
            emails: 待保存的邮件列表。

        Returns:
            实际新增的邮件数量。
        """
        ...

    @abstractmethod
    async def get_email(self, message_id: str) -> Optional[EmailRead]:
        """根据 message_id 获取单封邮件。

        Args:
            message_id: 邮件唯一标识。

        Returns:
            邮件数据，不存在返回 None。
        """
        ...

    @abstractmethod
    async def get_thread(self, thread_id: str) -> list[EmailRead]:
        """获取线程内所有邮件。

        Args:
            thread_id: 线程根 Message-ID。

        Returns:
            该线程下的邮件列表，按时间排序。
        """
        ...

    @abstractmethod
    async def search_fulltext(
        self, query: str, list_name: Optional[str] = None,
        page: int = 1, page_size: int = 50,
    ) -> tuple[list[EmailSearchResult], int]:
        """全文搜索邮件。

        Args:
            query: 搜索关键词。
            list_name: 限定邮件列表，None 表示全部。
            page: 页码（从 1 开始）。
            page_size: 每页数量。

        Returns:
            (搜索结果列表, 总匹配数)。
        """
        ...

    @abstractmethod
    async def get_email_count(self, list_name: Optional[str] = None) -> int:
        """获取邮件总数。

        Args:
            list_name: 限定邮件列表，None 表示全部。

        Returns:
            邮件数量。
        """
        ...

    @abstractmethod
    async def close(self) -> None:
        """关闭连接和释放资源。"""
        ...
