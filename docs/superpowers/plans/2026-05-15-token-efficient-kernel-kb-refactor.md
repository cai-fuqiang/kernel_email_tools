# Token-Efficient Kernel KB Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove product-layer AI features with minimum token burn, then improve code-annotation relation UX with tight model routing.

**Architecture:** Split work into narrow phases. Use small model for inventory and residue scans, coding model for bounded edits, frontier model only for design decisions and review. Keep retrieval infrastructure, remove Ask and Agent Research product layers, then land relation-picker UX in code flow.

**Tech Stack:** FastAPI, React, TypeScript, SQLAlchemy async, PostgreSQL, pytest, Vite, shell tooling (`rg`, `sed`, `git`, `pytest`, `npm`).

---

## File Map

### Phase 1: Inventory only

**Read-only scope:**
- `src/api/routers/ask.py`
- `src/api/routers/agent.py`
- `src/api/server.py`
- `src/api/state.py`
- `src/storage/ask_store.py`
- `src/storage/agent_store.py`
- `src/storage/models.py`
- `src/agent/research_service.py`
- `src/qa/ask_agent.py`
- `src/qa/ask_drafts.py`
- `web/src/pages/AskPage.tsx`
- `web/src/pages/AgentResearchPage.tsx`
- `web/src/api/client.ts`
- `web/src/api/types.ts`
- `web/src/layouts/MainLayout.tsx`
- `web/src/App.tsx`
- `web/src/pages/DashboardPage.tsx`
- `tests/test_agent_service.py`
- any `Ask` / `AgentResearch` references returned by `rg`

### Phase 2: Backend AI deletion

**Delete / modify scope:**
- Delete: `src/api/routers/ask.py`
- Delete: `src/api/routers/agent.py`
- Delete: `src/storage/ask_store.py`
- Delete: `src/storage/agent_store.py`
- Delete: `src/agent/research_service.py`
- Delete or reduce: `src/qa/ask_agent.py`
- Delete or reduce: `src/qa/ask_drafts.py`
- Modify: `src/api/server.py`
- Modify: `src/api/state.py`
- Modify: `src/storage/models.py`
- Delete / update related backend tests

### Phase 3: Frontend AI deletion

