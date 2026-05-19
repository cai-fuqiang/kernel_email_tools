# Kernel Commit Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a structured kernel commit browser in the code history inspector with file-level patch browsing, GitHub-style hunk context previews, and hunk-level navigation into the nearest browsable tag version.

**Architecture:** Extend the existing `/api/kernel/commit` response so the backend returns structured commit files, hunks, and jump targets in addition to the raw patch fallback. Keep the main code pane as a real file viewer by rendering patch exploration inside `CodeHistoryPanel`, then use callback-driven navigation to open current-version or nearest-tag targets in `KernelCodePage`.

**Tech Stack:** FastAPI, Python, local git-backed kernel source, React, TypeScript, existing API client/types, pytest, Vitest, React Testing Library

---

## File Structure

### Backend

- Modify: `src/api/routers/kernel.py`
  - add helper types and functions that parse `git show --patch` output into files and hunks
  - add nearest-tag target resolution for each hunk
  - enrich `/api/kernel/commit` responses with structured patch data and explicit truncation metadata
- Create: `tests/api/test_kernel_commit_browser.py`
  - cover patch parsing, hunk context preview generation, truncation behavior, and nearest-tag mapping

### Frontend

- Modify: `web/src/api/types.ts`
  - add structured commit patch types and jump target types
- Modify: `web/src/api/client.ts`
  - keep `getKernelCommit()` but type it to the enriched response payload
- Create: `web/src/components/kernelCode/commitPatchModel.ts`
  - isolate frontend formatting and target-picking helpers away from the already-large `CodeHistoryPanel.tsx`
- Create: `web/src/components/kernelCode/__tests__/commitPatchModel.test.ts`
  - verify file labels, navigation target preference, and disabled-state reasons
- Create: `web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx`
  - verify file selection, hunk rendering, and hunk action callbacks
- Modify: `web/src/components/kernelCode/CodeHistoryPanel.tsx`
  - replace flat changed-file rows and raw diff modal with structured file navigator and hunk browser
- Modify: `web/src/pages/KernelCodePage.tsx`
  - pass navigation callbacks so hunk actions open the target file and line in the main code pane

### Docs / Memory

- Modify: `AGENTS.md`
  - append the stable architecture decision after the feature is complete

## Task 1: Parse commit patch text into structured files and hunks

**Files:**
- Modify: `src/api/routers/kernel.py`
- Test: `tests/api/test_kernel_commit_browser.py`

- [ ] **Step 1: Write the failing parser tests**

```python
from src.api.routers.kernel import _parse_commit_patch


def test_parse_commit_patch_groups_lines_by_file_and_hunk():
    patch = """diff --git a/mm/mmap.c b/mm/mmap.c
index 1111111..2222222 100644
--- a/mm/mmap.c
+++ b/mm/mmap.c
@@ -10,2 +10,3 @@ static int demo(void)
 line_a
-line_b
+line_b2
+line_c
"""

    files = _parse_commit_patch(patch, context_radius=3)

    assert len(files) == 1
    assert files[0]["path"] == "mm/mmap.c"
    assert files[0]["status"] == "modified"
    assert files[0]["hunks"][0]["header"] == "@@ -10,2 +10,3 @@ static int demo(void)"
    assert [line["kind"] for line in files[0]["hunks"][0]["lines"]] == ["context", "del", "add", "add"]


def test_parse_commit_patch_marks_rename_and_binary_sections():
    patch = """diff --git a/old.c b/new.c
similarity index 98%
rename from old.c
rename to new.c
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
"""

    files = _parse_commit_patch(patch, context_radius=3)

    assert files[0]["status"] == "renamed"
    assert files[0]["old_path"] == "old.c"
    assert files[0]["new_path"] == "new.c"
    assert files[1]["is_binary"] is True
    assert files[1]["hunks"] == []
```

- [ ] **Step 2: Run the parser tests to verify they fail**

Run: `rtk pytest tests/api/test_kernel_commit_browser.py::test_parse_commit_patch_groups_lines_by_file_and_hunk tests/api/test_kernel_commit_browser.py::test_parse_commit_patch_marks_rename_and_binary_sections -q`

