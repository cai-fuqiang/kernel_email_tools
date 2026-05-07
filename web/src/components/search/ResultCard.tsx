import type { SearchHit } from '../../api/types';
import type { ContributionStats } from '../../api/contributions';
import ContributionChips from '../ContributionChips';
import EmailTagEditor from '../EmailTagEditor';
import { highlightSnippet } from './searchUtils';

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
            <ContributionChips stats={stats} />
            {hit.tags?.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                {tag}
              </span>
            ))}
            {(hit.tags?.length || 0) > 3 && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                +{hit.tags.length - 3}
              </span>
            )}
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
          <div className="hidden items-center gap-1 opacity-0 transition group-hover:flex group-hover:opacity-100">
            {hit.source && (
              <span className="rounded bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700">
                {hit.source}
              </span>
            )}
            <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600">
              score {hit.score.toFixed(3)}
            </span>
          </div>
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
