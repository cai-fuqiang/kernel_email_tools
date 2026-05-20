/** @vitest-environment jsdom */
import { type ReactNode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import App from '../../App';
import ManualPdfPage from '../ManualPdfPage';

vi.mock('../../auth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock('../../layouts/MainLayout', () => ({
  default: () => <div data-testid="main-layout"><Outlet /></div>,
}));

afterEach(() => {
  document.body.innerHTML = '';
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
          <Route path="/manual/pdf/:documentId" element={<ManualPdfPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });

  return { container, root };
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
  it('renders the dedicated PDF workspace for the standalone route', () => {
    const { container } = renderRoute('/manual/pdf/doc-777');

    expect(container.textContent).toContain('PDF Workspace');
    expect(container.textContent).toContain('Open PDF document');
    expect(container.textContent).toContain('doc-777');
    expect(container.textContent).not.toContain('Search Chip Manuals');
  });

  it('renders the dedicated PDF workspace through the real App route table and basename', async () => {
    window.history.replaceState({}, '', '/app/manual/pdf/doc-888');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

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
