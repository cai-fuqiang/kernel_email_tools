# GitHub-Style Patch Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split commit patch preview with a GitHub-style unified diff browser that supports inline context expansion and preserves existing commit-to-code navigation.

**Architecture:** Keep `CodeHistoryPanel` as the patch-browser surface, but change the data contract so backend hunks return ordered display rows instead of a detached `context_preview`. Add a focused backend expansion endpoint for omitted context ranges, normalize the new row model in `commitPatchModel.ts`, and render GitHub-like diff tables in the commit detail modal while keeping `KernelCodePage` navigation callbacks intact.

**Tech Stack:** FastAPI, Python, local git-backed kernel source, React, TypeScript, existing kernel history modal UI, pytest, Vitest

---

## File Structure

### Execution prerequisite

Before implementation, expand the execution brief to include these additional interface files:

- `web/src/api/client.ts`
  - add a typed frontend call for the hunk-expansion endpoint
- `web/src/api/types.ts`
  - add row-based patch types used by `commitPatchModel.ts` and `CodeHistoryPanel.tsx`
- `AGENTS.md`
  - append the final architecture decision after the feature lands

### Backend

- Modify: `src/api/routers/kernel.py`
  - replace `context_preview`-first hunk shaping with row-based hunk shaping
  - add helpers that compute inline expander rows and reveal omitted file context
  - add a commit patch expansion endpoint
- Modify: `tests/api/test_kernel_commit_browser.py`
  - cover row generation, expander metadata, expansion responses, and enriched commit responses

### Frontend

- Modify: `web/src/api/types.ts`
  - add `KernelCommitPatchRowLine`, `KernelCommitPatchRowExpander`, and expansion response types
- Modify: `web/src/api/client.ts`
  - add `expandKernelCommitPatchHunk()` for inline expander clicks
- Modify: `web/src/components/kernelCode/commitPatchModel.ts`
  - normalize backend row payloads into frontend row views
  - keep target normalization and file label formatting
- Modify: `web/src/components/kernelCode/__tests__/commitPatchModel.test.ts`
  - verify row normalization, expander identity, and target selection
- Modify: `web/src/components/kernelCode/CodeHistoryPanel.tsx`
  - replace the dual-`pre` hunk rendering with a unified GitHub-style diff table
  - add inline expander loading and error handling
- Modify: `web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx`
  - verify unified rendering, expander actions, and navigation button behavior
- Verify only: `web/src/pages/KernelCodePage.tsx`
  - confirm the existing `onOpenCommitTarget` callback contract still satisfies the new UI

### Docs / Memory

- Modify: `AGENTS.md`
  - append the stable architecture decision and clear `Current Feature Context` after implementation

## Task 1: Define the backend row model and failing parser tests

**Files:**
- Modify: `tests/api/test_kernel_commit_browser.py`
- Modify: `src/api/routers/kernel.py`

- [ ] **Step 1: Extend the backend tests to describe row-based hunks and expander metadata**

```python
def test_parse_commit_patch_builds_rows_with_inline_expanders():
    patch = """diff --git a/mm/mmap.c b/mm/mmap.c
index 1111111..2222222 100644
--- a/mm/mmap.c
+++ b/mm/mmap.c
@@ -10,4 +10,5 @@ static int demo(void)
 line_a
 line_b
-line_c
+line_c2
+line_d
 line_e
"""

    files = kernel._parse_commit_patch(patch, context_radius=3, commit_hash="abcd1234")
    hunk = files[0]["hunks"][0]

    assert hunk["rows"][0] == {
        "type": "expander",
        "id": "mm/mmap.c:@@ -10,4 +10,5 @@ static int demo(void):up",
        "direction": "up",
        "hidden_count": 9,
        "step_size": 20,
        "old_start": 1,
        "old_end": 9,
        "new_start": 1,
        "new_end": 9,
        "expand_key": "abcd1234:mm/mmap.c:10:10:up",
    }
    assert [row["type"] for row in hunk["rows"][1:6]] == ["line", "line", "line", "line", "line"]
    assert hunk["rows"][-1]["type"] == "expander"


def test_parse_commit_patch_preserves_line_numbers_inside_line_rows():
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

    files = kernel._parse_commit_patch(patch, context_radius=3, commit_hash="abcd1234")
    rows = files[0]["hunks"][0]["rows"]
    line_rows = [row for row in rows if row["type"] == "line"]

    assert line_rows == [
        {"type": "line", "kind": "context", "text": "line_a", "old_line": 10, "new_line": 10},
        {"type": "line", "kind": "del", "text": "-line_b", "old_line": 11, "new_line": None},
        {"type": "line", "kind": "add", "text": "+line_b2", "old_line": None, "new_line": 11},
        {"type": "line", "kind": "add", "text": "+line_c", "old_line": None, "new_line": 12},
    ]
```

