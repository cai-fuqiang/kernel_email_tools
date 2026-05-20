import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { getManualDocumentView, listAnnotations } from '../api/client';
import type { AnnotationListItem, ManualDocumentView } from '../api/types';
import { PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';

const PDFJS_VIEWER_BASE = '/app/pdfjs/web/viewer.html';

const EXPANDED_RAIL_WIDTH = 320;
const COLLAPSED_RAIL_WIDTH = 48;
const MIN_RAIL_WIDTH = 240;
const MAX_RAIL_WIDTH = 520;

type ManualPdfAnnotationMode = 'text' | 'region';
type ManualPdfLoadState = 'idle' | 'loading' | 'ready' | 'error';
type RailSide = 'left' | 'right';

function clampRailWidth(width: number) {
  return Math.min(Math.max(MIN_RAIL_WIDTH, width), MAX_RAIL_WIDTH);
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

function AnnotationModeControls({
  annotationMode,
  blockedMessage,
  onChange,
}: {
  annotationMode: ManualPdfAnnotationMode;
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

function WorkspaceRailShell({
  isDesktop,
  collapsed,
  side,
  title,
  railLabel,
  actionLabel,
  width = EXPANDED_RAIL_WIDTH,
  onToggle,
  onResizeStart,
  onResizeStep,
  children,
}: {
  isDesktop: boolean;
  collapsed: boolean;
  side: RailSide;
  title: string;
  railLabel: string;
  actionLabel: string;
  width?: number;
  onToggle: () => void;
  onResizeStart?: (side: RailSide, clientX: number) => void;
  onResizeStep?: (side: RailSide, delta: number) => void;
  children: ReactNode;
}) {
  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!onResizeStep || collapsed) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onResizeStep(side, -16);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onResizeStep(side, 16);
      }
    },
    [collapsed, onResizeStep, side],
  );

  return (
    <aside
      data-testid={`${side}-rail-shell`}
      style={isDesktop ? { width: `${collapsed ? COLLAPSED_RAIL_WIDTH : width}px` } : undefined}
      className={`relative rounded-2xl border border-slate-200 bg-white shadow-sm transition-all ${
        isDesktop ? 'shrink-0' : 'w-full'
      }`}
    >
      {isDesktop && !collapsed && onResizeStart ? (
        <div
          data-testid={`${side}-rail-resize-handle`}
          role="separator"
          aria-label={`Resize ${side} panel`}
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
            event.preventDefault();
            onResizeStart(side, event.clientX);
          }}
          onKeyDown={handleResizeKeyDown}
          className={`absolute top-4 h-[calc(100%-2rem)] w-2 rounded-full bg-transparent cursor-col-resize hover:bg-sky-200/70 focus:bg-sky-200/70 ${
            side === 'left' ? '-right-1' : '-left-1'
          }`}
        />
      ) : null}
      {isDesktop && collapsed ? (
        <div className="flex h-full min-h-[20rem] flex-col items-center justify-between px-2 py-4">
          <span className="[writing-mode:vertical-rl] text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            {title}
          </span>
          <PrimaryButton type="button" onClick={onToggle} className="px-2 py-3 text-xs">
            <span className="sr-only">{actionLabel}</span>
            <span aria-hidden="true">{side === 'left' ? '>' : '<'}</span>
          </PrimaryButton>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{railLabel}</p>
              <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            </div>
            <PrimaryButton type="button" onClick={onToggle} className="shrink-0">
              {actionLabel}
            </PrimaryButton>
          </div>
          {!collapsed && <div className="space-y-4 p-4">{children}</div>}
        </>
      )}
    </aside>
  );
}

function useIsDesktopWorkspace() {
  const readDesktopMatch = useCallback(() => {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(min-width: 1280px)').matches;
    }
    return window.innerWidth >= 1280;
  }, []);
  const [isDesktop, setIsDesktop] = useState(readDesktopMatch);

  useEffect(() => {
    if (typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia('(min-width: 1280px)');
      const handleChange = (event: MediaQueryListEvent) => {
        setIsDesktop(event.matches);
      };
      setIsDesktop(mediaQuery.matches);
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
        return () => {
          mediaQuery.removeEventListener('change', handleChange);
        };
      }
      if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleChange);
        return () => {
          mediaQuery.removeListener(handleChange);
        };
      }
      return;
    }

    const handleResize = () => {
      setIsDesktop(readDesktopMatch());
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [readDesktopMatch]);

  return isDesktop;
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

    setAnnotationsError(null);

    const loadAnnotations = async () => {
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
        if (!active) return;
      } catch (error: unknown) {
        if (!active) return;
        setAnnotationsError(
          error instanceof Error && error.message.trim() ? error.message : 'Unable to load annotations.',
        );
      }
    };

    void loadAnnotations();

    return () => {
      active = false;
    };
  }, [document?.document_id]);

  return { annotations, annotationsError };
}

function PdfViewer({
  pdfUrl,
  targetPage,
}: {
  pdfUrl: string;
  targetPage: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const absoluteUrl = `${window.location.origin}${pdfUrl}`;
  const viewerUrl = `${PDFJS_VIEWER_BASE}?file=${encodeURIComponent(absoluteUrl)}#page=${targetPage}`;
  const prevPageRef = useRef(targetPage);

  useEffect(() => {
    if (prevPageRef.current === targetPage) return;
    prevPageRef.current = targetPage;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: 'jump', page: targetPage }, window.location.origin);
  }, [targetPage]);

  return (
    <iframe
      ref={iframeRef}
      src={viewerUrl}
      className="w-full h-full min-h-[40rem] border-0"
      title="PDF Viewer"
      allow="fullscreen"
    />
  );
}

