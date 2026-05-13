# Code Annotation Roller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bidirectional code/annotation reading experience with a pinned annotation area, a 2.5D annotation roller, annotation jump controls, and range-aware code gutter markers.

**Architecture:** Extract annotation sync, range, and marker decisions into pure TypeScript helpers with Vitest coverage first. Then update `KernelCodePage.tsx` to track active viewport line, pinned annotation, sync source, and scroll refs. Finally update `AnnotationPanel.tsx` to render pinned and roller states while preserving existing CRUD, publish, reply, tag, and detail modal behavior.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Tailwind CSS, existing `lucide-react` icons.

---

## Recommended Model And Reasoning Mode

Use Codex/GPT-5 family with high reasoning effort for this plan. If dispatching subagents, use the default inherited model or `gpt-5.3-codex` with high reasoning for implementation tasks that touch scroll synchronization. Use medium reasoning for browser QA or small style follow-ups.

Do not ask any worker to output hidden chain-of-thought. Ask for:

- brief rationale for chosen implementation,
- failing and passing test evidence,
- files changed,
- browser observations,
- remaining risks.

## Scope

This plan implements only the front-end annotation reading interaction for the existing kernel code browser. It does not change backend APIs or annotation storage.

## File Structure

- Create: `web/src/components/kernelCode/annotationSync.ts`
  - Pure helpers for annotation line ranges, active annotation selection, roller item state, gutter marker classification, and scroll sync lock decisions.

- Create: `web/src/components/kernelCode/__tests__/annotationSync.test.ts`
  - Vitest coverage for the pure helpers before UI changes.

- Modify: `web/src/pages/KernelCodePage.tsx`
  - Track active center line, active annotation id, pinned annotation id, sync source, and annotation panel scroll callbacks.
  - Pass sync state and jump handlers into `AnnotationPanel`.
  - Render range-aware gutter markers in the code row marker column.

- Modify: `web/src/components/kernelCode/AnnotationPanel.tsx`
  - Render pinned region plus 2.5D roller region.
  - Add jump buttons and active card styling.
  - Preserve create/edit/delete/publish/detail modal behavior.

- Modify: `web/src/index.css`
  - Add reduced-motion safe utility styles only if Tailwind classes are insufficient for the roller transforms.

---

### Task 1: Add Pure Annotation Sync Helpers

