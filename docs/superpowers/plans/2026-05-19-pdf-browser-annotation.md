# PDF Browser and Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real in-app PDF browser with TOC navigation, document-local search, text annotations, and rectangular region annotations for images/charts/formulas.

**Architecture:** Reuse the shared annotation system and add a document-level reader model on top of the existing manual/document workflow. The backend will expose a stable document-view payload plus document-scoped annotations; the frontend will extend the manual page into a URL-backed PDF reader with TOC, find-in-document, text selection, and region overlay interactions.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, existing unified annotations APIs, React, React Router, existing manual search page, PDF rendering library to be selected during implementation (prefer `pdf.js`-compatible integration already available in the web app dependency graph).

---

## File Structure

**Modify**
- `src/api/routers/manual.py`
  Purpose: add document-view API(s), TOC serialization, document reader metadata, and reader-friendly payloads.
- `src/api/schemas.py`
  Purpose: define shared API schemas for PDF reader payloads and typed TOC/document view responses.
- `src/storage/models.py`
  Purpose: tighten annotation create/read typing for document PDF anchor payloads and document-level target conventions.
- `src/storage/annotation_store.py`
  Purpose: normalize and read document-level annotation payloads consistently through existing create/list flows.
- `web/src/api/types.ts`
  Purpose: add TypeScript models for document reader payloads, TOC nodes, search hits, and anchor variants.
- `web/src/api/client.ts`
  Purpose: add client calls for document-view loading and normalize document annotation payloads.
- `web/src/App.tsx`
  Purpose: register a reader-capable route state under the manual workflow.
- `web/src/pages/ManualSearchPage.tsx`
  Purpose: host the dedicated reader UI, TOC/search rails, PDF viewer state, and annotation interactions.

**Likely tests needed during execution**
- `tests/api/test_manual_reader.py`
- `web/src/pages/__tests__/ManualSearchPage.test.tsx`

**Scope note**
- The current brief does not list the test files above. Before implementation begins, expand the brief if you want strict repo-rule compliance for touching those test files.
- If the backend lacks an existing web-accessible PDF asset URL, execution may also require a brief expansion for the file-serving module that owns document asset delivery.

### Task 1: Define Reader Payload Contracts

**Files:**
- Modify: `src/api/schemas.py`
- Modify: `src/storage/models.py:787-896`
- Modify: `web/src/api/types.ts:352-430`
- Test: `tests/api/test_manual_reader.py`

- [ ] **Step 1: Write the failing backend schema test**

```python
def test_manual_document_view_schema_round_trip():
    payload = {
        "document_id": "intel_sdm:9.6",
        "title": "Intel SDM Volume 3",
        "subtitle": "System Programming Guide",
        "manual_type": "intel_sdm",
        "manual_version": "9.6",
        "pdf_url": "/api/manual/documents/intel_sdm:9.6/file",
        "page_count": 1234,
        "initial_page": 176,
        "toc": [
            {
                "id": "toc-1",
                "label": "Chapter 6",
                "page": 176,
                "children": [],
            }
        ],
    }

    model = ManualDocumentViewResponse.model_validate(payload)

    assert model.document_id == "intel_sdm:9.6"
    assert model.toc[0].page == 176
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/api/test_manual_reader.py::test_manual_document_view_schema_round_trip -v`
Expected: FAIL with `NameError` or import failure because `ManualDocumentViewResponse` / `ManualDocumentTocNode` does not exist yet.

- [ ] **Step 3: Write minimal schema and typing support**

```python
class ManualDocumentTocNode(BaseModel):
    id: str
    label: str
    page: int = Field(..., ge=1)
    children: list["ManualDocumentTocNode"] = Field(default_factory=list)


class ManualDocumentViewResponse(BaseModel):
    document_id: str
    title: str
    subtitle: str = ""
    manual_type: str
    manual_version: str = ""
    pdf_url: str
    page_count: int = Field(..., ge=1)
    initial_page: int = Field(..., ge=1)
    toc: list[ManualDocumentTocNode] = Field(default_factory=list)
```

```python
allowed_types = {
    "email",
    "code",
    "sdm_spec",
    "excerpt",
    "claim",
    "note",
    "summary",
    "link",
    "document_pdf",
}
```

```ts
export interface ManualDocumentTocNode {
  id: string;
  label: string;
  page: number;
  children: ManualDocumentTocNode[];
}

export interface ManualDocumentView {
  document_id: string;
  title: string;
  subtitle: string;
  manual_type: string;
  manual_version: string;
  pdf_url: string;
  page_count: number;
  initial_page: number;
  toc: ManualDocumentTocNode[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/api/test_manual_reader.py::test_manual_document_view_schema_round_trip -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/schemas.py src/storage/models.py web/src/api/types.ts tests/api/test_manual_reader.py
git commit -m "feat: add pdf reader document view schemas"
```

