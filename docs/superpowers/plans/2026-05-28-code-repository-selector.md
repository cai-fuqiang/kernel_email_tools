# Code Repository Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one unified code browsing page with a repository dropdown for Linux kernel and QEMU code.

**Architecture:** Keep the existing repo-aware backend APIs and `KernelCodePage` route model. Merge global navigation into one `Code` entry, add a repository selector in the code page header, and persist last location per repository. All code jumps and generated links must preserve the active `repoId`.

**Tech Stack:** React, React Router, TypeScript, existing FastAPI code repository endpoints, existing frontend test tooling.

---

## Brief Expansion Required

Before implementation, update the Feature Brief to include the files below. Do not edit or read files outside the updated brief.

**Files:**
- Modify: `web/src/pages/KernelCodePage.tsx`
- Modify: `web/src/layouts/MainLayout.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/pages/__tests__/KernelCodePage.test.tsx`
- Test: `web/src/layouts/__tests__/MainLayout.test.tsx` or the existing nearest MainLayout test file
- Modify: `AGENTS.md`

If repo-aware link helpers live outside the files above, ask to add that helper file to the brief before editing it.

## Task 1: Navigation Entry

**Files:**
- Modify: `web/src/layouts/MainLayout.tsx`
- Test: `web/src/layouts/__tests__/MainLayout.test.tsx` or the existing nearest MainLayout test file

- [ ] **Step 1: Write the failing test**

Add a test that renders the main layout navigation and asserts there is one `Code` navigation entry, not separate `Kernel Code` and `QEMU Code` entries.