**Files:**
- Create: `web/src/components/kernelCode/annotationSync.ts`
- Create: `web/src/components/kernelCode/__tests__/annotationSync.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/kernelCode/__tests__/annotationSync.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CodeAnnotation } from '../../../api/types';
import {
  buildLineMarker,
  getAnnotationLineRange,
  pickActiveAnnotation,
  rankRollerItems,
  shouldAllowSync,
} from '../annotationSync';

function annotation(patch: Partial<CodeAnnotation>): CodeAnnotation {
  return {
    annotation_id: 'a1',
    annotation_type: 'note',
    version: 'v6.6',
    file_path: 'mm/mmap.c',
    start_line: 10,
    end_line: 10,
    body: 'body',
    author: 'tester',
    visibility: 'private',
    publish_status: 'none',
    created_at: '',
    updated_at: '',
    target_type: 'kernel_line_range',
    target_ref: 'v6.6:mm/mmap.c',
    target_label: '',
    target_subtitle: '',
    anchor: {},
    meta: {},
    ...patch,
  };
}

describe('annotation sync helpers', () => {
  it('reads line range from explicit fields first', () => {
    expect(getAnnotationLineRange(annotation({ start_line: 5, end_line: 8 }))).toEqual({
      start: 5,
      end: 8,
    });
  });

  it('falls back to anchor line range when explicit fields are missing', () => {
    expect(
      getAnnotationLineRange(
        annotation({
          start_line: 0,
          end_line: 0,
          anchor: { start_line: '21', end_line: '24' },
        }),
      ),
    ).toEqual({ start: 21, end: 24 });
  });

  it('picks annotation containing center line before nearest annotation', () => {
    const annotations = [
      annotation({ annotation_id: 'near', start_line: 20, end_line: 22 }),
      annotation({ annotation_id: 'contains', start_line: 30, end_line: 40 }),
    ];

    expect(pickActiveAnnotation(annotations, 35)?.annotation_id).toBe('contains');
  });

  it('picks nearest annotation when center line has no direct overlap', () => {
    const annotations = [
      annotation({ annotation_id: 'before', start_line: 10, end_line: 11 }),
      annotation({ annotation_id: 'after', start_line: 40, end_line: 41 }),
    ];

    expect(pickActiveAnnotation(annotations, 32)?.annotation_id).toBe('after');
  });

  it('ranks roller items around the active annotation', () => {
    const annotations = [
      annotation({ annotation_id: 'a', start_line: 10, end_line: 10 }),
      annotation({ annotation_id: 'b', start_line: 20, end_line: 20 }),
      annotation({ annotation_id: 'c', start_line: 30, end_line: 30 }),
    ];

    expect(rankRollerItems(annotations, 'b').map((item) => [item.annotation.annotation_id, item.position])).toEqual([
      ['a', -1],
      ['b', 0],
      ['c', 1],
    ]);
  });

  it('uses a dot for single-line annotation markers', () => {
    expect(
      buildLineMarker({
        line: 10,
        annotations: [annotation({ start_line: 10, end_line: 10 })],
        selectedLines: new Set<number>(),
        activeAnnotationId: null,
      }),
    ).toMatchObject({ kind: 'dot', selected: false, active: false });
  });

  it('uses a vertical line for multi-line annotation markers', () => {
    expect(
      buildLineMarker({
        line: 11,
        annotations: [annotation({ start_line: 10, end_line: 12 })],
        selectedLines: new Set<number>(),
        activeAnnotationId: null,
      }),
    ).toMatchObject({ kind: 'range', selected: false, active: false });
  });

  it('promotes selected multi-line range to selected range marker', () => {
    expect(
      buildLineMarker({
        line: 11,
        annotations: [],
        selectedLines: new Set<number>([10, 11, 12]),
        activeAnnotationId: null,
      }),
    ).toMatchObject({ kind: 'range', selected: true, active: false });
  });

  it('blocks immediate reverse sync from the same source lock', () => {
    expect(shouldAllowSync({ source: 'code', requestedBy: 'annotation', now: 1000, lockedUntil: 1300 })).toBe(false);
    expect(shouldAllowSync({ source: 'code', requestedBy: 'annotation', now: 1400, lockedUntil: 1300 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd web
npm test -- src/components/kernelCode/__tests__/annotationSync.test.ts
```

Expected: FAIL with `Failed to resolve import "../annotationSync"`.

- [ ] **Step 3: Add the helper implementation**

Create `web/src/components/kernelCode/annotationSync.ts`:

```ts
import type { CodeAnnotation } from '../../api/types';

export type AnnotationRange = { start: number; end: number };
export type SyncSource = 'code' | 'annotation' | 'jump' | null;

export type RollerItem = {
  annotation: CodeAnnotation;
  position: number;
  active: boolean;
};

export type LineMarker = {
  kind: 'none' | 'dot' | 'range';
  selected: boolean;
  active: boolean;
  annotationCount: number;
};

function numericField(source: Record<string, unknown> | undefined, key: string): number {
  const value = source?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function getAnnotationLineRange(annotation: CodeAnnotation): AnnotationRange {
  const codeTarget = annotation.code_target as Record<string, unknown> | undefined;
  const metaCodeTarget = annotation.meta?.code_target as Record<string, unknown> | undefined;
  const start =
    annotation.start_line ||
    numericField(annotation.anchor, 'start_line') ||
    numericField(codeTarget, 'start_line') ||
    numericField(metaCodeTarget, 'start_line');
  const end =
    annotation.end_line ||
    numericField(annotation.anchor, 'end_line') ||
    numericField(codeTarget, 'end_line') ||
    numericField(metaCodeTarget, 'end_line') ||
    start;

  return {
    start,
    end: end > 0 ? Math.max(start, end) : start,
  };
}

export function lineDistanceToRange(line: number, range: AnnotationRange): number {
  if (range.start <= line && line <= range.end) return 0;
  if (line < range.start) return range.start - line;
  return line - range.end;
}

export function pickActiveAnnotation(
  annotations: CodeAnnotation[],
  centerLine: number | null,
): CodeAnnotation | null {
  if (!centerLine || annotations.length === 0) return null;
  return annotations
    .filter((annotation) => !annotation.in_reply_to)
    .slice()
    .sort((a, b) => {
      const aRange = getAnnotationLineRange(a);
      const bRange = getAnnotationLineRange(b);
      const distanceDelta = lineDistanceToRange(centerLine, aRange) - lineDistanceToRange(centerLine, bRange);
      if (distanceDelta !== 0) return distanceDelta;
      return aRange.start - bRange.start;
    })[0] || null;
}

export function rankRollerItems(annotations: CodeAnnotation[], activeAnnotationId: string | null): RollerItem[] {
  const roots = annotations
    .filter((annotation) => !annotation.in_reply_to)
    .slice()
    .sort((a, b) => getAnnotationLineRange(a).start - getAnnotationLineRange(b).start);
  const activeIndex = Math.max(0, roots.findIndex((annotation) => annotation.annotation_id === activeAnnotationId));

  return roots.map((annotation, index) => ({
    annotation,
    position: index - activeIndex,
    active: annotation.annotation_id === activeAnnotationId,
  }));
}

export function buildLineMarker({
  line,
  annotations,
  selectedLines,
  activeAnnotationId,
}: {
  line: number;
  annotations: CodeAnnotation[];
  selectedLines: Set<number>;
  activeAnnotationId: string | null;
}): LineMarker {
  const selected = selectedLines.has(line);
  const selectedRange = selectedLines.size > 1;
  const matching = annotations.filter((annotation) => {
    const range = getAnnotationLineRange(annotation);
    return range.start <= line && line <= range.end;
  });
  const hasMultiLineAnnotation = matching.some((annotation) => {
    const range = getAnnotationLineRange(annotation);
    return range.end > range.start;
  });
  const active = matching.some((annotation) => annotation.annotation_id === activeAnnotationId);

  if (selectedRange || hasMultiLineAnnotation) {
    return { kind: 'range', selected, active, annotationCount: matching.length };
  }
  if (selected || matching.length > 0) {
    return { kind: 'dot', selected, active, annotationCount: matching.length };
  }
  return { kind: 'none', selected: false, active: false, annotationCount: 0 };
}

export function shouldAllowSync({
  source,
  requestedBy,
  now,
  lockedUntil,
}: {
  source: SyncSource;
  requestedBy: Exclude<SyncSource, null>;
  now: number;
  lockedUntil: number;
}): boolean {
  if (!source) return true;
  if (now >= lockedUntil) return true;
  return source === requestedBy;
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
cd web
npm test -- src/components/kernelCode/__tests__/annotationSync.test.ts
```

