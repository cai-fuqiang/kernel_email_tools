# PDF Workspace Design

Date: 2026-05-20

## Goal

Give the PDF browser its own dedicated workspace page and upgrade it toward the KernelCode browsing model:

- collapsible left and right side panels
- a larger, zoomable central PDF reading surface
- annotation behavior that follows PDF scrolling in continuous reading mode
- a mixed reading model with both continuous scroll and single-page focus

## Scope

### In scope

- Add a dedicated PDF workspace route and page
- Keep the manual search page focused on search results and entry into the PDF workspace
- Introduce a three-panel workspace layout for PDFs
- Support panel collapse/expand on both sides
- Support continuous scroll mode and single-page focus mode
- Support central reader zoom controls
- Synchronize active page, TOC focus, search hits, and annotations around the visible PDF page

### Out of scope

- Changes to `web/src/pages/KernelCodePage.tsx`
- Persistent per-user layout preferences stored in backend
- Full cross-page region selection in continuous scroll mode
- New backend storage model for PDF annotations

## Affected Files

### Backend

- `src/api/routers/manual.py`
- `src/api/schemas.py`
- `src/storage/document_store.py`

### Frontend

- `web/src/App.tsx`
- `web/src/pages/ManualSearchPage.tsx`
- `web/src/pages/ManualPdfPage.tsx`
- `web/src/api/client.ts`
- `web/src/api/types.ts`

## Current State

The current PDF reader lives inside `web/src/pages/ManualSearchPage.tsx` as a reader mode selected by `:documentId`. It renders one page at a time, keeps TOC and annotations in the same page component, and filters annotations by the manually selected page.

That works for basic page-by-page reading, but it blocks the expected workspace behavior:

- the search page and PDF reader are coupled in one large component
- the middle reader area cannot reclaim space through collapsible side panels
- there is no continuous scroll mode, so annotations cannot follow scrolling naturally
- page state is driven by explicit page navigation rather than visible document position

## Proposed Architecture

### Route structure

Keep the search page at:

- `/manual/search`

Move the PDF workspace to a dedicated route:

- `/manual/pdf/:documentId`

`web/src/pages/ManualSearchPage.tsx` remains the manual search and result listing page. Clicking a result opens the dedicated PDF workspace route.

### Page ownership

`web/src/pages/ManualSearchPage.tsx`

- owns manual search query state
- owns result rendering
- links into the PDF workspace
- no longer owns heavy PDF reader state

`web/src/pages/ManualPdfPage.tsx`

- owns document loading and annotation loading
- owns workspace layout state
- owns reading mode state
- owns active page and active annotation synchronization
- owns text and region annotation creation UI

## Workspace Layout

The PDF workspace should use a three-panel layout similar to the KernelCode browsing mental model:

- left panel: TOC, in-document search, reading mode controls
- center panel: PDF reading surface
- right panel: annotation workspace and page-scoped annotation list

### Panel behavior

- Left and right panels can each be collapsed independently
- When collapsed, each panel reduces to a narrow rail with a restore control
- The center panel always takes the remaining width
- If both side panels are collapsed, the center reader enters a wide focus layout
- Collapse state is local UI state for this first version

## Reading Modes

### Continuous scroll mode

This is the default mode.

- Render multiple pages in a vertically scrollable stack
- The central scroll container becomes the source of truth for the active page
- `activePage` updates to the page with the highest visible ratio inside the reader viewport
- TOC highlighting and page annotation filtering follow `activePage`
- Clicking TOC entries, search hits, or annotation cards scrolls smoothly to the target page

This mode is the basis for “annotations follow PDF scrolling.”

### Single-page focus mode

This mode preserves the current precise page workflow.

- Render one page at a time
- Keep previous/next page controls
- Preserve text selection and region selection behavior
- Use `activePage` as the direct source of truth
- Clicking TOC entries, search hits, or annotation cards changes `activePage`

### Shared behavior across both modes

Both reading modes share:

- `activePage`
- `activeAnnotationId`
- zoom level
- collapsed panel state
- in-document search state
- draft annotation state

Switching modes should preserve context rather than resetting the workspace.

## Reader Zoom

The center PDF surface should support explicit zoom levels:

- fit width
- 100%
- 125%
- 150%

