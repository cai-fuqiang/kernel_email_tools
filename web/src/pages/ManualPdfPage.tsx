import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link, useParams } from 'react-router-dom';

import { getManualDocumentView, listAnnotations } from '../api/client';
import type { AnnotationListItem, ManualDocumentTocNode, ManualDocumentView } from '../api/types';
import { PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

type ManualPdfReaderMode = 'continuous' | 'single';
type ManualPdfAnnotationMode = 'text' | 'region';
type ManualPdfZoomPreset = 'fit' | '1.00' | '1.25' | '1.50';
type ManualPdfLoadState = 'idle' | 'loading' | 'ready' | 'error';
type VisiblePageCandidate = { page: number; visibleRatio: number };
type RailSide = 'left' | 'right';
type ReactPdfModule = typeof import('react-pdf');
type ManualPdfTestGlobals = typeof globalThis & {
  __MANUAL_PDF_TEST_RENDER_ERROR__?: Error | null;
};

const EXPANDED_RAIL_WIDTH = 320;
const COLLAPSED_RAIL_WIDTH = 48;
const MIN_RAIL_WIDTH = 240;
const MAX_RAIL_WIDTH = 520;
let reactPdfModulePromise: Promise<ReactPdfModule> | null = null;

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

function clampRailWidth(width: number) {
  return Math.min(Math.max(MIN_RAIL_WIDTH, width), MAX_RAIL_WIDTH);
}

function normalizePdfRenderErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message : 'Unable to render PDF pages.';
}

function ensurePdfDomPolyfills() {
  const globalScope = globalThis as typeof globalThis & {
    DOMMatrix?: new () => {
      a: number;
      b: number;
      c: number;
      d: number;
      e: number;
      f: number;
      multiply: () => unknown;
      translate: () => unknown;
      scale: () => unknown;
      rotate: () => unknown;
      inverse: () => unknown;
      transformPoint: (point?: unknown) => unknown;
      preMultiplySelf: () => unknown;
      translateSelf: () => unknown;
      scaleSelf: () => unknown;
      rotateSelf: () => unknown;
      invertSelf: () => unknown;
    };
  };

  if (typeof globalScope.DOMMatrix !== 'undefined') {
    return;
  }

  class DOMMatrixShim {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    multiply() {
      return new DOMMatrixShim();
    }

    translate() {
      return new DOMMatrixShim();
    }

    scale() {
      return new DOMMatrixShim();
    }

    rotate() {
      return new DOMMatrixShim();
    }

    inverse() {
      return new DOMMatrixShim();
    }

    transformPoint<T>(point: T) {
      return point;
    }

    preMultiplySelf() {
      return this;
    }

    translateSelf() {
      return this;
    }

    scaleSelf() {
      return this;
    }

    rotateSelf() {
      return this;
    }

    invertSelf() {
      return this;
    }
  }

  globalScope.DOMMatrix = DOMMatrixShim as typeof globalScope.DOMMatrix;
}

function loadReactPdfModule() {
  ensurePdfDomPolyfills();

  if (typeof navigator !== 'undefined' && /\bjsdom\b/i.test(navigator.userAgent)) {
    return Promise.resolve(createReactPdfTestModule());
  }

  if (!reactPdfModulePromise) {
    reactPdfModulePromise = import('react-pdf')
      .then((module) => {
        module.pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        return module;
      })
      .catch((error) => {
        reactPdfModulePromise = null;
        throw error;
      });
  }

  return reactPdfModulePromise;
}

