# Token Reduction Standards Design

**Date**: 2026-05-18  
**Status**: Approved  
**Goal**: Reduce per-feature token consumption via three complementary layers: code map, feature brief protocol, and tool usage rules.

---

## Problem

New feature development consumes excessive tokens primarily because AI agents explore the codebase from scratch each session. The project has ~78 Python files and ~78 TSX/TS files, with several large files (KernelCodePage.tsx at 105KB, models.py at 1209 lines, knowledge_store.py at 1282 lines). Without a code map, each feature begins with expensive free-form exploration.

Existing mitigations (RTK at 43% savings, caveman mode, claude-mem) are only partially leveraged. No Feature Brief protocol exists, so AI cannot scope work before exploring.

---

## Layer 1: AGENTS.md as Code Map

### Purpose
Give AI agents a single file to read before starting any task, replacing open-ended codebase exploration.

### Structure

```markdown
## Backend Modules (src/)

### High-Frequency (read first for most features)
- `src/storage/models.py` — All ORM models (Email, Annotation, AnnotationRelation, KnowledgeEntity, Tag, User). 1209 lines.
- `src/storage/knowledge_store.py` — UnifiedAnnotationStore + KnowledgeStore. Main data access layer. 1282 lines.
- `src/api/routers/annotations.py` — Annotation CRUD + relation endpoints. 26KB.
- `src/api/routers/knowledge.py` — Knowledge entity CRUD. 26KB.

### Stable (skip unless directly relevant)
- `src/parser/` — Email/patch parsing. Rarely changes.
- `src/collector/` — Git collection. Rarely changes.
- `src/translator/` — Google Translate wrapper. Stable.
- `src/retriever/` — Search backends (semantic/keyword/hybrid). Stable.

### Entry Points
- `src/api/routers/` — All HTTP endpoints (annotations, auth, kernel, knowledge, manual, search, system, tags, translations)
- `src/storage/migrations/` — Alembic migrations. Add new file per schema change.

## Frontend Modules (web/src/)

### High-Frequency
- `web/src/api/client.ts` — All API calls. 1436 lines. Check here before adding fetch calls.
- `web/src/api/types.ts` — All TypeScript types. 820 lines. Check here before defining new types.
- `web/src/pages/KernelCodePage.tsx` — Main kernel code view. 105KB. Largest file.
- `web/src/components/AnnotationRelationsPanel.tsx` — Relation display. 21.9KB.

### Stable (skip unless directly relevant)
- `web/src/components/Toast.tsx` — Toast notifications. Stable.
- `web/src/components/ConfirmModal.tsx` — Confirmation dialogs. Stable.
- `web/src/auth.tsx` — Auth context. Stable.

### Entry Points
- `web/src/App.tsx` — Route definitions
- `web/src/pages/` — Top-level page components (12 pages)
- `web/src/components/` — Shared components (30+ components)
```

### Maintenance Rule
When any feature adds/removes/renames a module or significantly changes a file's responsibility, update AGENTS.md in the same commit.

---

## Layer 2: Feature Brief Protocol

### Rule
Every new feature request must include a Feature Brief in the first message. AI must request one if absent before exploring code.

### Brief Template

```
## Feature Brief
目标: [one sentence]
影响模块:
  - backend: [file paths from AGENTS.md]
  - frontend: [file paths from AGENTS.md]
不影响: [explicit exclusions]
```

### AI Behavior
1. Receive task → check for Feature Brief
2. If missing → return template, do NOT explore code
3. If present → read only listed files, skip all others
4. After feature complete → record to claude-mem (see Layer 3)

### Example

```
## Feature Brief
目标: 在 AnnotationCard 中显示 relation count badge
影响模块:
  - backend: src/api/routers/annotations.py (add count field to response)
  - frontend: web/src/api/types.ts, web/src/api/client.ts, web/src/components/AnnotationCard.tsx
不影响: AnnotationRelationsPanel, KernelCodePage, storage layer
```

With this brief, AI reads 4 files instead of exploring 156 files.

---

## Layer 3: Tool Usage Rules

### Mandatory Tool Substitutions

| Scenario | Forbidden | Required |
|----------|-----------|----------|
| Find function definition | `Read` entire file | `LSP goToDefinition` or `smart-explore` |
| Find all callers | `grep` full repo | `LSP findReferences` |
| Read large file partially | `Read` (no limit) | `Read` with `offset` + `limit` |
| Restore cross-session context | Re-explore codebase | `claude-mem get_observations` |
| All communication | Normal prose | caveman full mode |
| Shell commands | Direct bash | RTK proxy (auto via hook) |

### Post-Feature Memory Protocol

After every feature is complete, AI must call claude-mem to record:

```
1. Files modified: [list]
2. New patterns introduced: [e.g., "AnnotationCard now accepts relationsCount prop"]
3. Architecture decisions: [e.g., "count computed server-side, not client-side"]
```

This prevents re-learning the same architecture in future sessions.

### File Read Budget

When a Feature Brief is present, AI must read only the listed files plus their direct imports if needed. No speculative reads. If an unlisted file seems relevant, add it to the Brief first (one message exchange), then read it.

---

## Implementation Plan

### Phase 1 — AGENTS.md Code Map (1 session)
- Write full AGENTS.md with backend + frontend module index
- Mark high-frequency vs stable zones
- Commit alongside this spec

### Phase 2 — Feature Brief Protocol (immediate)
- Add brief template to AGENTS.md
- Add rule to CLAUDE.md or project-level instructions: "Always provide Feature Brief"
- No code changes needed

### Phase 3 — Tool Rules Enforcement (immediate)
- Add tool substitution table to AGENTS.md
- Add post-feature memory protocol to AGENTS.md
- Verify caveman mode is active by default (already configured)

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Files read per feature | Unknown (untracked) | ≤ listed files + 2 |
| Cross-session re-exploration | Common | Eliminated via claude-mem |
| Feature Brief adoption | 0% | 100% of new features |
| RTK savings | 43.4% | 50%+ (more commands covered) |

---

## Non-Goals

- Splitting large files (KernelCodePage.tsx, models.py) — out of scope, high risk
- Automated Brief generation — human writes Brief, AI enforces it
- Changing code architecture — this spec is process/tooling only
