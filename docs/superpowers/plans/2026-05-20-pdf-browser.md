# PDF Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "PDF Browser" navigation page that lists all ingested documents as cards, lets users filter by title, and navigates directly to the PDF workspace on click.

**Architecture:** Fix `ingest_manual.py` to persist the source PDF path in chunk metadata, then add a `list_documents()` store method + `GET /api/manual/documents` endpoint, and a new `ManualBrowserPage` React page with a card grid and client-side filter. Documents with no PDF path show as disabled cards.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React 18 + TypeScript + Tailwind (frontend), Vitest (frontend tests), pytest + asyncio (backend tests).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/ingest_manual.py` | Modify | Inject `pdf_path` into every chunk's metadata before storing |
| `src/storage/document_store.py` | Modify | Add `list_documents()` async method |
| `src/api/schemas.py` | Modify | Add `ManualDocumentSummary` + `ManualDocumentListResponse` |
| `src/api/routers/manual.py` | Modify | Add `GET /api/manual/documents` endpoint |
| `web/src/api/types.ts` | Modify | Add `ManualDocumentSummary` + `ManualDocumentListResponse` types |
| `web/src/api/client.ts` | Modify | Add `listManualDocuments()` fetch function |
| `web/src/pages/ManualBrowserPage.tsx` | Create | Full browser page with card grid + filter |
| `web/src/App.tsx` | Modify | Add `/manual/browser` route |
| `web/src/layouts/MainLayout.tsx` | Modify | Add "PDF Browser" nav item |
| `tests/api/test_manual_reader.py` | Modify | Add `list_documents` store + endpoint tests |
| `web/src/pages/__tests__/ManualBrowserPage.test.tsx` | Create | Render tests for card grid, filter, disabled card |

---

## Task 1: Fix ingest to store pdf_path in chunk metadata

**Files:**
- Modify: `scripts/ingest_manual.py`

- [ ] **Step 1: Read the ingest script around the _store_chunks call to find exact insertion point**

```bash
grep -n "_store_chunks\|abs_pdf_path\|chunk.metadata" scripts/ingest_manual.py
```

Expected: shows `await _store_chunks(chunks, args.manual_type, ...)` at ~line 162, no existing pdf_path injection.

- [ ] **Step 2: Add pdf_path injection before _store_chunks call**

In `scripts/ingest_manual.py`, find the block that calls `_store_chunks` (around line 160). Add these lines immediately before it:

```python
    # Persist the source PDF path so the reader can serve the file later.
    abs_pdf_path = str(pdf_path.resolve())
    for chunk in chunks:
        chunk.metadata = {**(chunk.metadata or {}), "pdf_path": abs_pdf_path}
```

The final block should look like:

```python
    if args.store:
        logger.info("=== Step 4: Storing to Database ===")
        # Persist the source PDF path so the reader can serve the file later.
        abs_pdf_path = str(pdf_path.resolve())
        for chunk in chunks:
            chunk.metadata = {**(chunk.metadata or {}), "pdf_path": abs_pdf_path}
        await _store_chunks(
            chunks,
            args.manual_type,
            args.manual_version,
            args.drop_existing,
            reporter=reporter,
        )
```

- [ ] **Step 3: Verify no syntax errors**

```bash
python -m py_compile scripts/ingest_manual.py && echo "ok"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest_manual.py
git commit -m "fix: persist pdf_path in chunk metadata during ingest"
```

---

## Task 2: Add list_documents() to DocumentStorage

**Files:**
- Modify: `src/storage/document_store.py`
- Test: `tests/api/test_manual_reader.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_manual_reader.py`:

```python
def test_list_documents_returns_summary_per_manual():
    """list_documents groups chunks by manual_type+version and returns summaries."""
    from src.storage.document_store import DocumentStorage

    class FakeStorage(DocumentStorage):
        def __init__(self):
            pass  # skip DB init

        async def get_chunks_by_manual(self, manual_type, manual_version=""):
            # Only called for the two groups we define below
            if manual_type == "intel_sdm":
                return [
                    _make_chunk("intel_sdm", "default", pdf_path="/docs/sdm.pdf", page_end=100),
                    _make_chunk("intel_sdm", "default", pdf_path="/docs/sdm.pdf", page_end=200),
                ]
            return []

        async def _get_distinct_manuals(self):
            return [("intel_sdm", "default"), ("other_manual", "v1")]

    import asyncio
    storage = FakeStorage()
    results = asyncio.run(storage.list_documents())

    assert len(results) == 2
    sdm = next(r for r in results if r["manual_type"] == "intel_sdm")
    assert sdm["document_id"] == "intel_sdm:default"
    assert sdm["chunk_count"] == 2
    assert sdm["page_count"] == 201  # MAX(page_end) + 1
    # has_pdf is False because /docs/sdm.pdf doesn't exist on disk in CI
    assert isinstance(sdm["has_pdf"], bool)