### Task 2: Add Backend Document-View Endpoint

**Files:**
- Modify: `src/api/routers/manual.py`
- Modify: `src/api/schemas.py`
- Test: `tests/api/test_manual_reader.py`

- [ ] **Step 1: Write the failing document-view API test**

```python
def test_manual_document_view_returns_reader_payload(client):
    response = client.get("/api/manual/documents/intel_sdm:9.6")

    assert response.status_code == 200
    body = response.json()
    assert body["document_id"] == "intel_sdm:9.6"
    assert "toc" in body
    assert "pdf_url" in body
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/api/test_manual_reader.py::test_manual_document_view_returns_reader_payload -v`
Expected: FAIL with `404 Not Found` because the route does not exist yet.

- [ ] **Step 3: Implement minimal route and serializer**

```python
@router.get("/api/manual/documents/{document_id}", response_model=ManualDocumentViewResponse)
async def manual_document_view(document_id: str):
    if not state._manual_storage:
        raise HTTPException(status_code=503, detail="Manual storage not initialized")

    doc = await state._manual_storage.get_document_view(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")

    return ManualDocumentViewResponse.model_validate(doc)
```

```python
def _build_document_id(manual_type: str, manual_version: str) -> str:
    return f"{manual_type}:{manual_version or 'default'}"
```

Implementation notes:
- derive a stable `document_id` from imported document metadata
- aggregate TOC nodes from stored chunk metadata already available through manual/document storage
- return a stable `pdf_url` string rather than embedding file bytes in this payload

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/api/test_manual_reader.py::test_manual_document_view_returns_reader_payload -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/routers/manual.py src/api/schemas.py tests/api/test_manual_reader.py
git commit -m "feat: add manual document view endpoint"
```

### Task 3: Add Reader Client and Route State

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/ManualSearchPage.tsx`
- Test: `web/src/pages/__tests__/ManualSearchPage.test.tsx`

- [ ] **Step 1: Write the failing reader-navigation test**

```tsx
test('opens a dedicated reader state from a manual search hit', async () => {
  render(<App />);

  await user.click(screen.getByRole('button', { name: /open reader/i }));

  expect(await screen.findByText(/table of contents/i)).toBeInTheDocument();
  expect(screen.getByText(/document search/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ManualSearchPage.test.tsx --runInBand`
Expected: FAIL because there is no dedicated reader state or reader action in the manual page.

- [ ] **Step 3: Add client call and route-backed reader state**

```ts
export async function getManualDocumentView(documentId: string): Promise<ManualDocumentView> {
  return fetchJSON<ManualDocumentView>(`${API_BASE}/manual/documents/${encodeURIComponent(documentId)}`);
}
```

```tsx
<Route path="/manual/search" element={<ManualSearchPage />} />
<Route path="/manual/search/:documentId" element={<ManualSearchPage />} />
```

```tsx
const { documentId } = useParams();
const [readerDocument, setReaderDocument] = useState<ManualDocumentView | null>(null);
const isReaderMode = Boolean(documentId);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ManualSearchPage.test.tsx --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts web/src/api/types.ts web/src/App.tsx web/src/pages/ManualSearchPage.tsx web/src/pages/__tests__/ManualSearchPage.test.tsx
git commit -m "feat: add pdf reader route state"
```

### Task 4: Build TOC and In-Document Search UI

**Files:**
- Modify: `web/src/pages/ManualSearchPage.tsx`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Test: `web/src/pages/__tests__/ManualSearchPage.test.tsx`

- [ ] **Step 1: Write the failing TOC and find-in-document test**

```tsx
test('shows TOC and searchable hit list for the open document', async () => {
  render(<ManualSearchPage />);

  expect(await screen.findByText(/chapter 6/i)).toBeInTheDocument();

  await user.type(screen.getByPlaceholderText(/find in document/i), 'dma');

  expect(await screen.findByText(/1 of 7 matches/i)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /jump to match/i }).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ManualSearchPage.test.tsx --runInBand`
Expected: FAIL because the reader has no TOC rail or document-local search panel yet.

- [ ] **Step 3: Implement the reader shell**

```tsx
type ReaderSearchHit = {
  id: string;
  page: number;
  preview: string;
  matchIndex: number;
};

const [readerQuery, setReaderQuery] = useState('');
const [readerHits, setReaderHits] = useState<ReaderSearchHit[]>([]);
const [activeHitIndex, setActiveHitIndex] = useState(0);
const [activePage, setActivePage] = useState(readerDocument?.initial_page ?? 1);
```

