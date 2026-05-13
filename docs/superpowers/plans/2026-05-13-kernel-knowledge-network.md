# Kernel Knowledge Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前内核邮件/手册知识库演进为“以内核代码为锚点、以证据为基础、可跨邮件、commit、LWN、手册、博客和论文互联”的知识网络。

**Architecture:** 复用现有 `KnowledgeEntityORM`、`KnowledgeRelationORM`、`KnowledgeEvidenceORM`、`KnowledgeDraftORM`，先补齐统一来源文档、分片锚点、原子知识断言、实体规范、关系类型、证据反查能力和面向阅读的综述层。复杂邮件不直接作为知识实体，而是拆成 `SourceSegment -> KnowledgeClaim -> Evidence -> Entity/Relation`；`KnowledgeBrief` 只负责把 claim/evidence 串成可读文章，不替代证据层。第一阶段不引入独立图数据库，继续使用 PostgreSQL + JSONB + 全文检索 + 现有向量检索，避免系统过早复杂化。

**Tech Stack:** Python, FastAPI, SQLAlchemy async, PostgreSQL, pgvector, Pydantic, pytest, existing parser/chunker/indexer/retriever modules.

---

## 范围边界

本计划只做第一阶段：建立可扩展的知识对象和证据模型，让现有邮件、手册、commit 资料能挂到同一张知识网络上。

暂不做：
- 自动爬取 LWN、博客、论文。
- 大规模 LLM 自动抽取实体和关系。
- Neo4j、GraphQL、复杂前端图谱编辑器。
- 对所有历史数据做全量迁移。

第一阶段完成后，系统应该能回答这类问题：
- 某个 `symbol`、`file`、`subsystem`、`concept` 关联了哪些邮件、commit、手册段落和解释性证据。
- 某条知识关系为什么存在，能否回到原始证据。
- 同一知识对象来自哪些来源，哪些是人工确认，哪些是候选草稿。
- 一封复杂邮件里的不同片段分别贡献了哪些事实、限制条件、历史原因、性能判断或争议点。
- 某个高价值知识点是否有一篇类似博客的综述，并且综述中的判断能回链到 claim/evidence。

## 复杂邮件的建模原则

内核邮件列表的难点在于：一封邮件经常同时包含 patch 意图、历史背景、反例、性能数据、架构限制、maintainer 判断和对其他邮件的回应。系统不能把“邮件”本身当成一个知识单元，而应该把邮件当成原始容器。

第一阶段采用四层拆分：

```text
SourceDocument
  一封邮件、一个 commit、一篇 LWN、一份手册、一篇论文

SourceSegment
  文档里的重要片段，保留 quote、位置、hash、上下文

KnowledgeClaim
  从片段提炼出的最小知识断言，例如 fact/rationale/limitation/performance/warning

KnowledgeEntity / KnowledgeRelation
  claim 最终挂到函数、文件、commit、概念、硬件特性、架构、内核版本
```

一封邮件可以贡献多个 `KnowledgeClaim`；一个 `KnowledgeClaim` 可以由多封邮件、commit、手册和 LWN 共同支持；后续邮件也可以通过 evidence role 标记为 `contradicts` 或 `qualifies`。这让系统可以表达“先提出、后反驳、再限定适用范围、最终被 commit 采纳”的真实内核讨论过程。

示例：

```text
mail segment A:
  “mmap_lock is already held by the caller on this path”

KnowledgeClaim:
  statement: "mmap_lock is already held by the caller on this path"
  claim_type: fact
  scope: {symbol: "do_mmap", file_path: "mm/mmap.c"}
  status: confirmed

Evidence:
  source_segment_id: email:<message-id>#paragraph:3
  evidence_role: supports
  quote: 原始邮件中的关键句子

Relation:
  function:do_mmap -> depends_on -> lock:mmap_lock
```

## 综述层的建模原则

证据层解决“凭什么这么说”，但仅有证据会让人很难阅读。内核知识还需要一层人类可读的串联文本，用来解释背景、历史演变、当前结论、争议点和适用范围。

第一阶段增加 `KnowledgeBrief`：

```text
KnowledgeBrief
  面向人阅读的主题综述，类似严格版本的博客文章
  绑定一个 entity/relation/thread/topic/symbol/subsystem
  引用 claim_ids 和 evidence_ids
  每个重要段落都应该能回链到证据
```

`KnowledgeBrief` 不是事实来源，不能替代 evidence。它的定位是阅读入口：

```text
Evidence 是地基
KnowledgeClaim 是可验证的砖
KnowledgeRelation 是结构
KnowledgeBrief 是让人走进来的说明文字
```

不是每个知识点都需要 brief。优先给高价值对象建立综述，例如 `subsystem:mm`、`symbol:do_mmap`、`concept:mmap_lock`、关键 thread、关键 commit 或影响大的硬件机制。

## 文件结构

- Modify: `src/storage/models.py`
  - 增加 `SourceDocumentORM` 和 `SourceSegmentORM`。
  - 增加 `KnowledgeClaimORM` 和 `ThreadEpisodeORM`，表达邮件片段中的原子知识断言和线程阶段性结论。
  - 增加 `KnowledgeBriefORM`，表达由 claim/evidence 支撑的人类可读综述。
  - 增加对应 Pydantic schema。
  - 保持现有 `KnowledgeEntityORM / KnowledgeRelationORM / KnowledgeEvidenceORM` 兼容。

- Modify: `src/storage/postgres.py`
  - 在 `init_db()` 中创建 source document/segment 表。
  - 增加必要索引和全文搜索触发器。

- Create: `src/storage/source_store.py`
  - 管理来源文档和来源分片的 upsert、查询、反查。

- Modify: `src/storage/knowledge_store.py`
  - 让 evidence 支持引用 `source_segment_id`。
  - 增加 claim 创建、更新、列表和按 entity/source 反查能力。
  - 增加 brief 创建、更新、发布状态和按 target 读取能力。
  - 增加按 source segment / source document 反查实体和关系的方法。

- Modify: `src/api/routers/knowledge.py`
  - 增加 source document/segment API。
  - 增加 claim API。
  - 增加 brief API。
  - 增加 entity evidence graph API。

- Create: `src/knowledge/entity_types.py`
  - 集中定义实体类型、关系类型、来源类型和置信度枚举。

