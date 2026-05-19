# Has Subtopic Relation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `has_subtopic` as a first-class knowledge relation with validation, search/result labeling, and dedicated parent-page presentation while keeping evidence, notes, and other relations attached to normal entities.

**Architecture:** Reuse the existing `KnowledgeRelationORM` edge model instead of introducing a new subtopic object type. Enforce `has_subtopic` semantics in `KnowledgeStore`, project subtopic parent metadata into entity list results for search labeling, and surface subtopics as their own UI section while leaving evidence and notes scoped to the child entity page.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy async ORM, React, TypeScript, Vitest, pytest

---

### Task 1: Lock backend semantics with failing unit tests

**Files:**
- Modify: `tests/test_knowledge_enhancements.py`
- Modify: `web/src/components/knowledge/__tests__/knowledgeLayout.test.ts`

- [ ] **Step 1: Write failing pytest coverage for new `has_subtopic` semantics**

```python
from src.storage.knowledge_store import (
    HAS_SUBTOPIC_RELATION,
    KNOWLEDGE_RELATION_TYPES,
    SUBTOPIC_PARENT_META_KEY,
    can_relation_become_subtopic,
)
from src.storage.models import KnowledgeEntityRead


class TestKnowledgeSubtopicSemantics:
    def test_has_subtopic_relation_type_is_registered(self):
        assert HAS_SUBTOPIC_RELATION in KNOWLEDGE_RELATION_TYPES

    def test_subtopic_parent_meta_key_is_stable(self):
        assert SUBTOPIC_PARENT_META_KEY == "subtopic_parent"

    def test_subtopic_requires_aspect_style_names(self):
        assert can_relation_become_subtopic("VMCS", "VMCS lifecycle") is True
        assert can_relation_become_subtopic("VMCS", "Nested virtualization") is False
```

- [ ] **Step 2: Write failing Vitest coverage for subtopic labeling and grouping helpers**

```ts
import {
  buildEntityListSubtitle,
  splitRelationsForDocument,
} from '../knowledgeLayout';

expect(buildEntityListSubtitle(entity({
  meta: { subtopic_parent: { entity_id: 'vmx', canonical_name: 'VMX' } },
}))).toContain('Subtopic of VMX');

const groups = splitRelationsForDocument({
  outgoing: [relation({ relation_type: 'has_subtopic' })],
  incoming: [],
});
expect(groups.subtopics.length).toBe(1);
expect(groups.related.outgoing.length).toBe(0);
```

- [ ] **Step 3: Run the focused tests and verify they fail for the missing behavior**

Run:

```bash
pytest tests/test_knowledge_enhancements.py -q
cd web && npm test -- web/src/components/knowledge/__tests__/knowledgeLayout.test.ts
```

Expected: failures complaining about missing exported constants/helpers and missing subtopic grouping behavior.


### Task 2: Implement backend `has_subtopic` validation and entity search projection

**Files:**
- Modify: `src/storage/knowledge_store.py`
- Modify: `src/api/routers/knowledge.py`
- Modify: `src/storage/models.py`
- Modify: `web/src/api/types.ts`

- [ ] **Step 1: Add backend constants and helper functions for subtopic semantics**

```python
HAS_SUBTOPIC_RELATION = "has_subtopic"
SUBTOPIC_PARENT_META_KEY = "subtopic_parent"
KNOWLEDGE_RELATION_TYPES = {
    "related_to",
    "part_of",
    "explains",
    "caused_by",
    "fixed_by",
    "supersedes",
    "introduced_in",
    "removed_in",
    "affects_version",
    HAS_SUBTOPIC_RELATION,
}


def can_relation_become_subtopic(parent_name: str, child_name: str) -> bool:
    parent = parent_name.strip().lower()
    child = child_name.strip().lower()
    return bool(parent and child) and child.startswith(f"{parent} ")
```

- [ ] **Step 2: Enforce relation validation inside `KnowledgeStore.create_relation` and `update_relation`**

```python
if relation_type not in KNOWLEDGE_RELATION_TYPES:
    raise ValueError(f"Unsupported knowledge relation type: {relation_type}")

if relation_type == HAS_SUBTOPIC_RELATION:
    await self._validate_subtopic_relation(
        session,
        source_entity_id=source_entity_id,
        target_entity_id=target_entity_id,
        relation_id=None,
    )
else:
    await self._ensure_no_relation_pair_conflict(...)
```

- [ ] **Step 3: Add subtopic-specific guards**

```python
async def _validate_subtopic_relation(...):
    if source_entity_id == target_entity_id:
        raise ValueError("Subtopic relation cannot point to the same entity")
    if await self._has_subtopic_parent(session, source_entity_id):
        raise ValueError("Subtopic parents cannot also be subtopics yet")
    if await self._has_subtopic_parent(session, target_entity_id, exclude_relation_id=relation_id):
        raise ValueError("Each subtopic can only have one parent")
    if await self._relation_exists_between_pair(
        session,
        source_entity_id,
        target_entity_id,
        exclude_relation_id=relation_id,
    ):
        raise ValueError("Entities already have another relation; replace it instead of adding has_subtopic")
    if await self._would_create_subtopic_cycle(session, source_entity_id, target_entity_id, relation_id):
        raise ValueError("Subtopic relation would create a cycle")
```