Expected: FAIL with `ImportError` or `AttributeError` because `_parse_commit_patch` does not exist yet.

- [ ] **Step 3: Write the minimal parser implementation**

```python
def _new_patch_file(path: str, old_path: str | None = None, new_path: str | None = None) -> dict:
    resolved_old = old_path or path
    resolved_new = new_path or path
    return {
        "path": resolved_new or resolved_old,
        "old_path": resolved_old,
        "new_path": resolved_new,
        "status": "modified",
        "added": "0",
        "deleted": "0",
        "is_binary": False,
        "truncated": False,
        "hunks": [],
    }


def _parse_commit_patch(patch: str, context_radius: int = 3) -> list[dict]:
    files: list[dict] = []
    current_file: dict | None = None
    current_hunk: dict | None = None
    old_line = 0
    new_line = 0

    for raw_line in patch.splitlines():
        if raw_line.startswith("diff --git "):
            match = re.match(r"^diff --git a/(.+) b/(.+)$", raw_line)
            if not match:
                current_file = None
                current_hunk = None
                continue
            current_file = _new_patch_file(match.group(2), match.group(1), match.group(2))
            files.append(current_file)
            current_hunk = None
            continue
        if current_file is None:
            continue
        if raw_line.startswith("rename from "):
            current_file["status"] = "renamed"
            current_file["old_path"] = raw_line.replace("rename from ", "", 1).strip()
            continue
        if raw_line.startswith("rename to "):
            current_file["status"] = "renamed"
            current_file["new_path"] = raw_line.replace("rename to ", "", 1).strip()
            current_file["path"] = current_file["new_path"]
            continue
        if raw_line.startswith("Binary files "):
            current_file["is_binary"] = True
            current_file["status"] = "binary"
            current_hunk = None
            continue
        if raw_line.startswith("@@ "):
            match = re.match(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$", raw_line)
            if not match:
                continue
            old_line = int(match.group(1))
            new_line = int(match.group(3))
            current_hunk = {
                "header": raw_line,
                "old_start": old_line,
                "old_count": int(match.group(2) or "1"),
                "new_start": new_line,
                "new_count": int(match.group(4) or "1"),
                "lines": [],
                "context_preview": None,
                "current_version_target": None,
                "nearest_tag_target": None,
            }
            current_file["hunks"].append(current_hunk)
            continue
        if current_hunk is None:
            continue
        if raw_line.startswith("+") and not raw_line.startswith("+++"):
            current_hunk["lines"].append({"kind": "add", "text": raw_line, "old_line": None, "new_line": new_line})
            new_line += 1
            continue
        if raw_line.startswith("-") and not raw_line.startswith("---"):
            current_hunk["lines"].append({"kind": "del", "text": raw_line, "old_line": old_line, "new_line": None})
            old_line += 1
            continue
        current_hunk["lines"].append({"kind": "context", "text": raw_line, "old_line": old_line, "new_line": new_line})
        old_line += 1
        new_line += 1

    for file_entry in files:
        for hunk in file_entry["hunks"]:
            hunk["context_preview"] = _build_hunk_context_preview(hunk, context_radius)
    return files
```

- [ ] **Step 4: Add the hunk context preview helper and rerun the parser tests**

```python
def _build_hunk_context_preview(hunk: dict, context_radius: int) -> dict:
    preview_lines = hunk["lines"][: max(1, min(len(hunk["lines"]), context_radius * 2 + 3))]
    numbered = []
    focus_start = None
    focus_end = None
    for line in preview_lines:
        line_no = line.get("new_line") or line.get("old_line")
        if line["kind"] in {"add", "del"}:
            if focus_start is None and line_no is not None:
                focus_start = line_no
            if line_no is not None:
                focus_end = line_no
        numbered.append(line["text"])
    return {
        "focus_start_line": focus_start or hunk["new_start"],
        "focus_end_line": focus_end or hunk["new_start"],
        "snippet": "\n".join(numbered),
        "before_lines": [],
        "after_lines": [],
    }
```