Implementation should treat zoom as a width multiplier for the rendered PDF page width. In continuous mode, every rendered page uses the same effective width. In single-page mode, the focused page uses the same zoom model.

The reader container should remain scrollable horizontally if a zoom level exceeds the available center width.

## Annotation Synchronization

### Active page synchronization

In continuous mode:

- measure each rendered page within the scroll viewport
- choose the page with the strongest visible presence as `activePage`
- update the right panel annotation list to show annotations for `activePage`

In single-page mode:

- `activePage` changes through page navigation or explicit jumps
- the right panel reflects the current page exactly as today

### Annotation navigation

- Clicking an annotation card jumps to that annotation’s page
- If the annotation has a region rectangle, the rectangle is highlighted in the reader
- The selected annotation card is visually distinct
- The selected annotation remains selected while the user scrolls unless a different annotation is explicitly chosen

### Scope of annotation lists

Default right-panel behavior:

- show annotations on the active page
- keep selection and highlight in sync with the central reader

First version rule:

- do not add a `Current page` / `All annotations` toggle
- keep the list scoped to the active page to preserve a tighter workspace

## Selection and Annotation Creation

### Text annotations

- Supported in both modes
- Use the active page text layer to capture text selection
- Save with the existing `document_pdf` target type and current anchor shape

### Region annotations

- First-class in single-page focus mode
- Existing region-drag behavior can be preserved here with minimal change
- In continuous mode, region creation should be disabled or clearly deferred to focus mode to avoid ambiguous drag behavior across stacked pages

If region mode is selected in continuous mode, the UI should guide the user to switch to single-page focus mode before drawing.

## Backend Contract

The current backend document view contract is likely sufficient:

- `document_id`
- `title`
- `subtitle`
- `manual_type`
- `manual_version`
- `pdf_url`
- `page_count`
- `initial_page`
- `toc`
- `page_text`

The first implementation should avoid unnecessary schema growth. Backend changes should only be made if a small additional field is needed to stabilize rendering or navigation.

## Component and State Plan

### `web/src/App.tsx`

- register the dedicated PDF workspace route

### `web/src/pages/ManualSearchPage.tsx`

- remove embedded reader-mode rendering
- keep search UI and result cards
- update result navigation to open `/manual/pdf/:documentId`

### `web/src/pages/ManualPdfPage.tsx`

- load document metadata and annotations
- own all PDF workspace state
- render left/center/right layout
- maintain continuous and single-page mode behavior
- implement active-page detection in continuous mode
- keep annotation save flow using existing API calls

### `web/src/api/client.ts`

- reuse existing `getManualDocumentView`
- keep annotation listing and creation APIs
- add new helpers only if they remove duplication inside the workspace page

### `web/src/api/types.ts`

- reuse current document view types
- add UI-facing helper types only if they support clearer workspace logic

### Backend files

Backend files remain largely unchanged unless implementation reveals a small response gap.

## Error Handling

The PDF workspace should preserve separate states for:

- document metadata load failure
- PDF file render failure
- annotation load failure
- annotation save failure

Each failure should keep the rest of the workspace as usable as possible. For example, annotation loading failure should not block the reader itself if the PDF can still render.

## Testing and Verification

### Functional checks

1. Search results open the dedicated PDF workspace route
2. Left and right panels collapse and expand correctly
3. Center panel visibly grows when side panels collapse
4. Continuous mode updates `activePage` as the reader scrolls
5. Right-panel annotations follow the current visible page in continuous mode
6. TOC and in-document search jumps land on the correct page
7. Single-page mode still supports previous/next navigation
8. Existing text annotation creation still works
9. Existing region annotation creation still works in single-page focus mode

### UI checks

1. Long PDFs remain usable on desktop widths
2. The page does not thrash while scrolling between adjacent pages
3. The selected annotation highlight remains understandable during page changes
4. The mixed mode switch does not reset the user’s zoom or panel choices

## Acceptance Signal

This feature is complete when:

- PDF reading happens in a dedicated page
- the page behaves like a three-panel workspace
- both side panels can collapse
- the center reader can reclaim space and zoom
- continuous mode makes page-scoped annotations follow scroll position
- single-page mode still supports precise page-level annotation workflows
