import { useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { listKnowledgeEntityVersions } from '../../api/client';
import type { KnowledgeEntityVersion } from '../../api/types';
import { formatDate } from './knowledgeUtils';

interface EntityHistoryPanelProps {
  entityId: string;
}

export default function EntityHistoryPanel({ entityId }: EntityHistoryPanelProps) {
  const [versions, setVersions] = useState<KnowledgeEntityVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      const data = await listKnowledgeEntityVersions(entityId, 50);
      setVersions(data);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setExpanded(new Set());
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const toggle = (version: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  if (!entityId) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Change history</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
            {versions.length}
          </span>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-slate-700 hover:text-slate-950 disabled:opacity-50"
          title="Reload history"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>
      {versions.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-slate-600">
          {loading ? 'Loading...' : 'No prior versions yet. Edits will be recorded here.'}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {versions.map((v) => {
            const open = expanded.has(v.version);
            return (
              <li key={`${v.entity_id}-${v.version}`} className="px-4 py-3 text-xs">
                <button
                  type="button"
                  onClick={() => toggle(v.version)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="font-medium text-slate-800">v{v.version}</span>
                  <span className="text-slate-600">
                    {v.changed_by} · {formatDate(v.changed_at)}
                  </span>
                </button>
                {open && (
                  <div className="mt-2 space-y-1 rounded-md bg-slate-50 px-3 py-2 leading-5 text-slate-600">
                    <div>
                      <span className="text-[10px] font-semibold uppercase text-slate-600">
                        Name
                      </span>
                      <div className="text-slate-800">{v.canonical_name || '—'}</div>
                    </div>
                    {v.aliases.length > 0 && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase text-slate-600">
                          Aliases
                        </span>
                        <div>{v.aliases.join(', ')}</div>
                      </div>
                    )}
                    {v.summary && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase text-slate-600">
                          Summary
                        </span>
                        <div className="whitespace-pre-wrap">{v.summary}</div>
                      </div>
                    )}
                    {v.status && v.status !== 'active' && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase text-slate-600">
                          Status
                        </span>
                        <div>{v.status}</div>
                      </div>
                    )}
                    {v.change_note && (
                      <div className="border-t border-slate-200 pt-1 italic text-slate-600">
                        {v.change_note}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
