# Annotation-Centered Knowledge Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn annotations into the unified cross-domain knowledge layer, then replace the current force-directed graph with a lightweight knowledge map that shows only high-value annotation structure.

**Architecture:** Extend the existing unified annotation substrate instead of creating a separate claim/evidence stack. First add richer annotation typing, targeting, and promotion metadata in the backend. Then update frontend annotation entry points and types. Finally replace the current generic graph surface with a semantic map that renders promoted annotations around a current object.

**Tech Stack:** FastAPI, SQLAlchemy async, PostgreSQL JSONB, Pydantic, pytest, React, TypeScript, Vite, Vitest, Cytoscape or equivalent custom layout rendering.

---

## File Map

### Backend annotation model and API

- Modify: `src/storage/models.py`
- Modify: `src/storage/annotation_store.py`
- Modify: `src/api/routers/annotations.py`
- Modify: `src/api/schemas.py`
- Modify: `src/storage/migrations/20260514_add_annotation_relations.py` or add a new migration file for annotation metadata expansion
- Test: `tests/test_annotation_relations.py`
- Test: new focused backend tests for annotation target and promotion behavior

### Frontend annotation types and entry points

- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/components/ThreadDrawer.tsx`
- Modify: `web/src/components/AnnotationTree.tsx`
- Modify: `web/src/components/kernelCode/AnnotationPanel.tsx`
- Modify: `web/src/components/knowledge/KnowledgeWorkbench.tsx`
- Test: existing frontend annotation tests
- Test: new focused UI tests for type and target rendering

### Knowledge map redesign

- Modify: `web/src/components/KnowledgeGraphView.tsx`
- Modify: `web/src/components/knowledge/EntityRelationsPanel.tsx`
- Modify: `web/src/components/knowledge/KnowledgeWorkbench.tsx`
- Create or modify: supporting map inspector components if the existing file becomes too large
- Test: `web/src/components/knowledge/__tests__/knowledgeLayout.test.ts`
- Test: new focused map layout tests if extracted helpers are added

## Task 1: Extend annotation schema for annotation-centered knowledge

**Files:**
- Modify: `src/storage/models.py`
- Create: `src/storage/migrations/20260518_expand_annotations_for_knowledge_map.py`
- Test: `tests/test_annotation_knowledge_schema.py`

- [ ] **Step 1: Write the failing backend schema tests**

```python
from src.storage.models import AnnotationCreate


def test_annotation_create_accepts_claim_and_link_types():
    data = AnnotationCreate(
        annotation_type="claim",
        body="mmap_lock is held on this path",
        target_type="symbol",
        target_ref="symbol:do_mmap",
    )
    assert data.annotation_type == "claim"


def test_annotation_create_requires_meaningful_content():
    try:
        AnnotationCreate(
            annotation_type="link",
            body="",
            target_type="commit",
            target_ref="commit:deadbeef",
            meta={},
        )
    except Exception as exc:
        assert "short_label" in str(exc) or "body" in str(exc)
    else:
        raise AssertionError("expected validation failure")
```

- [ ] **Step 2: Run the test to verify failure**

Run:
```bash
rtk pytest tests/test_annotation_knowledge_schema.py -v
```

Expected:
```text
FAIL because the current schema only understands the old annotation shapes.
```

- [ ] **Step 3: Add the Phase 2 annotation fields and migration**

Model changes should include:

```python
short_label: Mapped[str] = mapped_column(String(256), nullable=False, default="")
pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
related_targets: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
```

Pydantic changes should include validation for:

```python
annotation_type in {"excerpt", "claim", "note", "summary", "link"}
```

Validation rule:

```python
if not body.strip() and not short_label.strip():
    raise ValueError("annotation requires body or short_label")
