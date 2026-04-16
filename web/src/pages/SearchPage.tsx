import { useState } from 'react';
import { searchEmails } from '../api/client';
import type { SearchResponse, SearchHit } from '../api/types';
import ThreadDrawer from '../components/ThreadDrawer';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('hybrid');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const handleSearch = async (p = 1) => {
    if (!query.trim()) return;
    setLoading(true); setError(''); setPage(p);
    try {
      const data = await searchEmails(query, { mode, page: p, page_size: 20 });
      setResult(data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  const totalPages = result ? Math.ceil(result.total / result.page_size) : 0;
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Search Emails</h2>
        <p className="text-sm text-gray-500">Full-text search across kernel mailing list archives</p>
      </div>
      <div className="flex gap-3 mb-6">
        <div className="flex-1 relative">
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search emails... e.g. shmem mount"
            className="w-full px-4 py-3 pl-11 bg-white border border-gray-300 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm" />
          <svg className="absolute left-3.5 top-3.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
        <select value={mode} onChange={e => setMode(e.target.value)} className="px-3 py-3 bg-white border border-gray-300 rounded-xl text-sm">
          <option value="hybrid">Hybrid</option><option value="keyword">Keyword</option><option value="semantic">Semantic</option>
        </select>
        <button onClick={() => handleSearch()} disabled={loading}
          className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm">
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      {result && <div>
        <p className="text-sm text-gray-500 mb-4">Found <span className="font-semibold text-gray-900">{result.total}</span> results <span className="ml-2 px-2 py-0.5 bg-gray-100 rounded-full text-xs">{result.mode}</span></p>
        <div className="space-y-3">{result.hits.map(hit => <ResultCard key={hit.message_id} hit={hit} onThread={() => setSelectedThread(hit.thread_id)} />)}</div>
        {totalPages > 1 && <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => handleSearch(page-1)} disabled={page<=1} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-50">Prev</button>
          <span className="text-sm text-gray-600">Page {page}/{totalPages}</span>
          <button onClick={() => handleSearch(page+1)} disabled={page>=totalPages} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-50">Next</button>
        </div>}
      </div>}
      {!result && !loading && <div className="text-center py-20 text-gray-400"><p>Enter a query to search kernel mailing list emails</p></div>}
      {selectedThread && <ThreadDrawer threadId={selectedThread} onClose={() => setSelectedThread(null)} />}
    </div>
  );
}
function ResultCard({ hit, onThread }: { hit: SearchHit; onThread: () => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{hit.subject}</h3>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
            <span className="font-medium text-gray-700">{hit.sender.split('<')[0].trim()}</span>
            <span>{hit.date ? new Date(hit.date).toLocaleDateString() : ''}</span>
            {hit.has_patch && <span className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs font-medium">patch</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-600 rounded-full font-medium">{hit.score.toFixed(3)}</span>
          <button onClick={onThread} className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Thread</button>
        </div>
      </div>
      {hit.snippet && <p className="mt-3 text-xs text-gray-600 leading-relaxed line-clamp-2" dangerouslySetInnerHTML={{__html: hit.snippet.replace(/<<(.*?)>>/g, '<mark class="bg-yellow-100 px-0.5 rounded">$1</mark>')}} />}
    </div>
  );
}