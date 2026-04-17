"""文档分片数据模型 — SQLAlchemy ORM + Pydantic 数据校验。"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import JSON, DateTime, Integer, String, Text, func, Index
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from src.chunker.base import ContentType


# ============================================================
# SQLAlchemy ORM 模型
# ============================================================

class DocumentBase(DeclarativeBase):
    """SQLAlchemy 声明式基类。"""
    pass


class DocumentChunkModel(DocumentBase):
    """数据库中的文档分片模型，与 DocumentChunk 数据类对应。"""

    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # 分片元数据
    chunk_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    manual_type: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    manual_version: Mapped[str] = mapped_column(String(50), nullable=False)
    volume: Mapped[str] = mapped_column(String(50), nullable=False)
    chapter: Mapped[str] = mapped_column(String(100), nullable=False)
    section: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    section_title: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)

    # 内容相关
    content: Mapped[str] = mapped_column(Text, nullable=False)
    context_prefix: Mapped[str] = mapped_column(Text, nullable=False)
    content_zh: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 页码信息
    page_start: Mapped[int] = mapped_column(Integer, nullable=False)
    page_end: Mapped[int] = mapped_column(Integer, nullable=False)

    # token 统计
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)

    # 元数据（使用 extra_data 避免与 SQLAlchemy 保留字段冲突）
    extra_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())
    translated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # 全文搜索向量
    search_vector: Mapped[Optional[str]] = mapped_column(TSVECTOR, nullable=True)

    # 向量嵌入（用于语义搜索）
    embedding: Mapped[Optional[list]] = mapped_column(Text, nullable=True)  # JSON 字符串存储

    # 定义索引
    __table_args__ = (
        Index('idx_document_chunks_search_vector', 'search_vector', postgresql_using='gin'),
        Index('idx_document_chunks_content_type', 'content_type', postgresql_using='btree'),
        Index('idx_document_chunks_manual_type', 'manual_type', postgresql_using='btree'),
        Index('idx_document_chunks_section', 'section', postgresql_using='btree'),
    )

    def __repr__(self) -> str:
        return f"<DocumentChunkModel(id={self.id}, chunk_id={self.chunk_id}, section={self.section})>"


# ============================================================
# Pydantic 数据校验模型
# ============================================================

class DocumentChunkCreate(BaseModel):
    """创建文档分片时的输入模型。"""

    chunk_id: str
    manual_type: str
    manual_version: str = ""
    volume: str = ""
    chapter: str = ""
    section: str = ""
    section_title: str = ""
    content_type: str = "text"
    content: str = ""
    context_prefix: str = ""
    page_start: int = 0
    page_end: int = 0
    token_count: int = 0
    metadata: dict = {}

    model_config = {"from_attributes": True}


class DocumentChunkRead(BaseModel):
    """查询文档分片时的输出模型。"""

    id: int
    chunk_id: str
    manual_type: str
    manual_version: str
    volume: str
    chapter: str
    section: str
    section_title: str
    content_type: str
    content: str
    context_prefix: str
    page_start: int
    page_end: int
    token_count: int
    metadata: dict
    content_zh: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DocumentSearchResult(BaseModel):
    """文档搜索结果条目。"""

    id: int
    chunk_id: str
    manual_type: str
    manual_version: str
    volume: str
    chapter: str
    section: str
    section_title: str
    content_type: str
    content: str
    page_start: int
    page_end: int
    score: float = 0.0
    snippet: str = ""

    model_config = {"from_attributes": True}