- Create: `src/knowledge/anchors.py`
  - 定义稳定锚点格式，如 code、commit、email、manual section、paper section。

- Create: `src/knowledge/importers.py`
  - 把现有 email/manual/commit 记录规范化成 `SourceDocument + SourceSegment + Evidence`。

- Modify: `scripts/ingest_manual.py`
  - 在导入手册分片后同步写入 source document/segment。

- Modify: `scripts/index.py` 或 Create: `scripts/sync_sources.py`
  - 提供一次性同步脚本，把已有 emails、email_chunks、document_chunks 映射到统一 source tables。

- Create: `tests/test_source_models.py`
  - 验证 source document/segment ORM 和 schema。

- Create: `tests/test_source_store.py`
  - 验证 upsert、去重、反查。

- Create: `tests/test_knowledge_evidence_sources.py`
  - 验证 evidence 能挂到 source segment，且能由 source 反查知识实体。

- Create: `tests/test_knowledge_claims.py`
  - 验证 claim、thread episode、evidence role 和 source segment 的关联。

- Create: `tests/test_knowledge_briefs.py`
  - 验证 brief 绑定 target、引用 claim/evidence、状态流转和 schema。

- Create: `tests/test_knowledge_constants.py`
  - 验证实体类型、关系类型、来源类型稳定。

---

### Task 1: 定义知识网络的基础枚举和锚点格式

**Files:**
- Create: `src/knowledge/__init__.py`
- Create: `src/knowledge/entity_types.py`
- Create: `src/knowledge/anchors.py`
- Test: `tests/test_knowledge_constants.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_knowledge_constants.py
from src.knowledge.anchors import make_code_anchor, make_source_ref
from src.knowledge.entity_types import (
    BRIEF_STATUSES,
    CLAIM_TYPES,
    ENTITY_TYPES,
    EVIDENCE_ROLES,
    RELATION_TYPES,
    SOURCE_TYPES,
    THREAD_EPISODE_STATUSES,
)


def test_entity_types_include_kernel_core_objects():
    assert "symbol" in ENTITY_TYPES
    assert "file" in ENTITY_TYPES
    assert "subsystem" in ENTITY_TYPES
    assert "concept" in ENTITY_TYPES
    assert "hardware_feature" in ENTITY_TYPES


def test_relation_types_include_evidence_oriented_edges():
    assert "discusses" in RELATION_TYPES
    assert "explains" in RELATION_TYPES
    assert "introduced_by" in RELATION_TYPES
    assert "depends_on" in RELATION_TYPES
    assert "contradicts" in RELATION_TYPES


def test_source_types_include_first_phase_sources():
    assert "email" in SOURCE_TYPES
    assert "commit" in SOURCE_TYPES
    assert "manual" in SOURCE_TYPES
    assert "article" in SOURCE_TYPES
    assert "paper" in SOURCE_TYPES


def test_claim_types_capture_mail_discussion_shapes():
    assert "fact" in CLAIM_TYPES
    assert "rationale" in CLAIM_TYPES
    assert "limitation" in CLAIM_TYPES
    assert "performance" in CLAIM_TYPES
    assert "warning" in CLAIM_TYPES


def test_evidence_roles_capture_argument_flow():
    assert "supports" in EVIDENCE_ROLES
    assert "contradicts" in EVIDENCE_ROLES
    assert "qualifies" in EVIDENCE_ROLES
    assert "mentions" in EVIDENCE_ROLES


def test_thread_episode_statuses_capture_discussion_outcomes():
    assert "accepted" in THREAD_EPISODE_STATUSES
    assert "rejected" in THREAD_EPISODE_STATUSES
    assert "unresolved" in THREAD_EPISODE_STATUSES


def test_brief_statuses_capture_review_flow():
    assert "draft" in BRIEF_STATUSES
    assert "reviewed" in BRIEF_STATUSES
    assert "published" in BRIEF_STATUSES
    assert "stale" in BRIEF_STATUSES


def test_make_code_anchor_is_stable():
    assert make_code_anchor("v6.6", "mm/mmap.c", 10, 20) == {
        "kind": "code",
        "version": "v6.6",
        "file_path": "mm/mmap.c",
        "start_line": 10,
        "end_line": 20,
    }


def test_make_source_ref_is_stable():
    assert make_source_ref("email", "abc@example.com") == "email:abc@example.com"
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pytest tests/test_knowledge_constants.py -v`

Expected: FAIL，错误包含 `ModuleNotFoundError: No module named 'src.knowledge'`。

- [ ] **Step 3: 创建最小实现**

```python
# src/knowledge/__init__.py
"""Kernel knowledge network primitives."""
```

```python
# src/knowledge/entity_types.py
ENTITY_TYPES = {
    "symbol",
    "file",
    "subsystem",
    "concept",
    "hardware_feature",
    "commit",
    "thread",
    "document",
}

RELATION_TYPES = {
    "discusses",
    "explains",
    "introduced_by",
    "fixed_by",
    "depends_on",
    "references",
    "implements",
    "contradicts",
    "applies_to_version",
}

SOURCE_TYPES = {
    "email",
    "commit",
    "manual",
    "article",
    "blog",
    "paper",
}

CONFIDENCE_LEVELS = {
    "candidate",
    "reviewed",
    "confirmed",
    "conflicting",
}

CLAIM_TYPES = {
    "fact",
    "rationale",
    "limitation",
    "performance",
    "warning",
    "historical_reason",
    "design_decision",
}

EVIDENCE_ROLES = {
    "supports",
    "contradicts",
    "qualifies",
    "mentions",
    "explains",
}

THREAD_EPISODE_STATUSES = {
    "accepted",
    "rejected",
    "unresolved",
    "superseded",
}

BRIEF_STATUSES = {
    "draft",
    "reviewed",
    "published",
    "stale",
}
```

```python
# src/knowledge/anchors.py
def make_code_anchor(version: str, file_path: str, start_line: int = 0, end_line: int = 0) -> dict:
    return {
        "kind": "code",
        "version": version,
        "file_path": file_path,
        "start_line": start_line,
        "end_line": end_line,
    }


def make_source_ref(source_type: str, source_id: str) -> str:
    return f"{source_type}:{source_id}"
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `pytest tests/test_knowledge_constants.py -v`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/knowledge tests/test_knowledge_constants.py
git commit -m "feat: define knowledge network primitives"
```