Expected: PASS for all helper tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/kernelCode/annotationSync.ts web/src/components/kernelCode/__tests__/annotationSync.test.ts
git commit -m "test: add annotation sync helpers"
```

---

### Task 2: Track Active Code Viewport Line And Sync State

**Files:**
- Modify: `web/src/pages/KernelCodePage.tsx`

- [ ] **Step 1: Add state and refs**

In `KernelCodePage`, add these imports from `annotationSync`:

```ts
import {
  buildLineMarker,
  getAnnotationLineRange,
  pickActiveAnnotation,
  type SyncSource,
} from '../components/kernelCode/annotationSync';
```

Near existing refs, add:

```ts
const annotationPanelRef = useRef<HTMLDivElement | null>(null);
const codeScrollRafRef = useRef<number | null>(null);
const syncLockRef = useRef<{ source: SyncSource; until: number }>({ source: null, until: 0 });
```

Near existing state, add:

```ts
const [activeCenterLine, setActiveCenterLine] = useState<number | null>(null);
const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
const [pinnedAnnotationId, setPinnedAnnotationId] = useState<string | null>(null);
```

- [ ] **Step 2: Add active annotation derivation**

After `relatedAnnotations`, add:

```ts
const activeAnnotation = useMemo(
  () => annotations.find((annotation) => annotation.annotation_id === activeAnnotationId) || null,
  [activeAnnotationId, annotations],
);

const pinnedAnnotation = useMemo(
  () => annotations.find((annotation) => annotation.annotation_id === pinnedAnnotationId) || null,
  [pinnedAnnotationId, annotations],
);
```

- [ ] **Step 3: Add center-line calculation**

Add this function near `scrollToLine`:

```ts
function computeCenterLineFromScroll(): number | null {
  const container = codeViewRef.current;
  if (!container || !currentFile) return null;
  const firstLine = container.querySelector<HTMLElement>('[data-line="1"]');
  if (!firstLine) return null;
  const rowHeight = firstLine.offsetHeight || 20;
  const rawLine = Math.round((container.scrollTop + container.clientHeight / 2) / rowHeight);
  return Math.max(1, Math.min(codeLines.length, rawLine));
}
```

- [ ] **Step 4: Add code scroll handler**

Add:

```ts
function handleCodeScroll() {
  if (codeScrollRafRef.current !== null) return;
  codeScrollRafRef.current = window.requestAnimationFrame(() => {
    codeScrollRafRef.current = null;
    const centerLine = computeCenterLineFromScroll();
    setActiveCenterLine(centerLine);
    const now = Date.now();
    const lock = syncLockRef.current;
    if (lock.source && lock.source !== 'code' && now < lock.until) return;
    const nextActive = pickActiveAnnotation(annotations, centerLine);
    setActiveAnnotationId(nextActive?.annotation_id || null);
    syncLockRef.current = { source: 'code', until: now + 350 };
  });
}
```

Attach it to the code scroll container:

```tsx
<div
  ref={codeViewRef}
  onScroll={handleCodeScroll}
  onMouseUp={handleCodeMouseUp}
  className="relative min-h-0 flex-1 overflow-y-scroll bg-white"
>
```

- [ ] **Step 5: Clear stale sync state on file changes**

In the effect that runs when `currentFile` changes and scrolls to `focusLine`, add:

```ts
setActiveCenterLine(focusLine || 1);
setActiveAnnotationId(null);
setPinnedAnnotationId(null);
syncLockRef.current = { source: null, until: 0 };
```

- [ ] **Step 6: Run build**

Run:

```bash
cd web
npm run build
```

Expected: TypeScript build and Vite build both succeed.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/KernelCodePage.tsx
git commit -m "feat: track active code annotation line"
```

---

### Task 3: Add Pinned And 2.5D Roller Rendering

**Files:**
- Modify: `web/src/components/kernelCode/AnnotationPanel.tsx`
- Modify: `web/src/pages/KernelCodePage.tsx`

- [ ] **Step 1: Extend `AnnotationPanelProps`**

In `AnnotationPanel.tsx`, import:

```ts
import { LocateFixed } from 'lucide-react';
import {
  getAnnotationLineRange,
  rankRollerItems,
} from './annotationSync';
```

Extend props:

```ts
  activeAnnotationId?: string | null;
  pinnedAnnotationId?: string | null;
  onJumpToAnnotation?: (annotation: CodeAnnotation, options?: { pin?: boolean }) => void;
  rollerContainerRef?: React.RefObject<HTMLDivElement>;
```

