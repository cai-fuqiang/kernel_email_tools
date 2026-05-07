import { useMemo, useState } from 'react';
import { Database, FileText, Info, MessageSquareText, Pin, PinOff, Tags } from 'lucide-react';
import type { ContributionStats } from '../../api/contributions';
import type { SearchHit } from '../../api/types';
import EmailTagEditor from '../EmailTagEditor';

interface SearchInspectorDockProps {
  hit: SearchHit | null;
  stats?: ContributionStats | null;
  onOpenThread: (threadId: string) => void;
}

function compactSender(sender: string) {
  return sender.split('<')[0].trim() || sender;
}

export default function SearchInspectorDock({ hit, stats, onOpenThread }: SearchInspectorDockProps) {
  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState(false);
  const knowledgeCount = stats?.knowledge_evidence_count || 0;
  const annotationCount = stats?.annotation_count || 0;
  const draftCount = stats?.draft_count || 0;
  const tagCount = hit?.tags?.length || 0;
  const total = tagCount + knowledgeCount + annotationCount + draftCount;
  const panelOpen = !!hit && (open || pinned);

  const meta = useMemo(() => {
    if (!hit) return [];
    return [
      compactSender(hit.sender),
      hit.date ? new Date(hit.date).toLocaleDateString() : '',
      hit.list_name,
      hit.has_patch ? 'patch' : '',
    ].filter(Boolean);
  }, [hit]);

  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-3 z-30 md:absolute md:bottom-auto md:left-auto md:right-3 md:top-28"
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      {panelOpen && hit && (
        <div className="pointer-events-auto fixed inset-x-3 bottom-16 max-h-[72vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/12 md:absolute md:bottom-auto md:left-auto md:right-14 md:top-0 md:max-h-[calc(100vh-8rem)] md:w-80">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-950">Result inspector</div>
              <div className="mt-1 truncate text-xs text-slate-500">{hit.subject}</div>
            </div>
            <button
              type="button"
              onClick={() => setPinned((value) => !value)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              title={pinned ? 'Unpin panel' : 'Pin panel'}
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {meta.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>{hit.source || 'search'}</span>
                <span>score {hit.score.toFixed(3)}</span>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <Tags size={12} />
                Tags
              </div>
              {tagCount > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {hit.tags.slice(0, 10).map((tag) => (
                    <span key={tag} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                      {tag}
                    </span>
                  ))}
                  {tagCount > 10 && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                      +{tagCount - 10}
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-500">No tags</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-2">
              <EmailTagEditor messageId={hit.message_id} initialTags={hit.tags || []} compact />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-blue-50 px-2 py-1.5 text-blue-700">
                <div className="flex items-center gap-1 text-[11px]"><Database size={12} />Knowledge</div>
                <div className="text-sm font-semibold">{knowledgeCount}</div>
              </div>
              <div className="rounded-lg bg-purple-50 px-2 py-1.5 text-purple-700">
                <div className="flex items-center gap-1 text-[11px]"><MessageSquareText size={12} />Notes</div>
                <div className="text-sm font-semibold">{annotationCount}</div>
              </div>
              <div className="rounded-lg bg-slate-100 px-2 py-1.5 text-slate-700">
                <div className="flex items-center gap-1 text-[11px]"><FileText size={12} />Drafts</div>
                <div className="text-sm font-semibold">{draftCount}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onOpenThread(hit.thread_id)}
              className="w-full rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Open thread
            </button>
          </div>
        </div>
      )}

      <div className="pointer-events-auto flex justify-end md:flex-col">
        <button
          type="button"
          disabled={!hit}
          onMouseEnter={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          onClick={() => {
            if (!hit) return;
            setPinned((value) => !value);
            setOpen(true);
          }}
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-lg shadow-slate-900/8 transition-all hover:-translate-x-0.5 hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          title="Result inspector"
        >
          <Info size={17} />
          {total > 0 && (
            <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-slate-950 px-1.5 py-0.5 text-center text-[10px] font-semibold text-white">
              {total > 99 ? '99+' : total}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
