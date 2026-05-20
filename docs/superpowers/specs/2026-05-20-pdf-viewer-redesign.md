# PDF Viewer Redesign: react-pdf-viewer Migration

**Date:** 2026-05-20  
**Status:** Approved  
**Scope:** `src/pages/ManualPdfPage.tsx` — replace react-pdf with @react-pdf-viewer/core

## Problem

`ManualPdfPage.tsx` is 1376 lines of hand-rolled PDF rendering logic built on `react-pdf`. It suffers from:
- pdfjs worker version mismatch requiring manual `workerSrc` hacks
- Custom scroll tracking, zoom state, page visibility logic that duplicates what a proper viewer provides
- Hard to maintain and extend

## Goal

Replace `react-pdf` + custom infrastructure with `@react-pdf-viewer/core` + `defaultLayoutPlugin`. Retain annotation display in right rail. Reduce file to ~400 lines.

## Dependencies

Remove:
- `react-pdf`
- `pdfjs-dist` (direct dep — no longer needed, viewer manages its own worker)

Add:
- `@react-pdf-viewer/core`
- `@react-pdf-viewer/default-layout`

## Architecture

```
ManualPdfPage
├── Viewer (@react-pdf-viewer/core)
│   └── defaultLayoutPlugin
│       ├── Left sidebar: Thumbnails / Bookmarks (PDF TOC) / Attachments
│       └── Toolbar: zoom, page number, search, fit-width
├── RightRail (custom, collapsible, 320px)
│   └── AnnotationListPanel
│       ├── Items sorted by anchor.page ascending
│       ├── Each item: page badge + react-markdown body
│       ├── Click → viewer.jumpToPage(page)
│       └── Independent scroll container (overflow-y: auto)
└── AnnotationModeControls (Text / Region toggle, bottom of right rail)
```

## Layout

```
┌──────┬─────────────────────────┬──────────────────┐
│Left  │  Toolbar (zoom/search)  │  Right Rail      │
│Side  ├─────────────────────────┤  (320px, 可折叠) │
│bar   │                         │                  │
│      │  PDF content            │  Annotation list │
│[📄]  │  (viewer manages scroll)│  - Page badge    │
│[🔖]  │                         │  - Markdown body │
│[📎]  │                         │  - Click→jump    │
│      │                         │                  │
│      │                         │  [Text][Region]  │
└──────┴─────────────────────────┴──────────────────┘
```

## Data Flow

### Annotation display
```
listAnnotations (backend API)
  → useManualPdfAnnotations hook (retained as-is)
  → AnnotationListPanel
      → sort by anchor.page
      → render react-markdown body
      → onClick: viewerRef.current?.jumpToPage(page - 1)
```

### Worker setup
```
// No manual workerSrc. Viewer handles worker internally.
import { Worker, Viewer } from '@react-pdf-viewer/core';

<Worker workerUrl="https://unpkg.com/pdfjs-dist@<version>/build/pdf.worker.min.js">
  <Viewer fileUrl={pdfUrl} plugins={[defaultLayoutPluginInstance]} />
</Worker>
```

The `<Worker>` wrapper pins the CDN worker URL to the exact pdfjs version bundled with `@react-pdf-viewer/core` — version mismatch eliminated.

## Components

### Retained (moved/trimmed)
- `useManualPdfAnnotations` — backend fetch, pagination, error state
- `AnnotationListPanel` — right rail list, Markdown render, scroll
- `AnnotationModeControls` — Text/Region toggle buttons
- `RightRail` — collapsible container, resize handle

### Deleted
- `loadReactPdfModule()` + worker URL hack
- `useVisiblePageTracking` (IntersectionObserver)
- `createPageRefRegistry`
- `resolveMostVisiblePage`
- Custom zoom state + ZOOM_PRESETS
- Custom continuous/single page mode toggle
- Manual `Document` / `Page` render tree
- `clampPage`, `scrollToPage`

### New (thin wrappers)
- `PdfViewerContainer` — wraps `<Worker>` + `<Viewer>` + `defaultLayoutPlugin` init

## Annotation Anchor Model

Anchors are page-level with optional text fragment:
```typescript
anchor: {
  page: number | string,   // 1-based page number
  quote?: string,          // display text (PDF quote)
  selected_text?: string,  // fallback display text
}
```

No bbox/region coordinates stored — region mode UI exists but annotation storage is page-level only.

## Right Rail Behavior

- Default: expanded (320px)
- Collapsed: 48px icon strip
- Resize handle: drag to resize between 240px–520px
- Annotation items: sorted ascending by page number
- Empty state: "No annotations yet"
- Error state: inline error message

## Error Handling

- PDF load failure: viewer's built-in error UI (no custom code needed)
- Annotation load failure: inline error in right rail (retained from current impl)
- Worker load failure: `<Worker>` boundary catches, shows error

## Testing

Existing behavior tests in `ManualPdfPage.test.tsx` cover:
- Annotation load + display
- Rail collapse/expand
- Page navigation

Tests mock `react-pdf` via `createReactPdfTestModule()` — this mock layer needs updating to mock `@react-pdf-viewer/core` instead. Existing test logic for annotation display stays valid.

## Out of Scope

- Creating new annotations (no UI for this currently)
- Saving region bbox coordinates to backend
- Custom TOC from `ManualDocumentTocNode` (replaced by PDF's own bookmarks via defaultLayoutPlugin)