---

### Task 2: 增加统一来源文档和来源分片模型

**Files:**
- Modify: `src/storage/models.py`
- Test: `tests/test_source_models.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_source_models.py
from src.storage.models import (
    SourceDocumentCreate,
    SourceDocumentORM,
    SourceSegmentCreate,
    SourceSegmentORM,
)


def test_source_document_table_shape():
    assert SourceDocumentORM.__tablename__ == "source_documents"
    cols = {c.name for c in SourceDocumentORM.__table__.columns}
    assert "source_doc_id" in cols
    assert "source_type" in cols
    assert "source_ref" in cols
    assert "title" in cols
    assert "authors" in cols
    assert "published_at" in cols
    assert "version" in cols
    assert "url" in cols
    assert "metadata" in cols


def test_source_segment_table_shape():
    assert SourceSegmentORM.__tablename__ == "source_segments"
    cols = {c.name for c in SourceSegmentORM.__table__.columns}
    assert "source_segment_id" in cols
    assert "source_doc_id" in cols
    assert "segment_ref" in cols
    assert "title" in cols
    assert "content" in cols
    assert "anchor" in cols
    assert "content_hash" in cols


def test_source_document_create_defaults():
    doc = SourceDocumentCreate(
        source_type="email",
        source_ref="abc@example.com",
        title="Patch discussion",
    )
    assert doc.source_doc_id == ""
    assert doc.authors == []
    assert doc.meta == {}


def test_source_segment_create_defaults():
    segment = SourceSegmentCreate(
        source_doc_id="email:abc@example.com",
        segment_ref="chunk:0",
        content="hello",
    )
    assert segment.source_segment_id == ""
    assert segment.anchor == {}
    assert segment.meta == {}
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pytest tests/test_source_models.py -v`

Expected: FAIL，错误包含 `ImportError` 或 `cannot import name 'SourceDocumentORM'`。

- [ ] **Step 3: 修改 `src/storage/models.py`**

在 `KnowledgeDraftORM` 前添加 ORM，字段保持显式、可审计：

```python
class SourceDocumentORM(Base):
    """统一来源文档：邮件、commit、手册、文章、论文等原始资料的规范化入口。"""

    __tablename__ = "source_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_doc_id: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_ref: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    authors: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    version: Mapped[str] = mapped_column(String(128), nullable=False, default="", index=True)
    url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    meta: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("source_type", "source_ref", name="uq_source_documents_type_ref"),
        Index("ix_source_documents_type_published", "source_type", "published_at"),
    )


class SourceSegmentORM(Base):
    """统一来源分片：知识证据引用的最小可回溯文本单元。"""

    __tablename__ = "source_segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_segment_id: Mapped[str] = mapped_column(String(240), nullable=False, unique=True, index=True)
    source_doc_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    segment_ref: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    anchor: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    meta: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    search_vector: Mapped[Optional[str]] = mapped_column(TSVECTOR, nullable=True)

    __table_args__ = (
        UniqueConstraint("source_doc_id", "segment_ref", name="uq_source_segments_doc_ref"),
        Index("ix_source_segments_doc", "source_doc_id"),
        Index("ix_source_segments_search_vector", "search_vector", postgresql_using="gin"),
    )
```

在 Pydantic schema 区域添加：

```python
class SourceDocumentCreate(BaseModel):
    source_type: str = Field(..., min_length=1, max_length=64)
    source_ref: str = Field(..., min_length=1, max_length=512)
    title: str = ""
    source_doc_id: str = Field("", max_length=200)
    authors: list[str] = Field(default_factory=list)
    published_at: Optional[datetime] = None
    version: str = ""
    url: str = ""
    meta: dict = Field(default_factory=dict)

    model_config = {"from_attributes": True}


class SourceDocumentRead(SourceDocumentCreate):
    source_doc_id: str
    created_at: datetime
    updated_at: datetime


class SourceSegmentCreate(BaseModel):
    source_doc_id: str = Field(..., min_length=1, max_length=200)
    segment_ref: str = Field(..., min_length=1, max_length=512)
    content: str = ""
    source_segment_id: str = Field("", max_length=240)
    title: str = ""
    anchor: dict = Field(default_factory=dict)
    content_hash: str = ""
    meta: dict = Field(default_factory=dict)

    model_config = {"from_attributes": True}


class SourceSegmentRead(SourceSegmentCreate):
    source_segment_id: str
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `pytest tests/test_source_models.py -v`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/storage/models.py tests/test_source_models.py
git commit -m "feat: add source document models"
```

---

### Task 3: 初始化 source tables 和全文检索

**Files:**
- Modify: `src/storage/postgres.py`
- Test: `tests/test_source_models.py`

- [ ] **Step 1: 补充触发器字符串测试**

```python
# tests/test_source_models.py
from pathlib import Path


def test_postgres_init_mentions_source_segment_search_vector():
    text = Path("src/storage/postgres.py").read_text()
    assert "source_segments_search_vector_update" in text
    assert "ix_source_segments_search_vector" in text
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pytest tests/test_source_models.py::test_postgres_init_mentions_source_segment_search_vector -v`

Expected: FAIL，断言找不到触发器名。

- [ ] **Step 3: 修改 `src/storage/postgres.py`**

在 `init_db()` 的 `Base.metadata.create_all` 之后调用新方法：

```python
await self._ensure_source_segment_search_vector(conn)
```

新增方法：

```python
async def _ensure_source_segment_search_vector(self, conn) -> None:
    """为 source_segments 维护全文检索向量。"""
    try:
        await conn.execute(text(
            "ALTER TABLE source_segments "
            "ADD COLUMN IF NOT EXISTS search_vector tsvector"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_source_segments_search_vector "
            "ON source_segments USING gin (search_vector)"
        ))
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION source_segments_search_vector_update() RETURNS trigger AS $$
            BEGIN
                NEW.search_vector :=
                    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
                    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B');
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql;
        """))
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_trigger WHERE tgname = 'source_segments_search_vector_trigger'
                ) THEN
                    CREATE TRIGGER source_segments_search_vector_trigger
                    BEFORE INSERT OR UPDATE ON source_segments
                    FOR EACH ROW EXECUTE FUNCTION source_segments_search_vector_update();
                END IF;
            END
            $$;
        """))
    except Exception as exc:
        logger.warning("Failed to ensure source_segments search_vector: %s", exc)
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `pytest tests/test_source_models.py -v`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/storage/postgres.py tests/test_source_models.py
git commit -m "feat: initialize source segment search"
```