**Delete / modify scope:**
- Delete: `web/src/pages/AskPage.tsx`
- Delete: `web/src/pages/AgentResearchPage.tsx`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/layouts/MainLayout.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/DashboardPage.tsx`
- Delete / update related frontend hooks or components used only by Ask / Agent Research

### Phase 4: Navigation and workbench reshape

**Modify scope:**
- `web/src/layouts/MainLayout.tsx`
- `web/src/App.tsx`
- `web/src/pages/DashboardPage.tsx`
- optional supporting components used by dashboard or nav

### Phase 5: Relation UX MVP

**Likely modify scope:**
- `web/src/components/AnnotationRelationsPanel.tsx`
- `web/src/components/kernelCode/AnnotationPanel.tsx`
- `web/src/components/kernelCode/AnnotationPreviewContent.tsx`
- `web/src/pages/KernelCodePage.tsx`
- `web/src/api/client.ts`
- `web/src/api/types.ts`
- `src/api/routers/annotations.py`
- `src/storage/annotation_store.py`
- focused tests for relation picker behavior

## Model Routing Rules

### Default model map

- `gpt-5.4-mini`:
  - inventory
  - residue scans
  - file/reference lookup
  - docs touch-ups
  - "what still references X?" checks
- `gpt-5.3-codex`:
  - all bounded code edits
  - deletion passes
  - router/state/model cleanup
  - frontend navigation reshaping
  - relation-picker MVP implementation
- `gpt-5.5`:
  - scope disputes
  - data-model decisions
  - UX tradeoff review
  - final review before merge

### Reasoning effort

- `gpt-5.4-mini`: `low`
- `gpt-5.3-codex`: `medium`
- `gpt-5.5`: `medium`
- `gpt-5.5 high`: only when blocked by design ambiguity

### Hard rules

- Do not use `gpt-5.5` for grep-like exploration.
- Do not ask coding model to hold more than one phase in context.
- Do not mix AI deletion and relation UX in same execution batch.
- Commit after each phase to avoid reloading giant diffs later.

## Task 1: Inventory pass with small model

**Files:**
- Read: phase-1 file map above

- [ ] Run exact reference scan.

Run:
```bash
rtk rg -n "Ask|ask_store|AskConversation|AskTurn|AgentResearch|agent_store|AgentResearchRun|AgentRunAction|research-runs" src web tests
```

Expected:
```text
List of exact files and symbols tied to Ask / Agent Research.
```

- [ ] Have `gpt-5.4-mini` convert raw hits into four buckets.

Buckets:
```text
1. backend delete
2. frontend delete
3. model / DB delete
4. tests to remove or rewrite
```

- [ ] Save small inventory note in working thread, not new large spec.

- [ ] Commit nothing in this phase.

## Task 2: Backend AI hard deletion

**Files:**
- Delete / Modify: backend phase-2 scope
- Test: backend tests affected by Ask / Agent Research

- [ ] Dispatch `gpt-5.3-codex` with only backend scope.

Prompt payload:
```text
Phase 2 only. Remove Ask and Agent Research product-layer backend code. Keep retrieval infrastructure. Touch only listed backend files. Update imports, state wiring, ORM/read models, and tests. Do not work on frontend. Run focused pytest after edits.
```

- [ ] Run focused backend residue scan.

Run:
```bash
rtk rg -n "AskConversation|AskTurn|AgentResearchRun|AgentRunAction|ask_store|agent_store|research-runs" src tests
```

Expected:
```text
No live product references remain, or only intentionally retained retrieval-layer code remains.
```

- [ ] Run focused tests.

Run:
```bash
rtk pytest tests -q
```

Expected:
```text
Passing tests, or clear failures limited to files scheduled for next phase.
```

- [ ] Commit backend deletion.

```bash
git add src tests
git commit -m "chore: remove ask and agent backend"
```

## Task 3: Frontend AI hard deletion

**Files:**
- Delete / Modify: frontend phase-3 scope

- [ ] Dispatch `gpt-5.3-codex` with only frontend scope.

Prompt payload:
```text
Phase 3 only. Remove Ask and Agent Research product-layer frontend code. Update routes, nav, API client, types, and dashboard references. Do not modify relation UX yet. Run web build after edits.
```

- [ ] Run frontend residue scan.

Run:
```bash
rtk rg -n "AskPage|AgentResearchPage|research-runs|AskConversation|AskTurn|AgentResearchRun" web
```

Expected:
```text
No live frontend references remain.
```

- [ ] Run web build.

Run:
```bash
cd web && npm run build
```

Expected:
```text
Build succeeds.
```

- [ ] Commit frontend deletion.

```bash
git add web
git commit -m "chore: remove ask and agent frontend"
```

## Task 4: Navigation and home reshape

**Files:**
- Modify: phase-4 scope

- [ ] Ask `gpt-5.5` for one final IA review using current spec only.

Review checklist:
```text
- primary nav = Kernel Code / Search / Knowledge
- Annotations / Manuals / Tags demoted
- dashboard becomes light workbench home
- search visible but not primary homepage story
```

- [ ] Dispatch `gpt-5.3-codex` to implement only IA changes.

Prompt payload:
```text
Phase 4 only. Reshape navigation and dashboard according to spec. Do not start relation picker work. Keep edits limited to nav and workbench-home surfaces. Run web build.
```

- [ ] Run build.

Run:
```bash
cd web && npm run build
```

Expected:
```text
Build succeeds.
```

- [ ] Commit IA reshape.

```bash
git add web
git commit -m "feat: focus navigation on kernel code search and knowledge"
```

## Task 5: Relation UX MVP design check

**Files:**
- Read: phase-5 scope

- [ ] Ask `gpt-5.5` to validate only MVP boundary.

Boundary:
```text
- nearby candidates
- full-library fallback
- preview before confirmation
- relation type explanation
- no mail-thread recommendation dependency
- inline create optional for follow-up commit
```

- [ ] Freeze MVP scope before coding.

Expected:
```text
One short approved scope note. No large redesign detour.
```

## Task 6: Relation UX MVP implementation

**Files:**
- Modify: phase-5 scope
- Test: focused annotation relation tests

- [ ] Dispatch `gpt-5.3-codex` with MVP-only files and scope.

Prompt payload:
```text
Phase 6 only. Implement code-annotation relation picker MVP. Prioritize nearby candidates, full-library fallback, preview, and direction/type clarity. Keep current code context stable. Do not expand into broader knowledge-home redesign.
```

- [ ] Run focused frontend + backend validation.

Run:
```bash
rtk pytest tests/test_annotation_relations.py -q
```

Expected:
```text
Relation tests pass.
```

Run:
```bash
cd web && npm run build
```

Expected:
```text
Build succeeds.
```

- [ ] Commit MVP.

```bash
git add src web tests
git commit -m "feat: add relation picker mvp for code annotations"
```

## Task 7: Residue and token-discipline review

**Files:**
- Whole repo via search only

- [ ] Use `gpt-5.4-mini` for final residue scan, not frontier model.

Run:
```bash
rtk rg -n "Ask|Agent Research|research run|Ask Agent|ask conversation" src web README.md tests
```

Expected:
```text
Only intentional historical docs or planned wording remain.
```

- [ ] Use `gpt-5.5` once for final review.

Review prompt:
```text
Review only final diffs and spec compliance. Focus on regressions, missed references, data-model mistakes, and IA drift. No re-exploration of removed systems.
```

- [ ] Decide next branch:

```text
1. inline create-and-link follow-up
2. workbench home refinement
3. manuals / annotations / tags demotion cleanup
```

## Token Discipline Checklist

- [ ] One phase per worker.
- [ ] One model per job class.
- [ ] Search with shell before reading files.
- [ ] Read only touched files plus direct dependencies.
- [ ] Run tests immediately after each phase.
- [ ] Commit immediately after each phase.
- [ ] Never reload full repo context into coding model after a phase commit.
- [ ] Use `gpt-5.5` only for decision or review moments.

## Self-Review

Spec coverage:
- AI product-layer deletion covered by Tasks 1-4.
- token-efficient model selection covered by model-routing rules and token checklist.
- first meaningful UX improvement covered by Tasks 5-6.
- navigation / workbench direction covered by Task 4.

Placeholder scan:
- No `TODO` / `TBD`.
- Commands and model choices are concrete.

Type consistency:
- Symbol names align with current repo names: `AskConversation`, `AskTurn`, `AgentResearchRun`, `AgentRunAction`, `ask_store`, `agent_store`.

