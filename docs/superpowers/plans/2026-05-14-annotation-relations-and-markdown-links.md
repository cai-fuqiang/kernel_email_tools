# Annotation Relations And Markdown Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight semantic links between annotations, plus first-class `annotation:<id>` Markdown links that render as internal annotation references.

**Architecture:** Keep annotation content and annotation relationships separate: `annotations.body` remains Markdown, while a new `annotation_relations` table stores typed directed edges. Markdown links are parsed into weak `references` relations, and explicit user-created links store stronger semantic relation types such as `variable_evolves_to` and `value_passed_to`.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, PostgreSQL JSONB, React 18, TypeScript, Vite, Vitest, Tailwind CSS, existing annotation APIs and components.

---

## Recommended Model And Reasoning Mode

Use the default Codex/GPT-5 coding model with high reasoning effort. This work touches backend data modeling, API contracts, Markdown rendering, and cross-component UI state. Do not request hidden chain-of-thought from workers; require concrete test evidence, files changed, and remaining risks.

## Scope

This plan implements the first production slice of annotation association:

- Structured annotation-to-annotation relations.
- Markdown `annotation:<id>` links rendered as internal annotation references.
- Automatic extraction of Markdown links into `references` relations.
- Manual creation of typed relations from annotation UI.
- A lightweight variable trace view for code annotations based on relation type and code anchors.

This plan does not implement full AST-based variable analysis, automatic call-graph inference, large graph visualization, or AI-generated relation creation.

## Frontend Design Direction

Use the `ui-ux-pro-max` design-system guidance for a professional developer tool rather than a marketing surface. The recommended style direction is Minimalism / Swiss Style: dense, quiet, grid-aligned, high-contrast, and optimized for repeated reading inside the existing kernel code workspace.

Apply these design constraints to the relation panel, Markdown annotation references, and variable trace panel:

- Keep the current application shell and annotation card language; do not introduce a landing-page pattern, oversized hero treatment, decorative cards, or promotional copy.
- Use a restrained developer-tool palette anchored in slate neutrals, with green only for constructive action or success and sky/blue only for active references and selected links.
- Prefer IBM Plex Sans for prose UI and JetBrains Mono for identifiers, relation IDs, code paths, line labels, and `annotation:<id>` references when font changes are already supported by the existing CSS.
- Keep relation UI compact enough for the right annotation rail: 8px or smaller radius, stable row height, predictable buttons, and no hover transforms that shift layout.
- Use Lucide icons for relation actions (`Link2`, `GitBranch`, `Trash2`, `ExternalLink`, `ArrowRight`) and provide `aria-label` text for icon-only buttons.
- Do not communicate relation type by color alone; show the relation type as text and optionally pair it with a small icon or border accent.
- Error states for failed relation loads or mutations must use `role="alert"` or an equivalent announced message, not just a red border.
- All relation creation, deletion, Markdown reference opening, and variable trace navigation must be keyboard reachable with visible focus rings.
- Respect `prefers-reduced-motion`; relation panels should use color, border, and weight changes rather than animated spatial movement.
- Verify layouts at 375px, 768px, 1024px, and 1440px. On narrow screens, relation controls may stack, but they must not introduce horizontal scrolling.

Component-specific design:

- Markdown annotation links render inline as text-like internal buttons, visually close to normal links but without navigating the browser away from the app.
- `AnnotationRelationsPanel` is a compact inspector section inside an annotation card, not a nested large card. It should show incoming/outgoing relationships as scan-friendly rows.
- Manual relation creation should use a labeled target-id input, a relation-type select, and a clear add button. The first version may use raw annotation IDs to stay simple.
- `VariableTracePanel` should read like a small trace lane: source line, relation label, target line. Avoid a large graph canvas in this first slice.

## Relationship Display Rules

Use two first-version displays:

- `AnnotationRelationsPanel` shows the local neighborhood of the current annotation.
- `VariableTracePanel` shows ordered code-flow relationships for code annotations.

`AnnotationRelationsPanel` must group relationships by direction:

```text
Relations
[Outgoing 2] [Incoming 1]

Outgoing
variable_evolves_to  code-annot-b23  mm/mmap.c:128  manual
depends_on           code-annot-c77  mm/mmap.c:96   manual

Incoming
references           code-annot-a12  mm/mmap.c:80   markdown_link
```

Each relation row must display:

- Relation type as visible text.
- Peer annotation identifier or available target label.
- File and line when the peer is a code annotation and metadata is available.
- Source kind: `manual`, `markdown_link`, or `system`.
- Direction cue: incoming or outgoing.
- Optional one-line description when present.

Behavior rules:

- Clicking the peer opens an annotation preview or focuses the annotation in the current rail.
- Manual relations may be deleted from the relation row.
- `markdown_link` relations are read-only in the relation panel; users delete them by editing Markdown body links.
- If the target annotation is deleted or hidden by permissions, show `Unavailable annotation` or `Private annotation` and keep the row stable.
- Do not use a large graph canvas in this first version.

`VariableTracePanel` must show code-flow relations as a compact vertical or inline trace, not as a graph:

```text
addr
line 42  initialized
  ↓ variable_evolves_to
line 57  page aligned
  ↓ value_passed_to
line 83  passed to do_mmap()
```

Use only these relation types in the first trace view:

```text
same_variable
variable_evolves_to
value_passed_to
depends_on
```

If the trace grows beyond five visible nodes, show the active annotation plus nearby upstream/downstream nodes first and provide an `Expand trace` control later. First implementation may render only the visible local trace without expansion if only local relation data is available.

## Relation Principles

- `parent_annotation_id` and `in_reply_to` continue to mean discussion replies.
- `annotation_relations` stores semantic relationships between annotations.
- Markdown links create weak `references` relations.
- User-created typed relations are stronger than Markdown references.
- Deleted or inaccessible target annotations must render as unavailable references instead of breaking the page.

## First Relation Types

Use this initial closed set:

```text
references
explains
refines
contradicts
same_variable
variable_evolves_to
value_passed_to
depends_on
evidence_for
```

Use this initial source-kind set:

```text
manual
markdown_link
system
```

## File Structure

- Create: `src/storage/annotation_links.py`
  - Parse `annotation:<id>` links from Markdown and normalize relation/source types.

- Modify: `src/storage/models.py`
  - Add `AnnotationRelationORM`, `AnnotationRelationCreate`, and `AnnotationRelationRead`.

- Create: `src/storage/migrations/20260514_add_annotation_relations.py`
  - Add the `annotation_relations` table and lookup indexes.

- Modify: `src/storage/annotation_store.py`
  - Add relation CRUD, visibility-aware relation reads, Markdown reference sync, and deletion cleanup.

- Modify: `src/api/schemas.py`
  - Add relation response/request schemas shared by annotation routes.

