import { useState } from 'react';
import { searchManuals } from '../api/client';
import type { ManualSearchResponse, ManualSearchHit } from '../api/types';

export default function ManualSearchPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ManualSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 过滤选项
  const [manualType, setManualType] = useState('');
  const [contentType, setContentType] = useState('');

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await searchManuals(query, {
        manual_type: manualType || undefined,
        content_type: contentType || undefined,
        page: 1,
        page_size: 20,
      });
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Search Chip Manuals</h2>
        <p className="text-sm text-gray-500">Full-text search across processor manuals (Intel SDM, ARM, AMD)</p>
      </div>

      {/* 搜索栏 */}
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
          <svg
            className="absolute left-3.5 top-3.5 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
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

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

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
        <div className="text-center py-20 text-gray-400">
          <p>Enter a query to search chip manuals</p>
        </div>
      )}
    </div>
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