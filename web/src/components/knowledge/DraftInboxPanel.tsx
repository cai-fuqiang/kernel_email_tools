import { Inbox, RefreshCw } from 'lucide-react';
import type { KnowledgeDraft } from '../../api/types';
import { SecondaryButton } from '../ui';
import { formatDateTime } from './knowledgeUtils';

interface DraftInboxPanelProps {
  drafts: KnowledgeDraft[];
  draftLoading: boolean;
  draftFilter: string;
  draftError: string;
  draftSaving: boolean;
  onRefresh: () => void;
  onFilterChange: (value: string) => void;
  onOpenDraft: (draft: KnowledgeDraft) => void;
  onRejectDraft: (draft: KnowledgeDraft) => void;
  className?: string;
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'human', label: 'Human' },
];

export default function DraftInboxPanel({
  drafts,
  draftLoading,
  draftFilter,
  draftError,
  draftSaving,
  onRefresh,
  onFilterChange,
  onOpenDraft,
  onRejectDraft,
  className = '',
}: DraftInboxPanelProps) {
  const sortedDrafts = [...drafts]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  return (
    <div className={`border-b border-slate-200 bg-amber-50/60 p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Inbox className="h-4 w-4 text-amber-600" />
            Draft Inbox
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-600">
            Search-generated drafts waiting for human review.
          </p>
        </div>
        <SecondaryButton
          type="button"
          onClick={onRefresh}
          className="border-amber-200 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </SecondaryButton>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => onFilterChange(filter.value)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
              draftFilter === filter.value
                ? 'bg-amber-200 text-amber-800'
                : 'bg-white/60 text-slate-600 hover:bg-amber-100 hover:text-amber-700'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {draftError && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {draftError}
        </div>
      )}
      <div className="mt-3 space-y-2">
        {draftLoading ? (
          <div className="text-xs text-gray-600">Loading drafts...</div>
        ) : drafts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-amber-200 bg-white/70 px-3 py-3 text-xs leading-5 text-gray-600">
            No drafts for this filter. Search and review flows can generate candidates here.
          </div>
        ) : (
          sortedDrafts.map((draft) => {
            return (
              <div key={draft.draft_id} className="rounded-lg border border-amber-100 bg-white p-3">
                <button
                  type="button"
                  onClick={() => onOpenDraft(draft)}
                  className="block w-full text-left"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-gray-900">
                        {draft.question || draft.source_ref || draft.source_type}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        Created by {draft.created_by || 'human'}
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                    >
                      {draft.source_type}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-gray-600">
                    Created {formatDateTime(draft.created_at)}
                  </div>
                </button>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenDraft(draft)}
                    className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500"
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    onClick={() => onRejectDraft(draft)}
                    disabled={draftSaving}
                    className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
