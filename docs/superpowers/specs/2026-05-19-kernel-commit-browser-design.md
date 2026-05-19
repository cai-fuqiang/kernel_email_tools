# Kernel Commit Browser Design

Date: 2026-05-19
Status: Draft for review

## Goal

Enrich kernel commit browsing inside the code browser so users can inspect commit patches by file and hunk, view GitHub-style nearby code context, and jump from a patch hunk to the nearest browsable tag version without rendering raw patch content inside the main code view.

## Scope

In scope:

- enrich commit detail data returned by the kernel API
- upgrade the history inspector commit detail UI from plain text diff to structured file and hunk browsing
- support hunk-level navigation into a real code view
- support hunk-level jump into the nearest tag version that can be opened in the code browser

Out of scope:

- annotation, knowledge, and tag feature changes
- a standalone commit page
- rendering patch text as the primary content of the main code pane
- cross-repo or non-kernel commit browsing

## User Problems

Current support is not enough in two places:

1. commit detail is too flat
   changed files are shown as static rows and the diff is a single raw text block
2. commit detail does not link back to nearby code well enough
   users cannot browse commit files and hunks naturally, and cannot reliably jump from a patch hunk to a useful real-code location

## Chosen Approach

Use the existing history inspector and commit detail modal, but upgrade commit detail into a structured commit browser:

- keep the history list lightweight
- load commit detail on demand
- return structured patch data from the backend
- browse a commit by changed file, then by hunk
- show both diff lines and nearby real-code context for each hunk
- allow hunk-level navigation into real code in either the current version or the nearest tag version

This preserves the current browsing workflow and avoids the navigation problems caused by showing patch content directly in the main code pane.

## Alternatives Considered

### A. Structured commit browser inside the existing history UI

Recommended.

Pros:

- fits the current `KernelCodePage` and `CodeHistoryPanel` workflow
- keeps patch viewing and real code viewing separate
- gives strong hunk-level navigation without a page switch

Cons:

- requires backend patch parsing and new response fields

### B. Keep raw patch response and parse everything in the frontend

Rejected.

Pros:

- smaller backend change

Cons:

- fragile diff parsing in the browser
- harder to support truncation, renames, context previews, and mapping metadata cleanly

### C. Build a separate commit browsing page

Rejected for now.

Pros:

- more room for large commit UI

Cons:

- interrupts the code browsing workflow
- weakens the connection between selected code range and commit inspection

## UX Design

### History List

The history list remains lightweight:

- compact summary rows for blame and line history commits
- no large diff rendering in the list itself
- expanding a row reveals short metadata only
- full commit browsing happens in the structured detail view

### Commit Detail Layout

Commit detail is split into three functional regions:

1. commit overview
   subject, author, date, trailers, lore links, truncation state
2. file navigator
   changed files with status and stats, selectable one at a time
3. hunk browser
   structured hunk cards for the selected file

### Hunk Card

Each hunk card shows:

- hunk header such as `@@ -120,7 +120,9 @@`
- a compact standard diff view
- a GitHub-style nearby code context block
- action buttons

The nearby code context block is not the main code pane. It is a preview inside commit detail that helps users understand where the change sits in real code.

### Hunk Actions

Each hunk offers:

- `Open in current version`
  opens the matching file and nearby line in the main code pane if available
- `Jump to nearest tag`
  switches to the nearest browsable tag version and opens the mapped file and line

The main code pane always remains a real file viewer, never a patch renderer.

## Backend Design

### Existing Endpoint

`GET /api/kernel/commit` already returns commit metadata, changed files, and a raw patch string.

### Response Evolution

Extend the response so structured patch data becomes primary while raw patch remains a fallback:

- keep:
  - commit metadata
  - trailers
  - lore links
  - changed file stats
  - raw patch
  - patch truncation flag
- add:
  - structured file list
  - structured hunk list per file
  - per-hunk context preview
  - per-hunk jump targets and mapping status

### Proposed Data Shape

Each commit detail includes a `files` array.

Each file entry includes:

- `path`
- `old_path`
- `new_path`
- `status`
- `added`
- `deleted`
- `is_binary`
- `truncated`
- `hunks`

Each hunk entry includes:

- `header`
- `old_start`
- `old_count`
- `new_start`
- `new_count`
- `lines`
- `context_preview`
- `current_version_target`
- `nearest_tag_target`

Each diff line includes:

- `kind`: `context` | `add` | `del` | `meta`
- `text`
- optional `old_line`
- optional `new_line`

Each `context_preview` includes:

