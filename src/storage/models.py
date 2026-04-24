"""邮件数据模型 — SQLAlchemy ORM + Pydantic 数据校验。"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Boolean, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, TSVECTOR
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


# ============================================================
# SQLAlchemy ORM 模型
# ============================================================

class Base(DeclarativeBase):
    """SQLAlchemy 声明式基类。"""
    pass


class TagORM(Base):
    """知识标签本体。"""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    parent_tag_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=True, index=True
    )
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#6366f1")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    tag_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="topic", index=True)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    updated_by: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # 自关联：父标签 -> 子标签
    children: Mapped[list["TagORM"]] = relationship(
        "TagORM", back_populates="parent", cascade="all, delete-orphan"
    )
    parent: Mapped[Optional["TagORM"]] = relationship(
        "TagORM", back_populates="children", remote_side=[id]
    )
    aliases: Mapped[list["TagAliasORM"]] = relationship(
        "TagAliasORM", back_populates="tag", cascade="all, delete-orphan"
    )
    assignments: Mapped[list["TagAssignmentORM"]] = relationship(
        "TagAssignmentORM", back_populates="tag", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("slug", name="uq_tags_slug"),
        UniqueConstraint("name", name="uq_tags_name"),
    )

    def __repr__(self) -> str:
        return f"<TagORM id={self.id} slug={self.slug!r} name={self.name!r}>"


class TagAliasORM(Base):
    """标签别名。"""

    __tablename__ = "tag_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tag_id: Mapped[int] = mapped_column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True)
    alias: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )

    tag: Mapped["TagORM"] = relationship("TagORM", back_populates="aliases")


class TagAssignmentORM(Base):
    """标签和目标对象之间的绑定。"""

    __tablename__ = "tag_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    assignment_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    tag_id: Mapped[int] = mapped_column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_ref: Mapped[str] = mapped_column(String(1024), nullable=False, index=True)
    anchor: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    anchor_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    assignment_scope: Mapped[str] = mapped_column(String(32), nullable=False, default="direct", index=True)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manual", index=True)
    evidence: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )

    tag: Mapped["TagORM"] = relationship("TagORM", back_populates="assignments")

    __table_args__ = (
        UniqueConstraint(
            "tag_id",
            "target_type",
            "target_ref",
            "anchor_hash",
            name="uq_tag_assignments_target",
        ),
        Index("ix_tag_assignments_lookup", "target_type", "target_ref"),
    )


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

    # 全文搜索向量列 — 由触发器或应用层维护
    search_vector: Mapped[Optional[str]] = mapped_column(
        TSVECTOR, nullable=True
    )

    __table_args__ = (
        UniqueConstraint("message_id", name="uq_emails_message_id"),
        Index("ix_emails_search_vector", "search_vector", postgresql_using="gin"),
        Index("ix_emails_list_thread", "list_name", "thread_id"),
    )

    def __repr__(self) -> str:
        return f"<EmailORM message_id={self.message_id!r} subject={self.subject[:50]!r}>"


# ============================================================
# 批注 ORM 模型
# ============================================================

class AnnotationORM(Base):
    """统一批注 ORM 模型。

    设计目标：
    - 标注本体统一：正文、作者、回复关系、时间戳
    - 标注目标统一：target_type + target_ref + target_label/subtitle
    - 标注锚点统一：anchor JSON，容纳行号、message_id、页面范围等
    - 兼容现有邮件/代码场景，同时能自然扩展到 SDM spec 等新目标
    """

    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    annotation_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)

    # 类型标识（当前主要用于 UI 分类；未来可扩展如 sdm_spec/manual）
    annotation_type: Mapped[str] = mapped_column(String(32), nullable=False, default="email")

    # 公共字段
    author: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    parent_annotation_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # 通用目标与锚点
    target_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_ref: Mapped[str] = mapped_column(String(1024), nullable=False, index=True)
    target_label: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    target_subtitle: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    anchor: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # 便捷冗余字段：便于当前邮件/代码查询与前端兼容
    thread_id: Mapped[str] = mapped_column(String(512), nullable=False, default="", index=True)
    in_reply_to: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    version: Mapped[str] = mapped_column(String(32), nullable=True, index=True)
    file_path: Mapped[str] = mapped_column(String(512), nullable=True, index=True)
    start_line: Mapped[int] = mapped_column(Integer, nullable=True)
    end_line: Mapped[int] = mapped_column(Integer, nullable=True)
    anchor_context: Mapped[str] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        UniqueConstraint("annotation_id", name="uq_annotations_annotation_id"),
        Index("ix_annotations_type", "annotation_type"),
        Index("ix_annotations_target", "target_type", "target_ref"),
        Index("ix_annotations_code", "version", "file_path"),
    )

    def __repr__(self) -> str:
        return f"<AnnotationORM id={self.id} annotation_id={self.annotation_id!r} type={self.annotation_type}>"


# ============================================================
# Pydantic 数据校验模型
# ============================================================

class TagCreate(BaseModel):
    """创建标签时的输入模型。"""

    name: str = Field(..., min_length=1, max_length=128, description="标签名称")
    slug: str = Field("", description="稳定 slug；为空时自动生成")
    description: str = Field("", description="标签说明")
    parent_tag_id: Optional[int] = Field(None, description="父标签 ID（用于层级标签）")
    color: str = Field("#6366f1", pattern=r"^#[0-9A-Fa-f]{6}$", description="标签颜色")
    status: str = Field("active", description="active | deprecated | draft")
    tag_kind: str = Field("topic", description="标签语义分类")
    aliases: list[str] = Field(default_factory=list, description="标签别名")
    created_by: str = Field("me", description="创建者")

    model_config = {"from_attributes": True}


class TagAliasRead(BaseModel):
    id: int
    alias: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TagRead(BaseModel):
    """查询标签时的输出模型。"""

    id: int
    slug: str
    name: str
    description: str = ""
    parent_tag_id: Optional[int] = None
    color: str
    status: str
    tag_kind: str
    aliases: list[str] = Field(default_factory=list)
    created_by: str = "me"
    updated_by: str = "me"
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TagTree(BaseModel):
    """树形标签结构（用于前端展示）。"""

    id: int
    slug: str
    name: str
    description: str = ""
    color: str
    status: str = "active"
    tag_kind: str = "topic"
    assignment_count: int = 0
    children: list["TagTree"] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class TagAssignmentCreate(BaseModel):
    tag_id: Optional[int] = None
    tag_slug: str = ""
    tag_name: str = ""
    target_type: str = Field(..., min_length=1, max_length=64)
    target_ref: str = Field(..., min_length=1, max_length=1024)
    anchor: dict = Field(default_factory=dict)
    assignment_scope: str = Field("direct")
    source_type: str = Field("manual")
    evidence: dict = Field(default_factory=dict)
    created_by: str = Field("me")

    model_config = {"from_attributes": True}


class TagAssignmentRead(BaseModel):
    id: int
    assignment_id: str
    tag_id: int
    tag_slug: str
    tag_name: str
    target_type: str
    target_ref: str
    anchor: dict = Field(default_factory=dict)
    anchor_hash: str = ""
    assignment_scope: str = "direct"
    source_type: str = "manual"
    evidence: dict = Field(default_factory=dict)
    created_by: str = "me"
    created_at: datetime

    model_config = {"from_attributes": True}


class TagBundle(BaseModel):
    direct_tags: list[TagRead] = Field(default_factory=list)
    inherited_tags: list[TagRead] = Field(default_factory=list)
    aggregated_tags: list[TagRead] = Field(default_factory=list)

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
    tags: list[str] = Field(default_factory=list)
    rank: float = 0.0  # 全文搜索排名分数
    snippet: str = ""  # 匹配片段

    model_config = {"from_attributes": True}


class AnnotationCreate(BaseModel):
    """创建批注时的输入模型。"""

    annotation_type: str = Field("email", description="批注类型：'email' | 'code'")
    body: str = Field(..., min_length=1, description="批注正文（支持 Markdown）")
    author: str = Field("", description="批注作者")
    parent_annotation_id: str = Field("", description="父批注 ID，支持回复")

    target_type: str = Field("", description="标注目标类型，如 email_thread / kernel_file / sdm_spec")
    target_ref: str = Field("", description="目标唯一引用，如 thread_id 或 version:path")
    target_label: str = Field("", description="目标主标题")
    target_subtitle: str = Field("", description="目标副标题")
    anchor: dict = Field(default_factory=dict, description="通用锚点，例如 message_id/line/page")

    # 便捷字段：邮件
    thread_id: str = Field("", description="所属线程 ID（email 类型）")
    in_reply_to: str = Field("", description="目标位置，例如 message_id")

    # 便捷字段：代码
    version: str = Field("", description="内核版本 tag（code 类型）")
    file_path: str = Field("", description="文件相对路径（code 类型）")
    start_line: int = Field(0, ge=0, description="起始行号（code 类型）")
    end_line: int = Field(0, ge=0, description="结束行号（code 类型）")
    meta: dict = Field(default_factory=dict, description="通用扩展元数据，用于承载 target/anchor 等")

    model_config = {"from_attributes": True}


class AnnotationUpdate(BaseModel):
    """更新批注时的输入模型。"""

    body: str = Field(..., min_length=1, description="批注正文（支持 Markdown）")

    model_config = {"from_attributes": True}


class AnnotationRead(BaseModel):
    """查询批注时的输出模型。"""

    id: int
    annotation_id: str
    annotation_type: str
    author: str
    body: str
    parent_annotation_id: str = ""
    created_at: datetime
    updated_at: datetime

    target_type: str = ""
    target_ref: str = ""
    target_label: str = ""
    target_subtitle: str = ""
    anchor: dict = Field(default_factory=dict)

    # 便捷字段
    thread_id: str = ""
    in_reply_to: str = ""
    version: str = ""
    file_path: str = ""
    start_line: int = 0
    end_line: int = 0
    meta: dict = Field(default_factory=dict)

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
    )