```tsx
it('shows one Code navigation entry for all source repositories', () => {
  renderMainLayout();

  expect(screen.getByRole('link', { name: /^Code$/ })).toHaveAttribute('href', '/app/kernel-code');
  expect(screen.queryByRole('link', { name: /Kernel Code/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /QEMU Code/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run the existing frontend test command for the selected test file.

Expected: FAIL because the sidebar still renders `Kernel Code` and `QEMU Code`.

- [ ] **Step 3: Implement the navigation change**

In `web/src/layouts/MainLayout.tsx`, replace the two code entries:

```tsx
const primaryItems: NavItem[] = [
  { to: '/kernel-code', label: 'Code', icon: Code2 },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/knowledge', label: 'Knowledge', icon: Library },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run the same frontend test command.

Expected: PASS.

## Task 2: Repository Selector

**Files:**
- Modify: `web/src/pages/KernelCodePage.tsx`
- Test: `web/src/pages/__tests__/KernelCodePage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that mocks `getCodeRepositories()` with Linux and QEMU, renders the code page, and expects a repository selector with both display names.

```tsx
it('renders a repository selector from repository metadata', async () => {
  mockGetCodeRepositories({
    repositories: [
      { id: 'linux', name: 'Linux Kernel', default_version: 'latest', elixir_base: 'https://elixir.bootlin.com/linux' },
      { id: 'qemu', name: 'QEMU', default_version: 'master', elixir_base: 'https://elixir.bootlin.com/qemu' },
    ],
    total: 2,
  });

  renderKernelCodePage('/kernel-code');

  const selector = await screen.findByLabelText(/Repository/i);
  expect(selector).toHaveValue('linux');
  expect(screen.getByRole('option', { name: 'Linux Kernel' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'QEMU' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run the existing frontend test command for the KernelCodePage test file.

Expected: FAIL because the repository selector does not exist.

- [ ] **Step 3: Implement the selector**

Add a labeled `<select>` near the existing title/version controls:

```tsx
<label className="flex items-center gap-2 text-sm text-slate-700">
  <FileCode2 className="h-4 w-4 text-slate-600" />
  <span className="sr-only">Repository</span>
  <select
    aria-label="Repository"
    value={repoId}
    onChange={(event) => handleRepositorySelect(event.target.value)}
    className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-950 outline-none transition focus:border-sky-500"
  >
    {repositories.map((repo) => (
      <option key={repo.id} value={repo.id}>
        {repo.name || repo.id}
      </option>
    ))}
  </select>
</label>
```

Define `handleRepositorySelect` before render:

```tsx
function handleRepositorySelect(nextRepoId: string) {
  if (!nextRepoId || nextRepoId === repoId) return;
  const saved = readSavedRepositoryLocation(nextRepoId);
  navigate(codeBrowserPath(nextRepoId, saved?.version, saved?.path, saved?.line));
}
```

If `codeBrowserPath` cannot accept optional version/path/line cleanly, add a small local URL builder in `KernelCodePage.tsx`.

- [ ] **Step 4: Run the test to verify it passes**

Run the same frontend test command.

Expected: PASS.

## Task 3: Per-Repository Location Memory

**Files:**
- Modify: `web/src/pages/KernelCodePage.tsx`
- Test: `web/src/pages/__tests__/KernelCodePage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that visits Linux with a path and line, switches to QEMU, then switches back and expects navigation to restore the Linux path and line.

```tsx
it('restores the last viewed location for each repository', async () => {
  renderKernelCodePage('/kernel-code?v=v6.6&path=mm/mmap.c&line=42');

  await userEvent.selectOptions(await screen.findByLabelText(/Repository/i), 'qemu');
  expect(mockNavigate).toHaveBeenLastCalledWith('/code/qemu');

  renderKernelCodePage('/code/qemu?v=master&path=hw/core/machine.c&line=12');
  await userEvent.selectOptions(await screen.findByLabelText(/Repository/i), 'linux');

  expect(mockNavigate).toHaveBeenLastCalledWith('/kernel-code?v=v6.6&path=mm%2Fmmap.c&line=42');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run the existing frontend test command for the KernelCodePage test file.

Expected: FAIL because locations are not persisted per repo.

- [ ] **Step 3: Implement repo-scoped storage helpers**

Add helpers in `KernelCodePage.tsx`:

```tsx
type RepositoryLocation = {
  version?: string;
  path?: string;
  line?: number | null;
  annotation?: string | null;
};

function repositoryLocationStorageKey(repoId: string): string {
  return `code-browser:last-location:${repoId}`;
}

function readSavedRepositoryLocation(repoId: string): RepositoryLocation | null {
  try {
    const raw = window.localStorage.getItem(repositoryLocationStorageKey(repoId));
    return raw ? JSON.parse(raw) as RepositoryLocation : null;
  } catch {
    return null;
  }
}

function writeSavedRepositoryLocation(repoId: string, location: RepositoryLocation) {
  try {
    window.localStorage.setItem(repositoryLocationStorageKey(repoId), JSON.stringify(location));
  } catch {
    // Storage is best-effort; route state remains authoritative.
  }
}
```

Persist when URL-relevant state changes:

```tsx
useEffect(() => {
  writeSavedRepositoryLocation(repoId, {
    version: selectedVersion || undefined,
    path: currentPath || undefined,
    line: urlLine || null,
    annotation: urlAnnotationId || null,
  });
}, [currentPath, repoId, selectedVersion, urlAnnotationId, urlLine]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run the same frontend test command.

Expected: PASS.

## Task 4: Repo-Aware Jump Links

**Files:**
- Modify: `web/src/pages/KernelCodePage.tsx`
- Test: `web/src/pages/__tests__/KernelCodePage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add tests covering Linux compatibility links and QEMU repo links.

```tsx
it('builds Linux drag links with the legacy kernel-code route', () => {
  const markdown = buildKernelCodeSelectionMarkdownDragPayload({
    repoId: 'linux',
    version: 'v6.6',
    filePath: 'mm/mmap.c',
    startLine: 10,
    endLine: 12,
    selectedText: 'static int example',
    origin: 'http://localhost:8080',
  });

  expect(markdown).toContain('http://localhost:8080/app/kernel-code?v=v6.6&path=mm%2Fmmap.c&line=10');
});

it('builds QEMU drag links with the repo route', () => {
  const markdown = buildKernelCodeSelectionMarkdownDragPayload({
    repoId: 'qemu',
    version: 'master',
    filePath: 'hw/core/machine.c',
    startLine: 10,
    endLine: 12,
    selectedText: 'static void example',
    origin: 'http://localhost:8080',
  });

  expect(markdown).toContain('http://localhost:8080/app/code/qemu?v=master&path=hw%2Fcore%2Fmachine.c&line=10');
});
```

- [ ] **Step 2: Run the tests to verify they fail where behavior is incomplete**

Run the existing frontend test command for the KernelCodePage test file.

Expected: any hard-coded Linux link behavior fails for QEMU.

- [ ] **Step 3: Fix jump/link construction**

Audit only the approved `KernelCodePage.tsx` file for path builders that call Linux-only helpers. Replace hard-coded `kernelCodePath(...)` calls with `codeBrowserPath(repoId, ...)` when the navigation target is source code in the active repository.

Keep annotation-only routes Linux-specific unless the data model explicitly supports non-Linux annotations.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same frontend test command.

Expected: PASS.

## Task 5: Route Compatibility

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/KernelCodePage.tsx`
- Test: `web/src/pages/__tests__/KernelCodePage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a route test for the unified `/code` entry if the implementation adds it.

```tsx
it('opens the unified code page from /code with Linux as the default repository', async () => {
  renderAppAt('/code');

  expect(await screen.findByLabelText(/Repository/i)).toHaveValue('linux');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run the existing frontend route/page test command.

Expected: FAIL if `/code` is not yet registered.

- [ ] **Step 3: Add the optional route**

If keeping the sidebar at `/kernel-code`, skip this step. If adding a cleaner unified route, update `web/src/App.tsx`:

```tsx
<Route path="/code" element={<KernelCodePage repoId="linux" />} />
<Route path="/kernel-code" element={<KernelCodePage repoId="linux" />} />
<Route path="/code/:repoId" element={<KernelCodePage />} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run the same frontend route/page test command.

Expected: PASS.

## Task 6: Documentation Memory And Verification

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update Architecture Decisions Log**

Append:

```md
- 2026-05-28: code browser uses one global Code navigation entry with an in-page repository selector, per-repository last-location memory, and repo-aware source links for Linux/QEMU navigation (web/src/pages/KernelCodePage.tsx, web/src/layouts/MainLayout.tsx)
```

- [ ] **Step 2: Run verification**

Run focused tests first, then the frontend build/test command used by this repo.

Expected: all selected tests pass and the frontend build succeeds.

- [ ] **Step 3: Rendered QA**

Open the app at `http://aliyun.cloud.vm:8080/app/kernel-code` when available.

Verify:
- sidebar shows one `Code` entry
- repository selector contains Linux Kernel and QEMU
- selecting QEMU navigates to `/app/code/qemu`
- switching back restores Linux's previous path
- QEMU links use `/app/code/qemu`

- [ ] **Step 4: Commit implementation**

```bash
git add web/src/pages/KernelCodePage.tsx web/src/layouts/MainLayout.tsx web/src/App.tsx AGENTS.md
git add web/src/pages/__tests__/KernelCodePage.test.tsx
git commit -m "feat: add code repository selector"
```

- [ ] **Step 5: Sync to home_pc**

Sync the committed state to `home_pc:~/workspace/kernel_email_tools` using the repo's established `rtk` workflow.

## Self-Review

- Spec coverage: covered unified code surface, repository dropdown, per-repo memory, repo-aware jumps/links, route compatibility, error-safe fallback behavior, tests, rendered QA.
- Placeholder scan: no TBD/TODO placeholders; route and test file discovery are gated by the required Feature Brief expansion.
- Type consistency: `RepositoryLocation` is local to `KernelCodePage.tsx`; `repoId`, `version`, `path`, `line`, and `annotation` match the spec vocabulary.
