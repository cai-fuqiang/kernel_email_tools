/** @vitest-environment jsdom */
import { type ReactNode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../App';
import { getManualDocumentView } from '../../api/client';
import ManualPdfPage, { resolveMostVisiblePage } from '../ManualPdfPage';

vi.mock('../../auth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    getManualDocumentView: vi.fn(),
  };
});

vi.mock('../../layouts/MainLayout', () => ({
  default: () => <div data-testid="main-layout"><Outlet /></div>,
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
const mountedRoots: Array<{ unmount: () => void }> = [];

beforeEach(() => {
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
  it('exports a resolver that picks the page with the largest visible area', () => {
    expect(
      resolveMostVisiblePage([
        { page: 3, visibleArea: 1200 },
        { page: 1, visibleArea: 4000 },
        { page: 2, visibleArea: 2200 },
      ]),
    ).toBe(1);
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

    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      const { container } = await renderRoute('/manual/pdf/doc-779');

      await waitFor(() => {
        expect(container.querySelector('[data-testid="pdf-reader-pane"]')).toBeTruthy();
      });

      await act(async () => {
        findButton(container, 'Chapter 2').click();
      });

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
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
