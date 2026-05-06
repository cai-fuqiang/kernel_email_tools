import { Link } from 'react-router-dom';
import { Inbox, RefreshCw } from 'lucide-react';
import type { KnowledgeDraft } from '../../api/types';
import { SecondaryButton } from '../ui';
import { agentDraftMeta, formatDateTime } from './knowledgeUtils';

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
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'human', label: 'Human' },
  { value: 'agent', label: 'AI Agent' },
  { value: 'accepted', label: 'Accepted Agent' },
  { value: 'rejected', label: 'Rejected Agent' },
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
}: DraftInboxPanelProps) {
  const sortedDrafts = [...drafts]
    .sort((a, b) => {
      const aConf = agentDraftMeta(a).confidence;
      const bConf = agentDraftMeta(b).confidence;
      if (aConf !== null && bConf !== null) return bConf - aConf;
      if (aConf !== null) return -1;
      if (bConf !== null) return 1;
      return 0;
    })
    .slice(0, 6);

  return (
    <div className="border-b border-slate-200 bg-amber-50/60 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Inbox className="h-4 w-4 text-amber-600" />
            Draft Inbox
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Ask/Search drafts waiting for human review.
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
          <div className="text-xs text-gray-500">Loading drafts...</div>
        ) : drafts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-amber-200 bg-white/70 px-3 py-3 text-xs leading-5 text-gray-500">
            No drafts for this filter. Ask or Search can generate candidates here.
          </div>
        ) : (
          sortedDrafts.map((draft) => {
            const agentMeta = agentDraftMeta(draft);
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
                      {draft.source_type === 'agent_research' ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                            AI Research Agent
                          </span>
                          {agentMeta.confidence !== null && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                agentMeta.confidence >= 0.7
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : agentMeta.confidence >= 0.5
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              confidence {agentMeta.confidence.toFixed(2)}
                            </span>
                          )}
                          {agentMeta.runId && (
                            <Link
                              to={`/agent-research?run_id=${agentMeta.runId}`}
                              className="text-[10px] text-purple-600 underline hover:text-purple-800"
                              onClick={(e) => e.stopPropagation()}
                            >
                              run {agentMeta.runId.slice(-12)}
                            </Link>
                          )}
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Created by {draft.created_by || 'human'}
                        </div>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        draft.source_type === 'agent_research'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {draft.source_type}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400">
                    Created {formatDateTime(draft.created_at)}
                  </div>
                </button>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenDraft(draft)}
                    className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white"
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