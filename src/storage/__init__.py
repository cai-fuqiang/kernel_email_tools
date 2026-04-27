"""存储层模块导出。"""

from src.storage.models import (
    Base,
    TagORM,
    TagAliasORM,
    TagAssignmentORM,
    EmailORM,
    EmailChunkORM,
    EmailChunkEmbeddingORM,
    TagCreate,
    TagRead,
    TagTree,
    TagAssignmentCreate,
    TagAssignmentRead,
    TagBundle,
    EmailCreate,
    EmailRead,
    EmailSearchResult,
    EmailChunkRead,
    EmailChunkSearchResult,
)
from src.storage.postgres import PostgresStorage
from src.storage.tag_store import TagStore
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
    "TagAliasORM",
    "TagAssignmentORM",
    "EmailORM",
    "EmailChunkORM",
    "EmailChunkEmbeddingORM",
    "DocumentChunkModel",
    # Pydantic 模型
    "TagCreate",
    "TagRead",
    "TagTree",
    "TagAssignmentCreate",
    "TagAssignmentRead",
    "TagBundle",
    "EmailCreate",
    "EmailRead",
    "EmailSearchResult",
    "EmailChunkRead",
    "EmailChunkSearchResult",
    "DocumentChunkCreate",
    "DocumentChunkRead",
    "DocumentSearchResult",
    # 存储类
    "PostgresStorage",
    "DocumentStorage",
    "TagStore",
]
