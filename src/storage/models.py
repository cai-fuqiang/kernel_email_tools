"""邮件数据模型 — SQLAlchemy ORM + Pydantic 数据校验。"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Boolean,
    Index,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


# ============================================================
# SQLAlchemy ORM 模型
# ============================================================

class Base(DeclarativeBase):
    """SQLAlchemy 声明式基类。"""
    pass


class TagORM(Base):
    """标签 ORM 模型，对应 tags 表。

    支持父子层级（树形结构），通过 parent_id 自关联实现。
    """

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    parent_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=True, index=True
    )
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#6366f1")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )

    # 自关联：父标签 -> 子标签
    children: Mapped[list["TagORM"]] = relationship(
        "TagORM", back_populates="parent", cascade="all, delete-orphan"
    )
    parent: Mapped[Optional["TagORM"]] = relationship(
        "TagORM", back_populates="children", remote_side=[id]
    )

    __table_args__ = (
        UniqueConstraint("name", name="uq_tags_name"),
    )

    def __repr__(self) -> str:
        return f"<TagORM id={self.id} name={self.name!r}>"


class EmailORM(Base):
    """邮件 ORM 模型，对应 emails 表。"""

    __tablename__ = "emails"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = mapped_column(String(512), nullable=False, unique=True, index=True)
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sender: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    in_reply_to: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    references: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    body_raw: Mapped[str] = mapped_column(Text, nullable=False, default="")
    patch_content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    has_patch: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    list_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    thread_id: Mapped[str] = mapped_column(String(512), nullable=False, default="", index=True)
    epoch: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 标签列表（存储 tag name，最多 16 个）
    tags: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String), nullable=True)

    # 全文搜索向量列 — 由触发器或应用层维护
    search_vector: Mapped[Optional[str]] = mapped_column(
        TSVECTOR, nullable=True
    )

    __table_args__ = (
        UniqueConstraint("message_id", name="uq_emails_message_id"),
        Index("ix_emails_search_vector", "search_vector", postgresql_using="gin"),
        Index("ix_emails_list_thread", "list_name", "thread_id"),
        Index("ix_emails_tags", "tags", postgresql_using="gin"),
    )

    def __repr__(self) -> str:
        return f"<EmailORM message_id={self.message_id!r} subject={self.subject[:50]!r}>"


# ============================================================
# Pydantic 数据校验模型
# ============================================================

class TagCreate(BaseModel):
    """创建标签时的输入模型。"""

    name: str = Field(..., min_length=1, max_length=64, description="标签名称")
    parent_id: Optional[int] = Field(None, description="父标签 ID（用于层级标签）")
    color: str = Field("#6366f1", pattern=r"^#[0-9A-Fa-f]{6}$", description="标签颜色")

    model_config = {"from_attributes": True}


class TagRead(BaseModel):
    """查询标签时的输出模型。"""

    id: int
    name: str
    parent_id: Optional[int] = None
    color: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TagTree(BaseModel):
    """树形标签结构（用于前端展示）。"""

    id: int
    name: str
    color: str
    children: list["TagTree"] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class EmailCreate(BaseModel):
    """创建邮件时的输入模型。"""

    message_id: str
    subject: str = ""
    sender: str = ""
    date: Optional[datetime] = None
    in_reply_to: str = ""
    references: list[str] = Field(default_factory=list)
    body: str = ""
    body_raw: str = ""
    patch_content: str = ""
    has_patch: bool = False
    list_name: str = ""
    thread_id: str = ""
    epoch: int = 0
    tags: list[str] = Field(default_factory=list, description="标签列表，最多 16 个")

    model_config = {"from_attributes": True}


class EmailRead(BaseModel):
    """查询邮件时的输出模型。"""

    id: int
    message_id: str
    subject: str
    sender: str
    date: Optional[datetime]
    in_reply_to: str
    references: list[str]
    body: str
    body_raw: str = ""
    patch_content: str
    has_patch: bool
    list_name: str
    thread_id: str
    epoch: int
    tags: list[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class EmailSearchResult(BaseModel):
    """搜索结果条目。"""

    id: int
    message_id: str
    subject: str
    sender: str
    date: Optional[datetime]
    list_name: str
    thread_id: str
    has_patch: bool
    rank: float = 0.0  # 全文搜索排名分数
    snippet: str = ""  # 匹配片段

    model_config = {"from_attributes": True}


# ============================================================
# 辅助函数：ParsedEmail → EmailCreate 转换
# ============================================================

def parsed_email_to_create(parsed) -> EmailCreate:
    """将 parser 层的 ParsedEmail 转换为 storage 层的 EmailCreate。

    Args:
        parsed: ParsedEmail dataclass 实例。

    Returns:
        EmailCreate pydantic 模型实例。
    """
    return EmailCreate(
        message_id=parsed.message_id,
        subject=parsed.subject,
        sender=parsed.sender,
        date=parsed.date,
        in_reply_to=parsed.in_reply_to,
        references=parsed.references,
        body=parsed.body,
        body_raw=parsed.body_raw,
        patch_content=parsed.patch_content,
        has_patch=parsed.has_patch,
        list_name=parsed.list_name,
        thread_id=parsed.thread_id,
        epoch=parsed.epoch,
        tags=[],  # 新邮件默认无标签
    )
