import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { listAnnotations } from '../api/client';
import type { AnnotationListItem } from '../api/types';
import ThreadDrawer from '../components/ThreadDrawer';

export default function AnnotationsPage() {
  const [annotations, setAnnotations] = useState<AnnotationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ThreadDrawer state
  const [drawerThreadId, setDrawerThreadId] = useState<string | null>(null);

  const fetchAnnotations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listAnnotations({
        q: query || undefined,
        page,
        page_size: pageSize,
      });
      setAnnotations(res.annotations);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load annotations');
    } finally {
      setLoading(false);
    }
  }, [query, page, pageSize]);

  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  const handleSearch = () => {
    setPage(1);
    setQuery(searchInput.trim());
  };

  const handleClear = () => {
    setSearchInput('');
    setPage(1);
    setQuery('');
  };

  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getAuthorInitial = (author: string) => {
    return author ? author.charAt(0).toUpperCase() : '?';
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Annotations</h1>
        <p className="text-sm text-gray-500">
          Browse and search all your annotations across email threads
        </p>
      </div>

      {/* Search bar */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search annotations..."
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none"
        />
        <button
          onClick={handleSearch}
          className="px-4 py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Search
        </button>
        {query && (
          <button
            onClick={handleClear}
            className="px-4 py-2.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 mb-4 text-sm text-gray-500">
        <span>
          {total} annotation{total !== 1 ? 's' : ''}{' '}
          {query && <span>matching "{query}"</span>}
        </span>
        {totalPages > 1 && (
          <span>
            Page {page} of {totalPages}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-indigo-400 border-t-transparent rounded-full" />
          <span className="ml-3 text-gray-500">Loading...</span>
        </div>
      )}

      {/* Annotation cards */}
      {!loading && annotations.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          {query ? 'No annotations match your search' : 'No annotations yet'}
        </div>
      )}

      {!loading && annotations.length > 0 && (
        <div className="space-y-3">
          {annotations.map((ann) => (
            <div
              key={ann.annotation_id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors cursor-pointer"
              onClick={() => setDrawerThreadId(ann.thread_id)}
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{
                    backgroundColor: `hsl(${ann.author.charCodeAt(0) * 15 % 360}, 65%, 50%)`,
                  }}
                >
                  {getAuthorInitial(ann.author)}
                </div>
                <span className="font-medium text-gray-900 text-sm">{ann.author}</span>
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium">
                  Annotation
                </span>
                <span className="text-xs text-gray-400 ml-auto">{formatDate(ann.created_at)}</span>
              </div>

              {/* Related email info */}
              {(ann.email_subject || ann.email_sender) && (
                <div className="mb-2 text-xs text-gray-500 bg-gray-50 px-3 py-1.5 rounded">
                  {ann.email_subject && (
                    <span className="font-medium text-gray-600">{ann.email_subject}</span>
                  )}
                  {ann.email_sender && (
                    <span className="ml-2 text-gray-400">— {ann.email_sender}</span>
                  )}
                </div>
              )}

              {/* Body (Markdown) */}
              <div className="annotation-markdown text-sm text-gray-700 leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {ann.body.length > 500 ? ann.body.slice(0, 500) + '...' : ann.body}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-40 hover:bg-gray-100"
          >
            Previous
          </button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 7) {
              pageNum = i + 1;
            } else if (page <= 4) {
              pageNum = i + 1;
            } else if (page >= totalPages - 3) {
              pageNum = totalPages - 6 + i;
            } else {
              pageNum = page - 3 + i;
            }
            return (
              <button
                key={pageNum}
                onClick={() => setPage(pageNum)}
                className={`px-3 py-1.5 rounded text-sm ${
                  page === pageNum
                    ? 'bg-indigo-600 text-white'
                    : 'border border-gray-300 hover:bg-gray-100'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-40 hover:bg-gray-100"
          >
            Next
          </button>
        </div>
      )}

      {/* Thread Drawer */}
      {drawerThreadId && (
        <ThreadDrawer
          threadId={drawerThreadId}
          onClose={() => setDrawerThreadId(null)}
        />
      )}
    </div>
  );
}