```

- [ ] **Step 4: Run focused tests to verify the model passes**

Run:
```bash
rtk pytest tests/test_annotation_knowledge_schema.py -v
```

Expected:
```text
PASS
```

- [ ] **Step 5: Commit the schema layer**

```bash
git add src/storage/models.py src/storage/migrations/20260518_expand_annotations_for_knowledge_map.py tests/test_annotation_knowledge_schema.py
git commit -m "feat: expand annotation schema for knowledge map"
```

## Task 2: Teach the annotation store and API about primary and related targets

**Files:**
- Modify: `src/storage/annotation_store.py`
- Modify: `src/api/routers/annotations.py`
- Modify: `src/api/schemas.py`
- Test: `tests/test_annotation_targeting.py`

- [ ] **Step 1: Write failing store and router tests**

```python
async def test_create_annotation_persists_related_targets(annotation_store):
    created = await annotation_store.create_annotation(
        AnnotationCreate(
            annotation_type="claim",
            body="folio batching was introduced here",
            target_type="commit",
            target_ref="commit:abc123",
            meta={"short_label": "folio batching intro"},
            related_targets=[
                {"target_type": "symbol", "target_ref": "symbol:filemap_fault"},
                {"target_type": "mail_thread", "target_ref": "thread:lkml-123"},
            ],
        )
    )
    assert len(created.meta["related_targets"]) == 2
```

- [ ] **Step 2: Run the focused backend tests and verify failure**

Run:
```bash
rtk pytest tests/test_annotation_targeting.py -v
```

Expected:
```text
FAIL because related target persistence and response serialization do not exist yet.
```

- [ ] **Step 3: Implement API request and response support**

Backend request shape should support:

```python
class AnnotationTargetRef(BaseModel):
    target_type: str
    target_ref: str
    target_label: str = ""
    target_subtitle: str = ""
    anchor: dict = Field(default_factory=dict)
    role: str = ""
```

The create flow should:

- keep `target_type` and `target_ref` as the primary target
- persist `related_targets` in a stable JSON structure
- surface `short_label` and `pinned` explicitly in responses

- [ ] **Step 4: Run the focused tests and existing annotation tests**

Run:
```bash
rtk pytest tests/test_annotation_targeting.py tests/test_annotation_relations.py -v
```

Expected:
```text
PASS
```

- [ ] **Step 5: Commit the targeting layer**

```bash
git add src/storage/annotation_store.py src/api/routers/annotations.py src/api/schemas.py tests/test_annotation_targeting.py
git commit -m "feat: add annotation primary and related targets"
```

## Task 3: Normalize high-value annotation behavior for map rendering

**Files:**
- Modify: `src/storage/annotation_store.py`
- Modify: `src/api/routers/annotations.py`
- Test: `tests/test_annotation_map_selection.py`

- [ ] **Step 1: Write failing selection tests**

```python
async def test_map_selection_returns_only_promoted_annotations(annotation_store):
    rows = await annotation_store.list_map_annotations(target_type="symbol", target_ref="symbol:do_mmap")
    assert all(item.annotation_type in {"claim", "summary", "link", "note"} for item in rows)
    assert all(item.annotation_type != "excerpt" for item in rows)
```

- [ ] **Step 2: Run tests and verify failure**

Run:
```bash
rtk pytest tests/test_annotation_map_selection.py -v
```

Expected:
```text
FAIL because there is no dedicated map selection behavior.
```

- [ ] **Step 3: Implement promoted annotation query logic**

Recommended selection rule:

```python
include = (
    annotation_type in {"claim", "summary", "link"}
    or (annotation_type == "note" and pinned)
)
```

Provide either:

- a dedicated annotation-store query, or
- a router-level filtered view if a dedicated store method is still overkill

- [ ] **Step 4: Run focused tests**

Run:
```bash
rtk pytest tests/test_annotation_map_selection.py -v
```

Expected:
```text
PASS
```

- [ ] **Step 5: Commit the selection behavior**

```bash
git add src/storage/annotation_store.py src/api/routers/annotations.py tests/test_annotation_map_selection.py
git commit -m "feat: add promoted annotation selection for maps"
```

## Task 4: Update frontend API types and annotation forms

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/components/ThreadDrawer.tsx`
- Modify: `web/src/components/AnnotationTree.tsx`
- Modify: `web/src/components/kernelCode/AnnotationPanel.tsx`
- Modify: `web/src/components/knowledge/KnowledgeWorkbench.tsx`
- Test: `web/src/components/kernelCode/__tests__/AnnotationPanel.test.ts`
- Test: `web/src/components/__tests__/ThreadAnnotationCard.test.tsx`

- [ ] **Step 1: Write failing frontend type-level and rendering tests**