- [ ] **Step 4: Project `subtopic_parent` metadata into entity list results used by search**

```python
async def _attach_subtopic_parent_meta(...):
    parent_relation_stmt = select(KnowledgeRelationORM).where(
        KnowledgeRelationORM.target_entity_id.in_(entity_ids),
        KnowledgeRelationORM.relation_type == HAS_SUBTOPIC_RELATION,
    )
    ...
    payload = dict(entity.meta or {})
    payload[SUBTOPIC_PARENT_META_KEY] = {
        "entity_id": parent.entity_id,
        "canonical_name": parent.canonical_name,
    }
```

- [ ] **Step 5: Extend `KnowledgeEntity` typing to expose subtopic parent metadata safely**

```ts
export interface KnowledgeEntitySubtopicParent {
  entity_id: string;
  canonical_name: string;
}
```

- [ ] **Step 6: Run backend/unit tests again**

Run:

```bash
pytest tests/test_knowledge_enhancements.py -q
```

Expected: passing tests for constants/helpers; any remaining failures should point to missing UI helpers only.


### Task 3: Implement UI grouping and labeling for subtopics

**Files:**
- Modify: `web/src/components/knowledge/knowledgeUtils.ts`
- Modify: `web/src/components/knowledge/knowledgeLayout.ts`
- Modify: `web/src/components/knowledge/KnowledgeRightRail.tsx`
- Modify: `web/src/components/knowledge/EntityListPanel.tsx`
- Modify: `web/src/components/knowledge/KnowledgeDocumentSections.tsx`
- Modify: `web/src/components/knowledge/EntityRelationsPanel.tsx`

- [ ] **Step 1: Add `has_subtopic` to the allowed relation list and expose label helpers**

```ts
export const RELATION_TYPES = [
  'related_to',
  'part_of',
  'has_subtopic',
  'explains',
  ...
];
```

- [ ] **Step 2: Add layout helpers for search subtitles and relation splitting**

```ts
export function buildEntityListSubtitle(entity: KnowledgeEntity) {
  const parent = extractSubtopicParent(entity);
  if (parent) return `Subtopic of ${parent.canonical_name}`;
  return readableType(entity.entity_type);
}

export function splitRelationsForDocument(relations: ...) {
  return {
    subtopics: relations.outgoing.filter((r) => r.relation_type === 'has_subtopic'),
    related: {
      outgoing: relations.outgoing.filter((r) => r.relation_type !== 'has_subtopic'),
      incoming: relations.incoming.filter((r) => r.relation_type !== 'has_subtopic'),
    },
  };
}
```

- [ ] **Step 3: Use the new subtitle helper in search/entity list cards**

```tsx
<span>{buildEntityListSubtitle(entity)}</span>
```

- [ ] **Step 4: Add a dedicated `Subtopics` section to `KnowledgeDocumentSections`**

```tsx
const relationGroups = splitRelationsForDocument(relations);
...
<section>
  <div className="...">Subtopics</div>
  {relationGroups.subtopics.map((item) => ...)}
</section>
```

- [ ] **Step 5: Keep the relations editor usable but visually distinguish subtopics**

```tsx
{relation.relation_type === 'has_subtopic' && (
  <span className="...">Subtopic</span>
)}
```

- [ ] **Step 6: Run the focused Vitest file and confirm it passes**

Run:

```bash
cd web && npm test -- web/src/components/knowledge/__tests__/knowledgeLayout.test.ts
```

Expected: PASS


### Task 4: Verification, memory updates, and commit

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Run the targeted backend and frontend verification suite**

Run:

```bash
pytest tests/test_knowledge_enhancements.py -q
cd web && npm test -- web/src/components/knowledge/__tests__/knowledgeLayout.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Append the architecture decision and clear current feature context**

```md
- 2026-05-19: knowledge subtopics are implemented as `has_subtopic` relations between normal knowledge entities, with dedicated parent-page and search-result presentation while evidence remains entity-scoped (src/storage/knowledge_store.py, src/api/routers/knowledge.py, web/src/components/knowledge/KnowledgeDocumentSections.tsx, web/src/components/knowledge/KnowledgeRightRail.tsx)
```

- [ ] **Step 3: Stage and commit the feature**

Run:

```bash
git add AGENTS.md docs/superpowers/plans/2026-05-19-has-subtopic-relation.md tests/test_knowledge_enhancements.py src/storage/knowledge_store.py src/api/routers/knowledge.py src/storage/models.py web/src/api/types.ts web/src/components/knowledge/knowledgeUtils.ts web/src/components/knowledge/knowledgeLayout.ts web/src/components/knowledge/KnowledgeRightRail.tsx web/src/components/knowledge/EntityListPanel.tsx web/src/components/knowledge/KnowledgeDocumentSections.tsx web/src/components/knowledge/EntityRelationsPanel.tsx web/src/components/knowledge/__tests__/knowledgeLayout.test.ts
git commit -m "feat: add knowledge subtopic relations"
```

- [ ] **Step 4: Sync the committed state to `home_pc`**

Run:

```bash
rtk ssh home_pc "cd ~/workspace/kernel_email_tools && git pull --ff-only"
```
