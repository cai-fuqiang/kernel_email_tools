/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import ManualPdfPage from '../ManualPdfPage';
import ManualSearchPage, { buildDocumentSearchHits, flattenTocPages } from '../ManualSearchPage';
import { getManualDocumentView, searchManuals } from '../../api/client';

vi.mock('../../api/client', () => ({
  searchManuals: vi.fn(),
  getManualDocumentView: vi.fn(),
}));

vi.mock('../../components/Toast', () => ({
  showToast: vi.fn(),
}));

const searchManualsMock = vi.mocked(searchManuals);
const getManualDocumentViewMock = vi.mocked(getManualDocumentView);

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function renderRoute(initialEntry: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/manual/search" element={<ManualSearchPage />} />
          <Route path="/manual/pdf/:documentId" element={<ManualPdfPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });

  return { container, root };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((node) =>
    node.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
  if (!button) {
    throw new Error(`Missing button with text: ${text}`);
  }
  return button;
}

async function waitFor(assertion: () => void, timeoutMs = 1000) {
  const startedAt = Date.now();
  // Poll briefly so the test waits for the rendered route change instead of a single microtask.
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

describe('ManualSearchPage reader helpers', () => {
  it('builds document-local search hits across pages', () => {
    const hits = buildDocumentSearchHits(
      [
        { page: 1, text: 'DMA remapping hardware supports queued invalidation.' },
        { page: 2, text: 'Second page mentions DMA remapping again for context.' },
      ],
      'dma',
    );

    expect(hits).toHaveLength(2);
    expect(hits[0].page).toBe(1);
    expect(hits[1].page).toBe(2);
  });

  it('flattens TOC nodes into page navigation order', () => {
    const pages = flattenTocPages([
      {
        id: 'vol-1',
        label: 'Vol 1',
        page: 1,
        children: [
          {
            id: 'chap-6',
            label: 'Chapter 6',
            page: 176,
            children: [
              { id: 'sec-6.1', label: 'DMA', page: 177, children: [] },
            ],
          },
        ],
      },
    ]);

    expect(pages).toEqual([1, 176, 177]);
  });

  it('opens the dedicated PDF workspace route from manual search hits', async () => {
    searchManualsMock.mockResolvedValue({
      query: 'dma',
      mode: 'hybrid',
      total: 1,
      hits: [
        {
          chunk_id: 'chunk-1',
          document_id: 'doc-123',
          manual_type: 'intel_sdm',
          manual_version: 'vol-1',
          volume: 'Volume 1',
          chapter: '3',
          section: '2.1',
          section_title: 'DMA remapping',
          content_type: 'text',
          content: 'DMA remapping content',
          page_start: 10,
          page_end: 12,
          score: 0.991,
          snippet: 'DMA remapping content',
          target_type: 'document_pdf',
          target_ref: 'doc-123',
          target_label: 'Intel SDM',
          target_subtitle: 'Volume 1 | pages 10-12',
        },
      ],
    });
    getManualDocumentViewMock.mockResolvedValue({
      document_id: 'doc-123',
      manual_type: 'intel_sdm',
      manual_version: 'vol-1',
      title: 'Intel SDM',
      subtitle: 'Volume 1 | pages 10-12',
      page_count: 3,
      initial_page: 1,
      pdf_url: '/manual/doc-123.pdf',
      toc: [],
    });

    const { container } = renderRoute('/manual/search');
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();

    await act(async () => {
      setInputValue(input, 'dma');
    });

    await act(async () => {
      findButton(container, 'Search').click();
    });

    await waitFor(() => {
      expect(findButton(container, 'Open PDF workspace')).toBeTruthy();
    });

    await act(async () => {
      findButton(container, 'Open PDF workspace').click();
    });

    await waitFor(() => {
      expect(container.textContent).toContain('PDF Workspace');
      expect(container.textContent).toContain('Open PDF document');
      expect(container.textContent).toContain('doc-123');
      expect(container.textContent).not.toContain('Search Chip Manuals');
    });
  });
});