- `focus_start_line`
- `focus_end_line`
- `snippet`
- optional `before_lines`
- optional `after_lines`

Each jump target includes:

- `available`
- `version`
- `path`
- `line`
- optional `reason`

## Patch Parsing

Backend parses the raw `git show --patch` output into file and hunk structures.

Requirements:

- support standard unified diffs
- capture rename and delete metadata
- preserve hunk headers and line ordering
- assign line numbers for old and new sides where possible
- mark binary or unsupported files clearly

If parsing partially fails for a file, keep the raw patch and mark that file as degraded instead of failing the whole commit detail response.

## Large Patch Strategy

Use progressive degradation similar to GitHub-style behavior:

1. return file summaries even when the full patch is large
2. return only the first `N` hunks per file when limits are hit
3. return only bounded nearby context per hunk
4. mark file-level or commit-level truncation explicitly
5. preserve jump metadata even when display content is truncated

This favors navigation and comprehension over perfect full-patch fidelity.

## Nearest Tag Mapping

### Definition

The nearest tag version means the closest release tag that:

- is reachable for this commit under the local kernel repository history
- exists in the code browser's supported version list
- can be opened through the existing kernel file browsing flow

### Mapping Rules

For each hunk:

1. prefer `new_path` with `new_start`
2. if not valid, fall back to `old_path` with `old_start`
3. if the mapped file does not exist in the nearest tag version, mark the jump unavailable
4. if the file exists but the line is out of range, clamp to the last line of the file when that line can be resolved cheaply; otherwise mark the jump unavailable

The system must never pretend a jump is valid when it cannot be opened reliably.

### Why Tag Mapping Is Hunk-Level

Mapping at commit level is too coarse. Different files or hunks in the same commit can have different usability outcomes because of renames, deletions, or line drift. Hunk-level mapping gives the user precise feedback.

## Frontend Design

### CodeHistoryPanel

Upgrade `CodeHistoryPanel` to:

- keep lightweight commit rows in the history list
- load structured detail on demand
- replace static changed-file text with selectable file navigation
- render hunk cards for the active file
- surface per-hunk actions and mapping availability

### Commit Detail Modal

Upgrade the modal from:

- left: message and changed files
- right: raw diff text

to:

- left: commit metadata and selectable changed files
- right: active file hunk browser

The modal should still support a readable fallback for raw patch if structured data is missing for a file.

### Main Code Pane Navigation

When a hunk action is used:

- update version if needed
- load the target file
- scroll near the target line
- preserve commit detail state so the user can return to other hunks quickly

This keeps the main pane focused on source code while the inspector remains the patch exploration tool.

## Error Handling

### Large Patches

If a patch is truncated:

- show a clear truncated badge
- keep file and hunk navigation for the retained subset
- preserve jump actions where mapping data exists

### Missing Mapping

If nearest-tag mapping cannot be produced:

- keep the hunk visible
- disable the jump button
- show a short reason

### Renames and Deletes

If a file was renamed or deleted:

- show both old and new paths when relevant
- choose the openable side for navigation
- disable actions that cannot be fulfilled reliably

### Binary or Unsupported Diff Content

If a file is binary or unsupported for context preview:

- keep the file in the navigator
- show a summary state instead of a text hunk preview
- disable hunk-specific actions when there is no meaningful location target

## Testing Strategy

Backend:

- parse single-file and multi-file diffs
- parse rename and delete diffs
- preserve hunk numbering and line numbering
- verify truncation behavior
- verify nearest-tag target generation and unavailable reasons

Frontend:

- changed file selection updates visible hunks
- hunk cards render diff lines and context previews
- unavailable jump targets render disabled actions with reasons
- jump actions call the expected navigation path
- degraded raw-patch fallback still renders safely

## Acceptance Criteria

1. commit detail supports file-by-file patch browsing
2. users can inspect structured hunk cards for a selected file
3. each hunk shows both diff lines and nearby code context
4. users can jump from a hunk to the nearest browsable tag version when mapping exists
5. the main code pane never becomes a raw patch viewer
6. large patch, rename, delete, and unmappable cases degrade clearly without breaking commit browsing

## Files Expected To Change

- `src/api/routers/kernel.py`
- `web/src/api/types.ts`
- `web/src/api/client.ts`
- `web/src/components/kernelCode/CodeHistoryPanel.tsx`
- `web/src/pages/KernelCodePage.tsx`

## Open Decisions Resolved In This Spec

- no separate commit page for this iteration
- no patch rendering inside the main code pane
- nearest tag jump is a first-class hunk action
- large patch support favors partial structured browsing plus clear truncation over full patch fidelity
