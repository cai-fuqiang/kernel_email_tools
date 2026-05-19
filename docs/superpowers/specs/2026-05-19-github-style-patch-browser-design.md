# GitHub-Style Patch Browser Design

Date: 2026-05-19
Status: Draft for review

## Goal

Replace the current split patch preview with a GitHub-style unified diff browser that renders each hunk as a single table, supports directional context expansion, and uses GitHub-inspired colors and affordances inside the kernel history commit detail modal.

## Scope

In scope:

- replace the current two-block hunk rendering with a single unified diff presentation
- return structured hunk rows that distinguish visible diff lines from omitted context segments
- support directional expansion for omitted context above, below, or between visible lines
- restyle the patch browser to match GitHub diff conventions closely enough to feel familiar
- preserve existing hunk-level navigation actions into the current version and nearest tag

Out of scope:

- annotation, knowledge, search, or tag feature changes
- changes to the main code viewer rendering model outside the history inspector modal
- a full GitHub clone of every keyboard shortcut or review affordance
- expanding binary file handling beyond the existing fallback behavior

## User Problem

The current patch browser splits a hunk into two unrelated blocks:

1. a dark diff block for changed lines
2. a separate light context preview block

This creates three UX problems:

1. the hunk no longer reads as one piece of code history
2. omitted context is shown as a detached preview instead of an expandable part of the diff
3. the visual treatment looks custom and noisy instead of familiar and scannable

## Chosen Approach

Upgrade the backend patch model so each hunk returns a single ordered row stream. That row stream mixes:

- visible diff rows
- expandable omitted-context rows

The frontend then renders each hunk as a single GitHub-style diff table with:

- hunk header row
- old line number column
- new line number column
- code content column
- inline expander rows

This is intentionally a full data-model upgrade rather than a CSS-only restyle. The design goal is not to make the current split layout look nicer; it is to make the browser structurally behave like a real diff viewer.

## Alternatives Considered

### A. Visual-only frontend restyle

Rejected.

Pros:

- fastest implementation
- mostly isolated to `CodeHistoryPanel.tsx`

Cons:

- does not remove the split-data model
- cannot support true directional expansion cleanly
- would still rely on detached `context_preview` snippets

### B. Frontend-only row reconstruction from existing hunk data

Rejected.

Pros:

- avoids backend API changes
- could improve the UI meaningfully

Cons:

- frontend must guess where omitted ranges belong
- expansion behavior would be fake or limited by current snippet data
- harder to keep line numbers and hidden-range state correct

### C. Backend row model plus frontend unified diff browser

Recommended.

Pros:

- supports true inline expansion
- keeps diff semantics explicit and testable
- gives the frontend a stable render model for future patch features

Cons:

- requires coordinated backend and frontend changes

## UX Design

### Hunk Layout

Each hunk becomes one bordered table-like card:

- top: hunk header row such as `@@ -111,7 +111,7 @@ tracepoint:crypto_splice:tsgl_composition`
- body: unified diff rows
- bottom: existing hunk navigation actions

The current second `context_preview` block disappears.

### Diff Rows

Each visible diff row renders three columns:

1. old line number
2. new line number
3. content

Row treatments:

- `context`: white background
- `add`: GitHub-style light green background and darker green text accent
- `del`: GitHub-style light red background and darker red text accent
- `meta`: muted gray metadata treatment when needed

The code area keeps monospace text and preserves whitespace. Hover should lightly emphasize the current row without disrupting add/delete colors.

### Expander Rows

Omitted context renders inline as a dedicated expander row rather than a separate preview block.

Expander behavior:

- when hidden lines exist only above visible content, show `Expand 20 lines above`
- when hidden lines exist only below visible content, show `Expand 20 lines below`
- when hidden lines exist between two visible ranges, show a combined omitted-lines row with direction-aware actions

The row should feel close to GitHub:

- muted blue-gray background
- centered affordance
- expand iconography
- clear omitted line count

### Expansion Model

Expansion is incremental by fixed step size rather than all-at-once.

Recommended step size:

- 20 lines per action

Behavior:

- each click expands at most 20 hidden lines in the requested direction
- the final click expands the remaining hidden lines even if fewer than 20
- expanded lines appear in place without replacing the whole hunk card
- scroll position should remain stable enough that the clicked expander stays near the user’s eye line

### Commit Detail Visual Style

The patch browser should move away from the current dark diff block and align with GitHub’s visual language:

- white diff surface
- light gray borders and separators
- pale blue hunk headers
- pale green insert rows
- pale red delete rows
- muted line number gutters