- Modify: `src/api/routers/annotations.py`
  - Add relation endpoints and call Markdown reference sync after create/update.

- Create: `tests/test_annotation_relations.py`
  - Cover models, Markdown parsing, route registration, and request validation.

- Modify: `web/src/api/types.ts`
  - Add relation types and relation payload types.

- Modify: `web/src/api/client.ts`
  - Add relation API client helpers.

- Modify: `web/src/components/AnnotationMarkdown.tsx`
  - Render `annotation:<id>` links as internal annotation references.

- Create: `web/src/components/AnnotationRelationsPanel.tsx`
  - Display outgoing/incoming relations and backlinks; provide manual relation creation.

- Modify: `web/src/components/AnnotationCard.tsx`
  - Embed relation display/actions in existing annotation card surfaces.

- Modify: `web/src/components/PreviewModal.tsx`
  - Allow internal annotation links to open the referenced annotation preview.

- Create: `web/src/components/kernelCode/VariableTracePanel.tsx`
  - Render variable-oriented relation chains for code annotations.

- Modify: `web/src/components/kernelCode/AnnotationPanel.tsx`
  - Show variable trace entry points for code annotations.

- Create: `web/src/components/__tests__/AnnotationMarkdown.test.tsx`
  - Verify Markdown annotation links render as internal links.

- Create: `web/src/components/__tests__/AnnotationRelationsPanel.test.tsx`
  - Verify relation display and manual relation submission.

---

### Task 1: Add Relation Models And Markdown Link Parser

**Files:**
- Create: `src/storage/annotation_links.py`
- Modify: `src/storage/models.py`
- Create: `tests/test_annotation_relations.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_annotation_relations.py`:

```python
"""Tests for annotation relation primitives and Markdown annotation links."""

from __future__ import annotations

import pytest
from pydantic import ValidationError


def test_extract_annotation_links_from_markdown():
    from src.storage.annotation_links import extract_annotation_links

    body = """
    See [the initialization](annotation:code-annot-a1b2c3).
    This repeats [same target](annotation:code-annot-a1b2c3 "variable_evolves_to").
    A normal link [external](https://example.com) is ignored.
    """

    assert extract_annotation_links(body) == [
        {"annotation_id": "code-annot-a1b2c3", "relation_type": "references"},
        {"annotation_id": "code-annot-a1b2c3", "relation_type": "variable_evolves_to"},
    ]


def test_relation_type_validation_accepts_initial_set():
    from src.storage.annotation_links import normalize_relation_type

    assert normalize_relation_type("variable_evolves_to") == "variable_evolves_to"
    assert normalize_relation_type("bogus") == "references"


def test_annotation_relation_orm_shape():
    from src.storage.models import AnnotationRelationORM

    assert AnnotationRelationORM.__tablename__ == "annotation_relations"
    cols = {c.name for c in AnnotationRelationORM.__table__.columns}
    assert {
        "relation_id",
        "source_annotation_id",
        "target_annotation_id",
        "relation_type",
        "source_kind",
        "description",
        "metadata",
        "created_by_user_id",
        "created_at",
        "updated_at",
    }.issubset(cols)


def test_annotation_relation_unique_constraint():
    from src.storage.models import AnnotationRelationORM

    constraint_names = {
        c.name for c in AnnotationRelationORM.__table__.constraints if c.name
    }
    assert "uq_annotation_relations_edge" in constraint_names


def test_annotation_relation_create_schema_rejects_self_link():
    from src.storage.models import AnnotationRelationCreate

    with pytest.raises(ValidationError):
        AnnotationRelationCreate(
            source_annotation_id="code-annot-a",
            target_annotation_id="code-annot-a",
            relation_type="references",
        )
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
rtk pytest tests/test_annotation_relations.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'src.storage.annotation_links'`.

- [ ] **Step 3: Add the Markdown link parser**

Create `src/storage/annotation_links.py`:

```python
"""Helpers for annotation-to-annotation references."""

from __future__ import annotations

import re
from typing import TypedDict


ANNOTATION_LINK_PATTERN = re.compile(
    r"\[[^\]]+\]\(annotation:(?P<id>[A-Za-z0-9_-]+)(?:\s+\"(?P<title>[A-Za-z0-9_-]+)\")?\)"
)

RELATION_TYPES = {
    "references",
    "explains",
    "refines",
    "contradicts",
    "same_variable",
    "variable_evolves_to",
    "value_passed_to",
    "depends_on",
    "evidence_for",
}

SOURCE_KINDS = {"manual", "markdown_link", "system"}


class AnnotationLink(TypedDict):
    annotation_id: str
    relation_type: str


def normalize_relation_type(value: str) -> str:
    normalized = (value or "").strip().lower().replace("-", "_")
    return normalized if normalized in RELATION_TYPES else "references"


def normalize_source_kind(value: str) -> str:
    normalized = (value or "").strip().lower().replace("-", "_")
    return normalized if normalized in SOURCE_KINDS else "manual"


def extract_annotation_links(markdown: str) -> list[AnnotationLink]:
    links: list[AnnotationLink] = []
    for match in ANNOTATION_LINK_PATTERN.finditer(markdown or ""):
        links.append(
            {
                "annotation_id": match.group("id"),
                "relation_type": normalize_relation_type(match.group("title") or "references"),
            }
        )
    return links
```

- [ ] **Step 4: Add ORM and Pydantic models**

Modify `src/storage/models.py` after `AnnotationORM`:

```python
class AnnotationRelationORM(Base):
    """Directed semantic relationship between two annotations."""

    __tablename__ = "annotation_relations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    relation_id: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    source_annotation_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_annotation_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    relation_type: Mapped[str] = mapped_column(String(64), nullable=False, default="references", index=True)
    source_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="manual", index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    meta: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    updated_by: Mapped[str] = mapped_column(String(128), nullable=False, default="me")
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    updated_by_user_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "source_annotation_id",
            "target_annotation_id",
            "relation_type",
            "source_kind",
            name="uq_annotation_relations_edge",
        ),
        Index("ix_annotation_relations_source_type", "source_annotation_id", "relation_type"),
        Index("ix_annotation_relations_target_type", "target_annotation_id", "relation_type"),
    )
```

Modify the Pydantic model section near `AnnotationCreate`:

```python
from pydantic import BaseModel, Field, model_validator
```

Add:

```python
class AnnotationRelationCreate(BaseModel):
    """Create a directed relation between annotations."""

    source_annotation_id: str = Field(..., min_length=1, max_length=64)
    target_annotation_id: str = Field(..., min_length=1, max_length=64)
    relation_type: str = Field("references", max_length=64)
    source_kind: str = Field("manual", max_length=32)
    description: str = Field("", max_length=2000)
    meta: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def reject_self_relation(self) -> "AnnotationRelationCreate":
        if self.source_annotation_id == self.target_annotation_id:
            raise ValueError("source_annotation_id and target_annotation_id must differ")
        return self


class AnnotationRelationRead(BaseModel):
    """Read model for an annotation relation."""

    relation_id: str
    source_annotation_id: str
    target_annotation_id: str
    relation_type: str = "references"
    source_kind: str = "manual"
    description: str = ""
    meta: dict = Field(default_factory=dict)
    created_by: str = ""
    updated_by: str = ""
    created_by_user_id: Optional[str] = None
    updated_by_user_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
rtk pytest tests/test_annotation_relations.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add src/storage/annotation_links.py src/storage/models.py tests/test_annotation_relations.py
rtk git commit -m "feat: add annotation relation primitives"
```

Expected: commit succeeds.

---

### Task 2: Add Database Migration For Relations

**Files:**
- Create: `src/storage/migrations/20260514_add_annotation_relations.py`

- [ ] **Step 1: Create the migration script**

Create `src/storage/migrations/20260514_add_annotation_relations.py`:

```python
"""Add annotation_relations table for typed annotation links."""

from __future__ import annotations

from sqlalchemy import text


async def run_migration(conn) -> None:
    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS annotation_relations (
                id SERIAL PRIMARY KEY,
                relation_id VARCHAR(96) NOT NULL UNIQUE,
                source_annotation_id VARCHAR(64) NOT NULL,
                target_annotation_id VARCHAR(64) NOT NULL,
                relation_type VARCHAR(64) NOT NULL DEFAULT 'references',
                source_kind VARCHAR(32) NOT NULL DEFAULT 'manual',
                description TEXT NOT NULL DEFAULT '',
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_by VARCHAR(128) NOT NULL DEFAULT 'me',
                updated_by VARCHAR(128) NOT NULL DEFAULT 'me',
                created_by_user_id VARCHAR(128),
                updated_by_user_id VARCHAR(128),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_annotation_relations_edge UNIQUE (
                    source_annotation_id,
                    target_annotation_id,
                    relation_type,
                    source_kind
                )
            )
            """
        )
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_annotation_relations_source_type ON annotation_relations (source_annotation_id, relation_type)")
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_annotation_relations_target_type ON annotation_relations (target_annotation_id, relation_type)")
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_annotation_relations_source_kind ON annotation_relations (source_kind)")
    )
```

- [ ] **Step 2: Add a migration shape test**

Append to `tests/test_annotation_relations.py`:

```python
def test_annotation_relation_migration_has_idempotent_table_sql():
    from pathlib import Path

    sql = Path("src/storage/migrations/20260514_add_annotation_relations.py").read_text()
    assert "CREATE TABLE IF NOT EXISTS annotation_relations" in sql
    assert "uq_annotation_relations_edge" in sql
    assert "CREATE INDEX IF NOT EXISTS ix_annotation_relations_source_type" in sql
    assert "CREATE INDEX IF NOT EXISTS ix_annotation_relations_target_type" in sql
```

- [ ] **Step 3: Run tests**

Run:

```bash
rtk pytest tests/test_annotation_relations.py -q
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add src/storage/migrations/20260514_add_annotation_relations.py tests/test_annotation_relations.py
rtk git commit -m "feat: add annotation relation migration"
```

Expected: commit succeeds.

---

### Task 3: Add Store Methods For Relation CRUD And Markdown Sync

**Files:**
- Modify: `src/storage/annotation_store.py`
- Modify: `tests/test_annotation_relations.py`

- [ ] **Step 1: Add pure behavior tests for sync decisions**

Append to `tests/test_annotation_relations.py`:

```python
def test_extract_markdown_links_keeps_duplicate_link_types():
    from src.storage.annotation_links import extract_annotation_links

    body = "[A](annotation:code-annot-a) [A flow](annotation:code-annot-a \"variable_evolves_to\")"

    assert extract_annotation_links(body) == [
        {"annotation_id": "code-annot-a", "relation_type": "references"},
        {"annotation_id": "code-annot-a", "relation_type": "variable_evolves_to"},
    ]
```

- [ ] **Step 2: Run tests**

Run:

```bash
rtk pytest tests/test_annotation_relations.py -q
```

Expected: PASS.

- [ ] **Step 3: Import relation dependencies**

Modify imports in `src/storage/annotation_store.py`:

```python
from sqlalchemy.exc import IntegrityError

from src.storage.annotation_links import (
    extract_annotation_links,
    normalize_relation_type,
    normalize_source_kind,
)
from src.storage.models import (
    AnnotationCreate,
    AnnotationORM,
    AnnotationRead,
    AnnotationRelationCreate,
    AnnotationRelationORM,
    AnnotationRelationRead,
    AnnotationUpdate,
    EmailORM,
    TagAssignmentORM,
)
```

- [ ] **Step 4: Add relation serialization helper**

Add inside `UnifiedAnnotationStore`:

```python
    def _to_relation_read(self, rel: AnnotationRelationORM) -> AnnotationRelationRead:
        return AnnotationRelationRead.model_validate(
            {
                "relation_id": rel.relation_id,
                "source_annotation_id": rel.source_annotation_id,
                "target_annotation_id": rel.target_annotation_id,
                "relation_type": rel.relation_type or "references",
                "source_kind": rel.source_kind or "manual",
                "description": rel.description or "",
                "meta": rel.meta or {},
                "created_by": rel.created_by or "",
                "updated_by": rel.updated_by or "",
                "created_by_user_id": rel.created_by_user_id,
                "updated_by_user_id": rel.updated_by_user_id,
                "created_at": rel.created_at,
                "updated_at": rel.updated_at,
            }
        )
```

- [ ] **Step 5: Add relation create/list/delete methods**

Add inside `UnifiedAnnotationStore`:

```python
    async def create_relation(
        self,
        relation: AnnotationRelationCreate,
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> AnnotationRelationRead:
        data = relation.model_copy(deep=True)
        data.relation_type = normalize_relation_type(data.relation_type)
        data.source_kind = normalize_source_kind(data.source_kind)
        now = datetime.utcnow()

        async with self.session_factory() as session:
            source = (
                await session.execute(
                    select(AnnotationORM).where(AnnotationORM.annotation_id == data.source_annotation_id)
                )
            ).scalar_one_or_none()
            target = (
                await session.execute(
                    select(AnnotationORM).where(AnnotationORM.annotation_id == data.target_annotation_id)
                )
            ).scalar_one_or_none()
            if not source:
                raise ValueError(f"source annotation not found: {data.source_annotation_id}")
            if not target:
                raise ValueError(f"target annotation not found: {data.target_annotation_id}")

            existing = (
                await session.execute(
                    select(AnnotationRelationORM).where(
                        AnnotationRelationORM.source_annotation_id == data.source_annotation_id,
                        AnnotationRelationORM.target_annotation_id == data.target_annotation_id,
                        AnnotationRelationORM.relation_type == data.relation_type,
                        AnnotationRelationORM.source_kind == data.source_kind,
                    )
                )
            ).scalar_one_or_none()
            if existing:
                return self._to_relation_read(existing)

            rel = AnnotationRelationORM(
                relation_id=f"annot-rel-{uuid.uuid4().hex[:12]}",
                source_annotation_id=data.source_annotation_id,
                target_annotation_id=data.target_annotation_id,
                relation_type=data.relation_type,
                source_kind=data.source_kind,
                description=data.description or "",
                meta=data.meta or {},
                created_by=actor_display_name or self.default_author,
                updated_by=actor_display_name or self.default_author,
                created_by_user_id=actor_user_id or None,
                updated_by_user_id=actor_user_id or None,
                created_at=now,
                updated_at=now,
            )
            session.add(rel)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                existing = (
                    await session.execute(
                        select(AnnotationRelationORM).where(
                            AnnotationRelationORM.source_annotation_id == data.source_annotation_id,
                            AnnotationRelationORM.target_annotation_id == data.target_annotation_id,
                            AnnotationRelationORM.relation_type == data.relation_type,
                            AnnotationRelationORM.source_kind == data.source_kind,
                        )
                    )
                ).scalar_one()
                return self._to_relation_read(existing)
            await session.refresh(rel)
            return self._to_relation_read(rel)

    async def list_relations(
        self,
        annotation_id: str,
        direction: str = "both",
        viewer_user_id: Optional[str] = None,
        include_all_private: bool = False,
    ) -> list[AnnotationRelationRead]:
        async with self.session_factory() as session:
            visibility_filters = self._visibility_filters(viewer_user_id, include_all_private=include_all_private)
            visible_annotations = select(AnnotationORM.annotation_id).where(*visibility_filters)
            clauses = []
            if direction in {"out", "both"}:
                clauses.append(AnnotationRelationORM.source_annotation_id == annotation_id)
            if direction in {"in", "both"}:
                clauses.append(AnnotationRelationORM.target_annotation_id == annotation_id)
            if not clauses:
                clauses = [AnnotationRelationORM.source_annotation_id == annotation_id]

            stmt = (
                select(AnnotationRelationORM)
                .where(or_(*clauses))
                .where(AnnotationRelationORM.source_annotation_id.in_(visible_annotations))
                .where(AnnotationRelationORM.target_annotation_id.in_(visible_annotations))
                .order_by(AnnotationRelationORM.created_at.asc())
            )
            result = await session.execute(stmt)
            return [self._to_relation_read(row) for row in result.scalars().all()]

    async def delete_relation(self, relation_id: str) -> bool:
        async with self.session_factory() as session:
            result = await session.execute(
                delete(AnnotationRelationORM).where(AnnotationRelationORM.relation_id == relation_id)
            )
            await session.commit()
            return bool(result.rowcount)
```

- [ ] **Step 6: Add Markdown reference sync**

Add inside `UnifiedAnnotationStore`:

```python
    async def sync_markdown_reference_relations(
        self,
        source_annotation_id: str,
        body: str,
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> None:
        links = extract_annotation_links(body)
        desired = {
            (link["annotation_id"], normalize_relation_type(link["relation_type"]))
            for link in links
            if link["annotation_id"] != source_annotation_id
        }

        async with self.session_factory() as session:
            existing = (
                await session.execute(
                    select(AnnotationRelationORM).where(
                        AnnotationRelationORM.source_annotation_id == source_annotation_id,
                        AnnotationRelationORM.source_kind == "markdown_link",
                    )
                )
            ).scalars().all()

            for rel in existing:
                key = (rel.target_annotation_id, rel.relation_type)
                if key not in desired:
                    await session.delete(rel)

            existing_keys = {(rel.target_annotation_id, rel.relation_type) for rel in existing}
            now = datetime.utcnow()
            for target_annotation_id, relation_type in desired - existing_keys:
                target = (
                    await session.execute(
                        select(AnnotationORM).where(AnnotationORM.annotation_id == target_annotation_id)
                    )
                ).scalar_one_or_none()
                if not target:
                    continue
                session.add(
                    AnnotationRelationORM(
                        relation_id=f"annot-rel-{uuid.uuid4().hex[:12]}",
                        source_annotation_id=source_annotation_id,
                        target_annotation_id=target_annotation_id,
                        relation_type=relation_type,
                        source_kind="markdown_link",
                        description="",
                        meta={},
                        created_by=actor_display_name or self.default_author,
                        updated_by=actor_display_name or self.default_author,
                        created_by_user_id=actor_user_id or None,
                        updated_by_user_id=actor_user_id or None,
                        created_at=now,
                        updated_at=now,
                    )
                )
            await session.commit()
```

- [ ] **Step 7: Clean relations on annotation delete**

Modify `delete()` in `src/storage/annotation_store.py` so it deletes relation rows before deleting the annotation:

```python
            await session.execute(
                delete(AnnotationRelationORM).where(
                    or_(
                        AnnotationRelationORM.source_annotation_id == annotation_id,
                        AnnotationRelationORM.target_annotation_id == annotation_id,
                    )
                )
            )
```

Expected placement: inside the same transaction, before deleting `AnnotationORM`.

- [ ] **Step 8: Run backend tests**

Run:

```bash
rtk pytest tests/test_annotation_relations.py tests/test_server_routes.py -q
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
rtk git add src/storage/annotation_store.py tests/test_annotation_relations.py
rtk git commit -m "feat: manage annotation relations in store"
```

Expected: commit succeeds.

---

### Task 4: Add Relation API Endpoints

**Files:**
- Modify: `src/api/schemas.py`
- Modify: `src/api/routers/annotations.py`
- Modify: `tests/test_annotation_relations.py`
- Modify: `tests/test_server_routes.py`

- [ ] **Step 1: Add schema tests**

Append to `tests/test_annotation_relations.py`:

```python
def test_annotation_relation_request_defaults():
    from src.api.schemas import AnnotationRelationRequest

    req = AnnotationRelationRequest(target_annotation_id="code-annot-b")
    assert req.relation_type == "references"
    assert req.description == ""
    assert req.meta == {}
```

- [ ] **Step 2: Add route registration test**

Append to `tests/test_server_routes.py`:

```python
def test_annotation_relation_routes_are_registered():
    paths = {getattr(route, "path", "") for route in app.routes}

    assert "/api/annotations/{annotation_id}/relations" in paths
    assert "/api/annotation-relations/{relation_id}" in paths
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
rtk pytest tests/test_annotation_relations.py tests/test_server_routes.py -q
```