```tsx
it('renders claim and summary annotation chips', () => {
  const annotation = { annotation_type: 'claim', short_label: 'Locking guarantee' };
  expect(annotation.annotation_type).toBe('claim');
});
```

- [ ] **Step 2: Run focused frontend tests and verify failure**

Run:
```bash
rtk npm test -- --run web/src/components/kernelCode/__tests__/AnnotationPanel.test.ts
```

Expected:
```text
FAIL because the UI only knows the older annotation categories.
```

- [ ] **Step 3: Add frontend support for the new annotation shape**

Type changes should include:

```ts
related_targets: Array<{
  target_type: string;
  target_ref: string;
  target_label?: string;
  target_subtitle?: string;
  anchor?: Record<string, unknown>;
  role?: string;
}>;
short_label: string;
pinned: boolean;
```

UI changes should:

- expose `claim`, `summary`, `link`, and `note`
- preserve existing email/code creation flows
- allow optional promotion controls where the surface makes sense

- [ ] **Step 4: Run focused frontend tests**

Run:
```bash
rtk npm test -- --run web/src/components/kernelCode/__tests__/AnnotationPanel.test.ts web/src/components/__tests__/ThreadAnnotationCard.test.tsx
```

Expected:
```text
PASS
```

- [ ] **Step 5: Commit the frontend annotation shape update**

```bash
git add web/src/api/types.ts web/src/api/client.ts web/src/components/ThreadDrawer.tsx web/src/components/AnnotationTree.tsx web/src/components/kernelCode/AnnotationPanel.tsx web/src/components/knowledge/KnowledgeWorkbench.tsx
git commit -m "feat: support annotation-centered knowledge metadata in ui"
```

## Task 5: Build a knowledge-map data adapter on top of promoted annotations

**Files:**
- Modify: `web/src/components/knowledge/KnowledgeWorkbench.tsx`
- Modify: `web/src/components/knowledge/knowledgeUtils.ts`
- Create: `web/src/components/knowledge/knowledgeMap.ts`
- Test: `web/src/components/knowledge/__tests__/knowledgeMap.test.ts`

- [ ] **Step 1: Write failing adapter tests**

```ts
it('builds a map model from a current object and promoted annotations', () => {
  const model = buildKnowledgeMapModel({
    center: { entity_id: 'symbol:do_mmap', canonical_name: 'do_mmap', entity_type: 'symbol' },
    annotations: [
      {
        annotation_id: 'ann-1',
        annotation_type: 'claim',
        short_label: 'Caller already holds mmap_lock',
        target_type: 'symbol',
        target_ref: 'symbol:do_mmap',
        related_targets: [{ target_type: 'commit', target_ref: 'commit:abc123' }],
      },
    ],
  });
  expect(model.annotationNodes).toHaveLength(1);
  expect(model.relatedObjectNodes).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:
```bash
rtk npm test -- --run web/src/components/knowledge/__tests__/knowledgeMap.test.ts
```

Expected:
```text
FAIL because no map adapter exists yet.
```

- [ ] **Step 3: Implement a pure map adapter**

The adapter should:

- accept the current object
- accept promoted annotations
- derive:
  - `centerNode`
  - `annotationNodes`
  - `relatedObjectNodes`
  - `edges`
- exclude low-value annotations by default

- [ ] **Step 4: Run focused tests**

Run:
```bash
rtk npm test -- --run web/src/components/knowledge/__tests__/knowledgeMap.test.ts
```

Expected:
```text
PASS
```

- [ ] **Step 5: Commit the map adapter**

```bash
git add web/src/components/knowledge/KnowledgeWorkbench.tsx web/src/components/knowledge/knowledgeUtils.ts web/src/components/knowledge/knowledgeMap.ts web/src/components/knowledge/__tests__/knowledgeMap.test.ts
git commit -m "feat: add annotation-centered knowledge map adapter"
```

## Task 6: Replace the generic graph with a semantic knowledge map

**Files:**
- Modify: `web/src/components/KnowledgeGraphView.tsx`
- Modify: `web/src/components/knowledge/EntityRelationsPanel.tsx`
- Modify: `web/src/components/knowledge/KnowledgeWorkbench.tsx`
- Create if needed: `web/src/components/knowledge/KnowledgeMapInspector.tsx`
- Test: `web/src/components/knowledge/__tests__/knowledgeLayout.test.ts`

- [ ] **Step 1: Write failing view tests for the new information architecture**

```tsx
it('shows Knowledge Map instead of Local knowledge graph', () => {
  expect(renderedHtml).toContain('Knowledge Map');
});