Run: `rtk pytest tests/api/test_kernel_commit_browser.py::test_parse_commit_patch_groups_lines_by_file_and_hunk tests/api/test_kernel_commit_browser.py::test_parse_commit_patch_marks_rename_and_binary_sections -q`

Expected: PASS

- [ ] **Step 5: Commit the parser groundwork**

```bash
rtk git add src/api/routers/kernel.py tests/api/test_kernel_commit_browser.py
rtk git commit -m "feat: parse kernel commit patches into structured hunks"
```

## Task 2: Enrich commit responses with truncation and nearest-tag jump targets

**Files:**
- Modify: `src/api/routers/kernel.py`
- Test: `tests/api/test_kernel_commit_browser.py`

- [ ] **Step 1: Write the failing route-shaping tests**

```python
from src.api.routers.kernel import _attach_hunk_targets


def test_attach_hunk_targets_prefers_new_path_and_line():
    files = [{
        "path": "mm/mmap.c",
        "old_path": "mm/mmap.c",
        "new_path": "mm/mmap.c",
        "status": "modified",
        "added": "1",
        "deleted": "1",
        "is_binary": False,
        "truncated": False,
        "hunks": [{
            "header": "@@ -10,1 +20,1 @@",
            "old_start": 10,
            "old_count": 1,
            "new_start": 20,
            "new_count": 1,
            "lines": [],
            "context_preview": {"focus_start_line": 20, "focus_end_line": 20, "snippet": ""},
            "current_version_target": None,
            "nearest_tag_target": None,
        }],
    }]

    resolved = _attach_hunk_targets(files, current_version="v6.6", nearest_tag_version="v6.5")

    hunk = resolved[0]["hunks"][0]
    assert hunk["current_version_target"] == {
        "available": True,
        "version": "v6.6",
        "path": "mm/mmap.c",
        "line": 20,
        "reason": None,
    }
    assert hunk["nearest_tag_target"]["version"] == "v6.5"


def test_attach_hunk_targets_marks_unavailable_when_no_path_can_open():
    files = [{
        "path": "",
        "old_path": "",
        "new_path": "",
        "status": "deleted",
        "added": "0",
        "deleted": "4",
        "is_binary": False,
        "truncated": False,
        "hunks": [{
            "header": "@@ -40,4 +0,0 @@",
            "old_start": 40,
            "old_count": 4,
            "new_start": 0,
            "new_count": 0,
            "lines": [],
            "context_preview": {"focus_start_line": 40, "focus_end_line": 43, "snippet": ""},
            "current_version_target": None,
            "nearest_tag_target": None,
        }],
    }]

    resolved = _attach_hunk_targets(files, current_version="v6.6", nearest_tag_version=None)

    assert resolved[0]["hunks"][0]["nearest_tag_target"] == {
        "available": False,
        "version": "",
        "path": "",
        "line": 0,
        "reason": "No browsable tag mapping found",
    }
```

- [ ] **Step 2: Run the route-shaping tests to verify they fail**

Run: `rtk pytest tests/api/test_kernel_commit_browser.py::test_attach_hunk_targets_prefers_new_path_and_line tests/api/test_kernel_commit_browser.py::test_attach_hunk_targets_marks_unavailable_when_no_path_can_open -q`

Expected: FAIL with `ImportError` or `AttributeError` because `_attach_hunk_targets` does not exist yet.

- [ ] **Step 3: Implement nearest-tag helpers and attach targets**

