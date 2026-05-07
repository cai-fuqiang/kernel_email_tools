import type { SearchHit } from '../../api/types';
import type { ContributionStats } from '../../api/contributions';
import EmailTagEditor from '../EmailTagEditor';
import { highlightSnippet } from './searchUtils';
import { Database, FileText, MessageSquareText, Tags } from 'lucide-react';

interface ResultCardProps {
  hit: SearchHit;
  onThread: () => void;
  selected?: boolean;
  onToggleSelect?: (messageId: string) => void;
  messageStats?: ContributionStats | null;
  threadStats?: ContributionStats | null;
}

export default function ResultCard({
  hit,
  onThread,
  selected,
  onToggleSelect,
  messageStats,
  threadStats,
}: ResultCardProps) {
  const senderName = hit.sender.split('<')[0].trim() || hit.sender;
  const dateLabel = hit.date ? new Date(hit.date).toLocaleDateString() : '';
  const stats = messageStats || threadStats;
  const tagCount = hit.tags?.length || 0;
  const knowledgeCount = stats?.knowledge_evidence_count || 0;
  const annotationCount = stats?.annotation_count || 0;
  const draftCount = stats?.draft_count || 0;
  const hasInspector = tagCount > 0 || knowledgeCount > 0 || annotationCount > 0 || draftCount > 0 || hit.source;

  return (
    <div className="group rounded-lg border border-gray-200 bg-white px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50">
      <div className="flex items-start gap-3">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={selected || false}
            onChange={() => onToggleSelect(hit.message_id)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
            aria-label={`Select ${hit.subject}`}
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={onThread}
              className="min-w-0 truncate text-left text-base font-semibold text-gray-950 hover:text-indigo-700"
            >
              {hit.subject}
            </button>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            <span className="truncate font-medium text-gray-700">{senderName}</span>
            {dateLabel && <span>{dateLabel}</span>}
            {hit.list_name && <span>{hit.list_name}</span>}
            {hit.has_patch && (
              <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">
                patch
              </span>
            )}
          </div>

          {hit.snippet && (
            <p
              className="mt-1.5 line-clamp-2 text-xs leading-5 text-gray-600"
              dangerouslySetInnerHTML={{
                __html: highlightSnippet(hit.snippet),
              }}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hasInspector && (
            <div className="relative">
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-950"
                aria-label="Inspect tags and contributions"
              >
                <Tags size={13} />
                {tagCount + annotationCount + knowledgeCount + draftCount}
              </button>
              <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-72 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-900/10 group-hover:block group-focus-within:block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-slate-950">Result inspector</div>
                  <div className="text-[11px] text-slate-500">score {hit.score.toFixed(3)}</div>
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <Tags size={12} />
                      Tags
                    </div>
                    {tagCount > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {hit.tags.slice(0, 8).map((tag) => (
                          <span key={tag} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                            {tag}
                          </span>
                        ))}
                        {tagCount > 8 && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                            +{tagCount - 8}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">No tags</div>
                    )}
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

                  {hit.source && (
                    <div className="flex items-center justify-between rounded-lg bg-sky-50 px-2 py-1.5 text-xs text-sky-700">
                      <span>Source</span>
                      <span className="font-medium">{hit.source}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <EmailTagEditor messageId={hit.message_id} initialTags={hit.tags || []} compact hideTags />
          <button
            type="button"
            onClick={onThread}
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-white"
          >
            Thread
          </button>
          <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600 group-hover:hidden">
            {hit.score.toFixed(3)}
          </span>
        </div>
      </div>
    </div>
  );
}
