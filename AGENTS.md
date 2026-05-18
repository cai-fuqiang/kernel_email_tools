# AGENTS.md — Kernel Email Tools Code Map

> Read this file before starting any task. It replaces codebase exploration.
> Update this file when you add/remove/rename modules or change a file's responsibility.

---

## Feature Brief Protocol

Every new feature request MUST include a Feature Brief. If absent, return this template and do NOT explore code:

```
## Feature Brief
目标: [one sentence]
影响模块:
  - backend: [file paths from this file's module list]
  - frontend: [file paths from this file's module list]
不影响: [explicit exclusions]
```

With a brief, read ONLY the listed files. No speculative reads. If an unlisted file seems relevant, ask to add it to the brief first.

---

## Backend Modules (src/)

### High-Frequency — read first for most features

| File | Responsibility |
|------|---------------|
| `src/storage/models.py` | All ORM models: UserORM, TagORM, EmailORM, AnnotationORM, AnnotationRelationORM, KnowledgeEntityORM. Large file. |
| `src/storage/annotation_store.py` | Annotation persistence layer (read/write annotations). 37KB. Check here for annotation DB operations. |
| `src/storage/knowledge_store.py` | KnowledgeStore. Knowledge entity data access. Large file. |
| `src/storage/tag_store.py` | Tag persistence layer. 41KB. |
| `src/api/routers/annotations.py` | Annotation CRUD + relation endpoints. 26KB. |
| `src/api/routers/knowledge.py` | Knowledge entity CRUD. 26KB. |
| `src/api/deps.py` | FastAPI dependencies (auth, db session). |
| `src/api/schemas.py` | Shared Pydantic request/response schemas. |

### Stable — skip unless directly relevant

| Path | Responsibility |
|------|---------------|
| `src/parser/` | Email/patch parsing. Rarely changes. |
| `src/collector/` | Git commit collection. Rarely changes. |
| `src/translator/` | Google Translate wrapper. Stable. |
| `src/retriever/` | Search backends (semantic/keyword/hybrid). Stable. |
| `src/chunker/` | Text chunking for indexing. Stable. |
| `src/indexer/` | Vector indexing. Stable. |

### Entry Points

| Path | Purpose |
|------|---------|
| `src/api/server.py` | FastAPI app creation, router registration |
| `src/api/routers/` | All HTTP endpoints: annotations, auth, kernel, knowledge, manual, search, system, tags, translations |
| `src/storage/migrations/` | Alembic migrations. Add new file per schema change, never modify existing ones. |

---

## Frontend Modules (web/src/)

### High-Frequency — check before adding new code

| File | Responsibility |
|------|---------------|
| `web/src/api/client.ts` | All API fetch calls. Large file. Check here before adding fetch calls to avoid duplicates. |
| `web/src/api/types.ts` | All TypeScript types. Check here before defining new types. |
| `web/src/pages/KernelCodePage.tsx` | Main kernel code browser. 105KB. Largest file. |
| `web/src/components/AnnotationRelationsPanel.tsx` | Annotation relation display. 21.9KB. |
| `web/src/components/kernelCode/AnnotationPanel.tsx` | Annotation panel within kernel code view. 50.6KB. |
| `web/src/components/knowledge/KnowledgeWorkbench.tsx` | Knowledge entity workbench. 38.7KB. |

### Stable — skip unless directly relevant

| Path | Responsibility |
|------|---------------|
| `web/src/components/Toast.tsx` | Toast notifications. Stable. |
| `web/src/components/ConfirmModal.tsx` | Confirmation dialogs. Stable. |
| `web/src/auth.tsx` | Auth context provider. Stable. |
| `web/src/components/ui.tsx` | Base UI primitives. Stable. |

### Entry Points

| Path | Purpose |
|------|---------|
| `web/src/App.tsx` | Route definitions — all page routes registered here |
| `web/src/pages/` | Top-level pages (12): AnnotationsPage, DashboardPage, KernelCodePage, KernelAnnotationPreviewPage, KernelSymbolPreviewPage, KnowledgePage, LoginPage, ManualSearchPage, RegisterPage, SearchPage, TagsPage, UsersPage |
| `web/src/components/kernelCode/` | Kernel code sub-components: AnnotationPanel, CodeHistoryPanel, AnnotationQuickPreviewPopover, KernelSymbolQuickPreviewPopover |
| `web/src/components/knowledge/` | Knowledge sub-components: KnowledgeWorkbench, KnowledgeRightRail, EntityListPanel, EntityRelationsPanel, EvidencePanel, KnowledgeTimelinePanel |
| `web/src/components/search/` | Search sub-components: SearchBar, AdvancedFilters, AnnotationResults, ResultCard |

---

## Tool Usage Rules

| Scenario | Forbidden | Use instead |
|----------|-----------|-------------|
| Find function definition | Read entire file | LSP goToDefinition or smart-explore |
| Find all callers | grep full repo | LSP findReferences |
| Read large file partially | Read (no limit) | Read with offset + limit |
| Restore cross-session context | Re-explore codebase | Read this file (Architecture Decisions Log + Current Feature Context below) |
| Shell commands | Direct bash | RTK proxy (auto via hook) |
| All communication (Claude) | Normal prose | caveman full mode |

---

## Post-Feature Protocol

After every feature is complete, ALL AI agents must:

1. Append to **Architecture Decisions Log** below:
   `- YYYY-MM-DD: [decision] ([file reference])`
2. Clear **Current Feature Context** section below
3. Update High-Frequency table above if new key files added

---

## Architecture Decisions Log

<!-- Append after every feature. Never delete entries. -->
- 2026-05-18: annotation relation routes placed before catchall thread route (src/api/routers/annotations.py)
- 2026-05-18: annotation count computed server-side not client-side (src/api/routers/annotations.py)
- 2026-05-18: AGENTS.md is primary cross-session memory for all AI agents; claude-mem is Claude-only supplement

---

## Current Feature Context

<!-- Active only during feature development. Clear (replace with empty comment) when feature is merged. -->
<!-- No active feature -->