---

### Task 4: 实现 SourceStore

**Files:**
- Create: `src/storage/source_store.py`
- Test: `tests/test_source_store.py`

- [ ] **Step 1: 写纯函数失败测试**

```python
# tests/test_source_store.py
from src.storage.source_store import make_source_doc_id, make_source_segment_id, sha256_text


def test_make_source_doc_id():
    assert make_source_doc_id("email", "abc@example.com") == "email:abc@example.com"


def test_make_source_segment_id():
    assert make_source_segment_id("email:abc@example.com", "chunk:0") == "email:abc@example.com#chunk:0"


def test_sha256_text_is_stable():
    assert sha256_text("hello") == sha256_text("hello")
    assert sha256_text("hello") != sha256_text("world")
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pytest tests/test_source_store.py -v`

Expected: FAIL，错误包含 `ModuleNotFoundError`。

- [ ] **Step 3: 创建最小实现**

```python
# src/storage/source_store.py
from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.storage.models import (
    SourceDocumentCreate,
    SourceDocumentORM,
    SourceDocumentRead,
    SourceSegmentCreate,
    SourceSegmentORM,
    SourceSegmentRead,
)


def make_source_doc_id(source_type: str, source_ref: str) -> str:
    return f"{source_type.strip()}:{source_ref.strip()}"


def make_source_segment_id(source_doc_id: str, segment_ref: str) -> str:
    return f"{source_doc_id.strip()}#{segment_ref.strip()}"


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class SourceStore:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._session_factory = session_factory

    async def upsert_document(self, data: SourceDocumentCreate) -> SourceDocumentRead:
        source_doc_id = data.source_doc_id or make_source_doc_id(data.source_type, data.source_ref)
        values = {
            "source_doc_id": source_doc_id,
            "source_type": data.source_type,
            "source_ref": data.source_ref,
            "title": data.title,
            "authors": data.authors,
            "published_at": data.published_at,
            "version": data.version,
            "url": data.url,
            "meta": data.meta,
            "updated_at": datetime.utcnow(),
        }
        async with self._session_factory() as session:
            stmt = pg_insert(SourceDocumentORM).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=["source_doc_id"],
                set_=values,
            ).returning(SourceDocumentORM)
            result = await session.execute(stmt)
            await session.commit()
            return SourceDocumentRead.model_validate(result.scalar_one())

    async def upsert_segment(self, data: SourceSegmentCreate) -> SourceSegmentRead:
        source_segment_id = data.source_segment_id or make_source_segment_id(data.source_doc_id, data.segment_ref)
        content_hash = data.content_hash or sha256_text(data.content)
        values = {
            "source_segment_id": source_segment_id,
            "source_doc_id": data.source_doc_id,
            "segment_ref": data.segment_ref,
            "title": data.title,
            "content": data.content,
            "anchor": data.anchor,
            "content_hash": content_hash,
            "meta": data.meta,
            "updated_at": datetime.utcnow(),
        }
        async with self._session_factory() as session:
            stmt = pg_insert(SourceSegmentORM).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=["source_segment_id"],
                set_=values,
            ).returning(SourceSegmentORM)
            result = await session.execute(stmt)
            await session.commit()
            return SourceSegmentRead.model_validate(result.scalar_one())

    async def get_document(self, source_doc_id: str) -> Optional[SourceDocumentRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(SourceDocumentORM).where(SourceDocumentORM.source_doc_id == source_doc_id)
            )
            item = result.scalar_one_or_none()
            return SourceDocumentRead.model_validate(item) if item else None
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `pytest tests/test_source_store.py -v`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/storage/source_store.py tests/test_source_store.py
git commit -m "feat: add source store"
```

---

### Task 5: 让 Evidence 可以引用 SourceSegment

**Files:**
- Modify: `src/storage/models.py`
- Modify: `src/storage/knowledge_store.py`
- Test: `tests/test_knowledge_evidence_sources.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_knowledge_evidence_sources.py
from src.storage.models import KnowledgeEvidenceCreate, KnowledgeEvidenceORM, KnowledgeEvidenceRead


def test_evidence_has_source_segment_id_column():
    cols = {c.name for c in KnowledgeEvidenceORM.__table__.columns}
    assert "source_doc_id" in cols
    assert "source_segment_id" in cols


def test_evidence_schema_accepts_source_refs():
    data = KnowledgeEvidenceCreate(
        entity_id="concept:mmap",
        source_type="manual",
        source_doc_id="manual:intel-sdm-vol3",
        source_segment_id="manual:intel-sdm-vol3#section:4.5",
        claim="Paging behavior is defined by the manual.",
    )
    assert data.source_doc_id == "manual:intel-sdm-vol3"
    assert data.source_segment_id.endswith("section:4.5")
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pytest tests/test_knowledge_evidence_sources.py -v`

Expected: FAIL，错误包含缺少 `source_doc_id` 或 `source_segment_id`。

- [ ] **Step 3: 修改 evidence ORM 和 schema**

在 `KnowledgeEvidenceORM` 添加：

```python
source_doc_id: Mapped[str] = mapped_column(String(200), nullable=False, default="", index=True)
source_segment_id: Mapped[str] = mapped_column(String(240), nullable=False, default="", index=True)
```

在 `KnowledgeEvidenceCreate`、`KnowledgeEvidenceUpdate`、`KnowledgeEvidenceRead` 添加对应字段：

```python
source_doc_id: str = Field("", max_length=200)
source_segment_id: str = Field("", max_length=240)
```

`KnowledgeEvidenceUpdate` 使用 `Optional[str]`。

给 `KnowledgeEvidenceORM.__table_args__` 增加：

```python
Index("ix_knowledge_evidence_source_segment", "source_segment_id")
```

- [ ] **Step 4: 修改 `KnowledgeStore.create_evidence`**

在创建 `KnowledgeEvidenceORM` 时写入：