Expected: FAIL because `AnnotationRelationRequest` and relation routes are missing.

- [ ] **Step 4: Add schemas**

Modify `src/api/schemas.py`:

```python
class AnnotationRelationRequest(BaseModel):
    target_annotation_id: str = Field(..., min_length=1, max_length=64)
    relation_type: str = Field("references", max_length=64)
    description: str = Field("", max_length=2000)
    meta: dict = Field(default_factory=dict)


class AnnotationRelationResponse(BaseModel):
    relation_id: str
    source_annotation_id: str
    target_annotation_id: str
    relation_type: str
    source_kind: str
    description: str = ""
    meta: dict = Field(default_factory=dict)
    created_by: str = ""
    updated_by: str = ""
    created_by_user_id: Optional[str] = None
    updated_by_user_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AnnotationRelationsResponse(BaseModel):
    annotation_id: str
    relations: list[AnnotationRelationResponse] = Field(default_factory=list)
```

- [ ] **Step 5: Add imports to annotation router**

Modify `src/api/routers/annotations.py` imports:

```python
from src.api.schemas import (
    AnnotationRelationRequest,
    AnnotationRelationResponse,
    AnnotationRelationsResponse,
    AnnotationResponse,
    DraftApplyRequest,
    DraftApplyResponse,
    _annotation_to_response,
)
from src.storage.models import AnnotationCreate, AnnotationORM, AnnotationRelationCreate, AnnotationUpdate
```

- [ ] **Step 6: Add relation routes**

Add to `src/api/routers/annotations.py` near other annotation routes:

```python
@router.get("/api/annotations/{annotation_id}/relations", response_model=AnnotationRelationsResponse)
async def list_annotation_relations(
    annotation_id: str,
    direction: str = Query("both", pattern="^(in|out|both)$"),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    relations = await state._annotation_store.list_relations(
        annotation_id,
        direction=direction,
        viewer_user_id=current_user.user_id if current_user else None,
        include_all_private=bool(current_user and _is_admin(current_user)),
    )
    return AnnotationRelationsResponse(
        annotation_id=annotation_id,
        relations=[AnnotationRelationResponse.model_validate(r.model_dump()) for r in relations],
    )


@router.post("/api/annotations/{annotation_id}/relations", response_model=AnnotationRelationResponse)
async def create_annotation_relation(
    annotation_id: str,
    request: AnnotationRelationRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    await _ensure_annotation_manage_access(annotation_id, current_user)
    try:
        relation = await state._annotation_store.create_relation(
            AnnotationRelationCreate(
                source_annotation_id=annotation_id,
                target_annotation_id=request.target_annotation_id,
                relation_type=request.relation_type,
                source_kind="manual",
                description=request.description,
                meta=request.meta,
            ),
            actor_user_id=current_user.user_id,
            actor_display_name=current_user.display_name,
        )
        return AnnotationRelationResponse.model_validate(relation.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/api/annotation-relations/{relation_id}")
async def delete_annotation_relation(
    relation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    deleted = await state._annotation_store.delete_relation(relation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Annotation relation {relation_id} not found")
    return {"status": "ok", "message": f"Annotation relation {relation_id} deleted"}
```

- [ ] **Step 7: Sync Markdown links after create and update**

In `create_annotation`, after `annotation = await state._annotation_store.create(...)` and before return:

```python
        await state._annotation_store.sync_markdown_reference_relations(
            annotation.annotation_id,
            annotation.body,
            actor_user_id=current_user.user_id,
            actor_display_name=current_user.display_name,
        )
```

In `update_annotation`, after `updated = await state._annotation_store.update(...)` and before return:

```python
    await state._annotation_store.sync_markdown_reference_relations(
        updated.annotation_id,
        updated.body,
        actor_user_id=current_user.user_id,
        actor_display_name=current_user.display_name,
    )
```

- [ ] **Step 8: Run backend tests**

Run:

```bash
rtk pytest tests/test_annotation_relations.py tests/test_server_routes.py -q
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
rtk git add src/api/schemas.py src/api/routers/annotations.py tests/test_annotation_relations.py tests/test_server_routes.py
rtk git commit -m "feat: expose annotation relation APIs"
```

Expected: commit succeeds.

---

### Task 5: Add Frontend API Types And Client Helpers

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`

- [ ] **Step 1: Add TypeScript relation types**

Modify `web/src/api/types.ts` after `AnnotationListResponse`:

```ts
export type AnnotationRelationType =
  | 'references'
  | 'explains'
  | 'refines'
  | 'contradicts'
  | 'same_variable'
  | 'variable_evolves_to'
  | 'value_passed_to'
  | 'depends_on'
  | 'evidence_for';

export type AnnotationRelationSourceKind = 'manual' | 'markdown_link' | 'system';

