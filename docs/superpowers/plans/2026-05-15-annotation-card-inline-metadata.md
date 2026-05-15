# AnnotationCard Inline Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the hover-triggered details popover from `AnnotationCard` and replace it with inline visibility/publishStatus badges and a collapsible tags row.

**Architecture:** Single-file change to `AnnotationCard.tsx`. Delete ~65-line popover block, add two inline badge elements in the header chip row, add a `tagsOpen` boolean state + collapsible `EmailTagEditor` row at card bottom.

**Tech Stack:** React, TypeScript, Tailwind CSS, lucide-react

---

### Task 1: Remove popover and `showDetailsPopover` prop

**Files:**
- Modify: `web/src/components/AnnotationCard.tsx`

- [ ] **Step 1: Read the file**

Open `web/src/components/AnnotationCard.tsx` and confirm the popover block starts around line 151 (`{showDetailsPopover && (`) and ends around line 225 (`})`).

- [ ] **Step 2: Remove `showDetailsPopover` prop from interface**

In `AnnotationCardProps` (line ~47), delete:
```ts
showDetailsPopover?: boolean;
```

- [ ] **Step 3: Remove prop from destructured params**

In the function signature (around line 101), delete:
```ts
showDetailsPopover = true,
```

- [ ] **Step 4: Delete the entire popover block**

Delete from `{showDetailsPopover && (` through its matching closing `)}` — the entire `<div className="relative shrink-0">` wrapper that contains the `<Info />` button and the popover div. After deletion the `</div>` that closes `<div className="flex items-start justify-between gap-3">` should be the next closing tag.

- [ ] **Step 5: Remove unused `Info` import**

In the lucide-react import line (line ~13), remove `Info` from the destructured imports:
```ts
// before
import { Clock3, Info, Shield, Tags, UserRound } from 'lucide-react';
// after
import { Shield, Tags } from 'lucide-react';
```
(Keep `Shield` and `Tags` — they will be used in Tasks 2 and 3. Remove `Clock3`, `UserRound` since they were only used inside the popover.)

- [ ] **Step 6: Verify build passes**

```bash
cd web && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors related to `showDetailsPopover`, `Info`, `Clock3`, or `UserRound`.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/AnnotationCard.tsx
git commit -m "refactor(annotation): remove hover details popover from AnnotationCard"
```

---

### Task 2: Add inline visibility and publishStatus badges to header

**Files:**
- Modify: `web/src/components/AnnotationCard.tsx`

- [ ] **Step 1: Locate the header chip row**

Find the `<div className="flex flex-wrap items-center gap-2">` block (around line 139) which currently contains:
```tsx
<span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${theme.chip}`}>
  {annotationType}
</span>
{anchorLabel && <span ...>{anchorLabel}</span>}
<AnnotationIdBadge annotationId={annotationId} compact showCopyLink />
```

- [ ] **Step 2: Add visibility badge after AnnotationIdBadge**

Insert after the `<AnnotationIdBadge .../>` line:
```tsx
<span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
  visibility === 'private'
    ? 'bg-amber-50 text-amber-700 border border-amber-200'
    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
}`}>
  <Shield size={10} />
  {visibility}
</span>
```

- [ ] **Step 3: Add publishStatus badge (hidden when 'none')**

Insert after the visibility badge:
```tsx
{publishStatus !== 'none' && (
  <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${statusTone}`}>
    {publishStatus}
  </span>
)}
```

`statusTone` is already defined in the component (line ~120).

- [ ] **Step 4: Verify build passes**

```bash
cd web && npm run build 2>&1 | tail -20
```
Expected: clean build, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/AnnotationCard.tsx
git commit -m "feat(annotation): add inline visibility and publish status badges to AnnotationCard header"
```

---

### Task 3: Add collapsible tags row at card bottom

**Files:**
- Modify: `web/src/components/AnnotationCard.tsx`

- [ ] **Step 1: Add `tagsOpen` state**

Near the top of the component body (after `const [editBody, setEditBody] = useState(body);`), add:
```tsx
const [tagsOpen, setTagsOpen] = useState(false);
```

- [ ] **Step 2: Locate insertion point**

Find the section just before `{resolvedCanManage || resolvedCanReply ? (` (the `AnnotationActions` block, around line 320). The collapsible tags row goes immediately before this block.

- [ ] **Step 3: Insert the collapsible tags row**

```tsx
<div className="mt-3">
  <button
    type="button"
    onClick={() => setTagsOpen((v) => !v)}
    className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
  >
    <Tags size={13} />
    标签
    <span className="text-[10px]">{tagsOpen ? '▴' : '▾'}</span>
  </button>
  {tagsOpen && (
    <div className="mt-2">
      <EmailTagEditor
        targetType="annotation"
        targetRef={annotationId}
        compact
      />
    </div>
  )}
</div>
```

- [ ] **Step 4: Verify `EmailTagEditor` import exists**

Check imports at top of file — `EmailTagEditor` should already be imported from `'./EmailTagEditor'`. If missing, add:
```tsx
import EmailTagEditor from './EmailTagEditor';
```

- [ ] **Step 5: Verify build passes**

```bash
cd web && npm run build 2>&1 | tail -20
```
Expected: clean build.

- [ ] **Step 6: Run existing tests**

```bash
cd web && npm test -- --run 2>&1 | tail -30
```
Expected: all tests pass (no regressions — `AnnotationCard` has no direct unit tests; `AnnotationTree` and `ThreadAnnotationCard` tests should still pass).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/AnnotationCard.tsx
git commit -m "feat(annotation): add collapsible tags row to AnnotationCard"
```

---

## Self-Review Checklist

- [x] Spec: remove popover → Task 1 ✓
- [x] Spec: inline visibility badge → Task 2 ✓  
- [x] Spec: inline publishStatus badge → Task 2 ✓
- [x] Spec: collapsible tags row → Task 3 ✓
- [x] Spec: remove `showDetailsPopover` prop → Task 1 ✓
- [x] No placeholders or TBDs
- [x] `Shield` and `Tags` imports kept through Task 1, used in Task 2 and 3
- [x] `statusTone` referenced in Task 2 is defined in the component before first use
- [x] `EmailTagEditor` import check included in Task 3
