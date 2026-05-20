import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import ManualPdfPage from '../ManualPdfPage';

describe('ManualPdfPage', () => {
  it('is available as the standalone manual PDF workspace route', () => {
    expect(ManualPdfPage).toBeDefined();

    const appSource = readFileSync(resolve(import.meta.dirname, '..', '..', 'App.tsx'), 'utf8');
    const pageSource = readFileSync(resolve(import.meta.dirname, '..', 'ManualPdfPage.tsx'), 'utf8');

    expect(appSource).toContain('path="/manual/pdf/:documentId"');
    expect(pageSource).toContain('eyebrow="PDF Workspace"');
    expect(pageSource).toContain('title="Open PDF document"');
    expect(pageSource).toContain('Read the source PDF in a dedicated workspace with navigation, zoom, and annotations.');
  });
});
