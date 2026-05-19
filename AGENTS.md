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
8. For frontend design work, prefer verifying against `http://aliyun.cloud.vm:8080` when it is available.

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
4. Commit the completed feature or bugfix before ending the task
5. Sync the committed state to `home_pc:~/workspace/kernel_email_tools`

---

## Architecture Decisions Log

<!-- Append after every feature. Never delete entries. -->
- 2026-05-18: annotation relation routes placed before catchall thread route (src/api/routers/annotations.py)
- 2026-05-18: annotation count computed server-side not client-side (src/api/routers/annotations.py)
- 2026-05-18: AGENTS.md is primary cross-session memory for all AI agents; claude-mem is Claude-only supplement
- 2026-05-19: project-local token workflow anchored in AGENTS.md plus kernel-email-tools-token skill and brief templates (AGENTS.md, .codex/skills/kernel-email-tools-token/SKILL.md, docs/ai/brief-templates.md)
- 2026-05-19: kernel commit browsing uses structured file/hunk patch data plus hunk-level nearest-tag jump targets in the history inspector (src/api/routers/kernel.py, web/src/components/kernelCode/CodeHistoryPanel.tsx, web/src/pages/KernelCodePage.tsx)
- 2026-05-19: commit detail modal uses stacked metadata-over-patch layout with dark-theme-safe diff colors to keep patch browsing readable in narrow dialogs (web/src/components/kernelCode/CodeHistoryPanel.tsx)
- 2026-05-19: commit patch preview now uses row-based hunks with on-demand context expansion and a GitHub-style unified diff surface while preserving current-version and nearest-tag jumps (src/api/routers/kernel.py, web/src/api/types.ts, web/src/api/client.ts, web/src/components/kernelCode/commitPatchModel.ts, web/src/components/kernelCode/CodeHistoryPanel.tsx)
- 2026-05-19: incremental patch expansion keeps remaining `up` expanders above revealed context so `Expand ... above` stays visible while hidden lines remain (src/api/routers/kernel.py, tests/api/test_kernel_commit_browser.py)
- 2026-05-19: patch browser expansion scrolls to the first revealed context line so clicking `Expand ... lines above` makes newly loaded lines immediately visible (web/src/components/kernelCode/CodeHistoryPanel.tsx, web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx)
- 2026-05-19: patch browser expand API now returns inserted context rows plus optional remaining expander, and the UI preserves the nearest stable line instead of calling `scrollIntoView` so inline expansion feels stitched rather than refreshed (src/api/routers/kernel.py, web/src/components/kernelCode/CodeHistoryPanel.tsx, web/src/components/kernelCode/commitPatchModel.ts)
- 2026-05-19: patch browser now renders one unified diff table per file, folds duplicate inter-hunk gap expanders into a single in-table separator, and uses Codex-style directional expansion affordances instead of separate hunk cards (web/src/components/kernelCode/CodeHistoryPanel.tsx, web/src/components/kernelCode/commitPatchModel.ts)
- 2026-05-19: unified file-level patch rendering compiles with a single file container ref plus commitPatchModel-owned display-row helpers; stale hunk-card imports and props should be removed when touching CodeHistoryPanel.tsx (web/src/components/kernelCode/CodeHistoryPanel.tsx, web/src/components/kernelCode/commitPatchModel.ts)
- 2026-05-19: AGENTS.md now requires per-feature commits, sync to `home_pc`, and frontend-design verification against `http://aliyun.cloud.vm:8080` when available (AGENTS.md)
- 2026-05-19: commit patch navigation actions now live on file patch objects while hunk headers remain model-only and are not rendered inside the diff table (src/api/routers/kernel.py, web/src/components/kernelCode/commitPatchModel.ts, web/src/components/kernelCode/CodeHistoryPanel.tsx)

---

## Current Feature Context

<!-- Active only during feature development. Clear (replace with empty comment) when feature is merged. -->
<!-- -->


<claude-mem-context>
# Memory Context

# [kernel_email_tools] recent context, 2026-05-19 4:17pm GMT+8

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (14,274t read) | 1,952,784t work | 99% savings