```python
def _make_jump_target(available: bool, version: str, path: str, line: int, reason: str | None = None) -> dict:
    return {
        "available": available,
        "version": version,
        "path": path,
        "line": line,
        "reason": reason,
    }


def _pick_hunk_target(hunk: dict, new_path: str, old_path: str) -> tuple[str, int]:
    if new_path and hunk.get("new_start", 0) > 0:
        return new_path, int(hunk["new_start"])
    if old_path and hunk.get("old_start", 0) > 0:
        return old_path, int(hunk["old_start"])
    return "", 0


def _resolve_nearest_browsable_tag(source: GitLocalSource, commit_hash: str) -> str | None:
    try:
        containing = source._repo.git.tag("--contains", commit_hash).splitlines()
    except Exception:
        return None
    release_tags = [tag.strip() for tag in containing if re.match(r"^v\d+\.\d+(?:\.\d+)?$", tag.strip())]
    if not release_tags:
        return None
    release_tags.sort(key=lambda tag: tuple(int(part) for part in tag.lstrip("v").split(".")), reverse=True)
    return release_tags[0]


def _attach_hunk_targets(files: list[dict], current_version: str, nearest_tag_version: str | None) -> list[dict]:
    for file_entry in files:
        for hunk in file_entry["hunks"]:
            path, line = _pick_hunk_target(hunk, file_entry.get("new_path", ""), file_entry.get("old_path", ""))
            if path and line > 0:
                hunk["current_version_target"] = _make_jump_target(True, current_version, path, line)
                if nearest_tag_version:
                    hunk["nearest_tag_target"] = _make_jump_target(True, nearest_tag_version, path, line)
                else:
                    hunk["nearest_tag_target"] = _make_jump_target(False, "", "", 0, "No browsable tag mapping found")
            else:
                hunk["current_version_target"] = _make_jump_target(False, "", "", 0, "No navigable file target")
                hunk["nearest_tag_target"] = _make_jump_target(False, "", "", 0, "No browsable tag mapping found")
    return files
```

- [ ] **Step 4: Thread the structured files through `kernel_commit()` and rerun tests**

```python
nearest_tag_version = _resolve_nearest_browsable_tag(source, normalized_commit_hash)
structured_files = _parse_commit_patch(patch_output[:max_patch_chars], context_radius=3)
structured_files = _attach_hunk_targets(structured_files, current_version=version, nearest_tag_version=nearest_tag_version)

entry = _history_entry(
    commit_hash=commit_hash_full.strip(),
    short_hash=short_hash.strip(),
    author_name=author_name.strip(),
    author_email=author_email.strip(),
    author_time=author_time.strip(),
    subject=subject.strip(),
    message=message.strip(),
    changed_files=changed_files,
    patch=patch_output[:max_patch_chars],
)
entry["version"] = version
entry["patch_truncated"] = patch_truncated
entry["nearest_tag_version"] = nearest_tag_version
entry["files"] = structured_files
```

Run: `rtk pytest tests/api/test_kernel_commit_browser.py -q`

Expected: PASS

- [ ] **Step 5: Commit the enriched backend response**

```bash
rtk git add src/api/routers/kernel.py tests/api/test_kernel_commit_browser.py
rtk git commit -m "feat: add kernel commit jump targets"
```

## Task 3: Add frontend types and pure helper coverage for file/hunk browsing

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Create: `web/src/components/kernelCode/commitPatchModel.ts`
- Test: `web/src/components/kernelCode/__tests__/commitPatchModel.test.ts`

- [ ] **Step 1: Write the failing frontend helper tests**

```ts
import { describe, expect, it } from 'vitest';
import { choosePrimaryTarget, formatChangedFileLabel } from '../commitPatchModel';

describe('commitPatchModel', () => {
  it('prefers nearest tag targets when requested', () => {
    expect(
      choosePrimaryTarget(
        {
          current_version_target: { available: true, version: 'v6.6', path: 'mm/mmap.c', line: 20, reason: null },
          nearest_tag_target: { available: true, version: 'v6.5', path: 'mm/mmap.c', line: 18, reason: null },
        },
        'nearest-tag',
      ),
    ).toEqual({ available: true, version: 'v6.5', path: 'mm/mmap.c', line: 18, reason: null });
  });

  it('formats rename labels with both paths', () => {
    expect(
      formatChangedFileLabel({ status: 'renamed', old_path: 'old.c', new_path: 'new.c', path: 'new.c' }),
    ).toBe('old.c -> new.c');
  });
});
```

- [ ] **Step 2: Run the frontend helper tests to verify they fail**

