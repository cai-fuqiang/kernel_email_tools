# AGENTS.md — Kernel Email Tools Code Map

> Read this file before starting any task. It replaces codebase exploration.
> Update this file when you add/remove/rename modules or change a file's responsibility.
> **Note for Codex:** claude-mem is unavailable. Use Architecture Decisions Log and Current Feature Context sections below as cross-session memory.

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

## AI Workflow Assets

### High-Frequency — read before project work

| File | Responsibility |
|------|---------------|
| `AGENTS.md` | Primary project memory, code map, token budget rules, and feature brief gate. |
| `.codex/skills/kernel-email-tools-token/SKILL.md` | Project-local low-token workflow skill for Codex sessions. |
| `docs/ai/brief-templates.md` | Compressed request templates for feature, bug, review, and refactor work. |

---

## Token Budget Rules

1. Read `AGENTS.md` first. Use it as memory before exploring code or old chats.
2. Require a brief for any project work. No brief, no code exploration.
3. Read only paths listed in the brief. If scope expands, update the brief first.
4. For large files, read targeted sections only. Prefer offset/limit, symbol lookup, or references.
5. Use `rtk` for shell commands.
6. Keep responses short by default: decision first, details only when needed.
7. Summarize findings once. Do not restate the same context in multiple messages.

---

## Permanent Memory Rules

1. `AGENTS.md` is the permanent memory anchor for this repo.
2. Store stable facts and lasting workflow decisions in **Architecture Decisions Log**.
3. Store active session notes only in **Current Feature Context**. Clear it when the feature is done.
4. Keep permanent memory compact. Prefer one-line decisions with file references.
5. Specs and plans in `docs/superpowers/` are secondary memory: useful for design history, not first-read context.
6. Repeated prompt scaffolding belongs in `docs/ai/brief-templates.md`, not in chat history.

---

## Default Brief Templates

Default templates live in `docs/ai/brief-templates.md`.

Use:
- `Feature Brief` for new behavior or docs/process work
- `Bug Brief` for defects or regressions
- `Review Brief` for code review or audit requests
- `Refactor Brief` for structure-only changes

Keep briefs small: one sentence goal, exact paths, explicit exclusions, clear acceptance signal.

---

## Local Skill Registry

- `kernel-email-tools-token`: default low-token project workflow
- `ui-ux-pro-max`: design reference workflow for UI/UX tasks

If a task is project-specific and token efficiency matters, load `kernel-email-tools-token` first.

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
- 2026-05-19: project-local token workflow anchored in AGENTS.md plus kernel-email-tools-token skill and brief templates (AGENTS.md, .codex/skills/kernel-email-tools-token/SKILL.md, docs/ai/brief-templates.md)

---

## Current Feature Context

<!-- Active only during feature development. Clear (replace with empty comment) when feature is merged. -->
<!-- -->


<claude-mem-context>
# Memory Context

# [kernel_email_tools] recent context, 2026-05-18 11:03pm GMT+8

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 41 obs (11,718t read) | 1,459,796t work | 99% savings

### May 14, 2026
2 1:36p 🔵 Annotation relationship visualization design question raised
3 1:39p 🟣 Annotation relation primitives and Markdown link parser
5 1:55p 🟣 Annotation relation primitives and Markdown link parser implemented
6 " ✅ Task 2 migration re-review requested
4 " ✅ Migration execution-path tests approved after CapturingConnection rewrite
7 " 🟣 Annotation relations migration and tests implemented
10 " 🔵 AnnotationRelationORM SQL compilation verified for PostgreSQL
11 " 🔵 AnnotationRelationRead model_validate fails on ORM objects with None defaults
12 " 🔵 Regex parser correctly normalizes deprecated RELATION_TYPES
13 " 🔵 SQLite DDL compilation fails due to ARRAY type in EmailORM
14 " 🔵 7 unit tests pass for annotation relation primitives
8 1:58p 🟣 Annotation relations migration and tests completed
9 " 🔵 Task 2 migration re-review: path fixed, substring coverage unresolved
21 2:06p 🔵 Review scope without session execution data
24 2:10p 🟣 Annotation relation CRUD operations added to UnifiedAnnotationStore
25 " 🟣 AnnotationRelationORM model and migration added
26 " 🟣 Annotation relation Pydantic models for create/read
27 " 🟣 Markdown annotation link parser utility
28 " 🔵 Task 3 test suite passes 13 tests
29 " 🟣 Annotation relation CRUD operations added to UnifiedAnnotationStore
44 2:18p 🟣 Annotation relation system implemented end-to-end
45 " 🟣 AnnotationRelationParser extracts markdown annotation links
46 " 🔴 Self-link bypass via whitespace trimming gap closed
47 " 🔴 react-markdown annotation: protocol URLs stripped by defaultUrlTransform
48 " 🔴 Frontend API client URL path and parameter alignment fixes
49 " 🟣 AnnotationRelationsPanel neighborhood UI built
50 " 🟣 Markdown annotation links render as interactive buttons
51 " ⚖️ Annotation relation routes placed before catchall thread route
52 " ✅ Annotation UI feedback: crowded layout missing annotation ID display
S73 UX polish for annotation relation display (declutter, AnnotationIdBadge) + caveman skill check (May 14 at 2:18 PM)
S72 Annotation relation display UX polish — declutter interfaces and surface annotation IDs everywhere (May 14 at 2:18 PM)
S75 继续计划 — user asks to continue with next steps after annotation relation system completion (May 14 at 5:21 PM)
130 8:16p 🟣 AnnotationIdBadge added to remaining preview surfaces
131 " 🟣 Annotation search results focus thread on specific annotation
S88 Confirm how annotation relationships are displayed (May 14 at 8:16 PM)
134 " 🟣 Shareable annotation links via AnnotationIdBadge
142 8:19p 🟣 Added shareable annotation deep links with copy-to-clipboard
143 " 🟣 Backend search now matches annotation_id, target_ref, file_path directly
144 " 🟣 Exact annotation ID search highlighted and promoted in both annotation pages
145 " 🔴 Fixed stale migration_sql assertions in wrong test class
146 " 🔵 Dev server sandbox restrictions prevent local browser QA
147 " ✅ Annotation relations plan Tasks 1-10 fully executed across 12 commits
148 9:05p ✅ Annotation relations system verification complete
141 9:42p 🟣 Installed caveman skill from external GitHub repo
149 10:28p 🔵 virtio_net module fails to load due to missing net_failover symbols
S89 Confirm how annotation relationships are displayed — created comprehensive usage guide (May 14 at 10:38 PM)
**Investigated**: Explored full annotation system: AnnotationRelationsPanel.tsx (outgoing/incoming relations), VariableTracePanel.tsx (code-flow trace), AnnotationMarkdown.tsx (annotation: links), AnnotationIdBadge.tsx, backend annotations.py router, AnnotationsPage.tsx

**Learned**: System supports 9 relation types (references, explains, refines, contradicts, same_variable, variable_evolves_to, value_passed_to, depends_on, evidence_for). Two display modes: Relations Panel (structured outgoing/incoming per annotation) and Variable Trace (filtered code-flow subset with variable names from meta). Markdown supports `annotation:<id>` links rendered as clickable internal buttons

**Completed**: Created docs/annotation-user-guide.md (477 lines) covering annotation ID system, relationship types, variable tracing, Markdown references, preview/detail workflow, multi-entry navigation. Updated README.md with link. Committed as `c81aa3c`

**Next Steps**: Session appears complete — no active work items remaining


Access 1460k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