- [ ] **Step 2: Run the focused parser tests to verify the new row assertions fail**

Run: `rtk pytest tests/api/test_kernel_commit_browser.py::test_parse_commit_patch_builds_rows_with_inline_expanders tests/api/test_kernel_commit_browser.py::test_parse_commit_patch_preserves_line_numbers_inside_line_rows -q`

Expected: FAIL because the current parser returns `lines` and `context_preview`, not `rows`.

- [ ] **Step 3: Add row-builder helpers in `kernel.py`**

```python
def _line_row(kind: str, text: str, old_line: int | None, new_line: int | None) -> dict:
    return {
        "type": "line",
        "kind": kind,
        "text": text,
        "old_line": old_line,
        "new_line": new_line,
    }


def _expander_row(
    *,
    row_id: str,
    direction: str,
    hidden_count: int,
    old_start: int | None,
    old_end: int | None,
    new_start: int | None,
    new_end: int | None,
    expand_key: str,
    step_size: int = 20,
) -> dict:
    return {
        "type": "expander",
        "id": row_id,
        "direction": direction,
        "hidden_count": hidden_count,
        "step_size": step_size,
        "old_start": old_start,
        "old_end": old_end,
        "new_start": new_start,
        "new_end": new_end,
        "expand_key": expand_key,
    }
```

- [ ] **Step 4: Replace raw `lines`-only hunk output with `rows`**

```python
current_hunk = {
    "header": raw_line,
    "old_start": old_start,
    "old_count": old_count,
    "new_start": new_start,
    "new_count": new_count,
    "lines": [],
    "rows": [],
    "current_version_target": None,
    "nearest_tag_target": None,
}

if raw_line.startswith("+") and not raw_line.startswith("+++"):
    current_hunk["lines"].append(_line_row("add", raw_line, None, new_line))
    new_line += 1
    continue
```

- [ ] **Step 5: Build inline expander rows after line parsing completes**

```python
def _finalize_hunk_rows(commit_hash: str, file_entry: dict, hunk: dict) -> None:
    prefix_old_end = max(0, int(hunk["old_start"]) - 1)
    prefix_new_end = max(0, int(hunk["new_start"]) - 1)
    suffix_old_start = int(hunk["old_start"]) + int(hunk["old_count"])
    suffix_new_start = int(hunk["new_start"]) + int(hunk["new_count"])

    rows: list[dict] = []
    if prefix_old_end > 0 or prefix_new_end > 0:
        rows.append(_expander_row(
            row_id=f'{file_entry["path"]}:{hunk["header"]}:up',
            direction="up",
            hidden_count=max(prefix_old_end, prefix_new_end),
            old_start=1 if prefix_old_end > 0 else None,
            old_end=prefix_old_end or None,
            new_start=1 if prefix_new_end > 0 else None,
            new_end=prefix_new_end or None,
            expand_key=f'{commit_hash}:{file_entry["path"]}:{hunk["old_start"]}:{hunk["new_start"]}:up',
        ))
    rows.extend(hunk["lines"])
    rows.append(_expander_row(
        row_id=f'{file_entry["path"]}:{hunk["header"]}:down',
        direction="down",
        hidden_count=20,
        old_start=suffix_old_start if suffix_old_start > 0 else None,
        old_end=None,
        new_start=suffix_new_start if suffix_new_start > 0 else None,
        new_end=None,
        expand_key=f'{commit_hash}:{file_entry["path"]}:{hunk["old_start"]}:{hunk["new_start"]}:down',
    ))
    hunk["rows"] = rows
```

- [ ] **Step 6: Rerun the parser tests**

Run: `rtk pytest tests/api/test_kernel_commit_browser.py::test_parse_commit_patch_builds_rows_with_inline_expanders tests/api/test_kernel_commit_browser.py::test_parse_commit_patch_preserves_line_numbers_inside_line_rows -q`

