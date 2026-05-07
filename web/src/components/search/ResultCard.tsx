import type { SearchHit } from '../../api/types';
import type { ContributionStats } from '../../api/contributions';
import { highlightSnippet } from './searchUtils';
import { Info } from 'lucide-react';

interface ResultCardProps {
  hit: SearchHit;
  onThread: () => void;
  selected?: boolean;
  onToggleSelect?: (messageId: string) => void;
  onInspect?: (hit: SearchHit) => void;
  messageStats?: ContributionStats | null;
  threadStats?: ContributionStats | null;
}

export default function ResultCard({
  hit,
  onThread,
  selected,
  onToggleSelect,
  onInspect,
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
  const inspectCount = tagCount + annotationCount + knowledgeCount + draftCount;

  return (
    <div
      className="group rounded-lg border border-gray-200 bg-white px-3 py-2 transition hover:border-slate-300 hover:bg-slate-50"
      onMouseEnter={() => onInspect?.(hit)}
      onFocus={() => onInspect?.(hit)}
    >
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
          {hasInspector && (
            <button
              type="button"
              onClick={() => onInspect?.(hit)}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-950"
              aria-label="Inspect tags and contributions"
            >
              <Info size={13} />
              {inspectCount}
            </button>
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
