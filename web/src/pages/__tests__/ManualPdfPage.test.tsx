/** @vitest-environment jsdom */
import { type ReactNode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../App';
import { getManualDocumentView, listAnnotations } from '../../api/client';
import ManualPdfPage, { createPageRefRegistry, resolveMostVisiblePage } from '../ManualPdfPage';

vi.mock('../../auth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    getManualDocumentView: vi.fn(),
    listAnnotations: vi.fn(),
  };
});

vi.mock('../../layouts/MainLayout', () => ({
  default: () => <div data-testid="main-layout"><Outlet /></div>,
}));

vi.mock('react-pdf', () => ({
  Document: ({ children }: { children: ReactNode }) => <div data-testid="pdf-document">{children}</div>,
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`pdf-rendered-page-${pageNumber}`}>Audience text layer</div>
  ),
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: '',
    },
  },
}));

afterEach(() => {
  mountedRoots.forEach((root) => {
    act(() => {
      root.unmount();
    });
  });
  mountedRoots.length = 0;
  document.body.innerHTML = '';
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const getManualDocumentViewMock = vi.mocked(getManualDocumentView);
const listAnnotationsMock = vi.mocked(listAnnotations);
const mountedRoots: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  getManualDocumentViewMock.mockImplementation(async (documentId: string) => ({
    document_id: documentId,
    title: `Manual ${documentId}`,
    subtitle: `Subtitle for ${documentId}`,
    manual_type: 'intel_sdm',
    manual_version: 'vol-1',
    pdf_url: `/api/manual/${documentId}.pdf`,
    page_count: 1,
    initial_page: 1,
    toc: [],
    page_text: [],
  }));
  listAnnotationsMock.mockResolvedValue({
    annotations: [],
    total: 0,
    page: 1,
    page_size: 100,
  });
});

async function renderRoute(initialEntry: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = trackRoot(createRoot(container));

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/manual/pdf/:documentId" element={<ManualPdfPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await Promise.resolve();
  });

  return { container, root };
}

function trackRoot(root: ReturnType<typeof createRoot>) {
  mountedRoots.push(root);
  return root;
}

