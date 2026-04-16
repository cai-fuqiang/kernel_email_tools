"""邮件线程树构建器，通过 In-Reply-To / References 重建对话结构。"""

import logging
from dataclasses import dataclass, field
from typing import Optional

from src.parser.base import ParsedEmail

logger = logging.getLogger(__name__)


@dataclass
class ThreadNode:
    """线程树节点。

    Attributes:
        email: 对应的解析后邮件。
        children: 子节点列表（回复邮件）。
        parent_id: 父节点 Message-ID。
    """

    email: ParsedEmail
    children: list["ThreadNode"] = field(default_factory=list)
    parent_id: str = ""


@dataclass
class Thread:
    """邮件线程。

    Attributes:
        thread_id: 线程根 Message-ID。
        subject: 线程主题（取根邮件的主题）。
        root: 线程树根节点。
        email_count: 线程中的邮件总数。
    """

    thread_id: str
    subject: str
    root: Optional[ThreadNode] = None
    email_count: int = 0


class ThreadBuilder:
    """邮件线程树构建器。

    通过 In-Reply-To 和 References 头信息重建邮件之间的回复关系。
    """

    def build_threads(self, emails: list[ParsedEmail]) -> list[Thread]:
        """从邮件列表构建线程树。

        Args:
            emails: 解析后的邮件列表。

        Returns:
            线程列表，每个线程包含完整的回复树。
        """
        # 按 message_id 建索引
        email_map: dict[str, ParsedEmail] = {e.message_id: e for e in emails}
        node_map: dict[str, ThreadNode] = {}

        # 为每封邮件创建节点
        for e in emails:
            node_map[e.message_id] = ThreadNode(
                email=e,
                parent_id=e.in_reply_to,
            )

        # 构建父子关系
        roots: list[ThreadNode] = []
        for mid, node in node_map.items():
            parent_id = node.parent_id
            if parent_id and parent_id in node_map:
                node_map[parent_id].children.append(node)
            else:
                roots.append(node)

        # 组装线程
        threads: list[Thread] = []
        for root_node in roots:
            count = self._count_nodes(root_node)
            threads.append(Thread(
                thread_id=root_node.email.message_id,
                subject=root_node.email.subject,
                root=root_node,
                email_count=count,
            ))

        # 按邮件数降序排列
        threads.sort(key=lambda t: t.email_count, reverse=True)
        logger.info(
            "Built %d threads from %d emails (%d root threads)",
            len(threads), len(emails), len(roots),
        )
        return threads

    def _count_nodes(self, node: ThreadNode) -> int:
        """递归计算节点数。"""
        return 1 + sum(self._count_nodes(child) for child in node.children)