function createReactPdfTestModule(): ReactPdfModule {
  const TestDocument = ({
    children,
    file,
    onLoadError,
    onLoadSuccess,
    onSourceError,
  }: {
    children: ReactNode;
    file: string;
    onLoadError?: (error: Error) => void;
    onLoadSuccess?: () => void;
    onSourceError?: (error: Error) => void;
  }) => {
    useEffect(() => {
      const testError = (globalThis as ManualPdfTestGlobals).__MANUAL_PDF_TEST_RENDER_ERROR__;
      if (testError) {
        onSourceError?.(testError);
        onLoadError?.(testError);
        return;
      }

      onLoadSuccess?.();
    }, [file, onLoadError, onLoadSuccess, onSourceError]);

    return <div data-testid="pdf-document">{children}</div>;
  };

  const TestPage = ({
    pageNumber,
    scale,
    width,
  }: {
    pageNumber: number;
    scale?: number;
    width?: number;
  }) => (
    <div
      data-testid={`pdf-rendered-page-${pageNumber}`}
      data-scale={scale === undefined ? '' : String(scale)}
      data-width={width === undefined ? '' : String(width)}
    >
      Audience text layer
    </div>
  );

  return {
    Document: TestDocument,
    Page: TestPage,
    pdfjs: {
      GlobalWorkerOptions: {
        workerSrc: '',
      },
    },
  } as ReactPdfModule;
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
  scrollContainerRef: RefObject<HTMLDivElement>;
  setPageRef: (page: number, node: HTMLElement | null) => void;
  onReaderModeChange: (mode: ManualPdfReaderMode) => void;
  onZoomChange: (preset: ManualPdfZoomPreset) => void;
}) {
  const zoomScale = zoomPresetToScale(zoomPreset);
  const viewportWidth = useViewportWidth(scrollContainerRef, document?.pdf_url);
  const pageScale = zoomPreset === 'fit' ? undefined : Number(zoomScale);
  const pageWidth = zoomPreset === 'fit' ? Math.max(280, Math.floor(viewportWidth - 32)) : undefined;
  const pageCount = document?.page_count ?? 0;
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount]);
  const [pdfRenderError, setPdfRenderError] = useState<string | null>(null);
  const [reactPdfModule, setReactPdfModule] = useState<ReactPdfModule | null>(null);
  const DocumentComponent = reactPdfModule?.Document;
  const PageComponent = reactPdfModule?.Page;

  useEffect(() => {
    setPdfRenderError(null);
  }, [document?.pdf_url]);

  useEffect(() => {
    let active = true;

    void loadReactPdfModule()
      .then((module) => {
        if (!active) {
          return;
        }
        setReactPdfModule(module);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setPdfRenderError(normalizePdfRenderErrorMessage(error));
      });

    return () => {
      active = false;
    };
  }, []);

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
                </div>

                {pdfRenderError ? (
                  <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <p className="font-medium text-rose-800">Unable to render PDF pages.</p>
                    <p className="mt-1">{pdfRenderError}</p>
                  </div>
                ) : !DocumentComponent || !PageComponent ? (
                  <p className="text-sm text-slate-300">Loading PDF renderer...</p>
                ) : (
                  <div className="space-y-4">
                    <DocumentComponent
                      file={document.pdf_url}
                      onLoadSuccess={() => setPdfRenderError(null)}
                      onLoadError={(error) => setPdfRenderError(normalizePdfRenderErrorMessage(error))}
                      onSourceError={(error) => setPdfRenderError(normalizePdfRenderErrorMessage(error))}
                    >
                      {readerMode === 'continuous' ? (
                        pages.map((page) => (
                          <article
                            key={page}
                            ref={(node) => setPageRef(page, node)}
                            data-testid={`pdf-page-${page}`}
                            data-active={String(page === activePage)}
                            className={`overflow-hidden rounded-2xl border p-4 shadow-sm ${
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
                            <div className="overflow-auto rounded-xl bg-white text-slate-900">
                              <PageComponent pageNumber={page} scale={pageScale} width={pageWidth} />
                            </div>
                          </article>
                        ))
                      ) : (
                        <article
                          key={readerPage}
                          ref={(node) => setPageRef(readerPage, node)}
                          data-testid={`pdf-page-${readerPage}`}
                          data-active="true"
                          className="overflow-hidden rounded-2xl border border-sky-300 bg-white p-4 text-slate-900 shadow-sm"
                        >
                          <div className="mb-4 flex items-center justify-between">
                            <p className="text-sm font-semibold">Page {readerPage}</p>
                            <p className="text-xs uppercase tracking-wide text-slate-500">Focused</p>
                          </div>
                          <div className="overflow-auto rounded-xl bg-white">
                            <PageComponent pageNumber={readerPage} scale={pageScale} width={pageWidth} />
                          </div>
                        </article>
                      )}
                    </DocumentComponent>
                  </div>
                )}
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

function useViewportWidth(ref: RefObject<HTMLDivElement>, dependency?: string) {
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const updateWidth = () => {
      setViewportWidth(node.getBoundingClientRect().width);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, [ref, dependency]);

  return viewportWidth;
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

function useManualPdfPageNavigation(document: ManualDocumentView | null, readerMode: ManualPdfReaderMode) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefRegistryRef = useRef<ReturnType<typeof createPageRefRegistry> | null>(null);
  const hasAlignedInitialPageRef = useRef(false);
  const previousReaderModeRef = useRef<ManualPdfReaderMode>(readerMode);
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
      hasAlignedInitialPageRef.current = false;
      return;
    }

    const nextPage = clampPage(document.initial_page, document.page_count);
    setActivePage(nextPage);
    setFocusedPage(nextPage);
    hasAlignedInitialPageRef.current = false;
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
      setFocusedPage(mostVisiblePage);
    }
  }, [pages, readerMode]);

  useEffect(() => {
    syncVisiblePageFromViewport();
  }, [syncVisiblePageFromViewport]);

  useEffect(() => {
    if (!document || readerMode !== 'continuous' || hasAlignedInitialPageRef.current) {
      return;
    }

    const initialPage = clampPage(document.initial_page, document.page_count);
    if (initialPage <= 1) {
      hasAlignedInitialPageRef.current = true;
      return;
    }

    const initialPageNode = pageRefRegistry.pageRefs.get(initialPage);
    if (!initialPageNode || typeof initialPageNode.scrollIntoView !== 'function') {
      return;
    }

    hasAlignedInitialPageRef.current = true;
    initialPageNode.scrollIntoView({ behavior: 'auto', block: 'start' });
    setActivePage(initialPage);
  }, [document, pageRefRegistry, readerMode]);

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

  useEffect(() => {
    if (!document) {
      previousReaderModeRef.current = readerMode;
      return;
    }

    if (previousReaderModeRef.current === readerMode) {
      return;
    }

    if (readerMode === 'single') {
      setFocusedPage(activePage);
    } else {
      setActivePage(focusedPage);
      pageRefRegistry.pageRefs.get(focusedPage)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }

    previousReaderModeRef.current = readerMode;
  }, [activePage, document, focusedPage, pageRefRegistry, readerMode]);

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
        setAnnotationsError(error instanceof Error && error.message.trim() ? error.message : 'Unable to load annotations.');
      }
    };

    void loadAnnotations();

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
  const isDesktop = useIsDesktopWorkspace();
  const [leftRailWidth, setLeftRailWidth] = useState(EXPANDED_RAIL_WIDTH);
  const [rightRailWidth, setRightRailWidth] = useState(EXPANDED_RAIL_WIDTH);
  const previousLeftCollapsed = useRef(isLeftCollapsed);
  const previousRightCollapsed = useRef(isRightCollapsed);
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
  useEffect(() => {
    if (previousLeftCollapsed.current && !isLeftCollapsed) {
      setLeftRailWidth(EXPANDED_RAIL_WIDTH);
    }

    previousLeftCollapsed.current = isLeftCollapsed;
  }, [isLeftCollapsed]);
  useEffect(() => {
    if (previousRightCollapsed.current && !isRightCollapsed) {
      setRightRailWidth(EXPANDED_RAIL_WIDTH);
    }

    previousRightCollapsed.current = isRightCollapsed;
  }, [isRightCollapsed]);
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
  const adjustRailWidth = useCallback((side: RailSide, delta: number) => {
    if (side === 'left') {
      setLeftRailWidth((width) => clampRailWidth(width + delta));
      return;
    }

    setRightRailWidth((width) => clampRailWidth(width - delta));
  }, []);
  const handleRailResizeStart = useCallback(
    (side: RailSide, clientX: number) => {
      const startWidth = side === 'left' ? leftRailWidth : rightRailWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - clientX;
        if (side === 'left') {
          setLeftRailWidth(clampRailWidth(startWidth + delta));
        } else {
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
    [leftRailWidth, rightRailWidth],
  );

  return (
    <div
      data-testid="pdf-workspace-root"
      data-left-collapsed={String(isLeftCollapsed)}
      data-right-collapsed={String(isRightCollapsed)}
      className="mt-6 flex min-h-[calc(100vh-13rem)] flex-col gap-4 xl:flex-row"
    >
      <WorkspaceRailShell
        isDesktop={isDesktop}
        collapsed={isLeftCollapsed}
        side="left"
        title="Outline"
        railLabel="Document rail"
        actionLabel={isLeftCollapsed ? 'Expand left panel' : 'Collapse left panel'}
        width={leftRailWidth}
        onToggle={onToggleLeft}
        onResizeStart={handleRailResizeStart}
        onResizeStep={adjustRailWidth}
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
                <dt className="font-medium text-slate-900">Title</dt>
                <dd>{document.title}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Subtitle</dt>
                <dd>{document.subtitle}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Document id</dt>
                <dd>{document.document_id}</dd>
              </div>
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