def _make_chunk(manual_type, manual_version, pdf_path="", page_end=10):
    from src.chunker.base import DocumentChunk, ContentType
    return DocumentChunk(
        chunk_id=f"{manual_type}:{manual_version}:{page_end}",
        manual_type=manual_type,
        manual_version=manual_version,
        content_type=ContentType.TEXT,
        content="test",
        section="s1",
        section_title="S1",
        page_start=0,
        page_end=page_end,
        token_count=1,
        metadata={"pdf_path": pdf_path} if pdf_path else {},
    )
```

- [ ] **Step 2: Run to verify it fails**

```bash
python -m pytest tests/api/test_manual_reader.py::test_list_documents_returns_summary_per_manual -v
```

Expected: FAIL — `DocumentStorage` has no `list_documents` or `_get_distinct_manuals` method.

- [ ] **Step 3: Implement list_documents() in document_store.py**

Add after `get_document_pdf_path` (before `close`), around line 424 in `src/storage/document_store.py`:

```python
    async def _get_distinct_manuals(self) -> list[tuple[str, str]]:
        """Return distinct (manual_type, manual_version) pairs."""
        async with self.async_session() as session:
            result = await session.execute(
                select(
                    DocumentChunkModel.manual_type,
                    DocumentChunkModel.manual_version,
                ).distinct()
            )
            return [(row.manual_type, row.manual_version) for row in result]

    async def list_documents(self) -> list[dict[str, Any]]:
        """Return one summary dict per ingested document."""
        pairs = await self._get_distinct_manuals()
        summaries = []
        for manual_type, manual_version in pairs:
            chunks = await self.get_chunks_by_manual(manual_type, manual_version)
            if not chunks:
                continue
            chunk_count = len(chunks)
            page_count = max(c.page_end for c in chunks) + 1
            first = chunks[0]
            title = first.section_title or first.section or build_document_id(manual_type, manual_version)
            pdf_path = self._extract_pdf_path(first.metadata if isinstance(first.metadata, dict) else {})
            summaries.append({
                "document_id": build_document_id(manual_type, manual_version),
                "title": title,
                "manual_type": manual_type,
                "manual_version": manual_version,
                "page_count": page_count,
                "chunk_count": chunk_count,
                "has_pdf": bool(pdf_path),
            })
        return summaries
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/api/test_manual_reader.py::test_list_documents_returns_summary_per_manual -v
```

Expected: PASS

- [ ] **Step 5: Run full test suite to check regressions**

```bash
python -m pytest tests/api/test_manual_reader.py -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/storage/document_store.py tests/api/test_manual_reader.py
git commit -m "feat: add DocumentStorage.list_documents() with distinct manual grouping"
```

---

## Task 3: Add schemas + GET /api/manual/documents endpoint

**Files:**
- Modify: `src/api/schemas.py`
- Modify: `src/api/routers/manual.py`
- Test: `tests/api/test_manual_reader.py`

- [ ] **Step 1: Write failing endpoint test**

Append to `tests/api/test_manual_reader.py`:

```python
def test_list_documents_endpoint_returns_summaries():
    class FakeStorage:
        async def list_documents(self):
            return [
                {
                    "document_id": "intel_sdm:default",
                    "title": "Intel SDM",
                    "manual_type": "intel_sdm",
                    "manual_version": "default",
                    "page_count": 1234,
                    "chunk_count": 88,
                    "has_pdf": True,
                }
            ]

    original = state._manual_storage
    state._manual_storage = FakeStorage()
    try:
        response = asyncio.run(manual.list_documents())
    finally:
        state._manual_storage = original

    assert len(response.documents) == 1
    doc = response.documents[0]
    assert doc.document_id == "intel_sdm:default"
    assert doc.has_pdf is True
    assert doc.chunk_count == 88