it('shows filter controls for promoted annotation classes', () => {
  expect(renderedHtml).toContain('Claims');
  expect(renderedHtml).toContain('Summaries');
});
```

- [ ] **Step 2: Run focused UI tests and verify failure**

Run:
```bash
rtk npm test -- --run web/src/components/knowledge/__tests__/knowledgeLayout.test.ts
```

Expected:
```text
FAIL because the existing graph is still a force-directed local graph.
```

- [ ] **Step 3: Implement the semantic map layout**

The new view should:

- rename the panel to `Knowledge Map`
- render:
  - center object card
  - left-side promoted annotation cards
  - right-side related object cards
- hide edge labels by default
- expose a top filter bar:
  - `Claims`
  - `Summaries`
  - `Links`
  - `Pinned notes`
- route detail reading into an inspector instead of overloading the graph itself

- [ ] **Step 4: Run focused UI tests and a frontend build**

Run:
```bash
rtk npm test -- --run web/src/components/knowledge/__tests__/knowledgeLayout.test.ts
rtk npm run build
```

Expected:
```text
PASS
Vite build succeeds
```

- [ ] **Step 5: Commit the map redesign**

```bash
git add web/src/components/KnowledgeGraphView.tsx web/src/components/knowledge/EntityRelationsPanel.tsx web/src/components/knowledge/KnowledgeWorkbench.tsx web/src/components/knowledge/KnowledgeMapInspector.tsx web/src/components/knowledge/__tests__/knowledgeLayout.test.ts
git commit -m "feat: redesign knowledge graph as annotation-centered map"
```

## Task 7: Verify cross-surface annotation flows and document the rollout boundary

**Files:**
- Modify: `README.md` if product behavior needs a brief update
- Modify: the new spec and plan only if self-review reveals gaps
- Test: relevant backend and frontend focused suites

- [ ] **Step 1: Run the focused backend suite**

Run:
```bash
rtk pytest tests/test_annotation_knowledge_schema.py tests/test_annotation_targeting.py tests/test_annotation_map_selection.py tests/test_annotation_relations.py -v
```

Expected:
```text
PASS
```

- [ ] **Step 2: Run the focused frontend suite**

Run:
```bash
rtk npm test -- --run web/src/components/kernelCode/__tests__/AnnotationPanel.test.ts web/src/components/__tests__/ThreadAnnotationCard.test.tsx web/src/components/knowledge/__tests__/knowledgeMap.test.ts web/src/components/knowledge/__tests__/knowledgeLayout.test.ts
```

Expected:
```text
PASS
```

- [ ] **Step 3: Run a residue scan to ensure no Phase 3-only concepts leaked into Phase 2**

Run:
```bash
rtk rg -n "class Claim|SourceSegmentORM|graph database|neo4j" src web tests docs/superpowers/plans/2026-05-18-annotation-centered-knowledge-map.md
```

Expected:
```text
No new production code should depend on a separate Claim model, SourceSegment ORM, or graph database.
```

- [ ] **Step 4: Commit final verification or docs touch-ups if needed**

```bash
git add README.md docs/superpowers/specs/2026-05-18-annotation-centered-knowledge-map-design.md docs/superpowers/plans/2026-05-18-annotation-centered-knowledge-map.md
git commit -m "docs: finalize annotation-centered knowledge map rollout"
```

## Self-Review

### Spec coverage

- Unified annotation target model: covered by Tasks 1 and 2.
- Annotation-centered knowledge bridge: covered by Tasks 2, 3, and 5.
- Knowledge map redesign: covered by Tasks 5 and 6.
- Phase 2 lightweight boundary: enforced in Task 7 residue scan.

### Placeholder scan

- No placeholder markers remain.
- Commands, files, and expected results are concrete enough to execute.

### Type consistency

- `annotation_type`, `short_label`, `related_targets`, and `pinned` are used consistently throughout the plan.
- The map redesign relies on promoted annotations instead of a new `Claim` model.
