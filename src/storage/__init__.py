"""存储层模块导出。"""

from src.storage.models import (
    Base,
    TagORM,
    EmailORM,
    TagCreate,
    TagRead,
    TagTree,
    EmailCreate,
    EmailRead,
    EmailSearchResult,
)
from src.storage.postgres import PostgresStorage
from src.storage.tag_store import TagStore, MAX_TAGS_PER_EMAIL
from src.storage.document_models import (
    DocumentBase,
    DocumentChunkModel,
    DocumentChunkCreate,
    DocumentChunkRead,
    DocumentSearchResult,
)
from src.storage.document_store import DocumentStorage

__all__ = [
    # 基础
    "Base",
    "DocumentBase",
    # ORM 模型
    "TagORM",
    "EmailORM",
    "DocumentChunkModel",
    # Pydantic 模型
    "TagCreate",
    "TagRead",
    "TagTree",
    "EmailCreate",
    "EmailRead",
    "EmailSearchResult",
    "DocumentChunkCreate",
    "DocumentChunkRead",
    "DocumentSearchResult",
    # 存储类
    "PostgresStorage",
    "DocumentStorage",
    "TagStore",
    "MAX_TAGS_PER_EMAIL",
]