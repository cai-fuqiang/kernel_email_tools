import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { searchManuals } from '../api/client';
import type { ManualSearchResponse, ManualSearchHit } from '../api/types';
import { EmptyState, PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';
import { showToast } from '../components/Toast';

export default function ManualSearchPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ManualSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // 过滤选项
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

  return (
    <PageShell>
      <PageHeader
        eyebrow="Manuals"
        title="Search Chip Manuals"
        description="Full-text search across processor manuals such as Intel SDM, ARM ARM, and AMD APM."
      />

      {/* 搜索栏 */}
      <SectionPanel title="Find manual sections">
      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search manuals... e.g. MOV instruction encoding"
            className="w-full px-4 py-3 pl-11 bg-white border border-gray-300 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          />
          <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
        </div>
        <PrimaryButton
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? 'Searching...' : 'Search'}
        </PrimaryButton>
      </div>

      {/* 过滤选项 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Manual Type</label>
          <select
            value={manualType}
            onChange={(e) => setManualType(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Manuals</option>
            <option value="intel_sdm">Intel SDM</option>
            <option value="arm_arm">ARM ARM</option>
            <option value="amd_apm">AMD APM</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Content Type</label>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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
          title="Manual evidence"
          description="Review larger snippets before asking a follow-up question or using a section as supporting evidence."
          actions={
            <Link
              to="/manual/ask"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Ask Manuals
            </Link>
          }
        >
          <p className="mb-4 text-sm text-gray-500">
            Found <span className="font-semibold text-gray-900">{result.total}</span> results{' '}
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs">{result.mode}</span>
          </p>
          <div className="space-y-3">
            {result.hits.map((hit) => (
              <ManualResultCard key={hit.chunk_id} hit={hit} />
            ))}
          </div>
        </SectionPanel>
      )}

      {!result && !loading && (
        <EmptyState title="Search manuals" description="Enter an instruction, register, or architecture concept to find relevant manual sections." />
      )}
    </PageShell>
  );
}

function ManualResultCard({ hit }: { hit: ManualSearchHit }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full font-medium">
              {hit.manual_type}
            </span>
            <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
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
          <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-600 rounded-full font-medium">
            {hit.score.toFixed(3)}
          </span>
        </div>
      </div>
      {hit.snippet && (
        <p className="mt-4 whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-700">
          {hit.snippet}
        </p>
      )}
    </div>
  );
}
