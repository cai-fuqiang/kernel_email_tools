# PDF Browser — Design Spec

Date: 2026-05-20

## Goal

Add a "PDF Browser" page to the navigation that lists all ingested documents as cards. Users can browse, filter, and click through to the PDF workspace. Documents without a stored PDF path are shown as disabled cards.

## Scope

**In scope:**
- Fix `ingest_manual.py` to store `pdf_path` in chunk metadata
- New `DocumentStorage.list_documents()` method
- New `GET /api/manual/documents` endpoint
- New `ManualBrowserPage` frontend page at `/manual/browser`
- Navigation entry "PDF Browser" in `MainLayout`

**Out of scope:**
- Annotation logic
- `ManualSearchPage` search functionality
- `KernelCodePage`
- Pagination (< 100 documents expected)

---

## Backend

### 1. `ingest_manual.py` fix

Before calling `_store_chunks`, inject the absolute PDF path into every chunk's metadata:

```python
abs_pdf_path = str(pdf_path.resolve())
for chunk in chunks:
    chunk.metadata = {**(chunk.metadata or {}), "pdf_path": abs_pdf_path}
```

`DocumentStorage._extract_pdf_path()` already reads `metadata["pdf_path"]`, so no store-layer changes needed.

After this fix, existing documents must be re-ingested with `--drop-existing` to gain a `pdf_path`.

### 2. `DocumentStorage.list_documents()`

New async method in `src/storage/document_store.py`:

- Query: GROUP BY `manual_type, manual_version` — fetch `chunk_count = COUNT(*)`, `page_count = MAX(page_end)+1`. Cannot extract `pdf_path` via SQL JSON on SQLite; instead load one representative chunk per group (e.g. `LIMIT 1` subquery or post-process in Python) and call `_extract_pdf_path(chunk.extra_data)`.
- For each group: derive `document_id` via `build_document_id(manual_type, manual_version)`, derive `title` from the first chunk's metadata or fall back to `"{manual_type} {manual_version}"`
- Return `list[dict]` with keys: `document_id, title, manual_type, manual_version, page_count, chunk_count, has_pdf: bool`

### 3. New endpoint `GET /api/manual/documents`

File: `src/api/routers/manual.py`

```
GET /api/manual/documents
Response 200: ManualDocumentListResponse
Response 503: manual storage not initialized
```

No auth required (consistent with other manual endpoints).

### 4. New schemas

File: `src/api/schemas.py`

```python
class ManualDocumentSummary(BaseModel):
    document_id: str
    title: str
    manual_type: str
    manual_version: str
    page_count: int
    chunk_count: int
    has_pdf: bool

class ManualDocumentListResponse(BaseModel):
    documents: list[ManualDocumentSummary]
```

---

## Frontend

### Routes

`web/src/App.tsx`: add `<Route path="/manual/browser" element={<ManualBrowserPage />} />`

### Navigation

`web/src/layouts/MainLayout.tsx`: add nav item below "Manuals":
- label: "PDF Browser"
- icon: `Library` (lucide-react)
- to: `/manual/browser`

### API layer

`web/src/api/types.ts`: add `ManualDocumentSummary`, `ManualDocumentListResponse`

`web/src/api/client.ts`: add `listManualDocuments(): Promise<ManualDocumentListResponse>`

### `ManualBrowserPage` (`web/src/pages/ManualBrowserPage.tsx`)

**Layout:**
```
PageShell
  PageHeader: "PDF Browser"
  filter input (text, client-side filter on title)
  responsive card grid (1 col mobile / 2 col md / 3 col xl)
    DocumentCard (per document)
  empty state (no documents loaded or all filtered out)
  error state
```

**`DocumentCard`:**
- Title (bold)
- `manual_type · manual_version` (muted)
- Page count · Chunk count
- Badge: green "PDF" if `has_pdf`, gray "No PDF" if not
- `has_pdf=true`: full opacity, cursor-pointer, `onClick` → `navigate("/manual/pdf/:documentId")`
- `has_pdf=false`: opacity-50, cursor-not-allowed, click disabled

**Data loading:**
- `useEffect` on mount: call `listManualDocuments()`
- States: `loading | loaded | error`
- Filter: `useState` string, applied client-side with `toLowerCase().includes()`

---

## Error handling

| Scenario | Behavior |
|----------|----------|
| API 503 (storage not configured) | Error state with message |
| API other error | Generic error message |
| Empty document list | Empty state: "No documents ingested yet." |
| All filtered out | "No documents match your search." |
| `has_pdf=false` card clicked | Click disabled — no navigation |

---

## Testing

- Unit test `list_documents()` with mixed has_pdf/no_pdf rows
- Unit test new endpoint (200, 503)
- Frontend: render test for card grid, filter, disabled card state
- Manual: re-ingest Intel SDM with `--drop-existing`, verify PDF workspace opens from browser page

---

## Files changed

| File | Change |
|------|--------|
| `scripts/ingest_manual.py` | inject pdf_path into chunk metadata |
| `src/storage/document_store.py` | add `list_documents()` |
| `src/api/schemas.py` | add `ManualDocumentSummary`, `ManualDocumentListResponse` |
| `src/api/routers/manual.py` | add `GET /api/manual/documents` |
| `web/src/api/types.ts` | add types |
| `web/src/api/client.ts` | add `listManualDocuments()` |
| `web/src/pages/ManualBrowserPage.tsx` | new page |
| `web/src/App.tsx` | add route |
| `web/src/layouts/MainLayout.tsx` | add nav item |