async function waitFor(assertion: () => void, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

describe('ManualPdfPage', () => {
  it('exports a resolver that picks the page with the largest visible ratio', () => {
    expect(
      resolveMostVisiblePage([
        { page: 3, visibleRatio: 0.25 },
        { page: 1, visibleRatio: 0.4 },
        { page: 2, visibleRatio: 0.6 },
      ]),
    ).toBe(2);
  });

  it('exports a page-ref registry helper that adds and removes page nodes', () => {
    const { pageRefs, setPageRef } = createPageRefRegistry();
    const pageNode = document.createElement('div');

    setPageRef(4, pageNode);
    expect(pageRefs.get(4)).toBe(pageNode);

    setPageRef(4, null);
    expect(pageRefs.has(4)).toBe(false);
  });

  it('shows a distinct error state when document loading fails', async () => {
    getManualDocumentViewMock.mockRejectedValueOnce(new Error('backend exploded'));

    const { container } = await renderRoute('/manual/pdf/doc-error');

    await waitFor(() => {
      expect(container.textContent).toContain('Unable to load PDF workspace.');
      expect(container.textContent).toContain('backend exploded');
      expect(container.textContent).toContain('Document id: doc-error');
    });
  });

  it('tracks collapse state for both sidebars and marks the reader as focus layout when both are collapsed', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'doc-777',
      title: 'Intel SDM',
      subtitle: 'Volume 1',
      manual_type: 'intel_sdm',
      manual_version: 'vol-1',
      pdf_url: '/api/manual/doc-777.pdf',
      page_count: 123,
      initial_page: 1,
      toc: [],
      page_text: [],
    });

    const { container } = await renderRoute('/manual/pdf/doc-777');

    await waitFor(() => {
      expect(container.querySelector('[data-testid="pdf-workspace-root"]')).toBeTruthy();
    });

    const root = container.querySelector('[data-testid="pdf-workspace-root"]') as HTMLElement;
    const readerPane = container.querySelector('[data-testid="pdf-reader-pane"]') as HTMLElement;

    expect(root.getAttribute('data-left-collapsed')).toBe('false');
    expect(root.getAttribute('data-right-collapsed')).toBe('false');
    expect(readerPane.getAttribute('data-focus-layout')).toBe('false');

    await act(async () => {
      findButton(container, 'Collapse left panel').click();
    });

    expect(root.getAttribute('data-left-collapsed')).toBe('true');
    expect(root.getAttribute('data-right-collapsed')).toBe('false');
    expect(readerPane.getAttribute('data-focus-layout')).toBe('false');

    await act(async () => {
      findButton(container, 'Collapse right panel').click();
    });

    expect(root.getAttribute('data-left-collapsed')).toBe('true');
    expect(root.getAttribute('data-right-collapsed')).toBe('true');
    expect(readerPane.getAttribute('data-focus-layout')).toBe('true');
  });

  it('changes zoom presets without resetting the reader mode', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'doc-778',
      title: 'Intel SDM',
      subtitle: 'Volume 2',
      manual_type: 'intel_sdm',
      manual_version: 'vol-2',
      pdf_url: '/api/manual/doc-778.pdf',
      page_count: 456,
      initial_page: 1,
      toc: [],
      page_text: [],
    });

    const { container } = await renderRoute('/manual/pdf/doc-778');

    await waitFor(() => {
      expect(container.querySelector('[data-testid="pdf-reader-pane"]')).toBeTruthy();
    });

    const readerPane = container.querySelector('[data-testid="pdf-reader-pane"]') as HTMLElement;

    expect(findButton(container, 'Continuous scroll').getAttribute('aria-pressed')).toBe('true');
    expect(findButton(container, 'Single-page focus').getAttribute('aria-pressed')).toBe('false');
    expect(findButton(container, 'Fit width').getAttribute('aria-pressed')).toBe('true');
    expect(readerPane.getAttribute('data-zoom')).toBe('1');

    await act(async () => {
      findButton(container, 'Single-page focus').click();
    });

    expect(findButton(container, 'Continuous scroll').getAttribute('aria-pressed')).toBe('false');
    expect(findButton(container, 'Single-page focus').getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      findButton(container, '125%').click();
    });

    expect(readerPane.getAttribute('data-zoom')).toBe('1.25');
    expect(findButton(container, 'Continuous scroll').getAttribute('aria-pressed')).toBe('false');
    expect(findButton(container, 'Single-page focus').getAttribute('aria-pressed')).toBe('true');
  });

  it('scrolls the target page smoothly when a TOC entry is clicked in continuous mode', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'doc-779',
      title: 'Intel SDM',
      subtitle: 'Volume 3',
      manual_type: 'intel_sdm',
      manual_version: 'vol-3',
      pdf_url: '/api/manual/doc-779.pdf',
      page_count: 3,
      initial_page: 1,
      toc: [
        { id: 'toc-1', label: 'Overview', page: 1, children: [] },
        { id: 'toc-2', label: 'Chapter 2', page: 2, children: [] },
      ],
      page_text: [],
    });

    const originalScrollIntoView = (HTMLElement.prototype as typeof HTMLElement.prototype & {
      scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
    }).scrollIntoView;
    const scrollIntoView = vi.fn();
    (HTMLElement.prototype as typeof HTMLElement.prototype & {
      scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
    }).scrollIntoView = scrollIntoView;

    try {
      const { container } = await renderRoute('/manual/pdf/doc-779');

      await waitFor(() => {
        expect(container.querySelector('[data-testid="pdf-reader-pane"]')).toBeTruthy();
      });

      await act(async () => {
        findButton(container, 'Chapter 2').click();
      });

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    } finally {
      if (originalScrollIntoView) {
        (HTMLElement.prototype as typeof HTMLElement.prototype & {
          scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
        }).scrollIntoView = originalScrollIntoView;
      } else {
        delete (HTMLElement.prototype as typeof HTMLElement.prototype & {
          scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
        }).scrollIntoView;
      }
    }
  });

  it('shows only annotations for the active page in the right rail', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'doc-780',
      title: 'Intel SDM',
      subtitle: 'Volume 4',
      manual_type: 'intel_sdm',
      manual_version: 'vol-4',
      pdf_url: '/api/manual/doc-780.pdf',
      page_count: 3,
      initial_page: 2,
      toc: [],
      page_text: [],
    });
    listAnnotationsMock.mockResolvedValue({
      annotations: [
        {
          annotation_id: 'ann-1',
          annotation_type: 'note',
          short_label: 'Page 1 note',
          author: 'Ada',
          visibility: 'public',
          publish_status: 'approved',
          body: 'Annotation on page 1',
          pinned: false,
          parent_annotation_id: '',
          created_at: '2026-05-20T00:00:00Z',
          updated_at: '2026-05-20T00:00:00Z',
          target_type: 'document_pdf',
          target_ref: 'doc-780',
          target_label: 'Intel SDM',
          target_subtitle: 'Volume 4',
          related_targets: [],
          anchor: { page: 1 },
        },
        {
          annotation_id: 'ann-2',
          annotation_type: 'note',
          short_label: 'Page 2 note',
          author: 'Bea',
          visibility: 'public',
          publish_status: 'approved',
          body: 'Annotation on page 2',
          pinned: false,
          parent_annotation_id: '',
          created_at: '2026-05-20T00:00:00Z',
          updated_at: '2026-05-20T00:00:00Z',
          target_type: 'document_pdf',
          target_ref: 'doc-780',
          target_label: 'Intel SDM',
          target_subtitle: 'Volume 4',
          related_targets: [],
          anchor: { page: 2 },
        },
      ],
      total: 2,
      page: 1,
      page_size: 100,
    });

    const { container } = await renderRoute('/manual/pdf/doc-780');

    await waitFor(() => {
      expect(container.querySelector('[data-testid="pdf-reader-pane"]')).toBeTruthy();
    });

    expect(container.textContent).toContain('Page 2 note');
    expect(container.textContent).not.toContain('Page 1 note');
  });

  it('fetches paginated annotations and surfaces load failures distinctly', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'doc-782',
      title: 'Intel SDM',
      subtitle: 'Volume 6',
      manual_type: 'intel_sdm',
      manual_version: 'vol-6',
      pdf_url: '/api/manual/doc-782.pdf',
      page_count: 3,
      initial_page: 1,
      toc: [],
      page_text: [],
    });
    listAnnotationsMock
      .mockResolvedValueOnce({
        annotations: [
          {
            annotation_id: 'ann-1',
            annotation_type: 'note',
            short_label: 'Page 1 note',
            author: 'Ada',
            visibility: 'public',
            publish_status: 'approved',
            body: 'Annotation on page 1',
            pinned: false,
            parent_annotation_id: '',
            created_at: '2026-05-20T00:00:00Z',
            updated_at: '2026-05-20T00:00:00Z',
            target_type: 'document_pdf',
            target_ref: 'doc-782',
            target_label: 'Intel SDM',
            target_subtitle: 'Volume 6',
            related_targets: [],
            anchor: { page: 1 },
          },
        ],
        total: 101,
        page: 1,
        page_size: 100,
      })
      .mockResolvedValueOnce({
        annotations: [
          {
            annotation_id: 'ann-2',
            annotation_type: 'note',
            short_label: 'Page 2 note',
            author: 'Bea',
            visibility: 'public',
            publish_status: 'approved',
            body: 'Annotation on page 2',
            pinned: false,
            parent_annotation_id: '',
            created_at: '2026-05-20T00:00:00Z',
            updated_at: '2026-05-20T00:00:00Z',
            target_type: 'document_pdf',
            target_ref: 'doc-782',
            target_label: 'Intel SDM',
            target_subtitle: 'Volume 6',
            related_targets: [],
            anchor: { page: 2 },
          },
        ],
        total: 101,
        page: 2,
        page_size: 100,
      });

    const { container } = await renderRoute('/manual/pdf/doc-782');

    await waitFor(() => {
      expect(listAnnotationsMock).toHaveBeenCalledTimes(2);
    });

    expect(listAnnotationsMock).toHaveBeenNthCalledWith(1, {
      target_type: 'document_pdf',
      target_ref: 'doc-782',
      page: 1,
      page_size: 100,
    });
    expect(listAnnotationsMock).toHaveBeenNthCalledWith(2, {
      target_type: 'document_pdf',
      target_ref: 'doc-782',
      page: 2,
      page_size: 100,
    });
    expect(container.textContent).toContain('Page 1 note');

    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'doc-783',
      title: 'Intel SDM',
      subtitle: 'Volume 7',
      manual_type: 'intel_sdm',
      manual_version: 'vol-7',
      pdf_url: '/api/manual/doc-783.pdf',
      page_count: 3,
      initial_page: 1,
      toc: [],
      page_text: [],
    });
    listAnnotationsMock
      .mockResolvedValueOnce({
        annotations: [
          {
            annotation_id: 'ann-3',
            annotation_type: 'note',
            short_label: 'Page 1 note',
            author: 'Ada',
            visibility: 'public',
            publish_status: 'approved',
            body: 'Annotation on page 1',
            pinned: false,
            parent_annotation_id: '',
            created_at: '2026-05-20T00:00:00Z',
            updated_at: '2026-05-20T00:00:00Z',
            target_type: 'document_pdf',
            target_ref: 'doc-783',
            target_label: 'Intel SDM',
            target_subtitle: 'Volume 7',
            related_targets: [],
            anchor: { page: 1 },
          },
        ],
        total: 101,
        page: 1,
        page_size: 100,
      })
      .mockRejectedValueOnce(new Error('annotation backend exploded'));

    const { container: errorContainer } = await renderRoute('/manual/pdf/doc-783');

    await waitFor(() => {
      expect(errorContainer.textContent).toContain('Unable to load annotations.');
      expect(errorContainer.textContent).toContain('annotation backend exploded');
    });
    expect(errorContainer.textContent).toContain('Page 1 note');
    expect(errorContainer.textContent).not.toContain('Page 2 note');
  });

  it('blocks region annotation mode in continuous scroll and allows it in single-page focus', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'doc-781',
      title: 'Intel SDM',
      subtitle: 'Volume 5',
      manual_type: 'intel_sdm',
      manual_version: 'vol-5',
      pdf_url: '/api/manual/doc-781.pdf',
      page_count: 2,
      initial_page: 1,
      toc: [],
      page_text: [],
    });

    const { container } = await renderRoute('/manual/pdf/doc-781');

    await waitFor(() => {
      expect(container.querySelector('[data-testid="pdf-reader-pane"]')).toBeTruthy();
    });

    await act(async () => {
      findButton(container, 'Region').click();
    });

    expect(container.textContent).toContain('Switch to single-page focus mode before drawing region annotations.');
    expect(findButton(container, 'Text').getAttribute('aria-pressed')).toBe('true');
    expect(findButton(container, 'Region').getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      findButton(container, 'Single-page focus').click();
    });

    await act(async () => {
      findButton(container, 'Region').click();
    });

    expect(container.textContent).not.toContain('Switch to single-page focus mode before drawing region annotations.');
    expect(findButton(container, 'Text').getAttribute('aria-pressed')).toBe('false');
    expect(findButton(container, 'Region').getAttribute('aria-pressed')).toBe('true');
  });

  it('jumps through the shared page navigation path when an annotation card is clicked', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'doc-784',
      title: 'Intel SDM',
      subtitle: 'Volume 8',
      manual_type: 'intel_sdm',
      manual_version: 'vol-8',
      pdf_url: '/api/manual/doc-784.pdf',
      page_count: 2,
      initial_page: 2,
      toc: [],
      page_text: [],
    });
    listAnnotationsMock.mockResolvedValue({
      annotations: [
        {
          annotation_id: 'ann-4',
          annotation_type: 'note',
          short_label: 'Jump target',
          author: 'Ada',
          visibility: 'public',
          publish_status: 'approved',
          body: 'Annotation used to test jump handling',
          pinned: false,
          parent_annotation_id: '',
          created_at: '2026-05-20T00:00:00Z',
          updated_at: '2026-05-20T00:00:00Z',
          target_type: 'document_pdf',
          target_ref: 'doc-784',
          target_label: 'Intel SDM',
          target_subtitle: 'Volume 8',
          related_targets: [],
          anchor: { page: 2 },
        },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    });

    const originalScrollIntoView = (HTMLElement.prototype as typeof HTMLElement.prototype & {
      scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
    }).scrollIntoView;
    const scrollIntoView = vi.fn();
    (HTMLElement.prototype as typeof HTMLElement.prototype & {
      scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
    }).scrollIntoView = scrollIntoView;

    try {
      const { container } = await renderRoute('/manual/pdf/doc-784');

      await waitFor(() => {
        expect(container.textContent).toContain('Jump target');
      });

      await act(async () => {
        findButton(container, 'Jump target').click();
      });

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    } finally {
      if (originalScrollIntoView) {
        (HTMLElement.prototype as typeof HTMLElement.prototype & {
          scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
        }).scrollIntoView = originalScrollIntoView;
      } else {
        delete (HTMLElement.prototype as typeof HTMLElement.prototype & {
          scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
        }).scrollIntoView;
      }
    }
  });

  it('renders real PDF pages and removes the placeholder reader copy', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'intel_sdm',
      title: 'Intel SDM',
      subtitle: 'Audience',
      manual_type: 'intel_sdm',
      manual_version: 'vol-1',
      pdf_url: '/api/manual/documents/intel_sdm:file',
      page_count: 172,
      initial_page: 110,
      toc: [],
      page_text: [],
    });

    const { container } = await renderRoute('/manual/pdf/intel_sdm');

    await waitFor(() => {
      expect(container.querySelector('[data-testid="pdf-document"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="pdf-rendered-page-110"]')).toBeTruthy();
      expect(container.textContent).toContain('Audience text layer');
    });

    expect(container.textContent).not.toContain('Center pane ready for PDF reading.');
    expect(container.textContent).not.toContain('Placeholder page canvas for continuous reading.');
  });

  it('collapses both rails into slim handles', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'intel_sdm',
      title: 'Intel SDM',
      subtitle: 'Audience',
      manual_type: 'intel_sdm',
      manual_version: 'vol-1',
      pdf_url: '/api/manual/documents/intel_sdm:file',
      page_count: 172,
      initial_page: 110,
      toc: [],
      page_text: [],
    });

    const { container } = await renderRoute('/manual/pdf/intel_sdm');

    await waitFor(() => {
      expect(container.querySelector('[data-testid="left-rail-shell"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="right-rail-shell"]')).toBeTruthy();
    });

    const leftRail = container.querySelector('[data-testid="left-rail-shell"]') as HTMLElement;
    const rightRail = container.querySelector('[data-testid="right-rail-shell"]') as HTMLElement;

    expect(leftRail.style.width).toBe('320px');
    expect(rightRail.style.width).toBe('320px');

    await act(async () => {
      findButton(container, 'Collapse left panel').click();
      findButton(container, 'Collapse right panel').click();
    });

    expect(leftRail.style.width).toBe('48px');
    expect(rightRail.style.width).toBe('48px');
    expect(findButton(container, 'Expand left panel')).toBeTruthy();
    expect(findButton(container, 'Expand right panel')).toBeTruthy();
    expect(container.querySelector('[data-testid="left-rail-resize-handle"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="right-rail-resize-handle"]')).toBeTruthy();
  });

  it('drags the right rail desktop handle from 320px to 400px', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'intel_sdm',
      title: 'Intel SDM',
      subtitle: 'Audience',
      manual_type: 'intel_sdm',
      manual_version: 'vol-1',
      pdf_url: '/api/manual/documents/intel_sdm:file',
      page_count: 172,
      initial_page: 110,
      toc: [],
      page_text: [],
    });

    const { container } = await renderRoute('/manual/pdf/intel_sdm');

    await waitFor(() => {
      expect(container.querySelector('[data-testid="right-rail-shell"]')).toBeTruthy();
    });

    const rightRail = container.querySelector('[data-testid="right-rail-shell"]') as HTMLElement;
    const rightHandle = container.querySelector('[data-testid="right-rail-resize-handle"]') as HTMLElement;

    expect(rightRail.style.width).toBe('320px');

    await act(async () => {
      rightHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: -80 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(rightRail.style.width).toBe('400px');
  });

  it('renders the dedicated PDF workspace for the standalone route', async () => {
    const { container } = await renderRoute('/manual/pdf/doc-777');

    await waitFor(() => {
      expect(container.textContent).toContain('PDF Workspace');
      expect(container.textContent).toContain('Open PDF document');
      expect(container.textContent).toContain('doc-777');
      expect(container.textContent).not.toContain('Search Chip Manuals');
    });
  });

  it('renders the dedicated PDF workspace through the real App route table and basename', async () => {
    window.history.replaceState({}, '', '/app/manual/pdf/doc-888');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = trackRoot(createRoot(container));

    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      expect(container.textContent).toContain('PDF Workspace');
      expect(container.textContent).toContain('Open PDF document');
      expect(container.textContent).toContain('doc-888');
      expect(container.textContent).not.toContain('Search Chip Manuals');
    });
  });
});

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((node) =>
    node.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
  if (!button) {
    throw new Error(`Missing button with text: ${text}`);
  }
  return button;
}