Expected: PASS

- [ ] **Step 7: Commit the parser row model**

```bash
git add src/api/routers/kernel.py tests/api/test_kernel_commit_browser.py
git commit -m "feat: add row-based kernel patch hunks"
```

## Task 2: Add backend context expansion helpers and endpoint

**Files:**
- Modify: `src/api/routers/kernel.py`
- Modify: `tests/api/test_kernel_commit_browser.py`

- [ ] **Step 1: Add failing tests for directional expansion**

```python
def test_expand_commit_hunk_returns_replacement_rows(monkeypatch):
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

    async def _fake_run_local_git(_source, *args, **_kwargs):
        if args[:4] == ("show", "--no-ext-diff", "--find-renames", "--format="):
            return patch
        if args[:2] == ("show", "abcd1234:mm/mmap.c"):
            return "\n".join([f"line_{index}" for index in range(1, 40)]) + "\n"
        raise AssertionError(args)

    monkeypatch.setattr(kernel, "_local_git_source", lambda: object())
    monkeypatch.setattr(kernel, "_run_local_git", _fake_run_local_git)

    response = asyncio.run(kernel.kernel_commit_patch_expand(
        payload=kernel.KernelCommitPatchExpandRequest(
            version="v6.6",
            commit_hash="abcd1234",
            file_path="mm/mmap.c",
            hunk_header="@@ -10,2 +10,3 @@ static int demo(void)",
            expander_id="mm/mmap.c:@@ -10,2 +10,3 @@ static int demo(void):up",
            direction="up",
        ),
    ))

    assert response["expander_id"].endswith(":up")
    assert response["replacement_rows"][0]["type"] == "line"
    assert response["replacement_rows"][-1]["type"] in {"line", "expander"}
```

- [ ] **Step 2: Run the expansion test to verify the endpoint is missing**

Run: `rtk pytest tests/api/test_kernel_commit_browser.py::test_expand_commit_hunk_returns_replacement_rows -q`

Expected: FAIL with `AttributeError` because `KernelCommitPatchExpandRequest` and `kernel_commit_patch_expand` do not exist yet.

- [ ] **Step 3: Add the expansion request model and file-content loader**

```python
class KernelCommitPatchExpandRequest(BaseModel):
    version: str = Field(..., min_length=1)
    commit_hash: str = Field(..., min_length=7)
    file_path: str = Field(..., min_length=1)
    hunk_header: str = Field(..., min_length=1)
    expander_id: str = Field(..., min_length=1)
    direction: str = Field(..., pattern="^(up|down)$")


async def _load_commit_file_lines(
    source: GitLocalSource,
    commit_hash: str,
    file_entry: dict,
) -> list[str]:
    if file_entry.get("status") == "deleted":
        blob = await _run_local_git(source, "show", f"{commit_hash}^:{file_entry['old_path']}")
    else:
        blob = await _run_local_git(source, "show", f"{commit_hash}:{file_entry['new_path']}")
    return blob.splitlines()
```

- [ ] **Step 4: Implement directional replacement-row building**

```python
def _slice_replacement_rows(
    *,
    file_lines: list[str],
    expander: dict,
    direction: str,
) -> list[dict]:
    start = int(expander["new_start"] or expander["old_start"] or 1)
    end = int(expander["new_end"] or expander["old_end"] or start)
    if direction == "up":
        reveal_start = max(1, end - 19)
        reveal_end = end
    else:
        reveal_start = start
        reveal_end = min(len(file_lines), start + 19)

    rows = [
        _line_row("context", file_lines[index - 1], index, index)
        for index in range(reveal_start, reveal_end + 1)
    ]
    remaining = end - reveal_start if direction == "up" else (int(expander["hidden_count"]) - len(rows))
    if remaining > 0:
        rows.append(_expander_row(
            row_id=expander["id"],
            direction=direction,
            hidden_count=remaining,
            old_start=expander["old_start"],
            old_end=reveal_start - 1 if direction == "up" else expander["old_end"],
            new_start=expander["new_start"],
            new_end=reveal_start - 1 if direction == "up" else expander["new_end"],
            expand_key=expander["expand_key"],
        ))
    return rows
```

- [ ] **Step 5: Add the expansion endpoint**

