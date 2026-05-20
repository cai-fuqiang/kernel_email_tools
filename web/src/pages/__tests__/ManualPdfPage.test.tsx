/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import ManualPdfPage from '../ManualPdfPage';

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

describe('ManualPdfPage', () => {
  it('renders the dedicated PDF workspace for the standalone route', () => {
    const { container } = renderRoute('/manual/pdf/doc-777');

    expect(container.textContent).toContain('PDF Workspace');
    expect(container.textContent).toContain('Open PDF document');
    expect(container.textContent).toContain('doc-777');
    expect(container.textContent).not.toContain('Search Chip Manuals');
  });
});
