import type {
  AskDraftApplyResponse,
  AskDraftResponse,
  SummarizeResponse,
} from '../../api/types';
import DraftReviewPanel from '../DraftReviewPanel';
import { citationLabel, resolveCitationSource } from './searchUtils';

interface SummaryPanelProps {
  summary: SummarizeResponse;
  draftBundle: AskDraftResponse | null;
  draftSaved: AskDraftApplyResponse | null;
  draftLoading: boolean;
  showDraftPanel: boolean;
  onCreateDraft: () => void;
  onDraftChange: (next: AskDraftResponse) => void;
  onApplyDraft: () => void;
  onCloseDraft: () => void;
  onOpenThread: (threadId: string) => void;
}

export default function SummaryPanel({
  summary,
  draftBundle,
  draftSaved,
  draftLoading,
  showDraftPanel,
  onCreateDraft,
  onDraftChange,
  onApplyDraft,
  onCloseDraft,
  onOpenThread,
}: SummaryPanelProps) {
  return (
    <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <svg
            className="w-4 h-4 text-indigo-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          AI 概括
          <span className="text-xs font-normal text-gray-400">by {summary.model}</span>
        </h3>
        <div className="flex items-center gap-2">
          {!showDraftPanel && (
            <button
              onClick={onCreateDraft}
              disabled={draftLoading}
              className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {draftLoading ? '生成草稿中...' : '创建草稿'}
            </button>
          )}
          {draftSaved && (
            <span className="text-xs text-green-600">
              已保存: {draftSaved.created_entities.length} 实体,{' '}
              {draftSaved.created_annotations.length} 批注,{' '}
              {draftSaved.created_tag_assignments.length} 标签
            </span>
          )}
        </div>
      </div>
      <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
        {summary.answer.split(/(\[[^\]]+\])/g).map((part, i) => {
          const m = part.match(/^\[([^\]]+)\]$/);
          if (!m) return <span key={i}>{part}</span>;
          const src = resolveCitationSource(m[1], summary.sources);
          if (!src || !src.thread_id) return <span key={i}>{part}</span>;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onOpenThread(src.thread_id!)}
              className="mx-0.5 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
              title={`Open cited email: ${src.message_id}`}
            >
              {citationLabel(src)}
            </button>
          );
        })}
      </div>

      {/* 草稿面板 */}
      {showDraftPanel && draftBundle && (
        <div className="mt-4 pt-4 border-t border-indigo-200">
          <DraftReviewPanel
            draft={draftBundle}
            onChange={onDraftChange}
            onSave={onApplyDraft}
            saving={draftLoading}
            saved={draftSaved}
            compact
          />
          <button
            onClick={onCloseDraft}
            className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            关闭草稿
          </button>
        </div>
      )}
    </div>
  );
}