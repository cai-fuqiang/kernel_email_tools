import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, ImagePlus, Search } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useNavigate, useParams } from 'react-router-dom';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import {
  createAnnotation,
  getManualDocumentView,
  listAnnotations,
  searchManuals,
} from '../api/client';
import type {
  Annotation,
  AnnotationListItem,
  ManualDocumentPageText,
  ManualDocumentTocNode,
  ManualDocumentView,
  ManualSearchHit,
  ManualSearchResponse,
} from '../api/types';
import { EmptyState, PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';
import { showToast } from '../components/Toast';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const DOCUMENT_ANNOTATION_PAGE_SIZE = 200;
const PDF_RENDER_WIDTH = 860;

type ManualChunkAnnotation = Annotation | AnnotationListItem;
type AnnotationMode = 'text' | 'region';

type DocumentSearchHit = {
  id: string;
  page: number;
  preview: string;
  matchIndex: number;
  start: number;
  end: number;
};

type PendingTextSelection = {
  page: number;
  selectedText: string;
  textStart: number;
  textEnd: number;
};

type RegionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PendingRegionSelection = {
  page: number;
  rect: RegionRect;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildTargetSubtitle(hit: ManualSearchHit): string {
  return hit.target_subtitle || [
    hit.manual_type,
    hit.manual_version,
    hit.volume,
    `pages ${hit.page_start}-${hit.page_end}`,
  ].filter(Boolean).join(' | ');
}

function buildShortLabel(title: string, excerpt: string): string {
  const prefix = title || 'PDF note';
  return `${prefix}: ${normalizeText(excerpt).slice(0, 72)}`.slice(0, 256);
}

function getAnnotationPage(annotation: ManualChunkAnnotation): number {
  const raw = annotation.anchor?.page;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 1;
  }
  return 1;
}

function getAnnotationQuote(annotation: ManualChunkAnnotation): string {
  const raw = annotation.anchor?.quote ?? annotation.anchor?.selected_text;
  return typeof raw === 'string' ? raw : '';
}

function getAnnotationRect(annotation: ManualChunkAnnotation): RegionRect | null {
  const raw = annotation.anchor?.rect;
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if ([x, y, width, height].every(Number.isFinite)) {
    return { x, y, width, height };
  }
  return null;
}

export function buildDocumentSearchHits(
  pageText: ManualDocumentPageText[],
  query: string,
): DocumentSearchHit[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const hits: DocumentSearchHit[] = [];
  for (const page of pageText) {
    const haystack = page.text || '';
    const lower = haystack.toLowerCase();
    let start = 0;
    let matchIndex = 0;
    while (start < lower.length) {
      const foundAt = lower.indexOf(normalizedQuery, start);
      if (foundAt < 0) break;
      const end = foundAt + normalizedQuery.length;
      const previewStart = Math.max(0, foundAt - 50);
      const previewEnd = Math.min(haystack.length, end + 80);
      hits.push({
        id: `${page.page}:${foundAt}`,
        page: page.page,
        preview: haystack.slice(previewStart, previewEnd).trim(),
        matchIndex,
        start: foundAt,
        end,
      });
      start = end;
      matchIndex += 1;
    }
  }
  return hits;
}

export function flattenTocPages(toc: ManualDocumentTocNode[]): number[] {
  const pages: number[] = [];
  const visit = (nodes: ManualDocumentTocNode[]) => {
    for (const node of nodes) {
      pages.push(node.page);
      visit(node.children);
    }
  };
  visit(toc);
  return pages;
}

export default function ManualSearchPage() {
  const navigate = useNavigate();
  const { documentId } = useParams();
  const isReaderMode = Boolean(documentId);

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ManualSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualType, setManualType] = useState('');
  const [contentType, setContentType] = useState('');

  const [readerDocument, setReaderDocument] = useState<ManualDocumentView | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const [annotations, setAnnotations] = useState<ManualChunkAnnotation[]>([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>('text');
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [pendingTextSelection, setPendingTextSelection] = useState<PendingTextSelection | null>(null);
  const [pendingRegionSelection, setPendingRegionSelection] = useState<PendingRegionSelection | null>(null);
  const [readerQuery, setReaderQuery] = useState('');
  const [activeHitIndex, setActiveHitIndex] = useState(0);
  const [pageAspectRatio, setPageAspectRatio] = useState(1.3);

  const regionStartRef = useRef<{ x: number; y: number } | null>(null);
  const regionOverlayRef = useRef<HTMLDivElement | null>(null);

  const readerHits = useMemo(
    () => buildDocumentSearchHits(readerDocument?.page_text || [], readerQuery),
    [readerDocument?.page_text, readerQuery],
  );

  const annotationsForActivePage = useMemo(
    () => annotations.filter((annotation) => getAnnotationPage(annotation) === activePage),
    [annotations, activePage],
  );

  useEffect(() => {
    if (!documentId) {
      setReaderDocument(null);
      setAnnotations([]);
      setDraftBody('');
      setReaderQuery('');
      return;
    }

    let cancelled = false;
    const currentDocumentId = documentId;

    async function loadDocument() {
      setReaderLoading(true);
      try {
        const doc = await getManualDocumentView(currentDocumentId);
        if (!cancelled) {
          setReaderDocument(doc);
          setActivePage(doc.initial_page);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          showToast(e instanceof Error ? e.message : 'Failed to load document view', 'error');
        }
      } finally {
        if (!cancelled) setReaderLoading(false);
      }
    }

    loadDocument();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    if (!readerDocument) return;
    let cancelled = false;
    const currentDocumentId = readerDocument.document_id;

    async function loadDocumentAnnotations() {
      setAnnotationsLoading(true);
      try {
        const data = await listAnnotations({
          target_type: 'document_pdf',
          target_ref: currentDocumentId,
          page: 1,
          page_size: DOCUMENT_ANNOTATION_PAGE_SIZE,
        });
        if (!cancelled) {
          setAnnotations(data.annotations);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          showToast(e instanceof Error ? e.message : 'Failed to load PDF annotations', 'error');
        }
      } finally {
        if (!cancelled) setAnnotationsLoading(false);
      }
    }

    loadDocumentAnnotations();
    return () => {
      cancelled = true;
    };
  }, [readerDocument]);

  useEffect(() => {
    if (!readerHits.length) {
      setActiveHitIndex(0);
      return;
    }
    if (activeHitIndex >= readerHits.length) {
      setActiveHitIndex(0);
    }
  }, [readerHits, activeHitIndex]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await searchManuals(query, {
        manual_type: manualType || undefined,
        content_type: contentType || undefined,
        page: 1,
        page_size: 20,
      });
      setResult(data);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Search failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openReader = (hit: ManualSearchHit) => {
    navigate(`/manual/search/${encodeURIComponent(hit.document_id)}`);
  };

  const currentSelectionKind = pendingRegionSelection
    ? 'region'
    : pendingTextSelection
      ? 'text'
      : '';

  const currentSelectionSummary = pendingRegionSelection
    ? `Region on page ${pendingRegionSelection.page}`
    : pendingTextSelection?.selectedText || '';

  const saveAnnotation = async () => {
    if (!readerDocument) return;
    if (!draftBody.trim()) {
      showToast('Enter annotation text first', 'error');
      return;
    }
    if (!pendingTextSelection && !pendingRegionSelection) {
      showToast('Create a text or region selection first', 'error');
      return;
    }

    const anchor = pendingRegionSelection
      ? {
          selection_kind: 'region',
          page: pendingRegionSelection.page,
          rect: pendingRegionSelection.rect,
        }
      : {
          selection_kind: 'text',
          page: pendingTextSelection!.page,
          selected_text: pendingTextSelection!.selectedText,
          quote: pendingTextSelection!.selectedText,
          text_start: pendingTextSelection!.textStart,
          text_end: pendingTextSelection!.textEnd,
        };

    const labelSource = pendingRegionSelection
      ? `Region page ${pendingRegionSelection.page}`
      : pendingTextSelection!.selectedText;

    setSaving(true);
    try {
      const created = await createAnnotation({
        annotation_type: 'note',
        body: draftBody.trim(),
        short_label: buildShortLabel(readerDocument.title, labelSource),
        target_type: 'document_pdf',
        target_ref: readerDocument.document_id,
        target_label: readerDocument.title,
        target_subtitle: readerDocument.subtitle,
        anchor,
        meta: {
          source: 'manual_pdf_reader',
          manual_type: readerDocument.manual_type,
          manual_version: readerDocument.manual_version,
        },
      });
      setAnnotations((current) => [created, ...current]);
      setDraftBody('');
      setPendingTextSelection(null);
      setPendingRegionSelection(null);
      setActiveAnnotationId(created.annotation_id);
      showToast('Annotation created', 'success');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to create annotation', 'error');
    } finally {
      setSaving(false);
    }
  };

  const focusAnnotation = (annotation: ManualChunkAnnotation) => {
    setActiveAnnotationId(annotation.annotation_id);
    setActivePage(getAnnotationPage(annotation));
  };

  const jumpToHit = (index: number) => {
    const hit = readerHits[index];
    if (!hit) return;
    setActiveHitIndex(index);
    setActivePage(hit.page);
  };

  const onTextMouseUp = () => {
    if (annotationMode !== 'text') return;
    const selection = window.getSelection();
    const selectedText = normalizeText(selection?.toString() || '');
    if (!selectedText) return;
    const pageText = readerDocument?.page_text.find((entry) => entry.page === activePage)?.text || '';
    const textStart = Math.max(pageText.indexOf(selectedText), 0);
    const textEnd = textStart + selectedText.length;
    setPendingTextSelection({
      page: activePage,
      selectedText,
      textStart,
      textEnd,
    });
    setPendingRegionSelection(null);
  };

  const startRegionSelection = (event: React.MouseEvent<HTMLDivElement>) => {
    if (annotationMode !== 'region' || !regionOverlayRef.current) return;
    const bounds = regionOverlayRef.current.getBoundingClientRect();
    regionStartRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    setPendingTextSelection(null);
    setPendingRegionSelection(null);
  };

  const moveRegionSelection = (event: React.MouseEvent<HTMLDivElement>) => {
    if (annotationMode !== 'region' || !regionStartRef.current || !regionOverlayRef.current) return;
    const bounds = regionOverlayRef.current.getBoundingClientRect();
    const currentX = event.clientX - bounds.left;
    const currentY = event.clientY - bounds.top;
    const left = Math.min(regionStartRef.current.x, currentX);
    const top = Math.min(regionStartRef.current.y, currentY);
    const width = Math.abs(currentX - regionStartRef.current.x);
    const height = Math.abs(currentY - regionStartRef.current.y);
    if (bounds.width <= 0 || bounds.height <= 0) return;
    setPendingRegionSelection({
      page: activePage,
      rect: {
        x: left / bounds.width,
        y: top / bounds.height,
        width: width / bounds.width,
        height: height / bounds.height,
      },
    });
  };

  const finishRegionSelection = () => {
    regionStartRef.current = null;
  };

  const renderTocNode = (node: ManualDocumentTocNode, depth = 0): JSX.Element => (
    <div key={node.id} className="space-y-1">
      <button
        type="button"
        onClick={() => setActivePage(node.page)}
        className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
          activePage === node.page ? 'bg-indigo-100 text-indigo-900' : 'hover:bg-gray-100 text-gray-700'
        }`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        {node.label}
      </button>
      {node.children.map((child) => renderTocNode(child, depth + 1))}
    </div>
  );

  const renderRectOverlay = (rect: RegionRect, active: boolean) => (
    <div
      className={`pointer-events-none absolute border-2 ${active ? 'border-amber-500 bg-amber-300/20' : 'border-fuchsia-500 bg-fuchsia-300/10'}`}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
      }}
    />
  );

  const pdfHeight = PDF_RENDER_WIDTH * pageAspectRatio;

  if (isReaderMode) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="PDF Reader"
          title={readerDocument?.title || 'Open PDF document'}
          description={readerDocument?.subtitle || 'Browse the source PDF, navigate by TOC, and annotate text or visual regions.'}
        />

        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/manual/search')}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to search
          </button>
          {readerLoading && <span className="text-sm text-gray-500">Loading document...</span>}
          {annotationsLoading && <span className="text-sm text-gray-500">Loading annotations...</span>}
        </div>

        {!readerDocument && !readerLoading && (
          <EmptyState title="Document unavailable" description="This PDF document could not be loaded from the document store." />
        )}

        {readerDocument && (
          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
            <SectionPanel title="Table of contents" description="Jump by chapter or section.">
              <div className="space-y-2">{readerDocument.toc.map((node) => renderTocNode(node))}</div>
              <div className="mt-4 border-t border-gray-100 pt-4">
                <label className="mb-1 block text-xs font-medium text-gray-700">Find in document</label>
                <input
                  value={readerQuery}
                  onChange={(event) => setReaderQuery(event.target.value)}
                  placeholder="Find in document"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                />
                <div className="mt-2 text-xs text-gray-500">
                  {readerHits.length ? `${activeHitIndex + 1} of ${readerHits.length} matches` : '0 matches'}
                </div>
                <div className="mt-3 max-h-[32rem] space-y-2 overflow-auto">
                  {readerHits.map((hit, index) => (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() => jumpToHit(index)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                        index === activeHitIndex ? 'border-indigo-300 bg-indigo-50 text-indigo-900' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <div className="text-xs font-medium text-gray-500">Page {hit.page}</div>
                      <div className="mt-1 line-clamp-3">{hit.preview}</div>
                    </button>
                  ))}
                </div>
              </div>
            </SectionPanel>

            <SectionPanel title="PDF viewer" description="Real PDF page rendering with text and region annotation modes.">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActivePage((current) => Math.max(1, current - 1))}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Previous page
                </button>
                <button
                  type="button"
                  onClick={() => setActivePage((current) => Math.min(pdfPageCount || readerDocument.page_count, current + 1))}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Next page
                </button>
                <span className="text-sm text-gray-600">
                  Page {activePage} / {pdfPageCount || readerDocument.page_count}
                </span>
                <div className="ml-auto inline-flex rounded-lg border border-gray-300 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setAnnotationMode('text')}
                    className={`rounded-md px-3 py-1 text-sm ${annotationMode === 'text' ? 'bg-indigo-100 text-indigo-900' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    Text mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnnotationMode('region')}
                    className={`rounded-md px-3 py-1 text-sm ${annotationMode === 'region' ? 'bg-indigo-100 text-indigo-900' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    Region mode
                  </button>
                </div>
              </div>

              <div className="overflow-auto rounded-xl border border-gray-200 bg-gray-100 p-4">
                <div
                  className="relative mx-auto"
                  style={{ width: `${PDF_RENDER_WIDTH}px`, height: `${pdfHeight}px` }}
                  onMouseUp={onTextMouseUp}
                >
                  <Document
                    file={readerDocument.pdf_url}
                    onLoadSuccess={({ numPages }) => setPdfPageCount(numPages)}
                    loading={<div className="flex h-full items-center justify-center text-sm text-gray-500">Loading PDF...</div>}
                    error={<div className="flex h-full items-center justify-center text-sm text-red-600">Unable to render PDF file.</div>}
                  >
                    <Page
                      pageNumber={activePage}
                      width={PDF_RENDER_WIDTH}
                      renderAnnotationLayer
                      renderTextLayer
                      onLoadSuccess={(page) => setPageAspectRatio(page.view[3] / page.view[2])}
                    />
                  </Document>

                  <div
                    ref={regionOverlayRef}
                    className="absolute inset-0"
                    onMouseDown={startRegionSelection}
                    onMouseMove={moveRegionSelection}
                    onMouseUp={finishRegionSelection}
                  >
                    {annotationsForActivePage.map((annotation) => {
                      const rect = getAnnotationRect(annotation);
                      if (!rect) return null;
                      return (
                        <div key={annotation.annotation_id}>
                          {renderRectOverlay(rect, annotation.annotation_id === activeAnnotationId)}
                        </div>
                      );
                    })}
                    {pendingRegionSelection?.page === activePage &&
                      renderRectOverlay(pendingRegionSelection.rect, true)}
                  </div>
                </div>
              </div>
            </SectionPanel>

            <SectionPanel title="Annotation workspace" description="Create text or region annotations and jump across existing notes.">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Current selection
                </div>
                <div className="mt-2 text-sm text-gray-700">
                  {currentSelectionKind ? (
                    currentSelectionKind === 'region' ? (
                      <div className="flex items-center gap-2">
                        <ImagePlus className="h-4 w-4 text-fuchsia-600" />
                        <span>{currentSelectionSummary}</span>
                      </div>
                    ) : (
                      currentSelectionSummary
                    )
                  ) : (
                    'Use Text mode to select text or Region mode to draw a rectangle.'
                  )}
                </div>
              </div>

              <label className="mt-4 block text-xs font-medium text-gray-700">Annotation</label>
              <textarea
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                rows={6}
                placeholder="Explain why this quote, figure, chart, or formula matters."
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-gray-500">Target: {readerDocument.document_id}</div>
                <PrimaryButton onClick={saveAnnotation} disabled={saving}>
                  {saving ? 'Saving...' : 'Save annotation'}
                </PrimaryButton>
              </div>

              <div className="mt-5 border-t border-gray-100 pt-4">
                <h4 className="text-sm font-semibold text-gray-900">Annotations on page {activePage}</h4>
                <div className="mt-3 space-y-3">
                  {annotationsForActivePage.map((annotation) => (
                    <button
                      key={annotation.annotation_id}
                      type="button"
                      onClick={() => focusAnnotation(annotation)}
                      className={`w-full rounded-lg border px-3 py-3 text-left ${
                        annotation.annotation_id === activeAnnotationId ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-gray-700">{annotation.author || 'Unknown author'}</span>
                        <span className="text-xs text-gray-500">Page {getAnnotationPage(annotation)}</span>
                      </div>
                      <p className="mt-2 text-sm text-gray-800">{annotation.body}</p>
                      {getAnnotationQuote(annotation) && (
                        <p className="mt-2 rounded bg-white px-2 py-1 text-xs text-gray-500">
                          {getAnnotationQuote(annotation)}
                        </p>
                      )}
                    </button>
                  ))}
                  {!annotationsForActivePage.length && (
                    <div className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                      No annotations on this page yet.
                    </div>
                  )}
                </div>
              </div>
            </SectionPanel>
          </div>
        )}
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Manuals"
        title="Search Chip Manuals"
        description="Search imported manuals and papers, then open a real PDF reader with TOC navigation and annotations."
      />

      <SectionPanel title="Find manual sections">
        <div className="mb-4 flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
              placeholder="Search manuals... e.g. MOV instruction encoding"
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 pl-11 text-sm shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            />
            <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-600" />
          </div>
          <PrimaryButton onClick={handleSearch} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </PrimaryButton>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Manual Type</label>
            <select
              value={manualType}
              onChange={(event) => setManualType(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Manuals</option>
              <option value="intel_sdm">Intel SDM</option>
              <option value="arm_arm">ARM ARM</option>
              <option value="amd_apm">AMD APM</option>
              <option value="paper">Paper</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Content Type</label>
            <select
              value={contentType}
              onChange={(event) => setContentType(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Types</option>
              <option value="text">Text</option>
              <option value="instruction">Instruction</option>
              <option value="register">Register</option>
              <option value="table">Table</option>
              <option value="pseudocode">Pseudocode</option>
            </select>
          </div>
        </div>
      </SectionPanel>

      {result && (
        <SectionPanel
          title="Document evidence"
          description="Open a search hit into the PDF reader, then navigate with TOC and annotate the source document directly."
        >
          <p className="mb-4 text-sm text-gray-500">
            Found <span className="font-semibold text-gray-900">{result.total}</span> results{' '}
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs">{result.mode}</span>
          </p>
          <div className="space-y-3">
            {result.hits.map((hit) => (
              <div key={hit.chunk_id} className="rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                        {hit.manual_type}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                        {hit.content_type}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      {hit.section_title || hit.section}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{hit.volume}</span>
                      {hit.manual_version && <span className="rounded bg-gray-50 px-1.5 py-0.5">{hit.manual_version}</span>}
                      {hit.chapter && <span className="rounded bg-gray-50 px-1.5 py-0.5">Chapter {hit.chapter}</span>}
                      <span className="rounded bg-gray-50 px-1.5 py-0.5">Section {hit.section}</span>
                      <span className="rounded bg-gray-50 px-1.5 py-0.5">Pages {hit.page_start}-{hit.page_end}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600">
                      {hit.score.toFixed(3)}
                    </span>
                  </div>
                </div>
                {hit.snippet && (
                  <p className="mt-4 whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-700">
                    {hit.snippet}
                  </p>
                )}
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-500">{buildTargetSubtitle(hit)}</p>
                  <button
                    type="button"
                    onClick={() => openReader(hit)}
                    className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
                  >
                    <FileText className="h-4 w-4" />
                    Open reader
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SectionPanel>
      )}

      {!result && !loading && (
        <EmptyState
          title="Search manuals"
          description="Enter an instruction, register, architecture concept, or paper topic to find imported PDF content."
        />
      )}
    </PageShell>
  );
}