This styling applies only to the patch browser area and should not force a GitHub-wide redesign of the rest of the inspector.

## Backend Design

### Current Problem

The current structured model exposes:

- `hunk.lines`
- `hunk.context_preview`

That model assumes the UI will render changed lines and nearby code as two different surfaces. It does not describe omitted intervals as first-class data.

### New Row-Based Hunk Shape

Each hunk should expose a `rows` array instead of a detached `context_preview` surface.

Proposed shape:

```ts
type PatchRow =
  | {
      type: 'line';
      kind: 'context' | 'add' | 'del' | 'meta';
      old_line: number | null;
      new_line: number | null;
      text: string;
    }
  | {
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
    };
```

Each file entry remains responsible for file metadata such as path, status, and stats. Each hunk remains responsible for navigation targets.

### Expansion Contract

The backend should support expanding omitted ranges using an explicit contract rather than forcing the frontend to compute hidden lines on its own.

Recommended options:

1. include enough hidden rows in the initial payload to support local expansion
2. or expose an expansion API keyed by hunk and hidden range identity

Recommendation:

- use a lightweight expansion API

Reasoning:

- keeps initial commit detail payload smaller
- avoids shipping full nearby file context for every hunk up front
- makes the 20-line step behavior straightforward and explicit

### Expansion API Shape

The route name can be chosen during implementation planning, but the response contract should return replacement rows for one expander segment.

Requirements:

- identify the commit, file, hunk, and expander being expanded
- specify requested direction
- respect fixed expansion step size
- return deterministic replacement rows
- preserve navigation target data for the hunk

One practical response shape:

```ts
type PatchExpansionResponse = {
  hunk_header: string;
  expander_id: string;
  replacement_rows: PatchRow[];
};
```

The frontend then replaces the clicked expander row with the returned rows, which may include:

- newly revealed `line` rows
- a smaller remaining `expander` row
- both

## Frontend Design

### Rendering Responsibilities

The frontend should no longer synthesize a pseudo-GitHub structure from `lines` plus `context_preview`. Instead it should render `rows` directly.

Main responsibilities:

- render file list as today
- render each selected hunk as one unified diff card
- dispatch expansion requests per expander row
- splice replacement rows into local hunk state after expansion
- preserve existing action buttons

### State Model

The patch browser needs local per-hunk row state so expansion can update one hunk without reloading the entire commit detail modal.

Suggested state shape:

- selected file path
- per-file expanded hunk rows keyed by hunk identity
- per-expander loading state
- request error state scoped to the hunk or expander

### Error Handling

If expansion fails:

- keep the current visible rows unchanged
- show a compact inline error near the expander row
- allow retry

If structured rows are unavailable:

- keep the existing raw patch fallback rendering

## Testing Strategy

### Backend

Add tests that verify:

- row ordering is stable for a parsed hunk
- expander rows describe omitted intervals correctly
- directional expansion returns the correct next 20 lines
- final expansion removes the expander when no hidden lines remain
- line numbering stays continuous across revealed rows

### Frontend

Add tests that verify:

- a hunk renders as a single unified diff surface
- expander rows render the correct action copy for `up`, `down`, and `both`
- clicking an expander inserts returned rows in place
- multiple expanders in one file do not share loading state incorrectly
- add/delete/context rows receive the expected GitHub-style classes

### Manual Verification

Manual QA should confirm:

- narrow modal widths remain readable
- large hunks do not cause obvious scroll-jump regressions
- navigation buttons still open the expected target after expansions

## Implementation Notes

Likely files in scope:

- `src/api/routers/kernel.py`
- `web/src/components/kernelCode/commitPatchModel.ts`
- `web/src/components/kernelCode/CodeHistoryPanel.tsx`

`web/src/pages/KernelCodePage.tsx` may need only minor or no changes unless state wiring must be adjusted for the modal.

If patch row construction is actually owned outside `kernel.py`, the implementation brief should be expanded before coding rather than working around hidden ownership.

## Risks

1. patch parsing ownership may live deeper than the router
   if so, implementation scope must be widened explicitly before changes begin
2. GitHub-like styling in a modal is tighter than on a full page
   spacing and sticky readability may need small modal-specific adjustments
3. expansion state can become fragile if keyed only by array index
   hunk and expander identities must be explicit and stable

## Acceptance Signal

The feature is successful when:

- each hunk appears as a single GitHub-style unified diff surface
- omitted context is represented by inline expanders, not a detached preview block
- users can expand omitted lines upward or downward in fixed steps
- colors and spacing clearly match GitHub diff conventions more closely than the current custom dark-light split
- existing commit-to-code navigation actions still work
