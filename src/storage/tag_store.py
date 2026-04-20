"""标签存储层 — 标签的 CRUD 操作。"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.storage.models import TagORM, TagTree

logger = logging.getLogger(__name__)

# 单封邮件最大标签数
MAX_TAGS_PER_EMAIL = 16


class TagStore:
    """标签存储管理。

    提供标签的创建、查询、删除等操作，支持父子层级。

    Attributes:
        session: 异步数据库会话。
    """

    def __init__(self, session: AsyncSession):
        """初始化 TagStore。

        Args:
            session: SQLAlchemy 异步会话。
        """
        self.session = session

    async def create_tag(
        self,
        name: str,
        parent_id: Optional[int] = None,
        color: str = "#6366f1",
    ) -> TagORM:
        """创建标签。

        Args:
            name: 标签名称。
            parent_id: 父标签 ID（可选，用于层级标签）。
            color: 标签颜色（十六进制）。

        Returns:
            创建的标签 ORM 实例。

        Raises:
            ValueError: 标签名已存在。
        """
        # 检查标签名是否已存在
        existing = await self.session.execute(
            select(TagORM).where(TagORM.name == name)
        )
        if existing.scalar_one_or_none():
            raise ValueError(f"Tag '{name}' already exists")

        # 检查父标签是否存在
        if parent_id is not None:
            parent = await self.session.get(TagORM, parent_id)
            if not parent:
                raise ValueError(f"Parent tag {parent_id} not found")

        tag = TagORM(
            name=name,
            parent_id=parent_id,
            color=color,
            created_at=datetime.utcnow(),
        )
        self.session.add(tag)
        await self.session.commit()
        await self.session.refresh(tag)
        logger.info(f"Created tag: {tag.name} (id={tag.id})")
        return tag

    async def get_tag(self, tag_id: int) -> Optional[TagORM]:
        """获取标签。

        Args:
            tag_id: 标签 ID。

        Returns:
            标签 ORM 实例，不存在则返回 None。
        """
        return await self.session.get(TagORM, tag_id)

    async def get_tag_by_name(self, name: str) -> Optional[TagORM]:
        """根据名称获取标签。

        Args:
            name: 标签名称。

        Returns:
            标签 ORM 实例，不存在则返回 None。
        """
        result = await self.session.execute(
            select(TagORM).where(TagORM.name == name)
        )
        return result.scalar_one_or_none()

    async def get_all_tags(self) -> list[TagORM]:
        """获取所有标签。

        Returns:
            标签列表。
        """
        result = await self.session.execute(
            select(TagORM).order_by(TagORM.name)
        )
        return list(result.scalars().all())

    async def get_tag_tree(self) -> list[TagTree]:
        """获取标签树形结构。

        Returns:
            树形标签列表，父标签在前，子标签嵌套在 children 中。
        """
        all_tags = await self.get_all_tags()

        # 构建 ID -> TagTree 映射
        tag_map: dict[int, TagTree] = {}
        for tag in all_tags:
            tag_map[tag.id] = TagTree(
                id=tag.id,
                name=tag.name,
                color=tag.color,
                children=[],
            )

        # 构建树形结构
        root_tags: list[TagTree] = []
        for tag in all_tags:
            node = tag_map[tag.id]
            if tag.parent_id is None:
                root_tags.append(node)
            else:
                parent = tag_map.get(tag.parent_id)
                if parent:
                    parent.children.append(node)

        return root_tags

    async def delete_tag(self, tag_id: int) -> bool:
        """删除标签。

        会级联删除所有子标签。

        Args:
            tag_id: 标签 ID。

        Returns:
            删除成功返回 True，标签不存在返回 False。
        """
        tag = await self.session.get(TagORM, tag_id)
        if not tag:
            return False

        # 级联删除子标签（通过外键 ON DELETE CASCADE）
        await self.session.delete(tag)
        await self.session.commit()
        logger.info(f"Deleted tag: {tag.name} (id={tag_id})")
        return True

    async def get_or_create_tag(
        self,
        name: str,
        parent_id: Optional[int] = None,
        color: str = "#6366f1",
    ) -> TagORM:
        """获取或创建标签。

        如果标签已存在则返回现有标签，否则创建新标签。

        Args:
            name: 标签名称。
            parent_id: 父标签 ID（可选）。
            color: 标签颜色。

        Returns:
            标签 ORM 实例。
        """
        existing = await self.get_tag_by_name(name)
        if existing:
            return existing
        return await self.create_tag(name, parent_id, color)

    async def update_tag(
        self,
        tag_id: int,
        name: Optional[str] = None,
        color: Optional[str] = None,
        parent_id: Optional[int] = None,
    ) -> Optional[TagORM]:
        """更新标签。

        Args:
            tag_id: 标签 ID。
            name: 新标签名称（可选）。
            color: 新颜色（可选）。
            parent_id: 新父标签 ID（可选，设为 None 表示移除父标签）。

        Returns:
            更新后的标签，不存在则返回 None。

        Raises:
            ValueError: 新名称已存在或父标签不存在。
        """
        tag = await self.session.get(TagORM, tag_id)
        if not tag:
            return None

        if name is not None and name != tag.name:
            # 检查新名称是否已存在
            existing = await self.get_tag_by_name(name)
            if existing and existing.id != tag_id:
                raise ValueError(f"Tag '{name}' already exists")
            tag.name = name

        if color is not None:
            tag.color = color

        if parent_id is not None:
            # 检查父标签是否存在
            parent = await self.session.get(TagORM, parent_id)
            if not parent:
                raise ValueError(f"Parent tag {parent_id} not found")
            # 防止循环引用
            if parent_id == tag_id:
                raise ValueError("Tag cannot be its own parent")
            tag.parent_id = parent_id
        elif parent_id is not None:
            tag.parent_id = None

        await self.session.commit()
        await self.session.refresh(tag)
        return tag