Update the function parameters with defaults:

```ts
  activeAnnotationId = null,
  pinnedAnnotationId = null,
  onJumpToAnnotation,
  rollerContainerRef,
```

- [ ] **Step 2: Remove duplicate line-range helper**

Delete local `numericField` and `getAnnotationLineRange` from `AnnotationPanel.tsx`, keeping `formatAnnotationLineRange` but making it call the imported helper.

- [ ] **Step 3: Add roller data**

After `replyCounts`, add:

```ts
const pinnedAnnotation = useMemo(
  () => rootAnnotations.find((annotation) => annotation.annotation_id === pinnedAnnotationId) || null,
  [pinnedAnnotationId, rootAnnotations],
);

const rollerItems = useMemo(
  () => rankRollerItems(rootAnnotations, activeAnnotationId),
  [activeAnnotationId, rootAnnotations],
);
```

- [ ] **Step 4: Create a local card renderer**

Inside `AnnotationPanel`, add a `renderAnnotationCard` helper that reuses the existing card body/actions and adds active/roller styling:

```tsx
const renderAnnotationCard = (
  root: CodeAnnotation,
  options: { active?: boolean; pinned?: boolean; rollerPosition?: number } = {},
) => {
  const isExpanded = expandedIds.has(root.annotation_id);
  const replies = annotations.filter((a) => a.in_reply_to === root.annotation_id);
  const replyCount = replyCounts[root.annotation_id] || 0;
  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-rose-100 text-rose-800',
  };
  const sc = statusColors[root.publish_status] || 'bg-slate-200 text-slate-900';
  const position = options.rollerPosition ?? 0;
  const distance = Math.min(Math.abs(position), 3);
  const rollerStyle = options.pinned
    ? ''
    : distance === 0
      ? 'scale-100 opacity-100 shadow-md'
      : distance === 1
        ? 'scale-[0.97] opacity-80'
        : 'scale-[0.94] opacity-60';

  return (
    <div
      key={root.annotation_id}
      data-annotation-id={root.annotation_id}
      className={`space-y-1 transition duration-200 motion-reduce:scale-100 motion-reduce:transform-none ${
        options.active ? 'relative z-10' : ''
      } ${rollerStyle}`}
    >
      <div
        className={`overflow-hidden rounded-lg border bg-white shadow-sm ${
          options.active
            ? 'border-sky-300 ring-2 ring-sky-100'
            : options.pinned
              ? 'border-indigo-300'
              : 'border-slate-300'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-300 bg-slate-100 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {replyCount > 0 && (
              <button
                type="button"
                onClick={() => toggleExpand(root.annotation_id)}
                className="w-4 text-[10px] text-slate-600"
                aria-label={isExpanded ? 'Collapse replies' : 'Expand replies'}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            )}
            <span className="text-xs text-slate-600">{formatAnnotationLineRange(root)}</span>
            {replyCount > 0 && <span className="text-[10px] text-slate-600">({replyCount})</span>}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sc}`}>{root.publish_status}</span>
            {options.pinned && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Pinned</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onJumpToAnnotation && (
              <button
                type="button"
                onClick={() => onJumpToAnnotation(root, { pin: true })}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-white hover:text-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
                aria-label={`Jump to ${formatAnnotationLineRange(root)}`}
                title={`Jump to ${formatAnnotationLineRange(root)}`}
              >
                <LocateFixed className="h-3.5 w-3.5" />
              </button>
            )}
            <PublishButton a={root} />
            {canManage(root) && (
              <button
                type="button"
                onClick={() => {
                  setPreviewAnnotation(root);
                  setPreviewStartEditing(true);
                }}
                className="text-[10px] text-slate-600 hover:text-slate-950"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setPreviewAnnotation(root);
                setPreviewStartEditing(false);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-white hover:text-slate-900"
              aria-label="Open annotation detail"
              title="Open annotation detail"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            {canManage(root) && (
              <button
                type="button"
                onClick={() => setPendingAction({ kind: 'delete', annotationId: root.annotation_id, isReply: false })}
                className="text-[10px] text-slate-600 hover:text-red-500"
              >
                Delete
              </button>
            )}
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="markdown-content text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{root.body}</ReactMarkdown>
          </div>
          {root.publish_review_comment && (
            <div className="mt-2 rounded border border-slate-300 bg-slate-100 px-2 py-1 text-[10px] text-slate-700">
              Review note: {root.publish_review_comment}
            </div>
          )}
          <div className="mt-2">
            <EmailTagEditor targetType="annotation" targetRef={root.annotation_id} compact />
          </div>
        </div>
      </div>

      {isExpanded && replies.map((reply) => (
        <div key={reply.annotation_id} className="ml-4 overflow-hidden rounded-lg border border-l-4 border-slate-300 border-l-green-500 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-300 bg-slate-100 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700">Reply</span>
              <span className="text-xs text-slate-600">{formatAnnotationLineRange(reply)}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setPreviewAnnotation(reply);
                setPreviewStartEditing(false);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-white hover:text-slate-900"
              aria-label="Open reply detail"
              title="Open reply detail"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="px-3 py-2">
            <div className="markdown-content text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply.body}</ReactMarkdown>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 5: Replace the list body with pinned plus roller sections**

Replace the existing `rootAnnotations.filter(...).map(...)` list body with:

```tsx
<div className="space-y-3">
  {pinnedAnnotation ? (
    <section className="sticky top-0 z-20 rounded-lg border border-indigo-200 bg-indigo-50/80 p-2 backdrop-blur">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700">
        Pinned
      </div>
      {renderAnnotationCard(pinnedAnnotation, { pinned: true, active: pinnedAnnotation.annotation_id === activeAnnotationId })}
    </section>
  ) : selectedLines.size > 0 ? (
    <section className="sticky top-0 z-20 rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-600">
      {lineInfo} has no pinned annotation yet.
    </section>
  ) : null}

  <section
    ref={rollerContainerRef}
    className="space-y-2 overflow-y-auto py-2 [perspective:900px]"
    aria-label="Annotation roller"
  >
    {rollerItems.map((item) =>
      renderAnnotationCard(item.annotation, {
        active: item.active,
        rollerPosition: item.position,
      }),
    )}
  </section>