```python
source_doc_id=data.source_doc_id,
source_segment_id=data.source_segment_id,
```

在 update evidence 时同步允许更新这两个字段。

- [ ] **Step 5: 运行测试并确认通过**

Run: `pytest tests/test_knowledge_evidence_sources.py -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/storage/models.py src/storage/knowledge_store.py tests/test_knowledge_evidence_sources.py
git commit -m "feat: link evidence to source segments"
```

---

### Task 6: 增加 KnowledgeClaim 和 ThreadEpisode

**Files:**
- Modify: `src/storage/models.py`
- Modify: `src/storage/knowledge_store.py`
- Test: `tests/test_knowledge_claims.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_knowledge_claims.py
from src.storage.models import (
    KnowledgeClaimCreate,
    KnowledgeClaimORM,
    KnowledgeEvidenceCreate,
    KnowledgeEvidenceORM,
    ThreadEpisodeCreate,
    ThreadEpisodeORM,
)


def test_knowledge_claim_table_shape():
    assert KnowledgeClaimORM.__tablename__ == "knowledge_claims"
    cols = {c.name for c in KnowledgeClaimORM.__table__.columns}
    assert "claim_id" in cols
    assert "statement" in cols
    assert "claim_type" in cols
    assert "status" in cols
    assert "scope" in cols
    assert "source_segment_id" in cols
    assert "confidence" in cols
    assert "metadata" in cols


def test_thread_episode_table_shape():
    assert ThreadEpisodeORM.__tablename__ == "thread_episodes"
    cols = {c.name for c in ThreadEpisodeORM.__table__.columns}
    assert "episode_id" in cols
    assert "thread_id" in cols
    assert "topic" in cols
    assert "conclusion" in cols
    assert "status" in cols
    assert "claim_ids" in cols


def test_claim_schema_defaults():
    claim = KnowledgeClaimCreate(
        statement="mmap_lock is already held by the caller on this path.",
        claim_type="fact",
        source_segment_id="email:abc@example.com#paragraph:3",
    )
    assert claim.claim_id == ""
    assert claim.status == "candidate"
    assert claim.scope == {}


def test_evidence_can_point_to_claim_with_role():
    evidence = KnowledgeEvidenceCreate(
        entity_id="symbol:do_mmap",
        claim_id="claim:mmap-lock-held",
        evidence_role="supports",
        source_segment_id="email:abc@example.com#paragraph:3",
    )
    assert evidence.claim_id == "claim:mmap-lock-held"
    assert evidence.evidence_role == "supports"


def test_thread_episode_schema_defaults():
    episode = ThreadEpisodeCreate(
        thread_id="thread-root",
        topic="mmap_lock handling in do_mmap",
        claim_ids=["claim:mmap-lock-held"],
    )
    assert episode.episode_id == ""
    assert episode.status == "unresolved"
    assert episode.claim_ids == ["claim:mmap-lock-held"]
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pytest tests/test_knowledge_claims.py -v`

Expected: FAIL，错误包含缺少 `KnowledgeClaimORM` 或 `ThreadEpisodeORM`。

- [ ] **Step 3: 修改 `src/storage/models.py` 添加 ORM**

在 `KnowledgeEvidenceORM` 前添加：

```python
class KnowledgeClaimORM(Base):
    """从来源片段中提炼出的原子知识断言。"""

    __tablename__ = "knowledge_claims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_id: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True)
    statement: Mapped[str] = mapped_column(Text, nullable=False, default="")
    claim_type: Mapped[str] = mapped_column(String(64), nullable=False, default="fact", index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="candidate", index=True)
    scope: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source_segment_id: Mapped[str] = mapped_column(String(240), nullable=False, default="", index=True)
    confidence: Mapped[str] = mapped_column(String(32), nullable=False, default="candidate", index=True)
    meta: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    updated_by: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    updated_by_user_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("claim_id", name="uq_knowledge_claims_claim_id"),
        Index("ix_knowledge_claims_type_status", "claim_type", "status"),
        Index("ix_knowledge_claims_source_segment", "source_segment_id"),
    )


class ThreadEpisodeORM(Base):
    """邮件线程中的阶段性讨论单元和结论。"""

    __tablename__ = "thread_episodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    episode_id: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True)
    thread_id: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    topic: Mapped[str] = mapped_column(Text, nullable=False, default="")
    conclusion: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="unresolved", index=True)
    claim_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    meta: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("episode_id", name="uq_thread_episodes_episode_id"),
        Index("ix_thread_episodes_thread_status", "thread_id", "status"),
    )
```

- [ ] **Step 4: 修改 evidence 以连接 claim 和 source**

在 `KnowledgeEvidenceORM` 添加：

```python
claim_id: Mapped[str] = mapped_column(String(200), nullable=False, default="", index=True)
evidence_role: Mapped[str] = mapped_column(String(32), nullable=False, default="supports", index=True)
```

给 `KnowledgeEvidenceORM.__table_args__` 增加：

```python
Index("ix_knowledge_evidence_claim_role", "claim_id", "evidence_role")
```

- [ ] **Step 5: 添加 Pydantic schema**

```python
class KnowledgeClaimCreate(BaseModel):
    statement: str = Field(..., min_length=1, max_length=12000)
    claim_type: str = Field("fact", max_length=64)
    claim_id: str = Field("", max_length=200)
    status: str = Field("candidate", max_length=32)
    scope: dict = Field(default_factory=dict)
    source_segment_id: str = Field("", max_length=240)
    confidence: str = Field("candidate", max_length=32)
    meta: dict = Field(default_factory=dict)
    created_by: str = Field("me", max_length=128)
    updated_by: str = Field("me", max_length=128)
    created_by_user_id: Optional[str] = None
    updated_by_user_id: Optional[str] = None

    model_config = {"from_attributes": True}


class KnowledgeClaimRead(KnowledgeClaimCreate):
    claim_id: str
    created_at: datetime
    updated_at: datetime


class ThreadEpisodeCreate(BaseModel):
    thread_id: str = Field(..., min_length=1, max_length=512)
    topic: str = Field("", max_length=4000)
    conclusion: str = Field("", max_length=12000)
    claim_ids: list[str] = Field(default_factory=list)
    episode_id: str = Field("", max_length=200)
    status: str = Field("unresolved", max_length=32)
    meta: dict = Field(default_factory=dict)

    model_config = {"from_attributes": True}


class ThreadEpisodeRead(ThreadEpisodeCreate):
    episode_id: str
    created_at: datetime
    updated_at: datetime
```

