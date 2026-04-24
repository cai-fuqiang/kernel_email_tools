import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getTranslatedThreads,
  listTranslationJobs,
  type TranslatedThreadInfo,
  type TranslationJobResponse,
} from '../api/client';
import ThreadDrawer from '../components/ThreadDrawer';

function mergeTranslatedThreads(
  previous: TranslatedThreadInfo[],
  incoming: TranslatedThreadInfo[],
): TranslatedThreadInfo[] {
  const merged = new Map<string, TranslatedThreadInfo>();
  previous.forEach((thread) => merged.set(thread.thread_id, thread));
  incoming.forEach((thread) => merged.set(thread.thread_id, thread));
  return Array.from(merged.values()).sort((a, b) =>
    (b.last_translated_at || '').localeCompare(a.last_translated_at || ''),
  );
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatSender(sender: string) {
  const match = sender.match(/^(.+?)\s*</);
  return match ? match[1].trim() : sender.split('@')[0];
}

function JobProgressCard({
  job,
  onOpen,
}: {
  job: TranslationJobResponse;
  onOpen: (threadId: string) => void;
}) {
  const progress = job.total > 0 ? Math.min(100, Math.round((job.completed / job.total) * 100)) : 0;

  return (
    <div className="bg-white border border-blue-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate" title={job.subject || job.thread_id}>
            {job.subject || job.thread_id}
          </div>
          <div className="mt-1 text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
            <span>{job.email_count} email{job.email_count > 1 ? 's' : ''}</span>
            <span>{formatSender(job.sender || job.thread_id)}</span>
            <span>{formatDate(job.date)}</span>
          </div>
        </div>
        <button
          onClick={() => onOpen(job.thread_id)}
          className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
        >
          Open
        </button>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-gray-600 mb-1.5">
          <span>
            {job.status === 'pending' ? '等待开始' : '翻译中'} {job.completed}/{job.total || 0}
            {job.cached_count > 0 ? `，缓存命中 ${job.cached_count}` : ''}
            {job.failed_count > 0 ? `，失败 ${job.failed_count}` : ''}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-blue-50 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function TranslationsPage() {
  const [threads, setThreads] = useState<TranslatedThreadInfo[]>([]);
  const [activeJobs, setActiveJobs] = useState<TranslationJobResponse[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [error, setError] = useState('');
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const threadsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchThreads = useCallback(async (silent = false) => {
    if (!silent) setLoadingThreads(true);
    try {
      const resp = await getTranslatedThreads();
      setThreads((prev) => {
        if (silent) {
          if (resp.threads.length === 0 && prev.length > 0) {
            return prev;
          }
          return mergeTranslatedThreads(prev, resp.threads);
        }
        return resp.threads;
      });
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Failed to load translated threads');
    } finally {
      if (!silent) setLoadingThreads(false);
    }
  }, []);

  const fetchJobs = useCallback(async (silent = false) => {
    if (!silent) setLoadingJobs(true);
    try {
      const resp = await listTranslationJobs('active');
      setActiveJobs(resp.jobs);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Failed to load translation jobs');
    } finally {
      if (!silent) setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    setError('');
    fetchJobs();
    fetchThreads();
  }, [fetchJobs, fetchThreads]);

  useEffect(() => {
    if (!autoRefresh) return undefined;

    jobsTimerRef.current = setInterval(() => {
      fetchJobs(true);
    }, 1000);

    threadsTimerRef.current = setInterval(() => {
      fetchThreads(true);
    }, 5000);

    return () => {
      if (jobsTimerRef.current) clearInterval(jobsTimerRef.current);
      if (threadsTimerRef.current) clearInterval(threadsTimerRef.current);
    };
  }, [autoRefresh, fetchJobs, fetchThreads]);

  const handleRefresh = useCallback(() => {
    setError('');
    fetchJobs();
    fetchThreads();
  }, [fetchJobs, fetchThreads]);

  const completedThreads = threads.filter(
    (thread) => !activeJobs.some((job) => job.thread_id === thread.thread_id),
  );

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Translations</h2>
          <p className="text-sm text-gray-500">
            翻译中的线程会实时展示进度，已完成线程单独归档展示。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Auto-refresh
          </label>
          <button
            onClick={handleRefresh}
            disabled={loadingThreads || loadingJobs}
            className="px-4 py-2 text-sm font-medium bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {loadingThreads || loadingJobs ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900">Translating Now</h3>
          <span className="text-xs text-gray-500">
            {activeJobs.length} running job{activeJobs.length > 1 ? 's' : ''}
          </span>
        </div>

        {loadingJobs && activeJobs.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400">
            <div className="animate-spin inline-block w-6 h-6 border-2 border-gray-300 border-t-indigo-600 rounded-full mb-3" />
            <p>Loading translation jobs...</p>
          </div>
        ) : activeJobs.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-200 rounded-xl p-8 text-center text-gray-400">
            <p className="text-sm">No active translation jobs</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeJobs.map((job) => (
              <JobProgressCard
                key={job.job_id}
                job={job}
                onOpen={(threadId) => setSelectedThread(threadId)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900">Translated Threads</h3>
          <span className="text-xs text-gray-500">
            {completedThreads.length} completed thread{completedThreads.length > 1 ? 's' : ''}
          </span>
        </div>

        {loadingThreads && completedThreads.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400">
            <div className="animate-spin inline-block w-6 h-6 border-2 border-gray-300 border-t-indigo-600 rounded-full mb-3" />
            <p>Loading translated threads...</p>
          </div>
        ) : completedThreads.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-200 rounded-xl p-8 text-center text-gray-400">
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
                {completedThreads.map((t) => (
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
              {completedThreads.length} translated thread{completedThreads.length > 1 ? 's' : ''}
            </div>
          </div>
        )}
      </section>

      {selectedThread && (
        <ThreadDrawer threadId={selectedThread} onClose={() => setSelectedThread(null)} />
      )}
    </div>
  );
}
