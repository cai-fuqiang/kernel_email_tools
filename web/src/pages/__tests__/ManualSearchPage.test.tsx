import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: '',
    },
  },
}));

import { buildDocumentSearchHits, flattenTocPages } from '../ManualSearchPage';

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

  it('opens the dedicated PDF workspace route from manual search hits', () => {
    const filePath = resolve(import.meta.dirname, '..', 'ManualSearchPage.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain('/manual/pdf/${encodeURIComponent(hit.document_id)}');
    expect(source).toContain('Open PDF workspace');
  });
});
