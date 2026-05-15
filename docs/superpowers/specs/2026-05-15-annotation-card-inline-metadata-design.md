# AnnotationCard: Inline Metadata — Remove Hover Popover

**Date:** 2026-05-15  
**Status:** Approved

## Problem

`AnnotationCard.tsx` renders a details popover triggered by `group-hover` on `.group/annotation-card`. The popover uses `fixed inset-x-3 bottom-3 z-50`, which:

1. Covers action buttons (edit/delete/reply) in the same card
2. Duplicates information already shown in the card header (annotation ID, target label, anchor)
3. Degrades on mobile (hover doesn't exist)

## Solution: Inline Metadata + Collapsible Tags Row

### Remove

- `showDetailsPopover` prop and its entire popover `<div>` block (~65 lines in `AnnotationCard.tsx`)
- `group/annotation-card` class and all `group-hover/annotation-card` + `group-focus-within/annotation-card` Tailwind classes

### Add to card header chip row

Inline badges after the type chip and anchorLabel:

- **Visibility badge**: shield icon + "private" (amber) / "public" (emerald) — small pill
- **PublishStatus badge**: reuse existing `statusTone` colors — inline pill, hidden when `publishStatus === 'none'`

### Add collapsible tags row

At card bottom, before `AnnotationActions`:

```
[Tags icon] 标签 ▾          ← collapsed by default (local useState)
──────────────────
<EmailTagEditor ...>        ← shown when expanded
```

- Local `useState<boolean>` (`tagsOpen`) controls visibility
- Toggle button: `<Tags size={14}/> 标签 {tagsOpen ? '▴' : '▾'}`

### Prop cleanup

- Remove `showDetailsPopover?: boolean` from `AnnotationCardProps`
- Remove all call sites passing `showDetailsPopover` (grep: `AnnotationTree.tsx`, `AnnotationPanel.tsx`, `ThreadAnnotationCard.tsx`)

## Files Changed

| File | Change |
|------|--------|
| `web/src/components/AnnotationCard.tsx` | Remove popover, add inline badges, add collapsible tags row |
| `web/src/components/AnnotationTree.tsx` | Remove `showDetailsPopover` prop if passed |
| `web/src/components/kernelCode/AnnotationPanel.tsx` | Remove `showDetailsPopover` prop if passed |
| `web/src/components/ThreadAnnotationCard.tsx` | Remove `showDetailsPopover` prop if passed |

## Non-Goals

- No changes to `AnnotationTree` card header (target label / anchorLabel / AnnotationIdBadge already there)
- No changes to `EmailTagEditor` internals
- No new API calls