Run: `rtk npm test -- --run web/src/components/kernelCode/__tests__/commitPatchModel.test.ts`

Expected: FAIL because `commitPatchModel.ts` does not exist yet.

- [ ] **Step 3: Add the frontend commit patch types and helper module**

```ts
export type CommitJumpTarget = {
  available: boolean;
  version: string;
  path: string;
  line: number;
  reason?: string | null;
};

export type CommitPatchHunk = {
  header: string;
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  lines: Array<{ kind: 'context' | 'add' | 'del' | 'meta'; text: string; old_line?: number | null; new_line?: number | null }>;
  context_preview: {
    focus_start_line: number;
    focus_end_line: number;
    snippet: string;
    before_lines?: string[];
    after_lines?: string[];
  };
  current_version_target: CommitJumpTarget;
  nearest_tag_target: CommitJumpTarget;
};

export function choosePrimaryTarget(
  hunk: Pick<CommitPatchHunk, 'current_version_target' | 'nearest_tag_target'>,
  mode: 'current-version' | 'nearest-tag',
) {
  return mode === 'nearest-tag' ? hunk.nearest_tag_target : hunk.current_version_target;
}

export function formatChangedFileLabel(file: { status: string; old_path?: string | null; new_path?: string | null; path: string }) {
  if (file.status === 'renamed' && file.old_path && file.new_path && file.old_path !== file.new_path) {
    return `${file.old_path} -> ${file.new_path}`;
  }
  return file.path;
}
```

- [ ] **Step 4: Update API types/client and rerun the helper tests**

```ts
export interface KernelCommitFile {
  path: string;
  old_path: string;
  new_path: string;
  status: string;
  added: string;
  deleted: string;
  is_binary: boolean;
  truncated: boolean;
  hunks: CommitPatchHunk[];
}

export interface KernelHistoryCommit {
  commit_hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  author_time: string;
  subject: string;
  message?: string;
  trailers: Record<string, string[]>;
  urls: string[];
  lore_links: string[];
  has_lore_link: boolean;
  changed_files: Array<{ added: string; deleted: string; path: string }>;
  patch?: string;
  patch_truncated?: boolean;
  version?: string;
  nearest_tag_version?: string | null;
  files?: KernelCommitFile[];
}
```

Run: `rtk npm test -- --run web/src/components/kernelCode/__tests__/commitPatchModel.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the frontend model layer**

```bash
rtk git add web/src/api/types.ts web/src/api/client.ts web/src/components/kernelCode/commitPatchModel.ts web/src/components/kernelCode/__tests__/commitPatchModel.test.ts
rtk git commit -m "feat: model kernel commit patch data"
```

## Task 4: Render file navigator, hunk cards, and navigation actions in the history UI

**Files:**
- Modify: `web/src/components/kernelCode/CodeHistoryPanel.tsx`
- Modify: `web/src/pages/KernelCodePage.tsx`
- Test: `web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import CodeHistoryPanel from '../CodeHistoryPanel';

