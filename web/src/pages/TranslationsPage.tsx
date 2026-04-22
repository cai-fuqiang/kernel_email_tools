import { useState, useEffect, useCallback, useRef } from 'react';
import { getTranslatedThreads, type TranslatedThreadInfo } from '../api/client';
import ThreadDrawer from '../components/ThreadDrawer';

export default function TranslationsPage() {
  const [threads, setThreads] = useState<TranslatedThreadInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchThreads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const resp = await getTranslatedThreads();
      setThreads(resp.threads);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Failed to load translated threads');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  // 自动轮询（每 5 秒静默刷新）
  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => fetchThreads(true), 5000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, fetchThreads]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const formatSender = (sender: string) => {
    const match = sender.match(/^(.+?)\s*</);
    return match ? match[1].trim() : sender.split('@')[0];
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Translations</h2>
          <p className="text-sm text-gray-500">
            View and manage cached email thread translations. Tags from associated emails are shown.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Auto-refresh
          </label>
          <button
            onClick={() => fetchThreads()}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && threads.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="animate-spin inline-block w-6 h-6 border-2 border-gray-300 border-t-indigo-600 rounded-full mb-3" />
          <p>Loading translated threads...</p>
        </div>
      ) : threads.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">No translated threads yet</p>
          <p className="text-sm">Translate emails from the Search page by opening a thread and clicking the translate button.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Subject</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Sender</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tags</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cached</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {threads.map((t) => (
                <tr key={t.thread_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="text-sm font-medium text-gray-900 truncate max-w-xs" title={t.subject}>
                      {t.subject || '(no subject)'}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {t.email_count} email{t.email_count > 1 ? 's' : ''} in thread
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-gray-700">{formatSender(t.sender)}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-gray-500">{formatDate(t.date)}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {t.tags.length > 0 ? (
                        t.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                      {t.cached_paragraphs} para{t.cached_paragraphs > 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <button
                      onClick={() => setSelectedThread(t.thread_id)}
                      className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
            {threads.length} translated thread{threads.length > 1 ? 's' : ''}
          </div>
        </div>
      )}

      {selectedThread && (
        <ThreadDrawer threadId={selectedThread} onClose={() => setSelectedThread(null)} />
      )}
    </div>
  );
}