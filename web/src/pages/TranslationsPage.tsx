import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getTranslatedThreads,
  listTranslationJobs,
  type TranslatedThreadInfo,
  type TranslationJobResponse,
} from '../api/client';
import ThreadDrawer from '../components/ThreadDrawer';
import { showToast } from '../components/Toast';
import { useAuth } from '../auth';
import { Info, Tags } from 'lucide-react';

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

function TranslatedThreadCard({
  thread,
  onOpen,
}: {
  thread: TranslatedThreadInfo;
  onOpen: (threadId: string) => void;
}) {
  return (
    <div className="group relative min-h-24 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpen(thread.thread_id)}
            className="block max-w-full truncate text-left text-sm font-semibold text-gray-950 hover:text-indigo-700"
            title={thread.subject}
          >
            {thread.subject || '(no subject)'}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            <span>{thread.email_count} email{thread.email_count > 1 ? 's' : ''}</span>
            <span>{thread.cached_paragraphs} cached paragraph{thread.cached_paragraphs > 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-950"
            aria-label="Translation details"
          >
            <Info size={14} />
          </button>
          <button
            type="button"
            onClick={() => onOpen(thread.thread_id)}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
          >
            Open
          </button>
        </div>
      </div>

      <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-50 hidden max-h-[72vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/10 group-hover:block group-focus-within:block md:absolute md:bottom-auto md:left-auto md:right-3 md:top-12 md:max-h-[calc(100vh-8rem)] md:w-72">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-slate-950">Translation details</div>
          <div className="text-[11px] text-slate-500">{formatDate(thread.last_translated_at)}</div>
        </div>

        <div className="space-y-2 text-xs text-slate-600">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-slate-50 px-2 py-1.5">
              <div className="text-[11px] text-slate-400">Sender</div>
              <div className="truncate font-medium text-slate-700">{formatSender(thread.sender)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 px-2 py-1.5">
              <div className="text-[11px] text-slate-400">Date</div>
              <div className="font-medium text-slate-700">{formatDate(thread.date)}</div>
            </div>
            <div className="rounded-lg bg-indigo-50 px-2 py-1.5 text-indigo-700">
              <div className="text-[11px]">Emails</div>
              <div className="text-sm font-semibold">{thread.email_count}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-700">
              <div className="text-[11px]">Cached</div>
              <div className="text-sm font-semibold">{thread.cached_paragraphs}</div>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <Tags size={12} />
              Tags
            </div>
            {thread.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {thread.tags.slice(0, 8).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                  >
                    {tag}
                  </span>
                ))}
                {thread.tags.length > 8 && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    +{thread.tags.length - 8}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-xs text-slate-500">No tags</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TranslationsPage() {
  const { isAuthenticated } = useAuth();
  const [threads, setThreads] = useState<TranslatedThreadInfo[]>([]);
  const [activeJobs, setActiveJobs] = useState<TranslationJobResponse[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);
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
      if (!silent) showToast(e instanceof Error ? e.message : 'Failed to load translated threads', 'error');
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
      if (!silent) showToast(e instanceof Error ? e.message : 'Failed to load translation jobs', 'error');
    } finally {
      if (!silent) setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchJobs();
    fetchThreads();
  }, [isAuthenticated, fetchJobs, fetchThreads]);

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
          <div className="grid gap-3 lg:grid-cols-2">
            {completedThreads.map((thread) => (
              <TranslatedThreadCard
                key={thread.thread_id}
                thread={thread}
                onOpen={(threadId) => setSelectedThread(threadId)}
              />
            ))}
          </div>
        )}
      </section>

      {selectedThread && (
        <ThreadDrawer threadId={selectedThread} onClose={() => setSelectedThread(null)} />
      )}
    </div>
  );
}