同步给 `KnowledgeEvidenceCreate`、`KnowledgeEvidenceUpdate`、`KnowledgeEvidenceRead` 添加：

```python
claim_id: str = Field("", max_length=200)
evidence_role: str = Field("supports", max_length=32)
```

`KnowledgeEvidenceUpdate` 使用 `Optional[str]`。

- [ ] **Step 6: 在 `KnowledgeStore` 增加 claim 创建方法**

```python
def normalize_claim_id(statement: str) -> str:
    return f"claim:{normalize_slug(statement)[:120]}"
```

```python
async def create_claim(self, data: KnowledgeClaimCreate) -> KnowledgeClaimRead:
    now = datetime.utcnow()
    claim = KnowledgeClaimORM(
        claim_id=data.claim_id or normalize_claim_id(data.statement),
        statement=data.statement.strip(),
        claim_type=data.claim_type.strip(),
        status=data.status.strip(),
        scope=data.scope or {},
        source_segment_id=data.source_segment_id.strip(),
        confidence=data.confidence.strip(),
        meta=data.meta or {},
        created_by=data.created_by,
        updated_by=data.updated_by,
        created_by_user_id=data.created_by_user_id,
        updated_by_user_id=data.updated_by_user_id,
        created_at=now,
        updated_at=now,
    )
    async with self._session_factory() as session:
        session.add(claim)
        await session.commit()
        await session.refresh(claim)
        return KnowledgeClaimRead.model_validate(claim)
```

- [ ] **Step 7: 运行测试并确认通过**

Run: `pytest tests/test_knowledge_claims.py -v`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/storage/models.py src/storage/knowledge_store.py tests/test_knowledge_claims.py
git commit -m "feat: add atomic knowledge claims"
```

---

### Task 7: 增加 KnowledgeBrief 综述层

**Files:**
- Modify: `src/storage/models.py`
- Modify: `src/storage/knowledge_store.py`
- Modify: `src/api/routers/knowledge.py`
- Test: `tests/test_knowledge_briefs.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_knowledge_briefs.py
from src.storage.models import KnowledgeBriefCreate, KnowledgeBriefORM


def test_knowledge_brief_table_shape():
    assert KnowledgeBriefORM.__tablename__ == "knowledge_briefs"
    cols = {c.name for c in KnowledgeBriefORM.__table__.columns}
    assert "brief_id" in cols
    assert "target_type" in cols
    assert "target_ref" in cols
    assert "title" in cols
    assert "summary_md" in cols
    assert "claim_ids" in cols
    assert "evidence_ids" in cols
    assert "status" in cols
    assert "generated_by" in cols
    assert "metadata" in cols


def test_knowledge_brief_schema_defaults():
    brief = KnowledgeBriefCreate(
        target_type="symbol",
        target_ref="symbol:do_mmap",
        title="do_mmap and mmap_lock",
        summary_md="# do_mmap and mmap_lock\n\nThe path assumes caller-held mmap_lock.",
        claim_ids=["claim:mmap-lock-held"],
        evidence_ids=["evidence:mail-1"],
    )
    assert brief.brief_id == ""
    assert brief.status == "draft"
    assert brief.generated_by == "human"
    assert brief.claim_ids == ["claim:mmap-lock-held"]
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pytest tests/test_knowledge_briefs.py -v`

Expected: FAIL，错误包含缺少 `KnowledgeBriefORM`。

- [ ] **Step 3: 修改 `src/storage/models.py` 添加 ORM**

在 `KnowledgeDraftORM` 前添加：

```python
class KnowledgeBriefORM(Base):
    """面向阅读的知识综述，由 claim/evidence 支撑，不能替代证据层。"""

    __tablename__ = "knowledge_briefs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    brief_id: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_ref: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    summary_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    claim_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    evidence_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)
    generated_by: Mapped[str] = mapped_column(String(32), nullable=False, default="human", index=True)
    reviewed_by: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    meta: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    updated_by: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    updated_by_user_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("brief_id", name="uq_knowledge_briefs_brief_id"),
        UniqueConstraint("target_type", "target_ref", "title", name="uq_knowledge_briefs_target_title"),
        Index("ix_knowledge_briefs_target_status", "target_type", "target_ref", "status"),
    )
```

- [ ] **Step 4: 添加 Pydantic schema**

```python
class KnowledgeBriefCreate(BaseModel):
    target_type: str = Field(..., min_length=1, max_length=64)
    target_ref: str = Field(..., min_length=1, max_length=512)
    title: str = Field(..., min_length=1, max_length=500)
    summary_md: str = Field("", max_length=80000)
    brief_id: str = Field("", max_length=200)
    claim_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    status: str = Field("draft", max_length=32)
    generated_by: str = Field("human", max_length=32)
    reviewed_by: str = Field("", max_length=128)
    meta: dict = Field(default_factory=dict)
    created_by: str = Field("me", max_length=128)
    updated_by: str = Field("me", max_length=128)
    created_by_user_id: Optional[str] = None
    updated_by_user_id: Optional[str] = None

    model_config = {"from_attributes": True}


class KnowledgeBriefUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    summary_md: Optional[str] = Field(None, max_length=80000)
    claim_ids: Optional[list[str]] = None
    evidence_ids: Optional[list[str]] = None
    status: Optional[str] = Field(None, max_length=32)
    generated_by: Optional[str] = Field(None, max_length=32)
    reviewed_by: Optional[str] = Field(None, max_length=128)
    meta: Optional[dict] = None

    model_config = {"from_attributes": True}


class KnowledgeBriefRead(KnowledgeBriefCreate):
    brief_id: str
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 5: 在 `KnowledgeStore` 增加 brief 创建方法**

```python
def normalize_brief_id(target_type: str, target_ref: str, title: str) -> str:
    return f"brief:{normalize_slug(target_type)}:{normalize_slug(target_ref)}:{normalize_slug(title)[:80]}"
```

