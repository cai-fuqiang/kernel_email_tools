"""代码注释数据模型 — SQLAlchemy ORM + Pydantic 数据校验。

对应 code_annotations 表，用于存储内核代码的行级/范围级注释。
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field
from sqlalchemy import (
    Column,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from src.storage.models import Base


# ============================================================
# SQLAlchemy ORM 模型
# ============================================================

class CodeAnnotationORM(Base):
    """代码注释 ORM 模型，对应 code_annotations 表。

    锚点策略：以 (version + file_path + start_line + end_line) 为准，
    同时存储 anchor_context（上下文哈希）用于检测版本漂移。
    """

    __tablename__ = "code_annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    annotation_id: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    version: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    anchor_context: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        # 同一位置不能有完全重复的注释
        UniqueConstraint(
            "version", "file_path", "start_line", "end_line", "body",
            name="uq_annotation_position_body"
        ),
        # 按文件聚合查询
        Index("ix_code_annotations_file", "version", "file_path"),
        # 按版本聚合查询
        Index("ix_code_annotations_version", "version"),
    )


# ============================================================
# Pydantic 数据校验模型
# ============================================================

class CodeAnnotationCreate(BaseModel):
    """创建代码注释请求。"""
    version: str = Field(..., description="内核版本 tag")
    file_path: str = Field(..., description="文件相对路径")
    start_line: int = Field(..., ge=1, description="起始行号")
    end_line: int = Field(..., ge=1, description="结束行号")
    body: str = Field(..., min_length=1, description="注释正文（支持 Markdown）")
    author: Optional[str] = Field("me", description="作者名称")


class CodeAnnotationUpdate(BaseModel):
    """更新代码注释请求。"""
    body: str = Field(..., min_length=1, description="注释正文")


class CodeAnnotationRead(BaseModel):
    """代码注释响应。"""
    annotation_id: str
    version: str
    file_path: str
    start_line: int
    end_line: int
    body: str
    author: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CodeAnnotationListItem(BaseModel):
    """注释列表项（含上下文摘要）。"""
    annotation_id: str
    version: str
    file_path: str
    start_line: int
    end_line: int
    body: str
    author: str
    created_at: datetime
    updated_at: datetime
    # 关联上下文（可选，用于总览页展示）
    context_snippet: Optional[str] = None