function ManualPdfWorkspace({
  documentId,
  document,
  loading,
  errorMessage,
  isRightCollapsed,
  annotationMode,
  onToggleRight,
  onAnnotationModeChange,
}: {
  documentId?: string;
  document: ManualDocumentView | null;
  loading: boolean;
  errorMessage: string | null;
  isRightCollapsed: boolean;
  annotationMode: ManualPdfAnnotationMode;
  onToggleRight: () => void;
  onAnnotationModeChange: (mode: ManualPdfAnnotationMode) => void;
}) {
  const isDesktop = useIsDesktopWorkspace();
  const [rightRailWidth, setRightRailWidth] = useState(EXPANDED_RAIL_WIDTH);
  const previousRightCollapsed = useRef(isRightCollapsed);

  const { annotations, annotationsError } = useManualPdfAnnotations(document);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [regionBlockedMessage, setRegionBlockedMessage] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(document?.initial_page ?? 1);

  const annotationsForActivePage = useMemo(
    () =>
      annotations
        .slice()
        .sort((a, b) => (getAnnotationPage(a) ?? 0) - (getAnnotationPage(b) ?? 0))
        .filter((annotation) => getAnnotationPage(annotation) === activePage),
    [annotations, activePage],
  );

  useEffect(() => {
    if (previousRightCollapsed.current && !isRightCollapsed) {
      setRightRailWidth(EXPANDED_RAIL_WIDTH);
    }
    previousRightCollapsed.current = isRightCollapsed;
  }, [isRightCollapsed]);

  const jumpToPage = useCallback((page: number) => {
    setActivePage(page);
  }, []);

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
      if (mode === 'region') {
        setRegionBlockedMessage('Switch to single-page focus mode before drawing region annotations.');
        onAnnotationModeChange('text');
        return;
      }
      setRegionBlockedMessage(null);
      onAnnotationModeChange(mode);
    },
    [onAnnotationModeChange],
  );

  const adjustRailWidth = useCallback((side: RailSide, delta: number) => {
    if (side === 'right') {
      setRightRailWidth((width) => clampRailWidth(width - delta));
    }
  }, []);

  const handleRailResizeStart = useCallback(
    (side: RailSide, clientX: number) => {
      const startWidth = rightRailWidth;
      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - clientX;
        if (side === 'right') {
          setRightRailWidth(clampRailWidth(startWidth - delta));
        }
      };
      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [rightRailWidth],
  );

  return (
    <div
      data-testid="pdf-workspace-root"
      data-right-collapsed={String(isRightCollapsed)}
      className="mt-6 flex min-h-[calc(100vh-13rem)] flex-col gap-4 xl:flex-row"
    >
      {/* PDF Viewer pane */}
      <section
        data-testid="pdf-reader-pane"
        className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full min-h-[20rem]">
            <p className="text-sm text-slate-500">Loading PDF workspace...</p>
          </div>
        ) : errorMessage ? (
          <div
            data-testid="pdf-load-error"
            className="space-y-2 p-6"
          >
            <p className="text-sm font-medium text-rose-600">Unable to load PDF workspace.</p>
            <p className="text-sm text-rose-500">{errorMessage}</p>
            {documentId && (
              <p className="text-xs text-rose-400">Document id: {documentId}</p>
            )}
          </div>
        ) : document ? (
          <div className="h-full min-h-[40rem]">
            <PdfViewer
              pdfUrl={document.pdf_url}
              targetPage={activePage}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full min-h-[20rem] p-6">
            <p className="text-sm text-slate-500">
              {documentId ? 'Waiting for document metadata.' : 'A document id is required for this workspace.'}
            </p>
          </div>
        )}
      </section>

      {/* Right rail: annotations */}
      <WorkspaceRailShell
        isDesktop={isDesktop}
        collapsed={isRightCollapsed}
        side="right"
        title="References"
        railLabel="Workspace rail"
        actionLabel={isRightCollapsed ? 'Expand right panel' : 'Collapse right panel'}
        width={rightRailWidth}
        onToggle={onToggleRight}
        onResizeStart={handleRailResizeStart}
        onResizeStep={adjustRailWidth}
      >
        <SectionPanel title="Annotation tools">
          <AnnotationModeControls
            annotationMode={annotationMode}
            blockedMessage={regionBlockedMessage}
            onChange={handleAnnotationModeChange}
          />
        </SectionPanel>
        <SectionPanel title="Annotations">
          {annotationsError ? (
            <p className="text-sm text-rose-600">Unable to load annotations. {annotationsError}</p>
          ) : null}
          <div
            data-testid="annotation-list-panel"
            className="max-h-[28rem] overflow-y-auto space-y-3"
          >
            {annotationsForActivePage.length ? (
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Active page {activePage} annotations</p>
                <div className="space-y-2">
                  {annotationsForActivePage.map((annotation) => {
                    const selected = annotation.annotation_id === activeAnnotationId;
                    const annotationPageNum = getAnnotationPage(annotation) ?? activePage;
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
                          <div className="min-w-0 prose prose-sm max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {annotation.short_label || annotation.body}
                            </ReactMarkdown>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-500 not-prose">
                              {getAnnotationSummary(annotation)}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-500">
                            Page {annotationPageNum}
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
          </div>
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
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [annotationMode, setAnnotationMode] = useState<ManualPdfAnnotationMode>('text');

  return (
    <PageShell>
      <div className="mb-4">
        <Link
          to="/manual/search"
          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
        >
          Back to manuals
        </Link>
      </div>
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
        isRightCollapsed={isRightCollapsed}
        annotationMode={annotationMode}
        onToggleRight={() => setIsRightCollapsed((collapsed) => !collapsed)}
        onAnnotationModeChange={setAnnotationMode}
      />
    </PageShell>
  );
}
