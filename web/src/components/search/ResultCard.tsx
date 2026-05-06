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
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
      {onToggleSelect && (
        <div className="float-right ml-3">
          <input
            type="checkbox"
            checked={selected || false}
            onChange={() => onToggleSelect(hit.message_id)}
            className="w-4 h-4 rounded border-slate-300"
          />
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{hit.subject}</h3>
            <ContributionChips stats={messageStats || threadStats} />
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
            <span className="font-medium text-gray-700">
              {hit.sender.split('<')[0].trim()}
            </span>
            <span>{hit.date ? new Date(hit.date).toLocaleDateString() : ''}</span>
            {hit.has_patch && (
              <span className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs font-medium">
                patch
              </span>
            )}
            {hit.source && (
              <span className="px-1.5 py-0.5 bg-sky-50 text-sky-700 rounded text-xs font-medium">
                {hit.source}
              </span>
            )}
          </div>
          {/* 可编辑标签 */}
          <div className="mt-2">
            <EmailTagEditor messageId={hit.message_id} initialTags={hit.tags || []} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-600 rounded-full font-medium">
            {hit.score.toFixed(3)}
          </span>
          <button
            onClick={onThread}
            className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
          >
            Thread
          </button>
        </div>
      </div>
      {hit.snippet && (
        <p
          className="mt-3 text-xs text-gray-600 leading-relaxed line-clamp-2"
          dangerouslySetInnerHTML={{
            __html: highlightSnippet(hit.snippet),
          }}
        />
      )}
    </div>
  );
}