</div>
```

- [ ] **Step 6: Pass props from `KernelCodePage`**

Update the `AnnotationPanel` call:

```tsx
<AnnotationPanel
  annotations={annotations}
  selectedLines={selectedLines}
  version={selectedVersion}
  filePath={currentPath}
  activeAnnotationId={activeAnnotation?.annotation_id || null}
  pinnedAnnotationId={pinnedAnnotation?.annotation_id || null}
  rollerContainerRef={annotationPanelRef}
  onJumpToAnnotation={handleJumpToAnnotation}
  onAnnotationCreated={handleAnnotationCreated}
  hideHeader
/>
```

- [ ] **Step 7: Run build**

Run:

```bash
cd web
npm run build
```

Expected: build succeeds without TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/kernelCode/AnnotationPanel.tsx web/src/pages/KernelCodePage.tsx
git commit -m "feat: add pinned annotation roller"
```

---

### Task 4: Add Annotation-To-Code Jump And Roller-To-Code Sync

**Files:**
- Modify: `web/src/pages/KernelCodePage.tsx`
- Modify: `web/src/components/kernelCode/AnnotationPanel.tsx`

- [ ] **Step 1: Add jump handler**

In `KernelCodePage`, add:

```ts
function handleJumpToAnnotation(annotation: CodeAnnotation, options?: { pin?: boolean }) {
  const range = getAnnotationLineRange(annotation);
  const now = Date.now();
  syncLockRef.current = { source: 'jump', until: now + 650 };
  setActiveAnnotationId(annotation.annotation_id);
  if (options?.pin) setPinnedAnnotationId(annotation.annotation_id);
  handleSelectRange(range.start, range.end);
  scrollToLine(range.start);
}
```

