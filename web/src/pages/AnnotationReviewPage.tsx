import { useCallback, useEffect, useMemo, useState } from 'react';
import AnnotationTree from '../components/AnnotationTree';
import { listAnnotations } from '../api/client';
import type { AnnotationListItem } from '../api/types';
import { useAuth } from '../auth';

type FilterType = 'all' | 'email' | 'code' | 'sdm_spec';

export default function AnnotationReviewPage() {
  const { isAdmin } = useAuth();
  const [filter, setFilter] = useState<FilterType>('all');
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [annotations, setAnnotations] = useState<AnnotationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAnnotations = useCallback(async () => {
    if (!isAdmin) {
      setError('Permission denied');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await listAnnotations({
        q: q || undefined,
        type: filter,
        publish_status: 'pending',
        page: 1,
        page_size: 200,
      });
      setAnnotations(data.annotations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load annotation review queue');
      setAnnotations([]);
    } finally {
      setLoading(false);
    }
  }, [filter, isAdmin, q]);

  useEffect(() => {
    loadAnnotations().catch(() => {});
  }, [loadAnnotations]);

  const stats = useMemo(() => ({
    total: annotations.length,
    email: annotations.filter((item) => item.annotation_type === 'email').length,
    code: annotations.filter((item) => item.annotation_type === 'code').length,
    spec: annotations.filter((item) => item.annotation_type === 'sdm_spec').length,
  }), [annotations]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-amber-50">
      <div className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
                Admin Tab
              </div>
              <h1 className="mt-3 text-3xl font-bold text-slate-900">Annotation Publication Review</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Central queue for reviewing editors&apos; requests to publish private annotations.
              </p>
            </div>
            <div className="grid min-w-[260px] gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-amber-700">Pending Total</div>
                <div className="mt-2 text-3xl font-semibold text-amber-900">{stats.total}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Breakdown</div>
                <div className="mt-2 text-sm text-slate-700">
                  {stats.email} email · {stats.code} code · {stats.spec} spec
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <div className="flex-1 min-w-[260px]">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setQ(searchInput.trim());
                }}
                placeholder="Search pending annotations..."
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400"
              />
            </div>
            <button
              onClick={() => setQ(searchInput.trim())}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white"
            >
              Search
            </button>
            <button
              onClick={() => {
                setSearchInput('');
                setQ('');
              }}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700"
            >
              Clear
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(['all', 'email', 'code', 'sdm_spec'] as FilterType[]).map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  filter === item
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-600'
                }`}
              >
                {item === 'all' ? 'All' : item}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center text-slate-400">
            Loading review queue...
          </div>
        ) : annotations.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center">
            <h2 className="text-lg font-semibold text-slate-900">No pending publication requests</h2>
            <p className="mt-2 text-sm text-slate-500">New requests from editors will appear here automatically.</p>
          </div>
        ) : (
          <AnnotationTree annotations={annotations} onAnnotationsChange={loadAnnotations} />
        )}
      </div>
    </div>
  );
}
