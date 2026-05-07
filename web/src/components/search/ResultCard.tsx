import type { SearchHit } from '../../api/types';
import type { ContributionStats } from '../../api/contributions';
import EmailTagEditor from '../EmailTagEditor';
import { highlightSnippet } from './searchUtils';
import { Database, FileText, Info, MessageSquareText, Tags } from 'lucide-react';

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
  const hasDock = tagCount > 0 || knowledgeCount > 0 || annotationCount > 0 || draftCount > 0 || hit.source;
  const dockCount = tagCount + knowledgeCount + annotationCount + draftCount;

  return (
    <div className="group/search-result relative rounded-lg border border-gray-200 bg-white px-3 py-2 transition hover:border-slate-300 hover:bg-slate-50">
      <div className="flex items-start gap-2">
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
              className="min-w-0 truncate text-left text-sm font-semibold leading-5 text-gray-950 hover:text-indigo-700"
            >
              {hit.subject}
            </button>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
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
              className="mt-1 line-clamp-1 text-xs leading-5 text-gray-600"
              dangerouslySetInnerHTML={{
                __html: highlightSnippet(hit.snippet),
              }}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hasDock && (
            <div className="relative">
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-950"
                aria-label="Inspect this search result"
              >
                <Info size={13} />
                {dockCount}
              </button>
              <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-50 hidden max-h-[72vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-900/10 group-hover/search-result:block group-focus-within/search-result:block md:absolute md:bottom-auto md:left-auto md:right-0 md:top-full md:mt-2 md:max-h-[calc(100vh-8rem)] md:w-72">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-slate-950">Result dock</div>
                  <div className="text-[11px] text-slate-500">score {hit.score.toFixed(3)}</div>
                </div>

                <div className="space-y-2">
                  <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                    <div className="truncate font-medium text-slate-800">{hit.subject}</div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-500">
                      <span>{senderName}</span>
                      {dateLabel && <span>{dateLabel}</span>}
                      {hit.list_name && <span>{hit.list_name}</span>}
                      {hit.source && <span>{hit.source}</span>}
                    </div>
                  </div>

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

                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <EmailTagEditor messageId={hit.message_id} initialTags={hit.tags || []} compact />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-blue-50 px-2 py-1.5 text-blue-700">
                      <div className="flex items-center gap-1 text-[11px]"><Database size={12} />K</div>
                      <div className="text-sm font-semibold">{knowledgeCount}</div>
                    </div>
                    <div className="rounded-lg bg-purple-50 px-2 py-1.5 text-purple-700">
                      <div className="flex items-center gap-1 text-[11px]"><MessageSquareText size={12} />A</div>
                      <div className="text-sm font-semibold">{annotationCount}</div>
                    </div>
                    <div className="rounded-lg bg-slate-100 px-2 py-1.5 text-slate-700">
                      <div className="flex items-center gap-1 text-[11px]"><FileText size={12} />D</div>
                      <div className="text-sm font-semibold">{draftCount}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {tagCount > 0 && (
            <span className="rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700" title={hit.tags.join(', ')}>
              {tagCount} tag{tagCount > 1 ? 's' : ''}
            </span>
          )}
          {knowledgeCount > 0 && (
            <span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700" title={`${knowledgeCount} knowledge evidence`}>
              K{knowledgeCount}
            </span>
          )}
          {annotationCount > 0 && (
            <span className="rounded-lg bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700" title={`${annotationCount} annotations`}>
              A{annotationCount}
            </span>
          )}
          {draftCount > 0 && (
            <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700" title={`${draftCount} pending drafts`}>
              D{draftCount}
            </span>
          )}
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