export interface AnnotationRelation {
  relation_id: string;
  source_annotation_id: string;
  target_annotation_id: string;
  relation_type: AnnotationRelationType;
  source_kind: AnnotationRelationSourceKind;
  description: string;
  meta: Record<string, unknown>;
  created_by: string;
  updated_by: string;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnotationRelationCreate {
  target_annotation_id: string;
  relation_type?: AnnotationRelationType;
  description?: string;
  meta?: Record<string, unknown>;
}

export interface AnnotationRelationsResponse {
  annotation_id: string;
  relations: AnnotationRelation[];
}
```

- [ ] **Step 2: Add client helpers**

Modify imports in `web/src/api/client.ts` to include the new types, then add:

```ts
export async function listAnnotationRelations(
  annotationId: string,
  direction: 'in' | 'out' | 'both' = 'both',
): Promise<AnnotationRelationsResponse> {
  const params = new URLSearchParams({ direction });
  return fetchJSON<AnnotationRelationsResponse>(
    `${API_BASE}/annotations/${encodeURIComponent(annotationId)}/relations?${params}`,
  );
}

export async function createAnnotationRelation(
  annotationId: string,
  data: AnnotationRelationCreate,
): Promise<AnnotationRelation> {
  return fetchWithBody<AnnotationRelation>(
    `${API_BASE}/annotations/${encodeURIComponent(annotationId)}/relations`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
}

export async function deleteAnnotationRelation(relationId: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/annotation-relations/${encodeURIComponent(relationId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

- [ ] **Step 3: Run TypeScript check**

Run:

```bash
rtk npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add web/src/api/types.ts web/src/api/client.ts
rtk git commit -m "feat: add annotation relation client APIs"
```

Expected: commit succeeds.

---

### Task 6: Render Markdown Annotation Links As Internal References

**Files:**
- Modify: `web/src/components/AnnotationMarkdown.tsx`
- Create: `web/src/components/__tests__/AnnotationMarkdown.test.tsx`

- [ ] **Step 1: Write the failing frontend test**

Create `web/src/components/__tests__/AnnotationMarkdown.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AnnotationMarkdown from '../AnnotationMarkdown';

describe('AnnotationMarkdown', () => {
  it('renders annotation links as internal buttons', () => {
    const onOpenAnnotation = vi.fn();

    render(
      <AnnotationMarkdown
        body={'See [initial value](annotation:code-annot-a1b2c3).'}
        onOpenAnnotation={onOpenAnnotation}
      />,
    );

    const link = screen.getByRole('button', { name: 'Open annotation initial value' });
    fireEvent.click(link);

    expect(onOpenAnnotation).toHaveBeenCalledWith('code-annot-a1b2c3');
  });

  it('keeps normal web links as anchors', () => {
    render(<AnnotationMarkdown body={'See [docs](https://example.com).'} />);

    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://example.com');
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
rtk npm --prefix web test -- src/components/__tests__/AnnotationMarkdown.test.tsx
```

Expected: FAIL because `onOpenAnnotation` is not a prop and annotation links render as normal anchors.

- [ ] **Step 3: Update Markdown renderer**

Modify `web/src/components/AnnotationMarkdown.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AnnotationMarkdownProps {
  body: string;
  className?: string;
  maxLength?: number;
  onOpenAnnotation?: (annotationId: string) => void;
}

function textFromChildren(children: React.ReactNode): string {
  return String(children ?? '').trim();
}

export default function AnnotationMarkdown({
  body,
  className = '',
  maxLength,
  onOpenAnnotation,
}: AnnotationMarkdownProps) {
  const displayContent = maxLength && body.length > maxLength
    ? `${body.slice(0, maxLength)}...`
    : body;

  return (
    <div className={`annotation-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            if (href?.startsWith('annotation:')) {
              const annotationId = href.slice('annotation:'.length);
              const label = textFromChildren(children) || annotationId;
              return (
                <button
                  type="button"
                  className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900"
                  aria-label={`Open annotation ${label}`}
                  onClick={() => onOpenAnnotation?.(annotationId)}
                >
                  {children}
                </button>
              );
            }

            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 4: Run frontend tests**

Run:

```bash
rtk npm --prefix web test -- src/components/__tests__/AnnotationMarkdown.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run TypeScript build**

Run:

```bash
rtk npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add web/src/components/AnnotationMarkdown.tsx web/src/components/__tests__/AnnotationMarkdown.test.tsx
rtk git commit -m "feat: render annotation markdown links"
```

Expected: commit succeeds.

---

### Task 7: Add Annotation Relations Panel

**Files:**
- Create: `web/src/components/AnnotationRelationsPanel.tsx`
- Create: `web/src/components/__tests__/AnnotationRelationsPanel.test.tsx`
- Modify: `web/src/components/AnnotationCard.tsx`

- [ ] **Step 1: Write the failing component test**

Create `web/src/components/__tests__/AnnotationRelationsPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AnnotationRelation } from '../../api/types';
import AnnotationRelationsPanel from '../AnnotationRelationsPanel';

const relation: AnnotationRelation = {
  relation_id: 'annot-rel-1',
  source_annotation_id: 'code-annot-a',
  target_annotation_id: 'code-annot-b',
  relation_type: 'variable_evolves_to',
  source_kind: 'manual',
  description: 'addr is page-aligned before the next note',
  meta: {},
  created_by: 'Tester',
  updated_by: 'Tester',
  created_at: '2026-05-14T00:00:00Z',
  updated_at: '2026-05-14T00:00:00Z',
};

describe('AnnotationRelationsPanel', () => {
  it('shows existing relations and creates a new relation', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <AnnotationRelationsPanel
        annotationId="code-annot-a"
        relations={[relation]}
        loading={false}
        error=""
        onOpenAnnotation={vi.fn()}
        onCreateRelation={onCreate}
        onDeleteRelation={vi.fn()}
      />,
    );

    expect(screen.getByText('variable_evolves_to')).toBeInTheDocument();
    expect(screen.getByText('code-annot-b')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Target annotation id'), {
      target: { value: 'code-annot-c' },
    });
    fireEvent.change(screen.getByLabelText('Relation type'), {
      target: { value: 'depends_on' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        target_annotation_id: 'code-annot-c',
        relation_type: 'depends_on',
        description: '',
        meta: {},
      });
    });
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
rtk npm --prefix web test -- src/components/__tests__/AnnotationRelationsPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Create the relation panel**

Create `web/src/components/AnnotationRelationsPanel.tsx`:

```tsx
import { Link2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { AnnotationRelation, AnnotationRelationCreate, AnnotationRelationType } from '../api/types';

const RELATION_TYPES: AnnotationRelationType[] = [
  'references',
  'explains',
  'refines',
  'contradicts',
  'same_variable',
  'variable_evolves_to',
  'value_passed_to',
  'depends_on',
  'evidence_for',
];

interface AnnotationRelationsPanelProps {
  annotationId: string;
  relations: AnnotationRelation[];
  loading: boolean;
  error: string;
  onOpenAnnotation: (annotationId: string) => void;
  onCreateRelation: (payload: AnnotationRelationCreate) => Promise<void>;
  onDeleteRelation: (relationId: string) => Promise<void>;
}

export default function AnnotationRelationsPanel({
  annotationId,
  relations,
  loading,
  error,
  onOpenAnnotation,
  onCreateRelation,
  onDeleteRelation,
}: AnnotationRelationsPanelProps) {
  const [targetAnnotationId, setTargetAnnotationId] = useState('');
  const [relationType, setRelationType] = useState<AnnotationRelationType>('references');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const target = targetAnnotationId.trim();
    if (!target || target === annotationId) return;
    setSubmitting(true);
    try {
      await onCreateRelation({
        target_annotation_id: target,
        relation_type: relationType,
        description: '',
        meta: {},
      });
      setTargetAnnotationId('');
      setRelationType('references');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-4 border-t border-slate-200 pt-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        Relations
      </div>

      {loading ? <p className="text-xs text-slate-500">Loading relations...</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="space-y-2">
        {relations.map((relation) => {
          const peer =
            relation.source_annotation_id === annotationId
              ? relation.target_annotation_id
              : relation.source_annotation_id;
          return (
            <div key={relation.relation_id} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="truncate text-left text-xs font-medium text-sky-700 hover:text-sky-900"
                  onClick={() => onOpenAnnotation(peer)}
                >
                  {peer}
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete relation ${relation.relation_id}`}
                  onClick={() => onDeleteRelation(relation.relation_id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{relation.relation_type}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid gap-2">
        <label className="grid gap-1 text-xs text-slate-600">
          <span>Target annotation id</span>
          <input
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            value={targetAnnotationId}
            onChange={(event) => setTargetAnnotationId(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>Relation type</span>
          <select
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            value={relationType}
            onChange={(event) => setRelationType(event.target.value as AnnotationRelationType)}
          >
            {RELATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={submitting || !targetAnnotationId.trim() || targetAnnotationId.trim() === annotationId}
          onClick={submit}
        >
          Add relation
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire panel into `AnnotationCard`**

Modify `web/src/components/AnnotationCard.tsx` to:

- Accept optional props `relations`, `relationsLoading`, `relationsError`, `onOpenAnnotation`, `onCreateRelation`, and `onDeleteRelation`.
- Render `AnnotationRelationsPanel` under Markdown body when `onCreateRelation` and `onDeleteRelation` are present.
- Pass `onOpenAnnotation` to `AnnotationMarkdown`.

Use this prop shape:

```ts
import type { AnnotationRelation, AnnotationRelationCreate } from '../api/types';

interface AnnotationCardProps {
  // keep existing props
  relations?: AnnotationRelation[];
  relationsLoading?: boolean;
  relationsError?: string;
  onOpenAnnotation?: (annotationId: string) => void;
  onCreateRelation?: (payload: AnnotationRelationCreate) => Promise<void>;
  onDeleteRelation?: (relationId: string) => Promise<void>;
}
```

Render:

```tsx
<AnnotationMarkdown body={annotation.body} onOpenAnnotation={onOpenAnnotation} />

{onCreateRelation && onDeleteRelation && onOpenAnnotation ? (
  <AnnotationRelationsPanel
    annotationId={annotation.annotation_id}
    relations={relations || []}
    loading={Boolean(relationsLoading)}
    error={relationsError || ''}
    onOpenAnnotation={onOpenAnnotation}
    onCreateRelation={onCreateRelation}
    onDeleteRelation={onDeleteRelation}
  />
) : null}
```

- [ ] **Step 5: Run component tests**

Run:

```bash
rtk npm --prefix web test -- src/components/__tests__/AnnotationRelationsPanel.test.tsx src/components/__tests__/AnnotationMarkdown.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run build**

Run:

```bash
rtk npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add web/src/components/AnnotationRelationsPanel.tsx web/src/components/AnnotationCard.tsx web/src/components/__tests__/AnnotationRelationsPanel.test.tsx
rtk git commit -m "feat: show annotation relations in cards"
```

Expected: commit succeeds.

---

### Task 8: Add Relation State To Annotation Detail Surfaces

**Files:**
- Modify: `web/src/components/PreviewModal.tsx`
- Modify: `web/src/workspace/components/EntityDetailPanel.tsx`
- Modify: `web/src/components/kernelCode/AnnotationPanel.tsx`

- [ ] **Step 1: Add relation loading behavior**

In each detail surface that renders `AnnotationCard`, add local state:

```ts
const [relations, setRelations] = useState<AnnotationRelation[]>([]);
const [relationsLoading, setRelationsLoading] = useState(false);
const [relationsError, setRelationsError] = useState('');
```

Add a loader:

```ts
async function loadRelations(annotationId: string) {
  setRelationsLoading(true);
  setRelationsError('');
  try {
    const data = await listAnnotationRelations(annotationId, 'both');
    setRelations(data.relations);
  } catch (error) {
    setRelationsError(error instanceof Error ? error.message : 'Failed to load annotation relations');
  } finally {
    setRelationsLoading(false);
  }
}
```

- [ ] **Step 2: Add relation mutations**

Add:

```ts
async function handleCreateRelation(annotationId: string, payload: AnnotationRelationCreate) {
  await createAnnotationRelation(annotationId, payload);
  await loadRelations(annotationId);
}

async function handleDeleteRelation(annotationId: string, relationId: string) {
  await deleteAnnotationRelation(relationId);
  await loadRelations(annotationId);
}
```

- [ ] **Step 3: Add internal annotation opening**

Use existing preview behavior where present. Where the surface has no preview callback, implement:

```ts
function handleOpenAnnotation(annotationId: string) {
  const next = relations.find(
    (relation) =>
      relation.source_annotation_id === annotationId ||
      relation.target_annotation_id === annotationId,
  );
  if (!next) return;
  window.dispatchEvent(new CustomEvent('open-annotation-reference', { detail: { annotationId } }));
}
```

Then subscribe in `PreviewModal.tsx`:

```ts
useEffect(() => {
  function onOpen(event: Event) {
    const custom = event as CustomEvent<{ annotationId?: string }>;
    if (custom.detail.annotationId) {
      // Fetch the annotation through the existing list API with q=annotation id, then preview the first exact match.
      openAnnotationById(custom.detail.annotationId);
    }
  }

  window.addEventListener('open-annotation-reference', onOpen);
  return () => window.removeEventListener('open-annotation-reference', onOpen);
}, [openAnnotationById]);
```

- [ ] **Step 4: Pass props into `AnnotationCard`**

Pass:

```tsx
relations={relations}
relationsLoading={relationsLoading}
relationsError={relationsError}
onOpenAnnotation={handleOpenAnnotation}
onCreateRelation={(payload) => handleCreateRelation(annotation.annotation_id, payload)}
onDeleteRelation={(relationId) => handleDeleteRelation(annotation.annotation_id, relationId)}
```

- [ ] **Step 5: Run build**

Run:

```bash
rtk npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add web/src/components/PreviewModal.tsx web/src/workspace/components/EntityDetailPanel.tsx web/src/components/kernelCode/AnnotationPanel.tsx
rtk git commit -m "feat: wire annotation relation state into detail views"
```

Expected: commit succeeds.

---

### Task 9: Add Lightweight Variable Trace For Code Annotations

**Files:**
- Create: `web/src/components/kernelCode/VariableTracePanel.tsx`
- Modify: `web/src/components/kernelCode/AnnotationPanel.tsx`
- Create: `web/src/components/kernelCode/__tests__/VariableTracePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/kernelCode/__tests__/VariableTracePanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AnnotationRelation, CodeAnnotation } from '../../../api/types';
import VariableTracePanel from '../VariableTracePanel';

function annotation(id: string, variableName: string, line: number): CodeAnnotation {
  return {
    annotation_id: id,
    annotation_type: 'code',
    version: 'v6.6',
    file_path: 'mm/mmap.c',
    start_line: line,
    end_line: line,
    body: `${variableName} note`,
    author: 'Tester',
    visibility: 'private',
    publish_status: 'none',
    created_at: '',
    updated_at: '',
    target_type: 'kernel_file',
    target_ref: 'v6.6:mm/mmap.c',
    target_label: 'mm/mmap.c',
    target_subtitle: 'v6.6',
    anchor: { variable_name: variableName, function_name: 'do_mmap' },
    meta: {},
  };
}

const relation: AnnotationRelation = {
  relation_id: 'rel-1',
  source_annotation_id: 'code-annot-a',
  target_annotation_id: 'code-annot-b',
  relation_type: 'variable_evolves_to',
  source_kind: 'manual',
  description: '',
  meta: {},
  created_by: 'Tester',
  updated_by: 'Tester',
  created_at: '',
  updated_at: '',
};

describe('VariableTracePanel', () => {
  it('shows variable flow between related code annotations', () => {
    render(
      <VariableTracePanel
        activeAnnotationId="code-annot-a"
        annotations={[annotation('code-annot-a', 'addr', 10), annotation('code-annot-b', 'addr', 18)]}
        relations={[relation]}
        onOpenAnnotation={() => undefined}
      />,
    );

    expect(screen.getByText('addr')).toBeInTheDocument();
    expect(screen.getByText('variable_evolves_to')).toBeInTheDocument();
    expect(screen.getByText('line 10')).toBeInTheDocument();
    expect(screen.getByText('line 18')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
rtk npm --prefix web test -- src/components/kernelCode/__tests__/VariableTracePanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Create variable trace panel**

Create `web/src/components/kernelCode/VariableTracePanel.tsx`:

```tsx
import { GitBranch } from 'lucide-react';
import type { AnnotationRelation, CodeAnnotation } from '../../api/types';

interface VariableTracePanelProps {
  activeAnnotationId: string;
  annotations: CodeAnnotation[];
  relations: AnnotationRelation[];
  onOpenAnnotation: (annotationId: string) => void;
}

function variableName(annotation: CodeAnnotation): string {
  const value = annotation.anchor?.variable_name || annotation.meta?.variable_name;
  return typeof value === 'string' && value.trim() ? value.trim() : 'variable';
}

function relevantRelations(activeAnnotationId: string, relations: AnnotationRelation[]) {
  const relationTypes = new Set(['same_variable', 'variable_evolves_to', 'value_passed_to', 'depends_on']);
  return relations.filter(
    (relation) =>
      relationTypes.has(relation.relation_type) &&
      (relation.source_annotation_id === activeAnnotationId || relation.target_annotation_id === activeAnnotationId),
  );
}

export default function VariableTracePanel({
  activeAnnotationId,
  annotations,
  relations,
  onOpenAnnotation,
}: VariableTracePanelProps) {
  const byId = new Map(annotations.map((annotation) => [annotation.annotation_id, annotation]));
  const active = byId.get(activeAnnotationId);
  const traceRelations = relevantRelations(activeAnnotationId, relations);

  if (!active || traceRelations.length === 0) return null;

  return (
    <section className="mt-3 rounded-md border border-sky-100 bg-sky-50/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-800">
        <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{variableName(active)}</span>
      </div>

      <div className="space-y-2">
        {traceRelations.map((relation) => {
          const source = byId.get(relation.source_annotation_id);
          const target = byId.get(relation.target_annotation_id);
          if (!source || !target) return null;

          return (
            <div key={relation.relation_id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
              <button type="button" className="text-left text-slate-700" onClick={() => onOpenAnnotation(source.annotation_id)}>
                line {source.start_line}
              </button>
              <span className="rounded bg-white px-1.5 py-0.5 text-[11px] text-sky-800">{relation.relation_type}</span>
              <button type="button" className="text-left text-slate-700" onClick={() => onOpenAnnotation(target.annotation_id)}>
                line {target.start_line}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire into code annotation panel**

Modify `web/src/components/kernelCode/AnnotationPanel.tsx` to render `VariableTracePanel` for the active or pinned code annotation:

```tsx
<VariableTracePanel
  activeAnnotationId={activeAnnotation.annotation_id}
  annotations={annotations}
  relations={relations}
  onOpenAnnotation={onOpenAnnotation}
/>
```

Use existing active annotation state from the roller work if present. If no active annotation state exists in the current branch, render it inside the selected annotation card only.

- [ ] **Step 5: Run frontend tests**

Run:

```bash
rtk npm --prefix web test -- src/components/kernelCode/__tests__/VariableTracePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run build**

Run:

```bash
rtk npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add web/src/components/kernelCode/VariableTracePanel.tsx web/src/components/kernelCode/AnnotationPanel.tsx web/src/components/kernelCode/__tests__/VariableTracePanel.test.tsx
rtk git commit -m "feat: show code annotation variable traces"
```

Expected: commit succeeds.

---

### Task 10: Browser QA And Final Verification

**Files:**
- No source files unless verification finds a defect.

- [ ] **Step 1: Run backend tests**

Run:

```bash
rtk pytest tests/test_annotation_relations.py tests/test_server_routes.py -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run:

```bash
rtk npm --prefix web test -- src/components/__tests__/AnnotationMarkdown.test.tsx src/components/__tests__/AnnotationRelationsPanel.test.tsx src/components/kernelCode/__tests__/VariableTracePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```bash
rtk npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 4: Start the dev server**

Run:

```bash
rtk npm run dev
```

Expected: Vite prints a local URL such as `http://localhost:5173/`.

- [ ] **Step 5: Browser-check Markdown annotation links**

Open a page that renders an annotation card. Create or edit an annotation body containing:

```md
See [the previous value](annotation:code-annot-example).
```

Expected:

- The link renders as an internal annotation reference button.
- Clicking the reference opens the referenced annotation preview if visible.
- If the target does not exist or is not visible to the user, the UI remains stable and shows no broken page navigation.

- [ ] **Step 6: Browser-check manual relations**

Open an annotation card and add a relation:

```text
target_annotation_id: code-annot-example
relation_type: variable_evolves_to
```

Expected:

- Relation appears in the card after creation.
- Relation can be deleted.
- The UI remains compact inside the existing card layout.

- [ ] **Step 7: Browser-check variable trace**

Open a kernel code annotation that has a `variable_evolves_to`, `same_variable`, `value_passed_to`, or `depends_on` relation.

Expected:

- Variable trace appears only when relevant relation data exists.
- Trace displays source line, relation type, and target line.
- Clicking either side opens the matching annotation.

- [ ] **Step 8: Final status**

Run:

```bash
rtk git status --short
```

Expected: only intentional files are modified, or the working tree is clean after commits.

---

## Self-Review Checklist

- Spec coverage: relation table, typed relations, Markdown internal links, backlinks through incoming relations, manual relation creation, and variable traces are covered.
- Placeholder scan: this plan avoids open placeholders and names every source file, test file, command, and expected result.
- Type consistency: backend relation fields use `relation_id`, `source_annotation_id`, `target_annotation_id`, `relation_type`, `source_kind`, `description`, and `meta`; frontend types mirror the same API names.
- Scope control: AST analysis, graph layout, and AI relation inference are explicitly outside this first slice.