def test_list_documents_endpoint_raises_503_when_storage_missing():
    original = state._manual_storage
    state._manual_storage = None
    try:
        try:
            asyncio.run(manual.list_documents())
        except HTTPException as exc:
            caught = exc
        else:
            caught = None
    finally:
        state._manual_storage = original

    assert caught is not None
    assert caught.status_code == 503
```

- [ ] **Step 2: Run to verify tests fail**

```bash
python -m pytest tests/api/test_manual_reader.py::test_list_documents_endpoint_returns_summaries tests/api/test_manual_reader.py::test_list_documents_endpoint_raises_503_when_storage_missing -v
```

Expected: FAIL — `manual.list_documents` not defined.

- [ ] **Step 3: Add schemas to src/api/schemas.py**

Find `class ManualDocumentViewResponse` (~line 111) and add these two classes immediately before it:

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

- [ ] **Step 4: Add endpoint to src/api/routers/manual.py**

In the `from src.api.schemas import (...)` block (~line 26), add `ManualDocumentListResponse, ManualDocumentSummary` to the imports.

Then add the endpoint after the existing `manual_document_file` handler (~line 153), before `manual_ask`:

```python
@router.get("/api/manual/documents", response_model=ManualDocumentListResponse)
async def list_documents():
    """List all ingested documents with summary metadata."""
    if not state._manual_storage:
        raise HTTPException(
            status_code=503,
            detail="Manual storage not initialized. Please configure storage.manual in settings.yaml",
        )
    summaries = await state._manual_storage.list_documents()
    return ManualDocumentListResponse(
        documents=[ManualDocumentSummary(**s) for s in summaries]
    )
```

**Important:** This route (`/api/manual/documents`) must be registered **before** the `{document_id}` route (`/api/manual/documents/{document_id}`) in the file, otherwise FastAPI will match `documents` as a `document_id` parameter. Verify the order: `list_documents` handler should appear before `manual_document_view`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
python -m pytest tests/api/test_manual_reader.py -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/api/schemas.py src/api/routers/manual.py tests/api/test_manual_reader.py
git commit -m "feat: add GET /api/manual/documents endpoint with ManualDocumentSummary schema"
```

---

## Task 4: Add frontend types and API client function

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`

- [ ] **Step 1: Add types to web/src/api/types.ts**

Find `export interface ManualDocumentView` (~line 392) and add these two interfaces immediately before it:

```typescript
export interface ManualDocumentSummary {
  document_id: string;
  title: string;
  manual_type: string;
  manual_version: string;
  page_count: number;
  chunk_count: number;
  has_pdf: boolean;
}

export interface ManualDocumentListResponse {
  documents: ManualDocumentSummary[];
}
```

- [ ] **Step 2: Add listManualDocuments() to web/src/api/client.ts**

Find `export async function getManualDocumentView` (~line 583) and add immediately before it:

```typescript
export async function listManualDocuments(): Promise<ManualDocumentListResponse> {
  return fetchJSON<ManualDocumentListResponse>(`${API_BASE}/manual/documents`);
}
```

Also add `ManualDocumentListResponse, ManualDocumentSummary` to the import from `'../api/types'` at the top of `client.ts`. Find the existing types import block and add them.

- [ ] **Step 3: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/types.ts web/src/api/client.ts
git commit -m "feat: add ManualDocumentSummary types and listManualDocuments() client function"
```

---

## Task 5: Build ManualBrowserPage

**Files:**
- Create: `web/src/pages/ManualBrowserPage.tsx`
- Test: `web/src/pages/__tests__/ManualBrowserPage.test.tsx`

- [ ] **Step 1: Write the failing test first**

Create `web/src/pages/__tests__/ManualBrowserPage.test.tsx`:

```typescript
/** @vitest-environment jsdom */
import React, { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { listManualDocuments } from '../../api/client';
import ManualBrowserPage from '../ManualBrowserPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, listManualDocuments: vi.fn() };
});

vi.mock('../../auth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

const listManualDocumentsMock = vi.mocked(listManualDocuments);
const mountedRoots: Array<{ unmount: () => void }> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia;
});

afterEach(() => {
  mountedRoots.forEach((r) => act(() => r.unmount()));
  mountedRoots.length = 0;
  document.body.innerHTML = '';
});

async function renderPage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ManualBrowserPage />
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
  return container;
}

async function waitFor(fn: () => void, ms = 1000) {
  const start = Date.now();
  while (true) {
    try {
      await act(async () => {});
      fn();
      return;
    } catch (e) {
      if (Date.now() - start > ms) throw e;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

describe('ManualBrowserPage', () => {
  it('renders a card for each document', async () => {
    listManualDocumentsMock.mockResolvedValue({
      documents: [
        { document_id: 'intel_sdm:default', title: 'Intel SDM', manual_type: 'intel_sdm', manual_version: 'default', page_count: 1234, chunk_count: 88, has_pdf: true },
        { document_id: 'arm_manual:v1', title: 'ARM Manual', manual_type: 'arm_manual', manual_version: 'v1', page_count: 500, chunk_count: 40, has_pdf: false },
      ],
    });

    const container = await renderPage();

    await waitFor(() => {
      expect(container.textContent).toContain('Intel SDM');
      expect(container.textContent).toContain('ARM Manual');
    });
  });

  it('filters cards by title', async () => {
    listManualDocumentsMock.mockResolvedValue({
      documents: [
        { document_id: 'intel_sdm:default', title: 'Intel SDM', manual_type: 'intel_sdm', manual_version: 'default', page_count: 100, chunk_count: 10, has_pdf: true },
        { document_id: 'arm_manual:v1', title: 'ARM Manual', manual_type: 'arm_manual', manual_version: 'v1', page_count: 50, chunk_count: 5, has_pdf: true },
      ],
    });

    const container = await renderPage();
    await waitFor(() => expect(container.textContent).toContain('Intel SDM'));

    const input = container.querySelector('input[placeholder]') as HTMLInputElement;
    await act(async () => {
      input.value = 'arm';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await waitFor(() => {
      expect(container.textContent).not.toContain('Intel SDM');
      expect(container.textContent).toContain('ARM Manual');
    });
  });

  it('disabled card has aria-disabled and no link for has_pdf=false', async () => {
    listManualDocumentsMock.mockResolvedValue({
      documents: [
        { document_id: 'no_pdf:default', title: 'No PDF Doc', manual_type: 'no_pdf', manual_version: 'default', page_count: 10, chunk_count: 2, has_pdf: false },
      ],
    });

    const container = await renderPage();
    await waitFor(() => expect(container.textContent).toContain('No PDF Doc'));

    const card = container.querySelector('[data-testid="doc-card-no_pdf:default"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows empty state when no documents', async () => {
    listManualDocumentsMock.mockResolvedValue({ documents: [] });

    const container = await renderPage();
    await waitFor(() => {
      expect(container.textContent).toContain('No documents ingested yet');
    });
  });

  it('shows error state on API failure', async () => {
    listManualDocumentsMock.mockRejectedValue(new Error('network error'));

    const container = await renderPage();
    await waitFor(() => {
      expect(container.textContent).toContain('network error');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/pages/__tests__/ManualBrowserPage.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `ManualBrowserPage` not found.

- [ ] **Step 3: Create ManualBrowserPage.tsx**

Create `web/src/pages/ManualBrowserPage.tsx`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listManualDocuments } from '../api/client';
import type { ManualDocumentSummary } from '../api/types';
import { PageHeader, PageShell } from '../components/ui';

export default function ManualBrowserPage() {
  const [documents, setDocuments] = useState<ManualDocumentSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listManualDocuments()
      .then((res) => { if (active) { setDocuments(res.documents); setLoading(false); } })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load documents.');
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const filtered = documents.filter((d) =>
    d.title.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <PageShell>
      <PageHeader title="PDF Browser" description="Browse and open ingested PDF documents." />

      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter by title…"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
          className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {!loading && !error && (
          <span className="text-sm text-slate-500">{filtered.length} document{filtered.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {loading && (
        <p className="text-sm text-slate-500">Loading documents…</p>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && documents.length === 0 && (
        <p className="text-sm text-slate-500">No documents ingested yet.</p>
      )}

      {!loading && !error && filtered.length === 0 && documents.length > 0 && (
        <p className="text-sm text-slate-500">No documents match your search.</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((doc) => (
            <DocumentCard key={doc.document_id} doc={doc} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function DocumentCard({ doc }: { doc: ManualDocumentSummary }) {
  const navigate = useNavigate();

  const handleClick = useCallback(() => {
    if (doc.has_pdf) navigate(`/manual/pdf/${encodeURIComponent(doc.document_id)}`);
  }, [doc.document_id, doc.has_pdf, navigate]);

  return (
    <div
      data-testid={`doc-card-${doc.document_id}`}
      aria-disabled={doc.has_pdf ? undefined : 'true'}
      onClick={handleClick}
      className={[
        'rounded-2xl border bg-white p-5 shadow-sm transition',
        doc.has_pdf
          ? 'cursor-pointer border-slate-200 hover:border-indigo-300 hover:shadow-md'
          : 'cursor-not-allowed border-slate-200 opacity-50',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900 leading-snug">{doc.title}</h2>
        {doc.has_pdf ? (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">PDF</span>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">No PDF</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{doc.manual_type} · {doc.manual_version}</p>
      <p className="mt-3 text-xs text-slate-400">{doc.page_count} pages · {doc.chunk_count} chunks</p>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run src/pages/__tests__/ManualBrowserPage.test.tsx 2>&1 | tail -10
```

