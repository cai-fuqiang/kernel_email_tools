# PDF Viewer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `react-pdf` + 1376-line custom viewer with `@react-pdf-viewer/core` + `defaultLayoutPlugin`, retaining annotation display in a right rail.

**Architecture:** Swap the PDF rendering layer to `@react-pdf-viewer/core` which self-manages its pdfjs worker (eliminating version-mismatch errors). Keep the right rail annotation panel and its backend data hook. Delete all custom scroll tracking, zoom state, and worker configuration code.

**Tech Stack:** `@react-pdf-viewer/core`, `@react-pdf-viewer/default-layout`, `react-markdown`, `vitest`, `react-router-dom`

**Spec:** `docs/superpowers/specs/2026-05-20-pdf-viewer-redesign.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `web/package.json` | Modify | Swap deps: remove react-pdf/pdfjs-dist, add @react-pdf-viewer packages |
| `web/src/pages/ManualPdfPage.tsx` | Rewrite | New viewer shell using @react-pdf-viewer; retain rail layout + annotation hook |
| `web/src/pages/__tests__/ManualPdfPage.test.tsx` | Modify | Remove deleted exports, update mock to stub @react-pdf-viewer/core |

---

## Task 1: Install dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install new packages, remove old ones**

```bash
cd web
npm install @react-pdf-viewer/core @react-pdf-viewer/default-layout
npm uninstall react-pdf pdfjs-dist
```

- [ ] **Step 2: Verify package.json**

`package.json` dependencies should now contain `@react-pdf-viewer/core` and `@react-pdf-viewer/default-layout`, and NOT contain `react-pdf` or `pdfjs-dist`.

- [ ] **Step 3: Confirm pdfjs version bundled with viewer**

```bash
cat node_modules/@react-pdf-viewer/core/package.json | grep pdfjs
```

Note the exact `pdfjs-dist` version printed — you will need it for the `<Worker>` URL in Task 2.

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "chore: swap react-pdf for @react-pdf-viewer/core"
```

---

## Task 2: Rewrite ManualPdfPage.tsx

**Files:**
- Rewrite: `web/src/pages/ManualPdfPage.tsx`

The new file keeps:
- `useManualPdfAnnotations` hook (unchanged)
- Right rail with annotation list (Markdown, scroll, page badge, click-to-jump)
- `WorkspaceRailShell` layout structure + collapse/resize behaviour
- `AnnotationModeControls` (Text/Region toggle)
- `ManualPdfPage` default export + route wiring

The new file removes:
- `loadReactPdfModule()`, worker URL hack, `createReactPdfTestModule()`
- `useVisiblePageTracking`, `createPageRefRegistry`, `resolveMostVisiblePage`
- `clampPage`, `scrollToPage`, custom zoom state, `ZOOM_PRESETS`
- Custom `<Document>` / `<Page>` render tree
- `continuous` / `single` page mode toggle

Replace the PDF rendering section with `<Worker>` + `<Viewer defaultLayoutPlugin>`.

- [ ] **Step 1: Write the new ManualPdfPage.tsx**

Replace the entire file with the following. Substitute `PDFJS_VERSION` with the version you noted in Task 1 Step 3.

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Worker, Viewer } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import type { ToolbarSlot, TransformToolbarSlot } from '@react-pdf-viewer/toolbar';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { getManualDocumentView, listAnnotations } from '../api/client';
import type { AnnotationListItem, ManualDocumentView } from '../api/types';
import { PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';

// Replace PDFJS_VERSION with the exact version from node_modules/@react-pdf-viewer/core/package.json
const PDFJS_WORKER_URL = `https://unpkg.com/pdfjs-dist@PDFJS_VERSION/build/pdf.worker.min.js`;

const EXPANDED_RAIL_WIDTH = 320;
const COLLAPSED_RAIL_WIDTH = 48;
const MIN_RAIL_WIDTH = 240;
const MAX_RAIL_WIDTH = 520;

type ManualPdfAnnotationMode = 'text' | 'region';
type ManualPdfLoadState = 'idle' | 'loading' | 'ready' | 'error';

// ── Annotation hook ──────────────────────────────────────────────────────────

function useManualPdfAnnotations(document: ManualDocumentView | null) {
  const [annotations, setAnnotations] = useState<AnnotationListItem[]>([]);
  const [annotationsError, setAnnotationsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!document) {
      setAnnotations([]);
      setAnnotationsError(null);
      return () => { active = false; };
    }

    setAnnotationsError(null);

    const load = async () => {
      const collected: AnnotationListItem[] = [];
      let page = 1;
      let totalPages = 1;
      try {
        while (page <= totalPages) {
          const response = await listAnnotations({
            target_type: 'document_pdf',
            target_ref: document.document_id,
            page,
            page_size: 100,
          });
          collected.push(...response.annotations);
          if (!active) return;
          setAnnotations([...collected]);
          const pageSize = response.page_size || 100;
          totalPages = Math.max(totalPages, Math.ceil(response.total / pageSize));
          page += 1;
        }
      } catch (error: unknown) {
        if (!active) return;
        setAnnotationsError(
          error instanceof Error && error.message.trim() ? error.message : 'Unable to load annotations.',
        );
      }
    };

    void load();
    return () => { active = false; };
  }, [document?.document_id]);

  return { annotations, annotationsError };
}