vi.mock('../../../api/client', () => ({
  getKernelBlame: vi.fn().mockResolvedValue({
    commit_hash: 'abc1234',
    short_hash: 'abc1234',
    author_name: 'dev',
    author_email: 'dev@example.com',
    author_time: '2026-05-19T10:00:00Z',
    subject: 'demo commit',
    trailers: {},
    urls: [],
    lore_links: [],
    has_lore_link: false,
    changed_files: [],
  }),
  getKernelLineHistory: vi.fn().mockResolvedValue({ commits: [], total: 0, version: 'v6.6', path: 'mm/mmap.c', start_line: 20, end_line: 22 }),
  getKernelCommit: vi.fn().mockResolvedValue({
    commit_hash: 'abc1234',
    short_hash: 'abc1234',
    author_name: 'dev',
    author_email: 'dev@example.com',
    author_time: '2026-05-19T10:00:00Z',
    subject: 'demo commit',
    message: 'body',
    trailers: {},
    urls: [],
    lore_links: [],
    has_lore_link: false,
    changed_files: [{ added: '2', deleted: '1', path: 'mm/mmap.c' }],
    files: [{
      path: 'mm/mmap.c',
      old_path: 'mm/mmap.c',
      new_path: 'mm/mmap.c',
      status: 'modified',
      added: '2',
      deleted: '1',
      is_binary: false,
      truncated: false,
      hunks: [{
        header: '@@ -10,1 +20,2 @@',
        old_start: 10,
        old_count: 1,
        new_start: 20,
        new_count: 2,
        lines: [{ kind: 'add', text: '+line_c', old_line: null, new_line: 20 }],
        context_preview: { focus_start_line: 20, focus_end_line: 21, snippet: 'line_b2\\nline_c' },
        current_version_target: { available: true, version: 'v6.6', path: 'mm/mmap.c', line: 20, reason: null },
        nearest_tag_target: { available: true, version: 'v6.5', path: 'mm/mmap.c', line: 18, reason: null },
      }],
    }],
  }),
  createKnowledgeDraft: vi.fn(),
  listKnowledgeEntities: vi.fn().mockResolvedValue({ entities: [] }),
}));