Expected: all PASS

- [ ] **Step 5: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ManualBrowserPage.tsx web/src/pages/__tests__/ManualBrowserPage.test.tsx
git commit -m "feat: add ManualBrowserPage with card grid and client-side filter"
```

---

## Task 6: Wire route and navigation

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/layouts/MainLayout.tsx`

- [ ] **Step 1: Add route to App.tsx**

In `web/src/App.tsx`, find the lazy import block (~line 12) and add:

```typescript
const ManualBrowserPage = lazy(() => import('./pages/ManualBrowserPage'));
```

Then find the `/manual/pdf/:documentId` route line (~line 78) and add the browser route after it:

```tsx
<Route path="/manual/browser" element={<ManualBrowserPage />} />
```

- [ ] **Step 2: Add nav item to MainLayout.tsx**

In `web/src/layouts/MainLayout.tsx`, add `FileText` to the lucide-react import block:

```typescript
import {
  BookOpen,
  Bookmark,
  Code2,
  FileText,
  Library,
  LayoutDashboard,
  LogOut,
  MailSearch,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Tags,
  Users,
  X,
} from 'lucide-react';
```

Then find the nav items array (~line 97) and add "PDF Browser" after the `Manuals` entry:

```typescript
{ to: '/manual/search', label: 'Manuals', icon: BookOpen },
{ to: '/manual/browser', label: 'PDF Browser', icon: FileText },
...(isManualPdfRoute ? [{ to: location.pathname, label: 'PDF Workspace', icon: BookOpen }] : []),
```

- [ ] **Step 3: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Run full frontend test suite**

```bash
cd web && npx vitest run 2>&1 | tail -10
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/layouts/MainLayout.tsx
git commit -m "feat: add PDF Browser route and nav item"
```

---

## Task 7: Sync to home_pc and verify

- [ ] **Step 1: Push branch**

```bash
git push origin delete_AI_function
```

- [ ] **Step 2: Pull and rebuild on home_pc**

```bash
ssh home_pc "cd ~/workspace/kernel_email_tools && git pull origin delete_AI_function && cd web && npm run build 2>&1 | tail -3"
```

Expected: `✓ built in ...`

- [ ] **Step 3: Restart server on home_pc**

```bash
ssh home_pc "pkill -f uvicorn; sleep 1; cd ~/workspace/kernel_email_tools && nohup /home/wang/.local/bin/uvicorn src.api.server:app --host 0.0.0.0 --port 8080 > api.log 2>&1 &"
sleep 3
ssh home_pc "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/app/pdfjs/web/viewer.html"
```

Expected: `200`

- [ ] **Step 4: Verify API endpoint**

```bash
ssh home_pc "curl -s http://localhost:8080/api/manual/documents | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d[\"documents\"]), \"docs\")'"
```

Expected: `N docs` (likely 1 — intel_sdm:default without pdf_path, so has_pdf=false until re-ingest)

- [ ] **Step 5: Update AGENTS.md**

Append to Architecture Decisions Log in `AGENTS.md`:

```
- 2026-05-20: PDF Browser page lists all ingested documents; pdf_path injected at ingest time into chunk metadata; list_documents() groups by manual_type+version in Python (not SQL) to avoid SQLite JSON limitations (scripts/ingest_manual.py, src/storage/document_store.py, src/api/routers/manual.py, web/src/pages/ManualBrowserPage.tsx)
```

- [ ] **Step 6: Commit AGENTS.md**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for PDF browser feature"
git push origin delete_AI_function
```