```python
@router.post("/api/kernel/commit/expand")
async def kernel_commit_patch_expand(
    payload: KernelCommitPatchExpandRequest = Body(...),
):
    source = _local_git_source()
    patch = await _run_local_git(source, "show", "--no-ext-diff", "--find-renames", "--format=", payload.commit_hash)
    files = _parse_commit_patch(patch, context_radius=3, commit_hash=payload.commit_hash)
    file_entry = next(file for file in files if file["path"] == payload.file_path)
    hunk = next(item for item in file_entry["hunks"] if item["header"] == payload.hunk_header)
    expander = next(row for row in hunk["rows"] if row["type"] == "expander" and row["id"] == payload.expander_id)
    file_lines = await _load_commit_file_lines(source, payload.commit_hash, file_entry)
    return {
        "hunk_header": hunk["header"],
        "expander_id": expander["id"],
        "replacement_rows": _slice_replacement_rows(file_lines=file_lines, expander=expander, direction=payload.direction),
    }
```

- [ ] **Step 6: Cover the enriched commit endpoint response**

```python
def test_kernel_commit_returns_rows_and_not_context_preview(monkeypatch):
    async def _fake_run_local_git(_source, *args, **_kwargs):
        if args[:3] == ("show", "--no-patch", "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%B"):
            return "abcd1234abcd1234abcd1234abcd1234abcd1234\x1fabcd123\x1fAlice\x1falice@example.com\x1f2026-05-19T00:00:00+00:00\x1fSubject\x1fBody"
        if args[:3] == ("show", "--numstat", "--format="):
            return "1\t1\tmm/mmap.c\n"
        if args[:4] == ("show", "--no-ext-diff", "--find-renames", "--format="):
            return """diff --git a/mm/mmap.c b/mm/mmap.c
index 1111111..2222222 100644
--- a/mm/mmap.c
+++ b/mm/mmap.c
@@ -10,1 +10,1 @@
-old
+new
"""
        if args[:2] == ("describe", "--tags"):
            return "v6.5\n"
        raise AssertionError(args)

    monkeypatch.setattr(kernel, "_local_git_source", lambda: object())
    monkeypatch.setattr(kernel, "_run_local_git", _fake_run_local_git)

    response = asyncio.run(kernel.kernel_commit(version="v6.6", commit_hash="abcd1234"))

    hunk = response["files"][0]["hunks"][0]
    assert "rows" in hunk
    assert "context_preview" not in hunk
    assert hunk["rows"][0]["type"] in {"expander", "line"}
```

- [ ] **Step 7: Run the backend commit-browser test file**

Run: `rtk pytest tests/api/test_kernel_commit_browser.py -q`

Expected: PASS

- [ ] **Step 8: Commit the backend expansion API**

```bash
git add src/api/routers/kernel.py tests/api/test_kernel_commit_browser.py
git commit -m "feat: add kernel patch context expansion api"
```

## Task 3: Add frontend types, API client, and model normalization

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/components/kernelCode/commitPatchModel.ts`
- Modify: `web/src/components/kernelCode/__tests__/commitPatchModel.test.ts`

- [ ] **Step 1: Add failing frontend model tests for row normalization**

```ts
it('normalizes row-based hunk data and preserves expander metadata', () => {
  const model = buildCommitPatchModel({
    nearest_tag_version: 'v6.5',
    files: [
      {
        path: 'mm/mmap.c',
        old_path: 'mm/mmap.c',
        new_path: 'mm/mmap.c',
        status: 'modified',
        added: '2',
        deleted: '1',
        is_binary: false,
        truncated: false,
        hunks: [
          {
            header: '@@ -10,1 +20,2 @@',
            old_start: 10,
            old_count: 1,
            new_start: 20,
            new_count: 2,
            rows: [
              {
                type: 'expander',
                id: 'top',
                direction: 'up',
                hidden_count: 9,
                step_size: 20,
                old_start: 1,
                old_end: 9,
                new_start: 1,
                new_end: 9,
                expand_key: 'expand-top',
              },
              { type: 'line', kind: 'add', text: '+line_c', old_line: null, new_line: 20 },
            ],
            current_version_target: { available: true, version: 'v6.6', path: 'mm/mmap.c', line: 20, reason: null },
            nearest_tag_target: { available: true, version: 'v6.5', path: 'mm/mmap.c', line: 18, reason: null },
          },
        ],
      },
    ],
  });

  expect(model!.files[0].hunks[0].rows[0]).toEqual({
    type: 'expander',
    id: 'top',
    direction: 'up',
    hiddenCount: 9,
    stepSize: 20,
    oldStart: 1,
    oldEnd: 9,
    newStart: 1,
    newEnd: 9,
    expandKey: 'expand-top',
  });
});
```

- [ ] **Step 2: Run the frontend model tests to verify they fail**

Run: `rtk npm run test -- commitPatchModel`

Expected: FAIL because the current model only knows `lines` and `context_preview`.

- [ ] **Step 3: Add row and expansion types to the API layer**

```ts
export interface KernelCommitPatchRowLine {
  type: 'line';
  kind: 'context' | 'add' | 'del' | 'meta';
  text: string;
  old_line: number | null;
  new_line: number | null;
}