```python
async def create_brief(self, data: KnowledgeBriefCreate) -> KnowledgeBriefRead:
    now = datetime.utcnow()
    brief = KnowledgeBriefORM(
        brief_id=data.brief_id or normalize_brief_id(data.target_type, data.target_ref, data.title),
        target_type=data.target_type.strip(),
        target_ref=data.target_ref.strip(),
        title=data.title.strip(),
        summary_md=data.summary_md,
        claim_ids=data.claim_ids,
        evidence_ids=data.evidence_ids,
        status=data.status.strip(),
        generated_by=data.generated_by.strip(),
        reviewed_by=data.reviewed_by.strip(),
        meta=data.meta or {},
        created_by=data.created_by,
        updated_by=data.updated_by,
        created_by_user_id=data.created_by_user_id,
        updated_by_user_id=data.updated_by_user_id,
        created_at=now,
        updated_at=now,
    )
    async with self._session_factory() as session:
        session.add(brief)
        await session.commit()
        await session.refresh(brief)
        return KnowledgeBriefRead.model_validate(brief)
```

```python
async def list_briefs_for_target(self, target_type: str, target_ref: str) -> list[KnowledgeBriefRead]:
    async with self._session_factory() as session:
        result = await session.execute(
            select(KnowledgeBriefORM)
            .where(
                KnowledgeBriefORM.target_type == target_type,
                KnowledgeBriefORM.target_ref == target_ref,
            )
            .order_by(KnowledgeBriefORM.updated_at.desc())
        )
        return [KnowledgeBriefRead.model_validate(item) for item in result.scalars().all()]
```

- [ ] **Step 6: 在 router 添加最小 API**

```python
class KnowledgeBriefCreateRequest(BaseModel):
    target_type: str = Field(..., min_length=1, max_length=64)
    target_ref: str = Field(..., min_length=1, max_length=512)
    title: str = Field(..., min_length=1, max_length=500)
    summary_md: str = Field("", max_length=80000)
    claim_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    status: str = Field("draft", max_length=32)
    generated_by: str = Field("human", max_length=32)
    reviewed_by: str = Field("", max_length=128)
    meta: dict = Field(default_factory=dict)
```

```python
@router.post("/api/knowledge/briefs")
async def create_knowledge_brief(
    request: KnowledgeBriefCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    return await state._knowledge_store.create_brief(
        KnowledgeBriefCreate(
            target_type=request.target_type,
            target_ref=request.target_ref,
            title=request.title,
            summary_md=request.summary_md,
            claim_ids=request.claim_ids,
            evidence_ids=request.evidence_ids,
            status=request.status,
            generated_by=request.generated_by,
            reviewed_by=request.reviewed_by,
            meta=request.meta,
            created_by=current_user.display_name,
            updated_by=current_user.display_name,
            created_by_user_id=current_user.user_id,
            updated_by_user_id=current_user.user_id,
        )
    )
```

- [ ] **Step 7: 运行测试并确认通过**

Run: `pytest tests/test_knowledge_briefs.py -v`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/storage/models.py src/storage/knowledge_store.py src/api/routers/knowledge.py tests/test_knowledge_briefs.py
git commit -m "feat: add knowledge briefs"
```

---

### Task 8: 同步已有邮件和手册分片到 SourceDocument/SourceSegment

**Files:**
- Create: `src/knowledge/importers.py`
- Create: `scripts/sync_sources.py`
- Test: `tests/test_source_store.py`

- [ ] **Step 1: 写转换函数测试**

```python
# tests/test_source_store.py
from datetime import datetime

from src.knowledge.importers import email_to_source_document, email_chunk_to_source_segment


def test_email_to_source_document():
    doc = email_to_source_document(
        message_id="abc@example.com",
        subject="Re: mmap change",
        sender="dev@example.com",
        date=datetime(2024, 1, 1),
        list_name="linux-mm",
        thread_id="thread-1",
    )
    assert doc.source_type == "email"
    assert doc.source_ref == "abc@example.com"
    assert doc.title == "Re: mmap change"
    assert doc.meta["list_name"] == "linux-mm"
    assert doc.meta["thread_id"] == "thread-1"


def test_email_chunk_to_source_segment():
    segment = email_chunk_to_source_segment(
        message_id="abc@example.com",
        chunk_index=0,
        content="hello",
        subject="Re: mmap change",
    )
    assert segment.source_doc_id == "email:abc@example.com"
    assert segment.segment_ref == "chunk:0"
    assert segment.title == "Re: mmap change"
    assert segment.content == "hello"
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pytest tests/test_source_store.py -v`

Expected: FAIL，错误包含 `No module named 'src.knowledge.importers'`。

- [ ] **Step 3: 创建转换函数**

```python
# src/knowledge/importers.py
from __future__ import annotations

from datetime import datetime

from src.storage.models import SourceDocumentCreate, SourceSegmentCreate
from src.storage.source_store import make_source_doc_id


def email_to_source_document(
    message_id: str,
    subject: str,
    sender: str,
    date: datetime | None,
    list_name: str,
    thread_id: str,
) -> SourceDocumentCreate:
    return SourceDocumentCreate(
        source_type="email",
        source_ref=message_id,
        title=subject,
        authors=[sender] if sender else [],
        published_at=date,
        meta={"list_name": list_name, "thread_id": thread_id},
    )


def email_chunk_to_source_segment(
    message_id: str,
    chunk_index: int,
    content: str,
    subject: str,
) -> SourceSegmentCreate:
    return SourceSegmentCreate(
        source_doc_id=make_source_doc_id("email", message_id),
        segment_ref=f"chunk:{chunk_index}",
        title=subject,
        content=content,
        anchor={"kind": "email_chunk", "message_id": message_id, "chunk_index": chunk_index},
    )
```

- [ ] **Step 4: 创建同步脚本骨架**

```python
# scripts/sync_sources.py
"""把已有 emails/email_chunks/document_chunks 同步为统一 source documents/segments。"""

import asyncio

from config.settings import get_settings
from src.storage.postgres import PostgresStorage
from src.storage.source_store import SourceStore


async def main() -> None:
    settings = get_settings()
    storage = PostgresStorage(settings.database_url)
    await storage.init_db()
    source_store = SourceStore(storage.session_factory)
    print(f"source sync ready: {source_store.__class__.__name__}")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 5: 运行测试**