### May 14, 2026
142 8:19p 🟣 Added shareable annotation deep links with copy-to-clipboard
143 " 🟣 Backend search now matches annotation_id, target_ref, file_path directly
144 " 🟣 Exact annotation ID search highlighted and promoted in both annotation pages
145 " 🔴 Fixed stale migration_sql assertions in wrong test class
146 " 🔵 Dev server sandbox restrictions prevent local browser QA
147 " ✅ Annotation relations plan Tasks 1-10 fully executed across 12 commits
148 9:05p ✅ Annotation relations system verification complete
141 9:42p 🟣 Installed caveman skill from external GitHub repo
149 10:28p 🔵 virtio_net module fails to load due to missing net_failover symbols
S112 GitHub-style kernel commit patch browser redesign - replace split dual-`pre` patch preview with unified diff table with inline context expanders, backend row-based hunk model, and expansion API endpoint (May 14 at 10:38 PM)
### May 18, 2026
180 10:57p 🔴 Fix merge_entities annotation retargeting for legacy knowledge_entity type
181 " 🔴 Fix KnowledgeGraphView stale selection when model entity changes
182 " 🟣 Add navigability guard for knowledge map related object nodes
### May 19, 2026
183 11:04a 🟣 Kernel commit browser feature committed
184 " 🔴 Fix line number clamping in KernelCodePage when line exceeds file length
185 " 🔵 short_label DB migration not applied on production database
186 " 🔵 Remote home_pc server down — app not running on port 8080
187 1:06p 🔴 Line clamping fix committed as 5d1faef
188 " ✅ README.md doc cleanup committed
189 " ✅ AGENTS.md memory context updated
190 " 🔵 home_pc missing settings.yaml and backend server
191 " 🔵 short_label DB migration not applied on aliyun.cloud.vm
192 " 🔵 Kernel code API returns Internal Server Error on aliyun.cloud.vm
193 1:12p 🔵 home_pc has serve.py running after initial check missed it
194 " 🔵 aliyun.cloud.vm confirmed running uvicorn
195 1:16p 🔵 home_pc config found in config/settings.yaml
196 " 🔵 home_pc DB schema missing short_label/pinned/related_targets columns
197 " 🔴 DB migration applied to home_pc annotations table
198 " 🔴 Annotation API now returns data after migration
208 1:19p 🔵 Commit 5d1faef confirmed on home_pc
199 1:25p 🔴 Patch browser UI layout fix
200 1:26p 🔴 Patch browser layout fix - prevent squeeze on large screens
201 " ✅ Patch browser layout approach pivoted to stacked layout
202 1:53p ✅ Patch preview redesign to GitHub-style single-block diff
S113 GitHub-style kernel commit patch browser redesign - replace split dual-`pre` patch preview with unified diff table with inline context expanders (May 19 at 1:53 PM)
S111 Redesign patch preview from split two-block display to GitHub-style single-block diff with inline context expansion (May 19 at 1:53 PM)
203 " 🟣 Implementation plan written for GitHub-style patch browser
S114 核对 home_pc 仓库 HEAD、进程工作目录及接口行为 — 区分代码没切到 5d1faef 还是服务没重载 (May 19 at 1:53 PM)
204 1:54p 🔵 Session initiated for GitHub-style patch browser implementation
205 2:06p 🔄 Row-based hunk normalization for patch browser UI model
206 2:08p 🟣 Row-based hunk normalization added to patch browser UI model
207 2:23p 🟣 GitHub-style patch browser backend row model implemented
S115 提交吧 — user requested to commit pending patch browser improvements on delete_AI_function branch (May 19 at 2:49 PM)
209 3:00p 🔴 Patch browser "Expand above" button missing after upward context expansion
210 " 🔴 Patch expander visibility preserved after incremental expansion
211 3:02p 🟣 patch browser scrolls to first revealed line after context expansion
212 " ✅ CodeHistoryPanel.tsx imports useRef and CommitPatchLineRowView
213 " ✅ delete_AI_function branch 1 commit ahead of origin after scroll fix
S116 Implement Codex-style inline patch expansion in commit browser — replace scroll-jumping `scrollIntoView` with viewport-anchored scroll offset compensation, and change API contract from flat `replacement_rows` to `inserted_rows` + optional `remaining_expander` (May 19 at 3:26 PM)
214 3:33p 🟣 Codex-style patch browser expansion implementation started
215 3:39p 🟣 Codex-style patch browser context expansion with inline merge and stable viewport
216 " 🟣 Unified file-level patch surface with merged inter-hunk expanders
S117 Per-file single continuous patch code block: merge all hunks into one diff table, fold inter-hunk gap expanders into single in-table separator, use Codex-style directional expand (May 19 at 3:39 PM)
S120 Session resume - still awaiting Feature Brief before code changes begin in kernel_email_tools (May 19 at 3:43 PM)
217 3:52p 🟣 Unified file-level patch surface with merged inter-hunk expanders
218 3:57p ⚖️ Configured AGENT.md with commit-and-sync workflow
219 4:06p ⚖️ File-level granularity for gap navigation features
S118 Discuss UI gap removal and file-level granularity for "open in current version" and "open in nested gap" features in kernel_email_tools project (May 19 at 4:06 PM)
S119 Discuss UI gap removal and file-level granularity for navigation features in kernel_email_tools; agent awaits Feature Brief per AGENTS.md conventions (May 19 at 4:06 PM)
220 " ⚖️ Superpowers workflow initiated for kernel_email_tools feature

Access 1953k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