- [ ] **Step 2: Add active card auto-scroll**

Add an effect:

```ts
useEffect(() => {
  if (!activeAnnotationId) return;
  const container = annotationPanelRef.current;
  const target = container?.querySelector<HTMLElement>(`[data-annotation-id="${activeAnnotationId}"]`);
  if (!container || !target) return;
  const now = Date.now();
  const lock = syncLockRef.current;
  if (lock.source && lock.source !== 'code' && now < lock.until) return;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
}, [activeAnnotationId]);
```

- [ ] **Step 3: Add annotation roller scroll handler**

In `AnnotationPanelProps`, add:

```ts
  onRollerCenteredAnnotationChange?: (annotation: CodeAnnotation) => void;
```

In `AnnotationPanel`, attach an `onScroll` handler to the roller section:

```tsx
onScroll={(event) => {
  if (!onRollerCenteredAnnotationChange) return;
  const container = event.currentTarget;
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-annotation-id]'));
  const center = container.getBoundingClientRect().top + container.clientHeight / 2;
  const nearest = cards
    .map((card) => ({
      id: card.dataset.annotationId || '',
      distance: Math.abs(card.getBoundingClientRect().top + card.offsetHeight / 2 - center),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  const annotation = rootAnnotations.find((item) => item.annotation_id === nearest?.id);
  if (annotation) onRollerCenteredAnnotationChange(annotation);
}}
```

- [ ] **Step 4: Add guarded code sync from roller**

In `KernelCodePage`, add:

```ts
function handleRollerCenteredAnnotationChange(annotation: CodeAnnotation) {
  const now = Date.now();
  const lock = syncLockRef.current;
  if (lock.source && lock.source !== 'annotation' && now < lock.until) return;
  const range = getAnnotationLineRange(annotation);
  syncLockRef.current = { source: 'annotation', until: now + 650 };
  setActiveAnnotationId(annotation.annotation_id);
  scrollToLine(range.start);
}
```

Pass it:

```tsx
onRollerCenteredAnnotationChange={handleRollerCenteredAnnotationChange}
```

- [ ] **Step 5: Run build**

Run:

```bash
cd web
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/KernelCodePage.tsx web/src/components/kernelCode/AnnotationPanel.tsx
git commit -m "feat: sync annotation roller with code"
```

---

### Task 5: Replace Gutter Dots With Range-Aware Markers

**Files:**
- Modify: `web/src/pages/KernelCodePage.tsx`

- [ ] **Step 1: Replace marker calculation inside code row map**

Inside `codeLines.map`, replace `annotationCount` marker state with:

```ts
const marker = buildLineMarker({
  line: lineNum,
  annotations,
  selectedLines,
  activeAnnotationId,
});
```

- [ ] **Step 2: Replace marker JSX**

Replace the first grid cell with:

```tsx
<div className="flex items-stretch justify-center py-0.5">
  {marker.kind === 'range' ? (
    <span
      className={`w-1 rounded-full ${
        marker.selected
          ? 'bg-sky-600'
          : marker.active
            ? 'bg-indigo-500'
            : marker.annotationCount > 0
              ? 'bg-sky-300'
              : 'bg-transparent'
      }`}
      title={marker.annotationCount > 0 ? `${marker.annotationCount} annotation(s)` : undefined}
    />
  ) : (
    <span
      className={`mt-2 h-1.5 w-1.5 rounded-full ${
        marker.selected
          ? 'bg-sky-600'
          : marker.active
            ? 'bg-indigo-500'
            : marker.annotationCount > 0
              ? 'bg-sky-400'
              : 'bg-transparent'
      }`}
      title={marker.annotationCount > 0 ? `${marker.annotationCount} annotation(s)` : undefined}
    />
  )}
</div>
```