Run: `pytest tests/test_source_store.py -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/knowledge/importers.py scripts/sync_sources.py tests/test_source_store.py
git commit -m "feat: add source sync importers"
```

---

### Task 9: 增加证据网络查询 API

**Files:**
- Modify: `src/storage/knowledge_store.py`
- Modify: `src/api/routers/knowledge.py`
- Test: `tests/test_knowledge_enhancements.py`

- [ ] **Step 1: 写 API schema 测试**

```python
# tests/test_knowledge_enhancements.py
from pathlib import Path


def test_knowledge_router_exposes_entity_graph_endpoint():
    text = Path("src/api/routers/knowledge.py").read_text()
    assert "/api/knowledge/entities/{entity_id:path}/graph" in text
    assert "get_knowledge_entity_graph" in text
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pytest tests/test_knowledge_enhancements.py::test_knowledge_router_exposes_entity_graph_endpoint -v`

Expected: FAIL，断言找不到 graph endpoint。

- [ ] **Step 3: 在 `KnowledgeStore` 增加 graph 方法**

```python
async def get_entity_graph(self, entity_id: str) -> dict:
    entity = await self.get(entity_id)
    if entity is None:
        return {}
    outgoing, incoming = await self.list_relations(entity_id)
    evidence = await self.list_evidence(entity_id)
    briefs = await self.list_briefs_for_target(entity.entity_type, entity.entity_id)
    return {
        "entity": entity.model_dump(mode="json"),
        "outgoing": [item.model_dump(mode="json") for item in outgoing],
        "incoming": [item.model_dump(mode="json") for item in incoming],
        "evidence": [item.model_dump(mode="json") for item in evidence],
        "briefs": [item.model_dump(mode="json") for item in briefs],
    }
```

如果现有方法名不同，优先复用现有 `KnowledgeStore` 里的 relation/evidence list 方法，不重复实现 SQL。

- [ ] **Step 4: 在 router 添加 endpoint**

```python
@router.get("/api/knowledge/entities/{entity_id:path}/graph")
async def get_knowledge_entity_graph(entity_id: str):
    if not state._knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    graph = await state._knowledge_store.get_entity_graph(entity_id)
    if not graph:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    return graph
```

- [ ] **Step 5: 运行测试**

Run: `pytest tests/test_knowledge_enhancements.py -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/storage/knowledge_store.py src/api/routers/knowledge.py tests/test_knowledge_enhancements.py
git commit -m "feat: expose knowledge entity graph"
```

---

### Task 10: 写第一阶段架构文档

**Files:**
- Create: `docs/kernel-knowledge-network.md`

- [ ] **Step 1: 写文档**

```markdown
# Kernel Knowledge Network

## 目标

本系统把邮件、commit、手册、文章、博客和论文统一成可追溯的知识网络。知识不是脱离来源的总结，而是由实体、关系、claim 和证据组成；综述只作为阅读入口。

## 核心对象

- SourceDocument：一份原始资料，如一封邮件、一个 commit、一份手册、一篇文章或论文。
- SourceSegment：SourceDocument 中可被引用的最小证据片段。
- KnowledgeClaim：从 SourceSegment 中提炼出的原子知识断言，表达事实、原因、限制、性能判断或警告。
- KnowledgeEntity：知识对象，如 symbol、file、subsystem、concept、hardware_feature。
- KnowledgeRelation：实体之间的有向关系。
- KnowledgeEvidence：支持、反驳、限定或解释 claim/entity/relation 的证据，必须能回到 SourceSegment。
- ThreadEpisode：邮件线程里的阶段性讨论单元，用来表达 accepted/rejected/unresolved 等结论状态。
- KnowledgeBrief：面向人阅读的主题综述，引用 claim/evidence 来串联背景、结论、争议和适用范围。

## 复杂邮件处理

一封邮件不是一个知识单元，而是一个原始资料容器。系统先把邮件切成 SourceSegment，再从片段中提取 KnowledgeClaim。多个 claim 可以来自同一封邮件；同一个 claim 也可以由多封邮件、commit、手册、LWN 和论文共同支持或反驳。

典型链路：

```text
email:<message-id>
  -> email:<message-id>#paragraph:3
  -> claim:mmap-lock-held-by-caller
  -> evidence_role:supports
  -> symbol:do_mmap / relation:depends_on
```

## 第一阶段原则

- PostgreSQL 优先，不引入独立图数据库。
- 证据优先，不把 LLM 总结当作事实。
- 综述可以像博客一样易读，但每个关键判断必须能回链到 claim/evidence。
- 代码锚点优先，尽量挂到 symbol、file、commit、subsystem、version。
- 自动抽取结果先进入 draft，需要人工确认后进入正式 claim、实体和关系。

## 后续阶段

第二阶段接入 commit patch hunk 和邮件线程聚合。
第三阶段接入 LWN、博客、论文，并加入来源可信度。
第四阶段增加可视化时间线和实体图谱导航。
```

- [ ] **Step 2: 提交**

```bash
git add docs/kernel-knowledge-network.md
git commit -m "docs: describe kernel knowledge network"
```

---

## 验证命令

完成全部任务后运行：

```bash
pytest tests/test_knowledge_constants.py tests/test_source_models.py tests/test_source_store.py tests/test_knowledge_evidence_sources.py tests/test_knowledge_claims.py tests/test_knowledge_briefs.py tests/test_knowledge_enhancements.py -v
```

Expected: 全部 PASS。

再运行现有相关测试：

```bash
pytest tests/test_search.py tests/test_search_router.py tests/test_knowledge_enhancements.py -v
```

Expected: 全部 PASS，且现有 search/knowledge 行为没有回归。

## 计划自检

- Spec coverage: 覆盖了来源文档、来源分片、原子 claim、线程 episode、brief 综述层、实体、关系、证据、反查 API、同步脚本和架构文档。
- Placeholder scan: 没有留下占位式任务内容。
- Type consistency: `source_doc_id`、`source_segment_id`、`claim_id`、`evidence_role`、`brief_id` 在 ORM、Pydantic schema、store、evidence/brief 中命名一致。
- Scope check: 第一阶段只做统一模型和最小同步，不做自动 LLM 抽取和复杂前端图谱，范围可独立交付。