```tsx
<aside aria-label="Table of contents">
  {readerDocument?.toc.map(renderTocNode)}
</aside>
<aside aria-label="Document search">
  <input placeholder="Find in document" />
  <div>{readerHits.length ? `${activeHitIndex + 1} of ${readerHits.length} matches` : '0 matches'}</div>
</aside>
```

Implementation notes:
- search against the PDF text layer text already loaded for visible pages
- if full-document text indexing is not immediately available, bootstrap using page-level extracted text from the backend payload
- keep hit objects page-scoped so clicks can jump to the exact page and local match

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ManualSearchPage.test.tsx --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ManualSearchPage.tsx web/src/pages/__tests__/ManualSearchPage.test.tsx
git commit -m "feat: add pdf toc and find-in-document UI"
```

### Task 5: Add Text Annotation Flow

**Files:**
- Modify: `src/storage/models.py`
- Modify: `src/storage/annotation_store.py`
- Modify: `web/src/pages/ManualSearchPage.tsx`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/types.ts`
- Test: `tests/api/test_manual_reader.py`
- Test: `web/src/pages/__tests__/ManualSearchPage.test.tsx`

- [ ] **Step 1: Write the failing text-annotation tests**

```python
def test_document_pdf_text_annotation_round_trips_anchor(api_client):
    payload = {
        "annotation_type": "note",
        "body": "Important VT-d requirement",
        "target_type": "document_pdf",
        "target_ref": "intel_sdm:9.6",
        "anchor": {
            "selection_kind": "text",
            "page": 176,
            "selected_text": "DMA remapping hardware",
            "quote": "DMA remapping hardware",
            "text_start": 1840,
            "text_end": 1862,
        },
    }

    response = api_client.post("/api/annotations", json=payload)
    assert response.status_code == 200
    assert response.json()["anchor"]["selection_kind"] == "text"
```

```tsx
test('creates a text annotation from the current PDF selection', async () => {
  render(<ManualSearchPage />);

  await user.click(await screen.findByRole('button', { name: /save text annotation/i }));

  expect(await screen.findByText(/important vt-d requirement/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/api/test_manual_reader.py::test_document_pdf_text_annotation_round_trips_anchor -v`
Expected: FAIL because document-level anchor conventions are not validated or exercised yet.

Run: `npm test -- ManualSearchPage.test.tsx --runInBand`
Expected: FAIL because the reader has no text-selection annotation workflow.

- [ ] **Step 3: Implement minimal text-annotation support**

```python
if data.annotation_type == "document_pdf":
    if not data.target_type:
        data.target_type = "document_pdf"
    if not data.meta:
        data.meta = {}
```

```tsx
const [pendingTextSelection, setPendingTextSelection] = useState<{
  page: number;
  selectedText: string;
  textStart: number;
  textEnd: number;
} | null>(null);
```

```tsx
await createAnnotation({
  annotation_type: 'note',
  body: draftBody.trim(),
  target_type: 'document_pdf',
  target_ref: readerDocument.document_id,
  target_label: readerDocument.title,
  target_subtitle: readerDocument.subtitle,
  anchor: {
    selection_kind: 'text',
    page: pendingTextSelection.page,
    selected_text: pendingTextSelection.selectedText,
    quote: pendingTextSelection.selectedText,
    text_start: pendingTextSelection.textStart,
    text_end: pendingTextSelection.textEnd,
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/api/test_manual_reader.py::test_document_pdf_text_annotation_round_trips_anchor -v`
Expected: PASS

Run: `npm test -- ManualSearchPage.test.tsx --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/models.py src/storage/annotation_store.py web/src/api/client.ts web/src/api/types.ts web/src/pages/ManualSearchPage.tsx tests/api/test_manual_reader.py web/src/pages/__tests__/ManualSearchPage.test.tsx
git commit -m "feat: add pdf text annotations"
```

### Task 6: Add Rectangular Region Annotations

**Files:**
- Modify: `web/src/pages/ManualSearchPage.tsx`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Modify: `src/storage/models.py`
- Modify: `src/storage/annotation_store.py`
- Test: `tests/api/test_manual_reader.py`
- Test: `web/src/pages/__tests__/ManualSearchPage.test.tsx`

- [ ] **Step 1: Write the failing region-annotation tests**

