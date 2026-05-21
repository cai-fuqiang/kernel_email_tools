# Multi-Repository Code Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a configurable multi-repository source browser that keeps the existing kernel browser working and adds QEMU through generic `/api/code/{repo_id}` APIs plus `/code/:repoId`.

**Architecture:** Register source repositories in `src/api/state.py` and initialize them in `src/api/server.py` from `kernel_source` plus `code_repositories`. Add generic code routes in `src/api/routers/kernel.py`, parameterize the existing code browser page by repository id, and keep kernel-only annotations/history on `linux`.

**Tech Stack:** FastAPI, existing `GitLocalSource` / `FallbackKernelSource` / `ElixirSource`, React Router, Vitest, pytest.

---

### Task 1: Backend Registry And Generic Routes

**Files:**
- Modify: `src/api/state.py`
- Modify: `src/api/server.py`
- Modify: `src/api/routers/kernel.py`
- Modify: `src/kernel_source/elixir.py`
- Test: `tests/test_kernel_resolver.py`

- [ ] **Step 1: Write failing backend tests**

Add tests for:
- registering a fake `qemu` repository in `state._code_repositories`
- resolving `qemu` paths through `/app/code/qemu?...`
- building QEMU Elixir symbol URLs with `/qemu/...`
- returning 404 for an unknown repo id

Run: `rtk pytest tests/test_kernel_resolver.py -q`
Expected: FAIL because generic code routes and registry do not exist yet.

- [ ] **Step 2: Implement registry**

Add `_code_repositories: dict[str, dict] = {}` to `src/api/state.py`.

In `src/api/server.py`, initialize `linux` from `kernel_source` and each configured `code_repositories` entry from:

```yaml
code_repositories:
  qemu:
    name: QEMU
    repo_path: /path/to/qemu/.git
    default_version: master
    elixir_base: https://elixir.bootlin.com/qemu
```

- [ ] **Step 3: Make ElixirSource project-aware**

Allow `ElixirSource(base_url="https://elixir.bootlin.com/qemu")` while preserving the current Linux default. Parse symbol links relative to the configured project path.

- [ ] **Step 4: Add generic routes**

Add:
- `GET /api/code/repositories`
- `GET /api/code/{repo_id}/versions`
- `GET /api/code/{repo_id}/tree/{version}` and `/{path:path}`
- `GET /api/code/{repo_id}/file/{version}/{path:path}`
- `GET /api/code/{repo_id}/resolve`
- `GET /api/code/{repo_id}/symbol-resolve`

Keep existing `/api/kernel/...` behavior unchanged by delegating to the `linux` source where practical.

- [ ] **Step 5: Run backend tests**

Run: `rtk pytest tests/test_kernel_resolver.py -q`
Expected: PASS.

### Task 2: Frontend API And Links

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/utils/externalLinks.ts`
- Test: `web/src/utils/__tests__/externalLinks.test.ts`

- [ ] **Step 1: Write failing frontend utility tests**

Add tests for:
- `codeBrowserPath('qemu', 'master', 'README.rst', 3)` returning `/code/qemu?...`
- `bootlinSourceUrl('https://elixir.bootlin.com/qemu', 'master', 'README.rst', 3)` returning the QEMU Bootlin URL
- kernel wrappers still returning `/kernel-code?...`

Run: `rtk npm --prefix web test -- externalLinks.test.ts --run`
Expected: FAIL because generic helpers do not exist.

- [ ] **Step 2: Add API types and client calls**

Add repository metadata types and generic `getCodeRepositories`, `getCodeVersions`, `getCodeTree`, `getCodeFile`, `resolveCodeSource`, and `resolveCodeSymbol` functions.

- [ ] **Step 3: Add generic external link helpers**

Add generic local browser and Bootlin helpers, then keep existing kernel helpers as wrappers.

- [ ] **Step 4: Run utility tests**

Run: `rtk npm --prefix web test -- externalLinks.test.ts --run`
Expected: PASS.

### Task 3: Frontend Page And Routes

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/layouts/MainLayout.tsx`
- Modify: `web/src/pages/KernelCodePage.tsx`
- Test: `web/src/pages/__tests__/KernelCodePage.test.ts`
- Test: `web/src/layouts/__tests__/MainLayout.test.ts`

- [ ] **Step 1: Write failing page tests**

Add source-text tests confirming:
- `/code/:repoId` route exists
- navigation includes a QEMU Code entry
- drag payload can target `/app/code/qemu?...`

Run: `rtk npm --prefix web test -- KernelCodePage.test.ts MainLayout.test.ts --run`
Expected: FAIL because the generic route and payload support do not exist.

- [ ] **Step 2: Parameterize KernelCodePage**

Add `repoId` support from prop or route param. Use generic API calls for all repos. Enable annotations/history/userscript only when `repoId === 'linux'`.

- [ ] **Step 3: Add routes and navigation**

Keep `/kernel-code` rendering Linux. Add `/code/:repoId`, and add QEMU Code to navigation.

- [ ] **Step 4: Run page tests**

Run: `rtk npm --prefix web test -- KernelCodePage.test.ts MainLayout.test.ts --run`
Expected: PASS.

### Task 4: Config, Verification, And Memory

**Files:**
- Modify: `config/settings.yaml`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add config example**

Add a `code_repositories.qemu` example with the requested Bootlin base and local repo path placeholder.

- [ ] **Step 2: Run focused verification**

Run:
- `rtk pytest tests/test_kernel_resolver.py -q`
- `rtk npm --prefix web test -- externalLinks.test.ts KernelCodePage.test.ts MainLayout.test.ts --run`
- `rtk npm --prefix web run build`

- [ ] **Step 3: Browser smoke check**

If the dev server is available, verify `http://aliyun.cloud.vm:8080/app/kernel-code` and `http://aliyun.cloud.vm:8080/app/code/qemu` render without obvious layout breakage.

- [ ] **Step 4: Update memory and commit**

Append one Architecture Decisions Log line to `AGENTS.md`, clear Current Feature Context, commit the feature, and sync to `home_pc:~/workspace/kernel_email_tools`.
