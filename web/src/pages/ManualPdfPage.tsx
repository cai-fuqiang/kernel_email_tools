import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useParams } from 'react-router-dom';

import { getManualDocumentView, listAnnotations } from '../api/client';
import type { AnnotationListItem, ManualDocumentTocNode, ManualDocumentView } from '../api/types';
import { PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';

type ManualPdfReaderMode = 'continuous' | 'single';
type ManualPdfAnnotationMode = 'text' | 'region';
type ManualPdfZoomPreset = 'fit' | '1.00' | '1.25' | '1.50';
type ManualPdfLoadState = 'idle' | 'loading' | 'ready' | 'error';
type VisiblePageCandidate = { page: number; visibleRatio: number };

const ZOOM_PRESETS: Array<{ label: string; value: ManualPdfZoomPreset }> = [
  { label: 'Fit width', value: 'fit' },
  { label: '100%', value: '1.00' },
  { label: '125%', value: '1.25' },
  { label: '150%', value: '1.50' },
];

function zoomPresetToScale(zoomPreset: ManualPdfZoomPreset): string {
  return zoomPreset === 'fit' ? '1' : zoomPreset;
}

export function resolveMostVisiblePage(candidates: VisiblePageCandidate[]) {
  let bestPage: number | null = null;
  let bestVisibleRatio = -1;

  for (const candidate of candidates) {
    if (
      candidate.visibleRatio > bestVisibleRatio ||
      (candidate.visibleRatio === bestVisibleRatio && bestPage !== null && candidate.page < bestPage) ||
      (candidate.visibleRatio === bestVisibleRatio && bestPage === null)
    ) {
      bestPage = candidate.page;
      bestVisibleRatio = candidate.visibleRatio;
    }
  }

  return bestPage;
}

export function createPageRefRegistry() {
  const pageRefs = new Map<number, HTMLElement>();

  const setPageRef = (page: number, node: HTMLElement | null) => {
    if (node) {
      pageRefs.set(page, node);
      return;
    }
    pageRefs.delete(page);
  };

  return { pageRefs, setPageRef };
}

function clampPage(page: number, pageCount: number) {
  if (!pageCount) return 1;
  return Math.min(Math.max(1, page), pageCount);
}

function buildPdfWorkspaceErrorMessage(error: unknown, documentId?: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (documentId) {
    return `Unable to load PDF workspace for ${documentId}.`;
  }
  return 'Unable to load PDF workspace.';
}

function getAnnotationPage(annotation: AnnotationListItem) {
  const page = annotation.anchor?.page;
  if (typeof page === 'number' && Number.isFinite(page)) {
    return page;
  }
  if (typeof page === 'string') {
    const parsedPage = Number.parseInt(page, 10);
    if (!Number.isNaN(parsedPage)) {
      return parsedPage;
    }
  }
  return null;
}

function getAnnotationSummary(annotation: AnnotationListItem) {
  const quote = annotation.anchor?.quote;
  if (typeof quote === 'string' && quote.trim()) {
    return quote;
  }

  const selectedText = annotation.anchor?.selected_text;
  if (typeof selectedText === 'string' && selectedText.trim()) {
    return selectedText;
  }

  return annotation.body;
}

function renderTocButtons(nodes: ManualDocumentTocNode[], onJumpToPage: (page: number) => void) {
  if (!nodes.length) {
    return <p className="text-sm text-slate-500">No outline available yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm text-slate-700">
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <button
              type="button"
              onClick={() => onJumpToPage(node.page)}
              className="text-left font-medium text-sky-700 underline-offset-2 hover:underline"
            >
              {node.label}
            </button>
            <p className="text-xs text-slate-500">Page {node.page}</p>
            {node.children.length > 0 && <div className="mt-2 pl-3">{renderTocButtons(node.children, onJumpToPage)}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function WorkspaceRailShell({
  collapsed,
  title,
  railLabel,
  actionLabel,
  onToggle,
  children,
}: {
  collapsed: boolean;
  title: string;
  railLabel: string;
  actionLabel: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      className={`shrink-0 rounded-2xl border border-slate-200 bg-white shadow-sm transition-all ${
        collapsed ? 'w-full xl:w-16' : 'w-full xl:w-80'
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        {!collapsed ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{railLabel}</p>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          </div>
        ) : (
          <div aria-hidden="true" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {title}
          </div>
        )}
        <PrimaryButton type="button" onClick={onToggle} className="shrink-0">
          {actionLabel}
        </PrimaryButton>
      </div>
      {!collapsed && <div className="space-y-4 p-4">{children}</div>}
    </aside>
  );
}

function ReaderModeControls({
  readerMode,
  onChange,
}: {
  readerMode: ManualPdfReaderMode;
  onChange: (mode: ManualPdfReaderMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PrimaryButton
        type="button"
        aria-pressed={readerMode === 'continuous'}
        onClick={() => onChange('continuous')}
        className={readerMode === 'continuous' ? 'bg-sky-500 hover:bg-sky-400' : 'bg-slate-700 hover:bg-slate-600'}
      >
        Continuous scroll
      </PrimaryButton>
      <PrimaryButton
        type="button"
        aria-pressed={readerMode === 'single'}
        onClick={() => onChange('single')}
        className={readerMode === 'single' ? 'bg-sky-500 hover:bg-sky-400' : 'bg-slate-700 hover:bg-slate-600'}
      >
        Single-page focus
      </PrimaryButton>
    </div>
  );
}

function AnnotationModeControls({
  annotationMode,
  readerMode,
  blockedMessage,
  onChange,
}: {
  annotationMode: ManualPdfAnnotationMode;
  readerMode: ManualPdfReaderMode;
  blockedMessage: string | null;
  onChange: (mode: ManualPdfAnnotationMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PrimaryButton
        type="button"
        aria-pressed={annotationMode === 'text'}
        onClick={() => onChange('text')}
        className={annotationMode === 'text' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-slate-700 hover:bg-slate-600'}
      >
        Text
      </PrimaryButton>
      <PrimaryButton
        type="button"
        aria-pressed={annotationMode === 'region'}
        onClick={() => onChange('region')}
        className={annotationMode === 'region' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-slate-700 hover:bg-slate-600'}
      >
        Region
      </PrimaryButton>
      {blockedMessage && <p className="text-xs text-amber-200">{blockedMessage}</p>}
    </div>
  );
}

function ZoomControls({
  zoomPreset,
  onChange,
}: {
  zoomPreset: ManualPdfZoomPreset;
  onChange: (preset: ManualPdfZoomPreset) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ZOOM_PRESETS.map((preset) => (
        <PrimaryButton
          key={preset.value}
          type="button"
          aria-pressed={zoomPreset === preset.value}
          onClick={() => onChange(preset.value)}
          className={zoomPreset === preset.value ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-slate-700 hover:bg-slate-600'}
        >
          {preset.label}
        </PrimaryButton>
      ))}
    </div>
  );
}

function PdfReaderPane({
  documentId,
  document,
  loading,
  errorMessage,
  readerMode,
  zoomPreset,
  focusLayout,
  activePage,
  readerPage,
  scrollContainerRef,
  setPageRef,
  onReaderModeChange,
  onZoomChange,
}: {
  documentId?: string;
  document: ManualDocumentView | null;
  loading: boolean;
  errorMessage: string | null;
  readerMode: ManualPdfReaderMode;
  zoomPreset: ManualPdfZoomPreset;
  focusLayout: boolean;
  activePage: number;
  readerPage: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  setPageRef: (page: number, node: HTMLElement | null) => void;
  onReaderModeChange: (mode: ManualPdfReaderMode) => void;
  onZoomChange: (preset: ManualPdfZoomPreset) => void;
}) {
  const zoomScale = zoomPresetToScale(zoomPreset);
  const pageCount = document?.page_count ?? 0;
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount]);

  return (
    <section
      data-testid="pdf-reader-pane"
      data-focus-layout={String(focusLayout)}
      data-zoom={zoomScale}
      className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-950 text-white shadow-lg"
    >
      <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <ReaderModeControls readerMode={readerMode} onChange={onReaderModeChange} />
          <ZoomControls zoomPreset={zoomPreset} onChange={onZoomChange} />
        </div>

        <div className="flex items-center gap-3 text-sm text-slate-300">
          <span className="rounded-full border border-white/10 px-3 py-1">
            Reader mode: {readerMode === 'continuous' ? 'continuous' : 'single-page focus'}
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1">Zoom: {zoomScale}</span>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <SectionPanel title={document?.title || 'PDF canvas'}>
          {loading ? (
            <p className="text-sm text-slate-300">Loading PDF workspace...</p>
          ) : errorMessage ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-rose-200">Unable to load PDF workspace.</p>
              <p className="text-sm text-rose-100">{errorMessage}</p>
              {documentId && (
                <p className="text-xs text-rose-100/80">Document id: {documentId}</p>
              )}
            </div>
          ) : document ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Center pane ready for PDF reading. The workspace shell is wired to the loaded document and preserves
                reader mode when zoom presets change.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Title</p>
                  <p className="mt-1 text-sm font-medium text-white">{document.title}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Subtitle</p>
                  <p className="mt-1 text-sm font-medium text-white">{document.subtitle}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Document id</p>
                  <p className="mt-1 text-sm font-medium text-white">{document.document_id}</p>
                </div>
              </div>

              <div
                ref={scrollContainerRef}
                data-testid="pdf-page-viewport"
                className={`rounded-2xl border border-white/10 bg-slate-900/70 p-4 ${
                  readerMode === 'continuous' ? 'max-h-[34rem] overflow-y-auto' : 'overflow-hidden'
                }`}
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Visible page</p>
                    <p className="text-sm font-medium text-white">
                      Page {readerPage} of {document.page_count}
                    </p>
                  </div>
                  <p className="text-xs text-slate-400">
                    {readerMode === 'continuous' ? 'Continuous scroll follows the visible page.' : 'Single-page focus shows one page at a time.'}
                  </p>
                </div>

                <div className="space-y-4">
                  {readerMode === 'continuous' ? (
                    pages.map((page) => (
                      <article
                        key={page}
                        ref={(node) => setPageRef(page, node)}
                        data-testid={`pdf-page-${page}`}
                        data-active={String(page === activePage)}
                        className={`min-h-64 rounded-2xl border p-4 shadow-sm ${
                          page === activePage
                            ? 'border-sky-300 bg-white text-slate-900'
                            : 'border-white/10 bg-white/5 text-white'
                        }`}
                      >
                        <div className="mb-4 flex items-center justify-between">
                          <p className="text-sm font-semibold">Page {page}</p>
                          <p className="text-xs uppercase tracking-wide text-current/60">
                            {page === activePage ? 'Active' : 'Idle'}
                          </p>
                        </div>
                        <div className="space-y-3">
                          <div className="h-40 rounded-xl border border-dashed border-current/20 bg-current/5" />
                          <p className="text-sm text-current/70">
                            Placeholder page canvas for continuous reading. Visible-page sync keeps this stack aligned
                            with the reader viewport.
                          </p>
                        </div>
                      </article>
                    ))
                  ) : (
                    <article
                      key={readerPage}
                      ref={(node) => setPageRef(readerPage, node)}
                      data-testid={`pdf-page-${readerPage}`}
                      data-active="true"
                      className="min-h-96 rounded-2xl border border-sky-300 bg-white p-4 text-slate-900 shadow-sm"
                    >
                      <div className="mb-4 flex items-center justify-between">
                        <p className="text-sm font-semibold">Page {readerPage}</p>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Focused</p>
                      </div>
                      <div className="space-y-3">
                        <div className="h-64 rounded-xl border border-dashed border-slate-300 bg-slate-50" />
                        <p className="text-sm text-slate-600">
                          Single-page focus keeps the selected page pinned here until a new TOC jump or page selection
                          changes it.
                        </p>
                      </div>
                    </article>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-300">
              {documentId ? 'Waiting for document metadata.' : 'A document id is required for this workspace.'}
            </p>
          )}
        </SectionPanel>
      </div>
    </section>
  );
}

function useManualPdfPageNavigation(document: ManualDocumentView | null, readerMode: ManualPdfReaderMode) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefRegistryRef = useRef<ReturnType<typeof createPageRefRegistry> | null>(null);
  if (!pageRefRegistryRef.current) {
    pageRefRegistryRef.current = createPageRefRegistry();
  }
  const pageRefRegistry = pageRefRegistryRef.current;
  const pageCount = document?.page_count ?? 0;
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount]);
  const [activePage, setActivePage] = useState(() => clampPage(document?.initial_page ?? 1, pageCount));
  const [focusedPage, setFocusedPage] = useState(() => clampPage(document?.initial_page ?? 1, pageCount));

  useEffect(() => {
    if (!document) {
      setActivePage(1);
      setFocusedPage(1);
      return;
    }

    const nextPage = clampPage(document.initial_page, document.page_count);
    setActivePage(nextPage);
    setFocusedPage(nextPage);
  }, [document?.document_id, document?.initial_page, document?.page_count]);

  const syncVisiblePageFromViewport = useCallback(() => {
    if (readerMode !== 'continuous') {
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const viewportTop = container.scrollTop;
    const viewportBottom = viewportTop + container.clientHeight;
    const candidates = pages
      .map((page) => {
        const node = pageRefRegistry.pageRefs.get(page);
        if (!node) {
          return null;
        }

        const pageTop = node.offsetTop;
        const pageBottom = pageTop + node.offsetHeight;

        if (pageBottom <= viewportTop) {
          return null;
        }
        if (pageTop >= viewportBottom) {
          return null;
        }

        const visibleTop = Math.max(pageTop, viewportTop);
        const visibleBottom = Math.min(pageBottom, viewportBottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        const visibleRatio = node.offsetHeight > 0 ? visibleHeight / node.offsetHeight : 0;

        return {
          page,
          visibleRatio,
        };
      })
      .filter((candidate): candidate is VisiblePageCandidate => candidate !== null);

    const mostVisiblePage = resolveMostVisiblePage(candidates);
    if (mostVisiblePage !== null) {
      setActivePage(mostVisiblePage);
    }
  }, [pages, readerMode]);

  useEffect(() => {
    syncVisiblePageFromViewport();
  }, [syncVisiblePageFromViewport]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || readerMode !== 'continuous') {
      return;
    }

    const handleScroll = () => {
      syncVisiblePageFromViewport();
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [readerMode, syncVisiblePageFromViewport]);

  const jumpToPage = useCallback(
    (page: number) => {
      if (!document) {
        return;
      }

      const nextPage = clampPage(page, document.page_count);
      setActivePage(nextPage);
      setFocusedPage(nextPage);

      if (readerMode === 'continuous') {
        pageRefRegistry.pageRefs.get(nextPage)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [document, pageRefRegistry, readerMode],
  );

  return {
    activePage,
    focusedPage,
    jumpToPage,
    readerPage: readerMode === 'continuous' ? activePage : focusedPage,
    scrollContainerRef,
    setPageRef: pageRefRegistry.setPageRef,
  };
}

function useManualPdfAnnotations(document: ManualDocumentView | null) {
  const [annotations, setAnnotations] = useState<AnnotationListItem[]>([]);
  const [annotationsError, setAnnotationsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!document) {
      setAnnotations([]);
      setAnnotationsError(null);
      return () => {
        active = false;
      };
    }

    setAnnotations([]);
    setAnnotationsError(null);

    const loadAnnotations = async () => {
      const collected: AnnotationListItem[] = [];
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        const response = await listAnnotations({
          target_type: 'document_pdf',
          target_ref: document.document_id,
          page,
          page_size: 100,
        });
        collected.push(...response.annotations);
        const pageSize = response.page_size || 100;
        totalPages = Math.max(totalPages, Math.ceil(response.total / pageSize));
        page += 1;
      }

      if (!active) return;
      setAnnotations(collected);
    };

    void loadAnnotations().catch((error: unknown) => {
      if (!active) return;
      setAnnotations([]);
      setAnnotationsError(error instanceof Error && error.message.trim() ? error.message : 'Unable to load annotations.');
    });

    return () => {
      active = false;
    };
  }, [document?.document_id]);

  return { annotations, annotationsError };
}

function ManualPdfWorkspace({
  documentId,
  document,
  loading,
  errorMessage,
  isLeftCollapsed,
  isRightCollapsed,
  readerMode,
  annotationMode,
  zoomPreset,
  onToggleLeft,
  onToggleRight,
  onReaderModeChange,
  onAnnotationModeChange,
  onZoomChange,
}: {
  documentId?: string;
  document: ManualDocumentView | null;
  loading: boolean;
  errorMessage: string | null;
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  readerMode: ManualPdfReaderMode;
  annotationMode: ManualPdfAnnotationMode;
  zoomPreset: ManualPdfZoomPreset;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onReaderModeChange: (mode: ManualPdfReaderMode) => void;
  onAnnotationModeChange: (mode: ManualPdfAnnotationMode) => void;
  onZoomChange: (preset: ManualPdfZoomPreset) => void;
}) {
  const focusLayout = isLeftCollapsed && isRightCollapsed;
  const { activePage, jumpToPage, readerPage, scrollContainerRef, setPageRef } = useManualPdfPageNavigation(
    document,
    readerMode,
  );
  const { annotations, annotationsError } = useManualPdfAnnotations(document);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [regionBlockedMessage, setRegionBlockedMessage] = useState<string | null>(null);
  const annotationsForActivePage = useMemo(
    () => annotations.filter((annotation) => getAnnotationPage(annotation) === activePage),
    [annotations, activePage],
  );
  useEffect(() => {
    if (readerMode === 'continuous' && annotationMode === 'region') {
      onAnnotationModeChange('text');
    }
    if (readerMode !== 'continuous') {
      setRegionBlockedMessage(null);
    }
  }, [annotationMode, onAnnotationModeChange, readerMode]);
  const focusAnnotation = useCallback(
    (annotation: AnnotationListItem) => {
      const annotationPage = getAnnotationPage(annotation) ?? activePage;
      setActiveAnnotationId(annotation.annotation_id);
      jumpToPage(annotationPage);
    },
    [activePage, jumpToPage],
  );
  const handleAnnotationModeChange = useCallback(
    (mode: ManualPdfAnnotationMode) => {
      if (mode === 'region' && readerMode === 'continuous') {
        setRegionBlockedMessage('Switch to single-page focus mode before drawing region annotations.');
        onAnnotationModeChange('text');
        return;
      }
      setRegionBlockedMessage(null);
      onAnnotationModeChange(mode);
    },
    [onAnnotationModeChange, readerMode],
  );

  return (
    <div
      data-testid="pdf-workspace-root"
      data-left-collapsed={String(isLeftCollapsed)}
      data-right-collapsed={String(isRightCollapsed)}
      className="mt-6 flex min-h-[calc(100vh-13rem)] flex-col gap-4 xl:flex-row"
    >
      <WorkspaceRailShell
        collapsed={isLeftCollapsed}
        title="Outline"
        railLabel="Document rail"
        actionLabel={isLeftCollapsed ? 'Expand left panel' : 'Collapse left panel'}
        onToggle={onToggleLeft}
      >
        <SectionPanel title={document?.title || 'Document details'}>
          {loading ? (
            <p className="text-sm text-slate-500">Loading document...</p>
          ) : errorMessage ? (
            <p className="text-sm text-rose-600">
              Unable to load document details. {errorMessage}
            </p>
          ) : document ? (
            <dl className="space-y-2 text-sm text-slate-600">
              <div>
                <dt className="font-medium text-slate-900">Manual type</dt>
                <dd>{document.manual_type}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Version</dt>
                <dd>{document.manual_version}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Pages</dt>
                <dd>{document.page_count}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Initial page</dt>
                <dd>{document.initial_page}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              {documentId ? 'Document metadata is unavailable.' : 'A document id is required for this workspace.'}
            </p>
          )}
        </SectionPanel>

        <SectionPanel title="Outline">
          {document ? renderTocButtons(document.toc, jumpToPage) : <p className="text-sm text-slate-500">Loading outline...</p>}
        </SectionPanel>
      </WorkspaceRailShell>

      <PdfReaderPane
        documentId={documentId}
        document={document}
        loading={loading}
        errorMessage={errorMessage}
        readerMode={readerMode}
        zoomPreset={zoomPreset}
        focusLayout={focusLayout}
        activePage={activePage}
        readerPage={readerPage}
        scrollContainerRef={scrollContainerRef}
        setPageRef={setPageRef}
        onReaderModeChange={onReaderModeChange}
        onZoomChange={onZoomChange}
      />

      <WorkspaceRailShell
        collapsed={isRightCollapsed}
        title="References"
        railLabel="Workspace rail"
        actionLabel={isRightCollapsed ? 'Expand right panel' : 'Collapse right panel'}
        onToggle={onToggleRight}
      >
        <SectionPanel title="Annotation tools">
          <AnnotationModeControls
            annotationMode={annotationMode}
            readerMode={readerMode}
            blockedMessage={regionBlockedMessage}
            onChange={handleAnnotationModeChange}
          />
        </SectionPanel>
        <SectionPanel title="Annotations">
          {annotationsError ? (
            <p className="text-sm text-rose-600">Unable to load annotations. {annotationsError}</p>
          ) : null}
          {annotationsForActivePage.length ? (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Active page {activePage} annotations</p>
              <div className="space-y-2">
                {annotationsForActivePage.map((annotation) => {
                  const selected = annotation.annotation_id === activeAnnotationId;
                  return (
                    <button
                      key={annotation.annotation_id}
                      type="button"
                      onClick={() => focusAnnotation(annotation)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                        selected
                          ? 'border-sky-300 bg-sky-50 text-slate-900 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{annotation.short_label || annotation.body}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{getAnnotationSummary(annotation)}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-500">
                          Page {getAnnotationPage(annotation) ?? activePage}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No annotations on page {activePage} yet.</p>
          )}
          {readerMode === 'continuous' && annotationMode === 'region' && (
            <p className="mt-3 text-sm text-amber-600">
              Switch to single-page focus mode before drawing region annotations.
            </p>
          )}
        </SectionPanel>
        <SectionPanel title="Document stats">
          {document ? (
            <dl className="space-y-2 text-sm text-slate-600">
              <div>
                <dt className="font-medium text-slate-900">Pages</dt>
                <dd>{document.page_count}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Initial page</dt>
                <dd>{document.initial_page}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">PDF URL</dt>
                <dd className="break-all">{document.pdf_url}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">{loading ? 'Loading document stats...' : 'Document stats unavailable.'}</p>
          )}
        </SectionPanel>
      </WorkspaceRailShell>
    </div>
  );
}

function useManualPdfDocument(documentId?: string) {
  const [document, setDocument] = useState<ManualDocumentView | null>(null);
  const [loadState, setLoadState] = useState<ManualPdfLoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!documentId) {
      setDocument(null);
      setErrorMessage(null);
      setLoadState('idle');
      return () => {
        active = false;
      };
    }

    setLoadState('loading');
    setErrorMessage(null);
    setDocument(null);

    void getManualDocumentView(documentId)
      .then((loadedDocument) => {
        if (!active) return;
        setDocument(loadedDocument);
        setLoadState('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDocument(null);
        setLoadState('error');
        setErrorMessage(buildPdfWorkspaceErrorMessage(error, documentId));
      });

    return () => {
      active = false;
    };
  }, [documentId]);

  return { document, loadState, errorMessage };
}

export default function ManualPdfPage() {
  const { documentId } = useParams();
  const { document, loadState, errorMessage } = useManualPdfDocument(documentId);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [readerMode, setReaderMode] = useState<ManualPdfReaderMode>('continuous');
  const [annotationMode, setAnnotationMode] = useState<ManualPdfAnnotationMode>('text');
  const [zoomPreset, setZoomPreset] = useState<ManualPdfZoomPreset>('fit');

  return (
    <PageShell>
      <PageHeader
        eyebrow="PDF Workspace"
        title="Open PDF document"
        description={
          loadState === 'error'
            ? errorMessage || 'Read the source PDF in a dedicated workspace with navigation, zoom, and annotations.'
            : document?.subtitle || 'Read the source PDF in a dedicated workspace with navigation, zoom, and annotations.'
        }
      />

      <ManualPdfWorkspace
        documentId={documentId}
        document={document}
        loading={loadState === 'loading'}
        errorMessage={loadState === 'error' ? errorMessage : null}
        isLeftCollapsed={isLeftCollapsed}
        isRightCollapsed={isRightCollapsed}
        readerMode={readerMode}
        annotationMode={annotationMode}
        zoomPreset={zoomPreset}
        onToggleLeft={() => setIsLeftCollapsed((collapsed) => !collapsed)}
        onToggleRight={() => setIsRightCollapsed((collapsed) => !collapsed)}
        onReaderModeChange={setReaderMode}
        onAnnotationModeChange={setAnnotationMode}
        onZoomChange={setZoomPreset}
      />
    </PageShell>
  );
}