```python
def test_document_pdf_region_annotation_round_trips_rect(api_client):
    payload = {
        "annotation_type": "note",
        "body": "Figure explains the DMA path",
        "target_type": "document_pdf",
        "target_ref": "paper:vt-directed-io-spec",
        "anchor": {
            "selection_kind": "region",
            "page": 14,
            "rect": {"x": 0.2, "y": 0.3, "width": 0.4, "height": 0.25},
        },
    }

    response = api_client.post("/api/annotations", json=payload)
    assert response.status_code == 200
    assert response.json()["anchor"]["rect"]["width"] == 0.4
```

```tsx
test('creates a region annotation from a dragged rectangle', async () => {
  render(<ManualSearchPage />);

  await user.click(await screen.findByRole('button', { name: /region mode/i }));
  await user.click(await screen.findByRole('button', { name: /save region annotation/i }));

  expect(await screen.findByText(/figure explains the dma path/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/api/test_manual_reader.py::test_document_pdf_region_annotation_round_trips_rect -v`
Expected: FAIL because region anchor behavior is not covered yet.

Run: `npm test -- ManualSearchPage.test.tsx --runInBand`
Expected: FAIL because there is no region mode or drag-to-annotate workflow.

- [ ] **Step 3: Implement minimal region mode**

```tsx
const [annotationMode, setAnnotationMode] = useState<'text' | 'region'>('text');
const [pendingRegionSelection, setPendingRegionSelection] = useState<{
  page: number;
  rect: { x: number; y: number; width: number; height: number };
} | null>(null);
```

```tsx
await createAnnotation({
  annotation_type: 'note',
  body: draftBody.trim(),
  target_type: 'document_pdf',
  target_ref: readerDocument.document_id,
  target_label: readerDocument.title,
  target_subtitle: readerDocument.subtitle,
  anchor: {
    selection_kind: 'region',
    page: pendingRegionSelection.page,
    rect: pendingRegionSelection.rect,
  },
});
```

Implementation notes:
- store normalized rectangle coordinates relative to the rendered page bounds
- render existing region annotations as overlays after annotation list fetch
- clicking a region annotation should set the active page and flash the rectangle overlay

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/api/test_manual_reader.py::test_document_pdf_region_annotation_round_trips_rect -v`
Expected: PASS

Run: `npm test -- ManualSearchPage.test.tsx --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/models.py src/storage/annotation_store.py web/src/api/client.ts web/src/api/types.ts web/src/pages/ManualSearchPage.tsx tests/api/test_manual_reader.py web/src/pages/__tests__/ManualSearchPage.test.tsx
git commit -m "feat: add pdf region annotations"
```

### Task 7: Add Annotation Jump-Back and Reader Polish

**Files:**
- Modify: `web/src/pages/ManualSearchPage.tsx`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/types.ts`
- Test: `web/src/pages/__tests__/ManualSearchPage.test.tsx`

- [ ] **Step 1: Write the failing jump-back test**

```tsx
test('clicking a document annotation jumps to the anchored page and highlight', async () => {
  render(<ManualSearchPage />);

  await user.click(await screen.findByText(/important vt-d requirement/i));

  expect(await screen.findByText(/page 176/i)).toBeInTheDocument();
  expect(screen.getByTestId('active-annotation-highlight')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ManualSearchPage.test.tsx --runInBand`
Expected: FAIL because annotation click handling does not yet drive page/highlight navigation.

- [ ] **Step 3: Implement page-jump and highlight state**

```tsx
const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);

function focusAnnotation(annotation: Annotation | AnnotationListItem) {
  const page = Number(annotation.anchor?.page || 1);
  setActivePage(page);
  setActiveAnnotationId(annotation.annotation_id);
}
```

```tsx
<button onClick={() => focusAnnotation(annotation)}>
  {annotation.short_label || annotation.body}
</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ManualSearchPage.test.tsx --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ManualSearchPage.tsx web/src/pages/__tests__/ManualSearchPage.test.tsx
git commit -m "feat: add pdf annotation jump back behavior"
```

## Self-Review

### Spec coverage

- Real PDF reading view: covered by Tasks 2, 3, and 4
- TOC navigation: covered by Tasks 2 and 4
- In-document search with hit list: covered by Task 4
- Text annotations: covered by Task 5
- Region annotations: covered by Task 6
- Annotation jump-back behavior: covered by Task 7

### Placeholder scan

- No `TODO` / `TBD` placeholders remain in the plan
- Route, schema, anchor, and command names are explicit
- The only explicit scope note is the brief-expansion requirement for tests / PDF asset serving before execution

### Type consistency

- Document target convention is consistently `target_type=document_pdf`
- Reader payload consistently uses `document_id`, `pdf_url`, and `toc`
- Anchor variants consistently use `selection_kind=text|region`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-pdf-browser-annotation.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
