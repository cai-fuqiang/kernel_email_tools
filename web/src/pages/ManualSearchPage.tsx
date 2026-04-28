import { useState } from 'react';
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
    } catch (e: any) {
      showToast(e.message || 'Search failed', 'error');
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
        <div>
          <p className="text-sm text-gray-500 mb-4">
            Found <span className="font-semibold text-gray-900">{result.total}</span> results{' '}
            <span className="ml-2 px-2 py-0.5 bg-gray-100 rounded-full text-xs">{result.mode}</span>
          </p>
          <div className="space-y-3">
            {result.hits.map((hit) => (
              <ManualResultCard key={hit.chunk_id} hit={hit} />
            ))}
          </div>
        </div>
      )}

      {!result && !loading && (
        <EmptyState title="Search manuals" description="Enter an instruction, register, or architecture concept to find relevant manual sections." />
      )}
    </PageShell>
  );
}

function ManualResultCard({ hit }: { hit: ManualSearchHit }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
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
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
            <span>{hit.volume}</span>
            <span>Section {hit.section}</span>
            <span>Pages {hit.page_start}-{hit.page_end}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-600 rounded-full font-medium">
            {hit.score.toFixed(3)}
          </span>
        </div>
      </div>
      {hit.snippet && (
        <p className="mt-3 text-xs text-gray-600 leading-relaxed line-clamp-3">
          {hit.snippet}
        </p>
      )}
    </div>
  );
}
