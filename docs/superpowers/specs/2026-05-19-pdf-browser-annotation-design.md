# PDF Browser and Annotation Design

**Date:** 2026-05-19

**Goal:** Add a readable in-app PDF browser with table-of-contents navigation, document-internal search, text selection annotations, and rectangular region annotations for images, charts, and formulas.

## Problem

The current manual/document experience is centered on extracted text snippets. That is not sufficient for many PDFs, especially papers and specs with:

- complex layout
- formulas
- figures and charts
- multi-column pages
- page-level visual context

Users need to read the real PDF page, navigate by TOC, search inside the current document, and annotate either text or visual regions.

## Scope

This design covers:

- a real PDF reading view
- TOC-based navigation
- in-document search with hit list and jump-to-match
- text annotations for sentence/paragraph selections
- rectangular region annotations for images/charts/formulas
- annotation list and jump-back behavior

This design does not cover:

- OCR for scanned PDFs
- automatic figure/table/formula detection
- cross-document global PDF search redesign
- cross-page text selection in v1

## User Experience

### Entry

Users start from the existing manual/document search page and open a search hit into a dedicated PDF reading view.

### Layout

The reading view uses a three-column layout:

- left rail: TOC tree and in-document search results
- center: real PDF page viewer
- right rail: annotation workspace and annotation list

### Annotation modes

Two annotation modes are supported:

- `Text`: select PDF text, then create an annotation
- `Region`: drag a rectangle over part of the page, then create an annotation

### Reading interactions

Users can:

- click a TOC node to jump to a chapter/page
- search inside the current document
- click a search result to jump to the page and highlight the match
- click an annotation to jump back to its page and highlight its target

## Architecture

### Frontend

The frontend adds a dedicated PDF reading state within the manual workflow.

Primary responsibilities:

- load a document-view payload from the backend
- render PDF pages
- overlay text and region highlights
- manage TOC navigation
- manage in-document search state
- create and list annotations for the current document

The existing manual search page remains the document discovery entrypoint, but no longer serves as the full reading surface.

### Backend

The backend expands the current manual/document API surface to provide a stable document view model:

- document identity
- document metadata
- TOC tree
- page/chapter mapping
- resource reference for PDF rendering
- existing annotations scoped to the document target

The backend continues to reuse the shared annotation system rather than creating a document-specific annotation store.

## Data Model

### Target model

PDF annotations should use a stable document-level target:

- `target_type = "document_pdf"`
- `target_ref = document_id`

This is different from the current chunk-scoped target used in manual search results. Chunk targets are useful for search evidence, but the browser needs a stable document target.

### Anchor model

`anchor` becomes the main polymorphic payload for PDF annotations.

#### Text anchor

```json
{
  "selection_kind": "text",
  "page": 12,
  "selected_text": "DMA remapping hardware supports...",
  "quote": "DMA remapping hardware supports...",
  "text_start": 1840,
  "text_end": 1892,
  "paragraph_index": 7,
  "sentence_index": 2
}
```

Notes:

- `page` is required
- `selected_text` and `quote` are required for stable rediscovery
- `text_start` and `text_end` are best-effort offsets within the page text layer
- `paragraph_index` and `sentence_index` are optional helpers

#### Region anchor

```json
{
  "selection_kind": "region",
  "page": 14,
  "rect": {
    "x": 0.21,
    "y": 0.34,
    "width": 0.43,
    "height": 0.28
  }
}
```

Notes:

- rectangle coordinates are normalized to page dimensions
- normalized coordinates survive zoom changes better than raw pixels

### Metadata

`meta` may carry document browsing helpers:

- document title
- manual/document type
- manual/document version
- TOC path or section label
- source page range from imported chunks

These are display helpers, not the primary identity.

## API Design

### Existing APIs reused

- annotation create/list/update/delete APIs remain the persistence path
- current manual search API remains the discovery path

### New/expanded manual document view payload

The manual/document router should provide a document-view response with:

- `document_id`
- `title`
- `subtitle`
- `manual_type`
- `manual_version`
- `pdf_url`
- `page_count`
- `toc`
- `initial_page`

TOC entries should include at least:

- `id`
- `label`
- `page`
- `children`

### Annotation list usage

The reading view lists annotations by:

- `target_type=document_pdf`
- `target_ref=document_id`

The frontend groups them by page and by selection kind.

## Frontend Structure

### Route strategy

The app should support a dedicated reader state rather than only an expanded card inside the search page. This can be:

- a new route under the manual area, or
- a structured reader mode inside the existing manual page with a URL-backed document selection

The important requirement is deep-linkability and stable document state.

### Main UI sections

#### Left rail

- TOC tree
- in-document search input
- hit list with current/total count

#### Center viewer

- PDF page rendering
- zoom controls
- page navigation
- text-selection highlight layer
- region-annotation overlay layer

#### Right rail

- annotation mode switch
- new annotation draft form
- page-scoped or document-scoped annotation list
- click-to-jump behavior

## Search Behavior

The first version supports a full in-document search panel, similar to browser find:

- search input
- all hits listed
- current hit index / total hits
- click a hit to jump to page and highlight
- next/previous hit navigation

This search is document-local, not global.

## Highlight and Navigation Rules

### Text annotation

When a text annotation is selected:

- navigate to its page
- attempt to resolve by offset first
- fall back to quote-text matching if offsets are stale
- highlight the resolved text range

### Region annotation

When a region annotation is selected:

- navigate to its page
- draw the saved rectangle overlay

### Search hit

When a search hit is selected:

- navigate to its page
- highlight the exact local match
- update current hit index

## Error Handling

The UI should explicitly handle:

- PDF resource unavailable
- document metadata available but TOC missing
- annotations load failure
- invalid or stale text anchor that cannot be exactly relocated

If a text anchor cannot be resolved exactly:

- still jump to the page
- show the saved quote in the right rail
- mark the annotation as approximate rather than silently failing

## Testing Strategy

### Backend

- document-view payload shape
- TOC serialization
- annotation filtering by `document_pdf` target
- anchor payload round-trip for `text` and `region`

### Frontend

- TOC click jumps to expected page
- in-document search renders hit list and navigates correctly
- text annotation creation sends expected anchor payload
- region annotation creation sends normalized rectangle payload
- clicking existing annotations jumps and highlights correctly

### Manual QA

Validate on at least:

- a manual/spec with TOC and dense structured text
- a paper with figures and multi-column layout
- a page with formula or chart region annotations

## Rollout Plan

### Phase 1

- document view payload
- PDF reader shell
- TOC navigation
- document-local search UI

### Phase 2

- text selection annotations
- annotation list and jump-back

### Phase 3

- region annotations for images/charts/formulas
- highlight overlay polish

## Open Decisions Chosen for v1

- Use a real PDF reading surface, not extracted text as the primary reader
- Support both text and region annotations in the first release
- Support document-local search with full hit list in the first release
- Do not support OCR or automatic visual-object detection in the first release
- Do not support cross-page text selection in the first release
