import { CheckCircle2 } from 'lucide-react';
import type { AskResponse, SourceRef } from '../../api/types';
import {
  citationLabel,
  normalizeMessageId,
  resolveCitationSource as resolveCitationSourceFromList,
} from '../search/searchUtils';

export type ConversationTurn = {
  id: string;
  question: string;
  response?: AskResponse;
  error?: string;
};

function buildSourceMap(answer?: AskResponse | null) {
  const sourceByMessageId = new Map<string, SourceRef>();
  for (const source of answer?.sources || []) {
    if (!source.message_id || !source.thread_id) continue;
    sourceByMessageId.set(normalizeMessageId(source.message_id), source);
  }
  return sourceByMessageId;
}

function resolveCitationSource(
  citation: string,
  sourceByMessageId: Map<string, SourceRef>,
): SourceRef | undefined {
  const normalized = normalizeMessageId(citation);
  const exact = sourceByMessageId.get(normalized);
  if (exact) return exact;

  // Fallback to list-based resolver for prefix/suffix matching.
  const sources = Array.from(sourceByMessageId.values());
  return resolveCitationSourceFromList(citation, sources);
}

function renderAnswerWithLinks(
  text: string,
  sourceByMessageId: Map<string, SourceRef>,
  onOpenSource: (threadId: string, messageId?: string) => void,
) {
  return text.split(/(\[[^\]]+\])/g).map((part, index) => {
    const match = part.match(/^\[([^\]]+)\]$/);
    if (!match) return <span key={index}>{part}</span>;
    const source = resolveCitationSource(match[1], sourceByMessageId);
    if (!source) return <span key={index}>{part}</span>;
    return (
      <button
        key={index}
        type="button"
        onClick={() => onOpenSource(source.thread_id || '', source.message_id)}
        className="mx-0.5 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
        title={`Open cited email: ${source.message_id}`}
      >
        {citationLabel(source)}
      </button>
    );
  });
}

interface ConversationCardProps {
  turn: ConversationTurn;
  onOpenThread: (threadId: string, focusMessageId?: string) => void;
}

export default function ConversationCard({ turn, onOpenThread }: ConversationCardProps) {
  const sourceByMessageId = buildSourceMap(turn.response);
  const standalone = turn.response?.retrieval_stats?.standalone_question;
  return (
    <div className="space-y-3">
      <div className="ml-auto max-w-3xl rounded-2xl bg-gray-900 px-4 py-3 text-sm text-white">
        {turn.question}
      </div>

      {turn.error && (
        <div className="max-w-3xl rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {turn.error}
        </div>
      )}

      {turn.response ? (
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Answer
            <span className="ml-auto text-xs font-normal text-gray-400">{turn.response.retrieval_mode} mode</span>
          </div>
          {typeof standalone === 'string' && standalone && standalone !== turn.question && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Rewritten for retrieval: {standalone}
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
            {renderAnswerWithLinks(turn.response.answer, sourceByMessageId, onOpenThread)}
          </div>

          {turn.response.sources.length > 0 && (
            <details className="rounded-xl border border-gray-100 bg-gray-50 p-3" open>
              <summary className="cursor-pointer text-sm font-semibold text-gray-700">Sources ({turn.response.sources.length})</summary>
              <div className="mt-3 space-y-2">
                {turn.response.sources.map((source, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => onOpenThread(source.thread_id || '', source.message_id)}
                    disabled={!source.thread_id}
                    className="block w-full rounded-lg border border-gray-100 bg-white p-3 text-left hover:border-indigo-200 hover:bg-indigo-50/30 disabled:cursor-default"
                  >
                    <p className="truncate text-sm font-medium text-gray-900">{source.subject}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {source.sender} · {source.date}
                      {source.source && <span> · {source.source}</span>}
                      {typeof source.score === 'number' && <span> · score {source.score.toFixed(3)}</span>}
                    </p>
                    {source.snippet && <p className="mt-2 line-clamp-3 text-xs text-gray-600">{source.snippet}</p>}
                  </button>
                ))}
              </div>
            </details>
          )}

          <details className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-gray-700">Explainability</summary>
            <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-gray-500">Search Plan</p>
                {turn.response.search_plan?.goal && <p className="mb-2 text-sm text-gray-800">{turn.response.search_plan.goal}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {(turn.response.search_plan?.keyword_queries || []).map((query, index) => (
                    <span key={`k-${index}`} className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{query}</span>
                  ))}
                  {(turn.response.search_plan?.semantic_queries || []).map((query, index) => (
                    <span key={`s-${index}`} className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{query}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-gray-500">Executed Queries</p>
                <div className="space-y-1">
                  {turn.response.executed_queries.map((query, index) => (
                    <div key={index} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-gray-700">{query.query}</span>
                      <span className="shrink-0 text-gray-500">{query.mode} · {query.hits}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>
      ) : (
        <div className="max-w-3xl rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-400">
          Thinking...
        </div>
      )}
    </div>
  );
}