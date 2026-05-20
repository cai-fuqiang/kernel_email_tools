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

  it('disabled card has aria-disabled for has_pdf=false', async () => {
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