export interface KernelCommitPatchRowExpander {
  type: 'expander';
  id: string;
  direction: 'up' | 'down' | 'both';
  hidden_count: number;
  step_size: number;
  old_start: number | null;
  old_end: number | null;
  new_start: number | null;
  new_end: number | null;
  expand_key: string;
}

export interface KernelCommitPatchExpandResponse {
  hunk_header: string;
  expander_id: string;
  replacement_rows: Array<KernelCommitPatchRowLine | KernelCommitPatchRowExpander>;
}
```

- [ ] **Step 4: Add the frontend API helper for expansion**

```ts
export async function expandKernelCommitPatchHunk(input: {
  version: string;
  commitHash: string;
  filePath: string;
  hunkHeader: string;
  expanderId: string;
  direction: 'up' | 'down';
}): Promise<KernelCommitPatchExpandResponse> {
  return requestJson('/api/kernel/commit/expand', {
    method: 'POST',
    body: JSON.stringify({
      version: input.version,
      commit_hash: input.commitHash,
      file_path: input.filePath,
      hunk_header: input.hunkHeader,
      expander_id: input.expanderId,
      direction: input.direction,
    }),
  });
}
```

- [ ] **Step 5: Normalize row data in `commitPatchModel.ts`**

```ts
export interface CommitPatchLineRowView {
  type: 'line';
  kind: 'context' | 'add' | 'del' | 'meta';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface CommitPatchExpanderRowView {
  type: 'expander';
  id: string;
  direction: 'up' | 'down' | 'both';
  hiddenCount: number;
  stepSize: number;
  oldStart: number | null;
  oldEnd: number | null;
  newStart: number | null;
  newEnd: number | null;
  expandKey: string;
}

function normalizeRow(row: KernelCommitPatchRowLine | KernelCommitPatchRowExpander) {
  if (row.type === 'expander') {
    return {
      type: 'expander' as const,
      id: row.id,
      direction: row.direction,
      hiddenCount: Number(row.hidden_count || 0),
      stepSize: Number(row.step_size || 20),
      oldStart: row.old_start ?? null,
      oldEnd: row.old_end ?? null,
      newStart: row.new_start ?? null,
      newEnd: row.new_end ?? null,
      expandKey: row.expand_key,
    };
  }
  return {
    type: 'line' as const,
    kind: row.kind,
    text: row.text,
    oldLine: row.old_line ?? null,
    newLine: row.new_line ?? null,
  };
}
```

- [ ] **Step 6: Run the model tests**

Run: `rtk npm run test -- commitPatchModel`

Expected: PASS

- [ ] **Step 7: Commit the frontend row model plumbing**

```bash
git add web/src/api/types.ts web/src/api/client.ts web/src/components/kernelCode/commitPatchModel.ts web/src/components/kernelCode/__tests__/commitPatchModel.test.ts
git commit -m "feat: normalize row-based kernel patch hunks"
```

## Task 4: Render the unified GitHub-style diff table and expander actions

**Files:**
- Modify: `web/src/components/kernelCode/CodeHistoryPanel.tsx`
- Modify: `web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx`
- Verify only: `web/src/pages/KernelCodePage.tsx`

- [ ] **Step 1: Add failing UI tests for inline expander rendering**

```tsx
it('renders a single unified diff surface with GitHub-style expander rows', async () => {
  const onOpenTarget = vi.fn();
  const model = buildCommitPatchModel({
    nearest_tag_version: 'v6.5',
    files: [
      {
        path: 'mm/mmap.c',
        old_path: 'mm/mmap.c',
        new_path: 'mm/mmap.c',
        status: 'modified',
        added: '2',
        deleted: '1',
        is_binary: false,
        truncated: false,
        hunks: [
          {
            header: '@@ -10,1 +20,2 @@',
            old_start: 10,
            old_count: 1,
            new_start: 20,
            new_count: 2,
            rows: [
              { type: 'expander', id: 'top', direction: 'up', hidden_count: 9, step_size: 20, old_start: 1, old_end: 9, new_start: 1, new_end: 9, expand_key: 'expand-top' },
              { type: 'line', kind: 'add', text: '+line_c', old_line: null, new_line: 20 },
            ],
            current_version_target: { available: true, version: 'v6.6', path: 'mm/mmap.c', line: 20, reason: null },
            nearest_tag_target: { available: true, version: 'v6.5', path: 'mm/mmap.c', line: 18, reason: null },
          },
        ],
      },
    ],
  });

  render(
    <CommitPatchBrowser
      model={model!}
      version="v6.6"
      commitHash="abcd1234"
      selectedFilePath="mm/mmap.c"
      onSelectFile={() => {}}
      onOpenTarget={onOpenTarget}
    />,
  );

  expect(screen.getByText('Expand 20 lines above')).toBeInTheDocument();
  expect(screen.getByText('+line_c')).toBeInTheDocument();
  expect(screen.queryByText('line_b2\nline_c')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the patch-browser UI test**

Run: `rtk npm run test -- CodeHistoryPanel`

Expected: FAIL because the current component still renders separate diff and context `pre` blocks.

- [ ] **Step 3: Add local hunk-row state and expander action handlers**

```tsx
const [hunkRowsByKey, setHunkRowsByKey] = useState<Record<string, CommitPatchRowView[]>>({});
const [loadingExpanderId, setLoadingExpanderId] = useState('');
const [expanderErrorById, setExpanderErrorById] = useState<Record<string, string>>({});

async function handleExpandRow(filePath: string, hunk: CommitPatchHunkView, row: CommitPatchExpanderRowView) {
  if (row.direction === 'both') return;
  setLoadingExpanderId(row.id);
  setExpanderErrorById((current) => ({ ...current, [row.id]: '' }));
  try {
    const response = await expandKernelCommitPatchHunk({
      version,
      commitHash,
      filePath,
      hunkHeader: hunk.header,
      expanderId: row.id,
      direction: row.direction,
    });
    setHunkRowsByKey((current) => ({
      ...current,
      [`${filePath}:${hunk.header}`]: replaceExpanderRows(current[`${filePath}:${hunk.header}`] || hunk.rows, row.id, response.replacementRows),
    }));
  } catch (error) {
    setExpanderErrorById((current) => ({ ...current, [row.id]: error instanceof Error ? error.message : 'Expand failed' }));
  } finally {
    setLoadingExpanderId('');
  }
}
```

Also update the commit detail modal call site and browser props:

```tsx
<CommitPatchBrowser
  model={structuredModel}
  version={version}
  commitHash={shown.commit_hash}
  selectedFilePath={selectedFilePath}
  onSelectFile={onSelectFile}
  onOpenTarget={(target) => onOpenTarget?.(target)}
/>
```

- [ ] **Step 4: Replace the dual `pre` layout with a unified diff table**

```tsx
<div className="mt-2 overflow-hidden rounded-md border border-slate-300 bg-white">
  <div className="border-b border-sky-200 bg-sky-50 px-3 py-2 font-mono text-[11px] text-sky-900">
    {hunk.header}
  </div>
  <div role="table" className="font-mono text-xs leading-5">
    {rows.map((row) => row.type === 'expander' ? (
      <button
        key={row.id}
        type="button"
        onClick={() => void handleExpandRow(selectedFile.path, hunk, row)}
        className="grid w-full grid-cols-[64px_64px_minmax(0,1fr)] border-t border-slate-200 bg-sky-50/60 px-0 text-left hover:bg-sky-100/80"
      >
        <span className="px-3 py-2 text-slate-500">…</span>
        <span className="px-3 py-2 text-slate-500">…</span>
        <span className="px-3 py-2 text-sky-800">
          {row.direction === 'up' ? `Expand ${row.stepSize} lines above` : `Expand ${row.stepSize} lines below`}
        </span>
      </button>
    ) : (
      <div
        key={`${row.type}:${row.oldLine ?? 'n'}:${row.newLine ?? 'n'}:${row.text}`}
        className={`grid grid-cols-[64px_64px_minmax(0,1fr)] border-t border-slate-200 ${
          row.kind === 'add'
            ? 'bg-emerald-50'
            : row.kind === 'del'
              ? 'bg-rose-50'
              : row.kind === 'meta'
                ? 'bg-slate-100'
                : 'bg-white'
        }`}
      >
        <span className="px-3 py-1.5 text-right text-slate-500">{row.oldLine ?? ''}</span>
        <span className="px-3 py-1.5 text-right text-slate-500">{row.newLine ?? ''}</span>
        <span className="overflow-x-auto px-3 py-1.5 text-slate-900">{row.text || '\u00a0'}</span>
      </div>
    ))}
  </div>
</div>
```

- [ ] **Step 5: Show inline expander errors and preserve navigation buttons**

```tsx
{expanderErrorById[row.id] ? (
  <div className="border-t border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
    {expanderErrorById[row.id]}
  </div>
) : null}
<div className="mt-3 flex flex-wrap gap-2">
  <SecondaryButton onClick={() => handleOpenTarget(currentTarget)} disabled={!currentTarget.available}>
    Open in current version
  </SecondaryButton>
  <SecondaryButton onClick={() => handleOpenTarget(nearestTagTarget)} disabled={!nearestTagTarget.available}>
    Jump to nearest tag
  </SecondaryButton>
</div>
```

- [ ] **Step 6: Verify `KernelCodePage.tsx` needs no functional change**

Run: `rtk rg -n "onOpenCommitTarget" web/src/pages/KernelCodePage.tsx`

Expected: one existing callback handoff from `CodeHistoryPanel` into `openCommitTarget`; leave the file unchanged unless type imports require a compile fix.

- [ ] **Step 7: Run the frontend patch-browser tests**

Run: `rtk npm run test -- CodeHistoryPanel commitPatchModel`

Expected: PASS

- [ ] **Step 8: Commit the unified diff UI**

```bash
git add web/src/components/kernelCode/CodeHistoryPanel.tsx web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx web/src/components/kernelCode/commitPatchModel.ts web/src/components/kernelCode/__tests__/commitPatchModel.test.ts web/src/api/types.ts web/src/api/client.ts
git commit -m "feat: render github-style kernel patch browser"
```

## Task 5: Full verification and repo memory updates

**Files:**
- Modify: `AGENTS.md`
- Verify: `tests/api/test_kernel_commit_browser.py`
- Verify: `web/src/components/kernelCode/__tests__/commitPatchModel.test.ts`
- Verify: `web/src/components/kernelCode/__tests__/CodeHistoryPanel.test.tsx`

- [ ] **Step 1: Run the backend regression tests**

Run: `rtk pytest tests/api/test_kernel_commit_browser.py -q`

Expected: PASS

- [ ] **Step 2: Run the frontend regression tests**

Run: `rtk npm run test -- CodeHistoryPanel commitPatchModel`

Expected: PASS

- [ ] **Step 3: Run a targeted combined verification pass**

Run: `rtk git diff -- src/api/routers/kernel.py web/src/components/kernelCode/CodeHistoryPanel.tsx web/src/components/kernelCode/commitPatchModel.ts`

Expected: a focused diff showing row-based hunk data, expansion API plumbing, and unified diff rendering with no annotation or knowledge changes.

- [ ] **Step 4: Append the stable decision to `AGENTS.md`**

```md
- 2026-05-19: kernel commit patch browser uses row-based hunks plus inline context expanders for GitHub-style diff rendering (src/api/routers/kernel.py, web/src/components/kernelCode/commitPatchModel.ts, web/src/components/kernelCode/CodeHistoryPanel.tsx)
```

- [ ] **Step 5: Clear `Current Feature Context` in `AGENTS.md`**

```md
## Current Feature Context

<!-- -->
```

- [ ] **Step 6: Commit the verification and memory update**

```bash
git add AGENTS.md
git commit -m "docs: record github-style patch browser decision"
```
