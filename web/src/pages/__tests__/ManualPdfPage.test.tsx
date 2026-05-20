/** @vitest-environment jsdom */
import React, { type ReactNode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../App';
import { getManualDocumentView, listAnnotations } from '../../api/client';
import ManualPdfPage from '../ManualPdfPage';

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

vi.mock('@react-pdf-viewer/core', () => ({
  Worker: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Viewer: ({ fileUrl }: { fileUrl: string }) => (
    <div data-testid="pdf-viewer-stub" data-file-url={fileUrl} />
  ),
}));

vi.mock('@react-pdf-viewer/default-layout', () => ({
  defaultLayoutPlugin: () => ({}),
}));

vi.mock('@react-pdf-viewer/page-navigation', () => ({
  pageNavigationPlugin: () => ({
    jumpToPage: vi.fn(),
  }),
}));

vi.mock('@react-pdf-viewer/core/lib/styles/index.css', () => ({}));
vi.mock('@react-pdf-viewer/default-layout/lib/styles/index.css', () => ({}));

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
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width: 1280px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia;
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
  it('shows a distinct error state when document loading fails', async () => {
    getManualDocumentViewMock.mockRejectedValueOnce(new Error('backend exploded'));

    const { container } = await renderRoute('/manual/pdf/doc-error');

    await waitFor(() => {
      expect(container.textContent).toContain('Unable to load PDF workspace.');
      expect(container.textContent).toContain('backend exploded');
      expect(container.textContent).toContain('Document id: doc-error');
    });
  });

  it('tracks collapse state for the right sidebar', async () => {
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

    expect(root.getAttribute('data-right-collapsed')).toBe('false');

    await act(async () => {
      findButton(container, 'Collapse right panel').click();
    });

    expect(root.getAttribute('data-right-collapsed')).toBe('true');

    await act(async () => {
      findButton(container, 'Expand right panel').click();
    });

    expect(root.getAttribute('data-right-collapsed')).toBe('false');
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
      initial_page: 1,
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

    expect(container.textContent).toContain('Page 1 note');
    expect(container.textContent).not.toContain('Page 2 note');
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

  it('blocks region annotation mode and shows a warning message', async () => {
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
  });

  it('renders an annotation card that can be clicked', async () => {
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'doc-784',
      title: 'Intel SDM',
      subtitle: 'Volume 8',
      manual_type: 'intel_sdm',
      manual_version: 'vol-8',
      pdf_url: '/api/manual/doc-784.pdf',
      page_count: 2,
      initial_page: 1,
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
          anchor: { page: 1 },
        },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    });

    const { container } = await renderRoute('/manual/pdf/doc-784');

    await waitFor(() => {
      expect(container.textContent).toContain('Jump target');
    });

    // clicking the annotation card should not throw
    await act(async () => {
      findButton(container, 'Jump target').click();
    });

    expect(container.querySelector('[data-testid="annotation-list-panel"]')).toBeTruthy();
  });

  it('collapses the right rail into a slim handle', async () => {
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

    expect(rightRail.style.width).toBe('320px');

    await act(async () => {
      findButton(container, 'Collapse right panel').click();
    });

    expect(rightRail.style.width).toBe('48px');
    expect(findButton(container, 'Expand right panel')).toBeTruthy();
    expect(container.querySelector('[data-testid="right-rail-resize-handle"]')).toBeFalsy();
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
      dispatchPointerEvent(rightHandle, 'pointerdown', 0);
      dispatchPointerEvent(window, 'pointermove', -80);
      dispatchPointerEvent(window, 'pointerup', -80);
    });

    expect(rightRail.style.width).toBe('400px');
  });

  it('resets rail width to the default size when re-expanding', async () => {
    const { container } = await renderRoute('/manual/pdf/intel_sdm');

    await waitFor(() => {
      expect(container.querySelector('[data-testid="right-rail-shell"]')).toBeTruthy();
    });

    const rightRail = container.querySelector('[data-testid="right-rail-shell"]') as HTMLElement;
    const rightHandle = container.querySelector('[data-testid="right-rail-resize-handle"]') as HTMLElement;

    await act(async () => {
      dispatchPointerEvent(rightHandle, 'pointerdown', 0);
      dispatchPointerEvent(window, 'pointermove', -80);
      dispatchPointerEvent(window, 'pointerup', -80);
    });

    expect(rightRail.style.width).toBe('400px');

    await act(async () => {
      findButton(container, 'Collapse right panel').click();
    });

    expect(rightRail.style.width).toBe('48px');

    await act(async () => {
      findButton(container, 'Expand right panel').click();
    });

    expect(rightRail.style.width).toBe('320px');
  });

  it('hides desktop resize handles in the stacked mobile layout', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '(min-width: 1280px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    const { container } = await renderRoute('/manual/pdf/intel_sdm');

    await waitFor(() => {
      expect(container.querySelector('[data-testid="pdf-reader-pane"]')).toBeTruthy();
    });

    expect(container.querySelector('[data-testid="right-rail-resize-handle"]')).toBeFalsy();
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

function dispatchPointerEvent(target: EventTarget, type: string, clientX: number) {
  const event =
    typeof PointerEvent === 'function'
      ? new PointerEvent(type, { bubbles: true, clientX })
      : new MouseEvent(type, { bubbles: true, clientX });

  target.dispatchEvent(event);
}