// ── Annotation display helpers ───────────────────────────────────────────────

function getAnnotationPage(annotation: AnnotationListItem): number | null {
  const page = annotation.anchor?.page;
  if (typeof page === 'number') return page;
  if (typeof page === 'string') {
    const parsed = Number.parseInt(page, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function getAnnotationSummary(annotation: AnnotationListItem): string {
  const quote = annotation.anchor?.quote;
  if (typeof quote === 'string' && quote.trim()) return quote;
  const selectedText = annotation.anchor?.selected_text;
  if (typeof selectedText === 'string' && selectedText.trim()) return selectedText;
  return annotation.body ?? '';
}

// ── Annotation mode controls ─────────────────────────────────────────────────

function AnnotationModeControls({
  annotationMode,
  onChange,
}: {
  annotationMode: ManualPdfAnnotationMode;
  onChange: (mode: ManualPdfAnnotationMode) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        aria-pressed={annotationMode === 'text'}
        onClick={() => onChange('text')}
        className={annotationMode === 'text' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-slate-700 hover:bg-slate-600'}
      >
        Text
      </button>
      <button
        type="button"
        aria-pressed={annotationMode === 'region'}
        onClick={() => onChange('region')}
        className={annotationMode === 'region' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-slate-700 hover:bg-slate-600'}
      >
        Region
      </button>
    </div>
  );
}

// ── Annotation list panel ────────────────────────────────────────────────────

function AnnotationListPanel({
  annotations,
  annotationsError,
  onJumpToPage,
}: {
  annotations: AnnotationListItem[];
  annotationsError: string | null;
  onJumpToPage: (page: number) => void;
}) {
  const sorted = [...annotations].sort((a, b) => {
    const pa = getAnnotationPage(a) ?? 0;
    const pb = getAnnotationPage(b) ?? 0;
    return pa - pb;
  });

  return (
    <div className="flex flex-col gap-2 overflow-y-auto" data-testid="annotation-list-panel">
      {annotationsError && (
        <p className="text-sm text-rose-600">Unable to load annotations. {annotationsError}</p>
      )}
      {sorted.length === 0 && !annotationsError && (
        <p className="text-sm text-slate-500">No annotations yet.</p>
      )}
      {sorted.map((annotation) => {
        const page = getAnnotationPage(annotation);
        const summary = getAnnotationSummary(annotation);
        return (
          <button
            key={annotation.annotation_id}
            type="button"
            className="text-left rounded border border-slate-200 p-2 hover:bg-slate-50"
            onClick={() => page != null && onJumpToPage(page)}
            data-testid={`annotation-item-${annotation.annotation_id}`}
          >
            {page != null && (
              <span className="mb-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                Page {page}
              </span>
            )}
            {summary && (
              <p className="mb-1 text-xs italic text-slate-400 line-clamp-2">{summary}</p>
            )}
            <div className="prose prose-sm max-w-none text-slate-700">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{annotation.body ?? ''}</ReactMarkdown>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── PDF viewer core ──────────────────────────────────────────────────────────

function PdfViewer({
  pdfUrl,
  onJumpToPage,
}: {
  pdfUrl: string;
  onJumpToPage: (jumpFn: (page: number) => void) => void;
}) {
  const jumpRef = useRef<((page: number) => void) | null>(null);

  const transform: TransformToolbarSlot = (slot: ToolbarSlot) => ({
    ...slot,
    // Remove download and open buttons to keep toolbar clean
    Download: () => <></>,
    Open: () => <></>,
  });

  const defaultLayoutPluginInstance = defaultLayoutPlugin({
    toolbarPlugin: { toolbarPlugin: { transform } },
  });

  const { toolbarPluginInstance } = defaultLayoutPluginInstance;
  const { pageNavigationPluginInstance } = toolbarPluginInstance;
  const { jumpToPage } = pageNavigationPluginInstance;

  useEffect(() => {
    jumpRef.current = (page: number) => jumpToPage(page - 1);
    onJumpToPage(jumpRef.current);
  }, [jumpToPage, onJumpToPage]);

  return (
    <Worker workerUrl={PDFJS_WORKER_URL}>
      <Viewer
        fileUrl={pdfUrl}
        plugins={[defaultLayoutPluginInstance]}
      />
    </Worker>
  );
}

// ── Rail shell ───────────────────────────────────────────────────────────────

function WorkspaceRail({
  side,
  collapsed,
  width,
  title,
  onToggle,
  onResizeStart,
  children,
}: {
  side: 'left' | 'right';
  collapsed: boolean;
  width: number;
  title: string;
  onToggle: () => void;
  onResizeStart: (side: 'left' | 'right', clientX: number) => void;
  children: ReactNode;
}) {
  const railWidth = collapsed ? COLLAPSED_RAIL_WIDTH : width;

  return (
    <div
      data-testid={`pdf-rail-${side}`}
      data-collapsed={String(collapsed)}
      style={{ width: railWidth, minWidth: railWidth, maxWidth: railWidth }}
      className="relative flex h-full flex-col overflow-hidden border-slate-200 bg-white"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        {!collapsed && <span className="text-sm font-medium text-slate-700">{title}</span>}
        <button type="button" onClick={onToggle} className="ml-auto text-slate-400 hover:text-slate-600">
          {collapsed ? '→' : '←'}
        </button>
      </div>
      {!collapsed && <div className="flex-1 overflow-y-auto p-3">{children}</div>}
      {/* Resize handle */}
      {!collapsed && (
        <div
          className="absolute top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-slate-300"
          style={{ [side === 'left' ? 'right' : 'left']: 0 }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            onResizeStart(side, e.clientX);
          }}
        />
      )}
    </div>
  );
}

// ── Workspace ────────────────────────────────────────────────────────────────

function ManualPdfWorkspace({
  document,
  loading,
  errorMessage,
  documentId,
}: {
  document: ManualDocumentView | null;
  loading: boolean;
  errorMessage: string | null;
  documentId?: string;
}) {
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [rightRailWidth, setRightRailWidth] = useState(EXPANDED_RAIL_WIDTH);
  const [annotationMode, setAnnotationMode] = useState<ManualPdfAnnotationMode>('text');
  const [jumpToPageFn, setJumpToPageFn] = useState<((page: number) => void) | null>(null);

  const { annotations, annotationsError } = useManualPdfAnnotations(document);

  const handleResizeStart = (side: 'left' | 'right', startX: number) => {
    const startWidth = side === 'right' ? rightRailWidth : 0;
    const onMove = (e: PointerEvent) => {
      const delta = side === 'right' ? startX - e.clientX : e.clientX - startX;
      const next = Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, startWidth + delta));
      if (side === 'right') setRightRailWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      data-testid="pdf-workspace-root"
      data-right-collapsed={String(isRightCollapsed)}
      className="flex h-full overflow-hidden"
    >
      {/* PDF viewer — takes remaining space */}
      <div data-testid="pdf-reader-pane" className="flex-1 overflow-hidden">
        {loading && <p className="p-4 text-slate-500">Loading…</p>}
        {errorMessage && (
          <div className="p-4 text-rose-600" data-testid="pdf-load-error">
            <p>Unable to load PDF workspace.</p>
            <p>{errorMessage}</p>
            {documentId && <p>Document id: {documentId}</p>}
          </div>
        )}
        {!loading && !errorMessage && document?.pdf_url && (
          <PdfViewer
            pdfUrl={document.pdf_url}
            onJumpToPage={(fn) => setJumpToPageFn(() => fn)}
          />
        )}
      </div>

      {/* Right rail — annotations */}
      <WorkspaceRail
        side="right"
        collapsed={isRightCollapsed}
        width={rightRailWidth}
        title="Annotations"
        onToggle={() => setIsRightCollapsed((v) => !v)}
        onResizeStart={handleResizeStart}
      >
        <SectionPanel title="Annotation tools">
          <AnnotationModeControls annotationMode={annotationMode} onChange={setAnnotationMode} />
        </SectionPanel>
        <SectionPanel title="Annotations">
          <AnnotationListPanel
            annotations={annotations}
            annotationsError={annotationsError}
            onJumpToPage={(page) => jumpToPageFn?.(page)}
          />
        </SectionPanel>
      </WorkspaceRail>
    </div>
  );
}

// ── Page root ────────────────────────────────────────────────────────────────

export default function ManualPdfPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const [loadState, setLoadState] = useState<ManualPdfLoadState>('idle');
  const [document, setDocument] = useState<ManualDocumentView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId) return;
    setLoadState('loading');
    setDocument(null);
    setErrorMessage(null);

    getManualDocumentView({ document_id: documentId })
      .then((view) => {
        setDocument(view);
        setLoadState('ready');
      })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof Error && err.message.trim() ? err.message : 'Unknown error.');
        setLoadState('error');
      });
  }, [documentId]);

  return (
    <PageShell>
      <PageHeader>
        <Link to="/manual">Manuals</Link>
        {document && <span>{document.title}</span>}
      </PageHeader>
      <ManualPdfWorkspace
        documentId={documentId}
        document={document}
        loading={loadState === 'loading' || loadState === 'idle'}
        errorMessage={errorMessage}
      />
    </PageShell>
  );
}
```

- [ ] **Step 2: Replace PDFJS_VERSION placeholder**

In the new file find `PDFJS_VERSION` and replace it with the actual version string you noted in Task 1 Step 3. Example: if the version is `4.4.168`, the line becomes:

```ts
const PDFJS_WORKER_URL = `https://unpkg.com/pdfjs-dist@4.4.168/build/pdf.worker.min.js`;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors. Fix any type errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/ManualPdfPage.tsx
git commit -m "feat: replace react-pdf with @react-pdf-viewer/core"
```

---

## Task 3: Update tests

**Files:**
- Modify: `web/src/pages/__tests__/ManualPdfPage.test.tsx`

The tests currently:
1. Import `createPageRefRegistry` and `resolveMostVisiblePage` from `ManualPdfPage` — both deleted
2. Mock `react-pdf` internals — no longer needed
3. Test collapse/expand rail behaviour — still valid, update selectors if needed

- [ ] **Step 1: Remove deleted-export tests**

Delete the two test cases that test `resolveMostVisiblePage` and `createPageRefRegistry` (lines ~119–138). They test implementation details that no longer exist.

- [ ] **Step 2: Add mock for @react-pdf-viewer/core**

Add this mock near the top of the test file (after existing vi.mock blocks):

```typescript
vi.mock('@react-pdf-viewer/core', () => ({
  Worker: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Viewer: ({ fileUrl }: { fileUrl: string }) => (
    <div data-testid="pdf-viewer-stub" data-file-url={fileUrl} />
  ),
}));

vi.mock('@react-pdf-viewer/default-layout', () => ({
  defaultLayoutPlugin: () => ({
    toolbarPluginInstance: {
      pageNavigationPluginInstance: {
        jumpToPage: vi.fn(),
      },
    },
  }),
}));
```

- [ ] **Step 3: Remove react-pdf CSS imports from test setup (if any)**

Search for `react-pdf` in the test file and remove any remaining references.

```bash
grep -n "react-pdf" web/src/pages/__tests__/ManualPdfPage.test.tsx
```

- [ ] **Step 4: Run tests**

```bash
cd web && npm test -- ManualPdfPage
```

Expected: all tests pass. Fix any remaining failures — they will be selector mismatches from changed `data-testid` attributes. The new file uses:
- `data-testid="pdf-workspace-root"` — still present
- `data-testid="pdf-reader-pane"` — still present
- `data-testid="pdf-load-error"` — replaces old error container
- `data-testid="annotation-list-panel"` — new
- `data-right-collapsed` attribute on workspace root (was `data-left-collapsed` + `data-right-collapsed` separately)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/__tests__/ManualPdfPage.test.tsx
git commit -m "test: update ManualPdfPage tests for @react-pdf-viewer/core"
```

---

## Task 4: Smoke test in browser

- [ ] **Step 1: Start dev server**

```bash
cd web && npm run dev
```

- [ ] **Step 2: Open a PDF document**

Navigate to `/manual/pdf/<any-document-id>`. Verify:
- PDF renders without "API version does not match Worker version" error
- Left sidebar shows Thumbnails / Bookmarks / Attachments tabs
- Toolbar shows zoom controls, page number input, search button
- Right rail shows annotation list (or "No annotations yet")
- Right rail collapse/expand button works
- Clicking an annotation jumps to the correct page

- [ ] **Step 3: Check browser console**

No `pdfjs` version mismatch errors. No unhandled React errors.

- [ ] **Step 4: Commit if any fixups needed**

```bash
git add -p
git commit -m "fix: pdf viewer smoke test fixups"
```

---

## Self-review against spec

- **Worker self-management** → `<Worker workerUrl=...>` in Task 2 ✓
- **defaultLayoutPlugin** (toolbar + left sidebar bookmarks/thumbnails) → Task 2 ✓
- **Right rail annotation list** → `AnnotationListPanel` in Task 2 ✓
- **Markdown render** → `ReactMarkdown` per annotation item ✓
- **Page badge + click-to-jump** → `getAnnotationPage` + `onJumpToPage` ✓
- **Collapse/resize rail** → `WorkspaceRail` in Task 2 ✓
- **Remove react-pdf + pdfjs-dist** → Task 1 ✓
- **Tests updated** → Task 3 ✓
- **Region mode UI** → `AnnotationModeControls` retained, no bbox stored (out of scope per spec) ✓
- **Custom TOC removed** → replaced by PDF bookmarks via defaultLayoutPlugin ✓
