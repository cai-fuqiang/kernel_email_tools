# Token Reduction Standards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a three-layer token reduction system (code map + feature brief protocol + tool rules) that works for both Claude and Codex.

**Architecture:** AGENTS.md becomes the single source of truth for codebase orientation, eliminating free-form exploration. A Feature Brief protocol gates every new feature request. Tool usage rules replace expensive patterns with targeted alternatives.

**Tech Stack:** Markdown files only — no code changes. Git for versioning. Works with any AI agent (Claude, Codex, Gemini, etc).

---

### Task 1: Write AGENTS.md Code Map

**Files:**
- Modify: `AGENTS.md` (replace current claude-mem-context stub with full code map)

- [ ] **Step 1: Replace AGENTS.md with full code map**

Write the following content to `AGENTS.md` exactly:

```markdown
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
| `src/storage/models.py` | All ORM models: UserORM, TagORM, EmailORM, AnnotationORM, AnnotationRelationORM, KnowledgeEntityORM. 1209 lines. |
| `src/storage/knowledge_store.py` | UnifiedAnnotationStore + KnowledgeStore. Main data access layer. 1282 lines. |
| `src/api/routers/annotations.py` | Annotation CRUD + relation endpoints. 26KB. |
| `src/api/routers/knowledge.py` | Knowledge entity CRUD. 26KB. |
| `src/api/deps.py` | FastAPI dependencies (auth, db session). 24.8KB. |
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
| `web/src/api/client.ts` | All API fetch calls. 1436 lines. Check here before adding fetch calls to avoid duplicates. |
| `web/src/api/types.ts` | All TypeScript types. 820 lines. Check here before defining new types. |
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
```

- [ ] **Step 2: Verify file written correctly**

Check the file has all major sections:
```bash
grep -n "^## " AGENTS.md
```
Expected output (in order):
```
## Feature Brief Protocol
## Backend Modules (src/)
## Frontend Modules (web/src/)
## Tool Usage Rules
## Post-Feature Protocol
## Architecture Decisions Log
## Current Feature Context
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add AGENTS.md code map with feature brief protocol and tool rules"
```

---

### Task 2: Add Feature Brief Rule to Project Instructions

**Files:**
- Create: `CLAUDE.md` (project-level Claude instructions)

The project has no `CLAUDE.md` at root. Create one so Claude enforces the Feature Brief protocol automatically on every session start.

- [ ] **Step 1: Create CLAUDE.md**

Write the following to `CLAUDE.md`:

```markdown
# Project Instructions

## Feature Brief Required

Every new feature request MUST include a Feature Brief. If a request lacks one, return the template below and do NOT explore the codebase:

```
## Feature Brief
目标: [one sentence]
影响模块:
  - backend: [file paths]
  - frontend: [file paths]
不影响: [explicit exclusions]
```

## Session Start

Read `AGENTS.md` before any task. It contains the code map, tool rules, and cross-session context (Architecture Decisions Log, Current Feature Context).

## Token Rules

- caveman full mode always active
- Use LSP tools instead of reading entire files
- Use `Read` with `offset`+`limit` for large files
- No speculative reads beyond Feature Brief scope

## After Each Feature

Update `AGENTS.md`:
1. Append to Architecture Decisions Log
2. Clear Current Feature Context
3. Update module tables if new files added
```

- [ ] **Step 2: Verify**

```bash
cat CLAUDE.md
```
Confirm all 4 sections present: Feature Brief Required, Session Start, Token Rules, After Each Feature.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add project CLAUDE.md with feature brief and token rules"
```

---

### Task 3: Add Codex Instructions

**Files:**
- Create: `AGENTS.md` already handles Codex (it reads AGENTS.md by convention)

Codex reads `AGENTS.md` natively. But Codex also reads a project-level `AGENTS.md` for behavioral instructions. Our AGENTS.md now combines code map + behavioral rules, so Codex will see the Feature Brief Protocol and Post-Feature Protocol automatically.

Verify Codex sees the right content by checking the Feature Brief Protocol is at the top of AGENTS.md (already done in Task 1). No additional file needed.

- [ ] **Step 1: Verify AGENTS.md Feature Brief section is near top**

```bash
head -20 AGENTS.md
```
Expected: `# AGENTS.md` header and `## Feature Brief Protocol` within first 20 lines.

- [ ] **Step 2: Add Codex-specific note to AGENTS.md**

Add one line to the top of AGENTS.md under the title to flag claude-mem unavailability:

Open `AGENTS.md` and edit the line after `# AGENTS.md — Kernel Email Tools Code Map`:

```markdown
> **Note for Codex:** claude-mem is unavailable. Use Architecture Decisions Log and Current Feature Context sections below as cross-session memory.
```

Final top of file should read:
```markdown
# AGENTS.md — Kernel Email Tools Code Map

> Read this file before starting any task. It replaces codebase exploration.
> Update this file when you add/remove/rename modules or change a file's responsibility.
> **Note for Codex:** claude-mem is unavailable. Use Architecture Decisions Log and Current Feature Context sections below as cross-session memory.
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add Codex-specific claude-mem note to AGENTS.md"
```

---

### Task 4: Verify the Full System Works End-to-End

No code to write — manual verification that the three layers are in place and consistent.

- [ ] **Step 1: Check all files exist**

```bash
ls -la AGENTS.md CLAUDE.md docs/superpowers/specs/2026-05-18-token-reduction-standards-design.md docs/superpowers/plans/2026-05-18-token-reduction-standards.md
```
Expected: all 4 files present, non-zero size.

- [ ] **Step 2: Verify AGENTS.md has all required sections**

```bash
grep -c "^## " AGENTS.md
```
Expected: `7` (Feature Brief Protocol, Backend Modules, Frontend Modules, Tool Usage Rules, Post-Feature Protocol, Architecture Decisions Log, Current Feature Context)

- [ ] **Step 3: Verify CLAUDE.md enforces Feature Brief**

```bash
grep -c "Feature Brief" CLAUDE.md
```
Expected: `2` or more.

- [ ] **Step 4: Simulate a new session**

Read only AGENTS.md and confirm you can answer:
- Where are annotation endpoints? (`src/api/routers/annotations.py`)
- Where are all TypeScript types? (`web/src/api/types.ts`)
- What's the biggest frontend file? (`web/src/pages/KernelCodePage.tsx`, 105KB)
- What architectural decisions were made? (Architecture Decisions Log section)

- [ ] **Step 5: Commit plan file if not already committed**

```bash
git add docs/superpowers/plans/2026-05-18-token-reduction-standards.md
git diff --cached --name-only
```
If the plan file appears, commit it:
```bash
git commit -m "docs: add token reduction standards implementation plan"
```

- [ ] **Step 6: Verify git log**

```bash
git log --oneline -5
```
Expected (in order, newest first):
```
docs: add token reduction standards implementation plan
docs: add Codex-specific claude-mem note to AGENTS.md
docs: add project CLAUDE.md with feature brief and token rules
docs: add AGENTS.md code map with feature brief protocol and tool rules
```
