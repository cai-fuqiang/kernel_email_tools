import { useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { searchManuals } from '../api/client';
import type {
  ManualDocumentPageText,
  ManualDocumentTocNode,
  ManualSearchHit,
  ManualSearchResponse,
} from '../api/types';
import { EmptyState, PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';
import { showToast } from '../components/Toast';

type DocumentSearchHit = {
  id: string;
  page: number;
  preview: string;
  matchIndex: number;
  start: number;
  end: number;
};

function buildTargetSubtitle(hit: ManualSearchHit): string {
  return hit.target_subtitle || [
    hit.manual_type,
    hit.manual_version,
    hit.volume,
    `pages ${hit.page_start}-${hit.page_end}`,
  ].filter(Boolean).join(' | ');
}

export function buildDocumentSearchHits(
  pageText: ManualDocumentPageText[],
  query: string,
): DocumentSearchHit[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const hits: DocumentSearchHit[] = [];
  for (const page of pageText) {
    const haystack = page.text || '';
    const lower = haystack.toLowerCase();
    let start = 0;
    let matchIndex = 0;
    while (start < lower.length) {
      const foundAt = lower.indexOf(normalizedQuery, start);
      if (foundAt < 0) break;
      const end = foundAt + normalizedQuery.length;
      const previewStart = Math.max(0, foundAt - 50);
      const previewEnd = Math.min(haystack.length, end + 80);
      hits.push({
        id: `${page.page}:${foundAt}`,
        page: page.page,
        preview: haystack.slice(previewStart, previewEnd).trim(),
        matchIndex,
        start: foundAt,
        end,
      });
      start = end;
      matchIndex += 1;
    }
  }
  return hits;
}

export function flattenTocPages(toc: ManualDocumentTocNode[]): number[] {
  const pages: number[] = [];
  const visit = (nodes: ManualDocumentTocNode[]) => {
    for (const node of nodes) {
      pages.push(node.page);
      visit(node.children);
    }
  };
  visit(toc);
  return pages;
}

export default function ManualSearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ManualSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualType, setManualType] = useState('');
  const [contentType, setContentType] = useState('');

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await searchManuals(query, {
        manual_type: manualType || undefined,
        content_type: contentType || undefined,
        page: 1,
        page_size: 20,
      });
      setResult(data);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Search failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openReader = (hit: ManualSearchHit) => {
    navigate(`/manual/pdf/${encodeURIComponent(hit.document_id)}`);
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Manuals"
        title="Search Chip Manuals"
        description="Search imported manuals and papers, then open a dedicated PDF workspace."
      />

      <SectionPanel title="Find manual sections">
        <div className="mb-4 flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
              placeholder="Search manuals... e.g. MOV instruction encoding"
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 pl-11 text-sm shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            />
            <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-600" />
          </div>
          <PrimaryButton onClick={handleSearch} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </PrimaryButton>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Manual Type</label>
            <select
              value={manualType}
              onChange={(event) => setManualType(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Manuals</option>
              <option value="intel_sdm">Intel SDM</option>
              <option value="arm_arm">ARM ARM</option>
              <option value="amd_apm">AMD APM</option>
              <option value="paper">Paper</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Content Type</label>
            <select
              value={contentType}
              onChange={(event) => setContentType(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Types</option>
              <option value="text">Text</option>
              <option value="instruction">Instruction</option>
              <option value="register">Register</option>
              <option value="table">Table</option>
              <option value="pseudocode">Pseudocode</option>
            </select>
          </div>
        </div>
      </SectionPanel>

      {result && (
        <SectionPanel
          title="Document evidence"
          description="Open a search hit into the PDF workspace, then navigate with TOC and annotate the source document directly."
        >
          <p className="mb-4 text-sm text-gray-500">
            Found <span className="font-semibold text-gray-900">{result.total}</span> results{' '}
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs">{result.mode}</span>
          </p>
          <div className="space-y-3">
            {result.hits.map((hit) => (
              <div key={hit.chunk_id} className="rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                        {hit.manual_type}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                        {hit.content_type}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      {hit.section_title || hit.section}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{hit.volume}</span>
                      {hit.manual_version && <span className="rounded bg-gray-50 px-1.5 py-0.5">{hit.manual_version}</span>}
                      {hit.chapter && <span className="rounded bg-gray-50 px-1.5 py-0.5">Chapter {hit.chapter}</span>}
                      <span className="rounded bg-gray-50 px-1.5 py-0.5">Section {hit.section}</span>
                      <span className="rounded bg-gray-50 px-1.5 py-0.5">Pages {hit.page_start}-{hit.page_end}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600">
                      {hit.score.toFixed(3)}
                    </span>
                  </div>
                </div>
                {hit.snippet && (
                  <p className="mt-4 whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-700">
                    {hit.snippet}
                  </p>
                )}
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-500">{buildTargetSubtitle(hit)}</p>
                  <button
                    type="button"
                    onClick={() => openReader(hit)}
                    className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
                  >
                    <FileText className="h-4 w-4" />
                    Open PDF workspace
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SectionPanel>
      )}

      {!result && !loading && (
        <EmptyState
          title="Search manuals"
          description="Enter an instruction, register, architecture concept, or paper topic to find imported PDF content."
        />
      )}
    </PageShell>
  );
}