it('renders file navigator and emits nearest-tag navigation requests', async () => {
  const onOpenCommitTarget = vi.fn();

  render(
    <CodeHistoryPanel
      version="v6.6"
      filePath="mm/mmap.c"
      selectedRange={{ startLine: 20, endLine: 22 }}
      selectedText="line_b2\nline_c"
      onOpenCommitTarget={onOpenCommitTarget}
    />,
  );

  fireEvent.click(await screen.findByTitle('Toggle commit detail'));
  await screen.findByText('mm/mmap.c');
  fireEvent.click(screen.getByRole('button', { name: 'Jump to nearest tag' }));

  await waitFor(() =>
    expect(onOpenCommitTarget).toHaveBeenCalledWith({
      version: 'v6.5',
      path: 'mm/mmap.c',
      line: 18,
    }),
  );
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run: `rtk npm test -- --run web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx`

Expected: FAIL because `CodeHistoryPanel` does not yet accept `onOpenCommitTarget` or render hunk actions.

- [ ] **Step 3: Implement the structured commit browser UI**

```tsx
type CommitOpenTarget = {
  version: string;
  path: string;
  line: number;
};

interface CodeHistoryPanelProps {
  version: string;
  filePath: string;
  selectedRange: SelectedRange | null;
  selectedText: string;
  onOpenCommitTarget?: (target: CommitOpenTarget) => void;
}

const [activeFilePathByCommit, setActiveFilePathByCommit] = useState<Record<string, string>>({});

function handleOpenHunkTarget(target: { available: boolean; version: string; path: string; line: number; reason?: string | null }) {
  if (!target.available || !target.path || !target.line) {
    showToast(target.reason || 'Navigation target unavailable', 'info');
    return;
  }
  onOpenCommitTarget?.({ version: target.version, path: target.path, line: target.line });
}

const activeFile = shown.files?.find(
  (file) => file.path === activeFilePathByCommit[commit.commit_hash],
) || shown.files?.[0];
```

```tsx
{shown.files?.length ? (
  <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
    <div className="space-y-1">
      {shown.files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => setActiveFilePathByCommit((current) => ({ ...current, [commit.commit_hash]: file.path }))}
          className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-3 py-2 text-left text-xs hover:border-sky-300 hover:bg-sky-50"
        >
          <span className="truncate font-mono">{formatChangedFileLabel(file)}</span>
          <span className="shrink-0 text-slate-600">+{file.added} -{file.deleted}</span>
        </button>
      ))}
    </div>
    <div className="space-y-3">
      {activeFile?.hunks.map((hunk) => (
        <div key={`${activeFile.path}-${hunk.header}`} className="rounded-lg border border-slate-300 bg-white p-3">
          <div className="font-mono text-[11px] text-slate-700">{hunk.header}</div>
          <pre className="mt-2 overflow-auto rounded-lg bg-slate-950/95 p-3 font-mono text-xs text-slate-100">{hunk.lines.map((line) => line.text).join('\n')}</pre>
          <pre className="mt-2 overflow-auto rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900">{hunk.context_preview.snippet}</pre>
          <div className="mt-3 flex gap-2">
            <SecondaryButton onClick={() => handleOpenHunkTarget(hunk.current_version_target)} disabled={!hunk.current_version_target.available}>
              Open in current version
            </SecondaryButton>
            <SecondaryButton onClick={() => handleOpenHunkTarget(hunk.nearest_tag_target)} disabled={!hunk.nearest_tag_target.available}>
              Jump to nearest tag
            </SecondaryButton>
          </div>
        </div>
      ))}
    </div>
  </div>
) : (
  <pre className="max-h-[72vh] overflow-auto rounded-lg border border-slate-300 bg-white font-mono text-xs leading-5">{shown.patch || 'No diff loaded for this commit.'}</pre>
)}
```

- [ ] **Step 4: Wire the navigation callback through `KernelCodePage` and rerun the component test**

```tsx
function handleOpenCommitTarget(target: { version: string; path: string; line: number }) {
  if (target.version !== selectedVersion) {
    setSelectedVersion(target.version);
  }
  setPathInput(target.path);
  navigate(kernelCodePath(target.version, target.path, target.line));
}
```

```tsx
<CodeHistoryPanel
  version={selectedVersion}
  filePath={currentPath}
  selectedRange={selectedRange}
  selectedText={selectedText}
  onOpenCommitTarget={handleOpenCommitTarget}
/>
```

Run: `rtk npm test -- --run web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit the history inspector UI upgrade**

```bash
rtk git add web/src/components/kernelCode/CodeHistoryPanel.tsx web/src/pages/KernelCodePage.tsx web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx
rtk git commit -m "feat: browse kernel commit hunks in history panel"
```

## Task 5: Verify end-to-end behavior and update project memory

**Files:**
- Modify: `AGENTS.md`
- Verify: `src/api/routers/kernel.py`
- Verify: `web/src/api/types.ts`
- Verify: `web/src/api/client.ts`
- Verify: `web/src/components/kernelCode/commitPatchModel.ts`
- Verify: `web/src/components/kernelCode/CodeHistoryPanel.tsx`
- Verify: `web/src/pages/KernelCodePage.tsx`
- Verify: `tests/api/test_kernel_commit_browser.py`
- Verify: `web/src/components/kernelCode/__tests__/commitPatchModel.test.ts`
- Verify: `web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx`

- [ ] **Step 1: Run the backend and frontend test targets**

Run: `rtk pytest tests/api/test_kernel_commit_browser.py -q`

Expected: PASS

Run: `rtk npm test -- --run web/src/components/kernelCode/__tests__/commitPatchModel.test.ts web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx`

Expected: PASS

- [ ] **Step 2: Run one focused manual verification path**

Run: `rtk npm run dev`

Expected: Vite dev server starts successfully.

Manual check:

- open the kernel code browser
- select a code range with history
- expand a commit
- switch between changed files
- confirm hunk diff and context preview render
- click `Open in current version`
- click `Jump to nearest tag`
- confirm the main code pane stays in real code view and scrolls to the requested location

- [ ] **Step 3: Update permanent project memory**

Append this line to `AGENTS.md` under `Architecture Decisions Log`:

```md
- 2026-05-19: kernel commit browsing uses structured file/hunk patch data plus hunk-level nearest-tag jump targets in the history inspector (src/api/routers/kernel.py, web/src/components/kernelCode/CodeHistoryPanel.tsx, web/src/pages/KernelCodePage.tsx)
```

Clear `Current Feature Context` back to:

```md
<!-- -->
```

- [ ] **Step 4: Commit the memory update and final verification state**

```bash
rtk git add AGENTS.md
rtk git commit -m "docs: record kernel commit browser architecture"
```

- [ ] **Step 5: Share completion notes with exact verification evidence**

Report:

- backend test command and result
- frontend test command and result
- manual verification result
- any remaining limitations, especially around truncated patches and unmappable hunks