- [ ] **Step 3: Strengthen active and selected row styles**

Update row class logic:

```ts
const isActiveAnnotationLine = marker.active;
```

Use:

```tsx
className={`group grid w-max grid-cols-[14px_52px_max-content_24px] border-b border-slate-200 px-3 ${
  isSelected
    ? 'border-l-2 border-l-sky-500 bg-sky-50'
    : isActiveAnnotationLine
      ? 'bg-indigo-50/70'
      : 'hover:bg-slate-50'
}`}
```

- [ ] **Step 4: Run helper tests and build**

Run:

```bash
cd web
npm test -- src/components/kernelCode/__tests__/annotationSync.test.ts
npm run build
```

Expected: tests pass and build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/KernelCodePage.tsx
git commit -m "feat: show annotation ranges in code gutter"
```

---

### Task 6: Browser Verification And Polish

**Files:**
- Modify if needed: `web/src/components/kernelCode/AnnotationPanel.tsx`
- Modify if needed: `web/src/pages/KernelCodePage.tsx`
- Modify if needed: `web/src/index.css`

- [ ] **Step 1: Start local app**

Run:

```bash
cd web
npm run dev
```

Expected: Vite starts and prints a local URL, usually `http://localhost:5173/`.

- [ ] **Step 2: Open the kernel code browser**

Use the in-app browser or Playwright to open:

```text
http://localhost:5173/app/kernel-code?v=v6.6&path=mm/mmap.c&line=1
```

Expected: Code Atlas opens with the file loaded.

- [ ] **Step 3: Verify code-to-annotation sync**

Manual/browser checks:

- Scroll the code pane.
- Confirm the active annotation card changes in the roller.
- Confirm the active card is visually larger/stronger than neighbors.
- Confirm no code text shifts horizontally during hover or active-state changes.

- [ ] **Step 4: Verify annotation-to-code sync**

Manual/browser checks:

- Scroll the annotation roller.
- Confirm the code pane moves to the centered annotation line range.
- Click a card jump button.
- Confirm the code pane scrolls to that annotation, selects its range, and pins it at the top.

- [ ] **Step 5: Verify gutter range markers**

Manual/browser checks:

- Single-line annotations show dots.
- Multi-line annotations show continuous vertical markers.
- Shift-select multiple code lines.
- Confirm selected range marker is stronger than passive annotation marker.

- [ ] **Step 6: Verify reduced motion**

In DevTools or Playwright, emulate reduced motion and refresh.

Expected:

- Roller cards still highlight active state.
- Scale/transform animation is removed or visually minimized.
- Jump and scroll interactions remain usable.

- [ ] **Step 7: Final validation**

Run:

```bash
cd web
npm test -- src/components/kernelCode/__tests__/annotationSync.test.ts
npm run build
```

Expected: tests pass and build succeeds.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/kernelCode/AnnotationPanel.tsx web/src/pages/KernelCodePage.tsx web/src/index.css
git commit -m "fix: polish annotation roller interactions"
```

---

## Self-Review Checklist

- Spec coverage: Tasks cover pinned annotation, 2.5D roller, code-to-annotation sync, annotation-to-code sync, jump buttons, gutter vertical ranges, reduced motion, and browser verification.
- Placeholder scan: No task uses unspecified placeholder work; each code change has concrete snippets and commands.
- Type consistency: Helper names used by tasks are defined in Task 1: `getAnnotationLineRange`, `pickActiveAnnotation`, `rankRollerItems`, `buildLineMarker`, `SyncSource`.
- Residual risk: `AnnotationPanel.tsx` currently contains repeated card rendering; Task 3 intentionally introduces a local renderer first. If the component becomes difficult to maintain during implementation, split `AnnotationCard` into a sibling component inside the same directory before proceeding to Task 4.
