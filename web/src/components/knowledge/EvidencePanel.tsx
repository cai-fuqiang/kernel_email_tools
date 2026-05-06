import { ExternalLink } from 'lucide-react';
import type { KnowledgeEntity, KnowledgeEvidence } from '../../api/types';
import { loreUrl } from '../../utils/externalLinks';
import {
  evidenceTitle,
  formatDateTime,
  sourceTitle,
  type KnowledgeEvidenceSource,
} from './knowledgeUtils';

interface EvidencePanelProps {
  selectedEntity: KnowledgeEntity;
  evidence: {
    question: string;
    generatedAt: string;
    sources: KnowledgeEvidenceSource[];
    threadIds: string[];
  };
  evidenceRows: KnowledgeEvidence[];
  directEvidenceCount: number;
  generatedEvidenceCount: number;
  lastEvidenceAt: string;
  onOpenThread: (threadId: string, focusMessageId?: string) => void;
}

export default function EvidencePanel({
  selectedEntity,
  evidence,
  evidenceRows,
  directEvidenceCount,
  generatedEvidenceCount,
  lastEvidenceAt,
  onOpenThread,
}: EvidencePanelProps) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-950">Source emails</h2>
          <p className="text-sm text-gray-500">
            Evidence kept with this item. Open a source before promoting a draft to active knowledge.
          </p>
        </div>
        {evidence.generatedAt && (
          <span className="text-xs text-gray-400">
            Captured {formatDateTime(evidence.generatedAt)}
          </span>
        )}
      </div>
      {evidence.question && (
        <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm leading-6 text-indigo-950">
          Ask question: {evidence.question}
        </div>
      )}
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase text-gray-400">Direct evidence</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">{directEvidenceCount}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase text-gray-400">Generated sources</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">{generatedEvidenceCount}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase text-gray-400">Last verified</div>
          <div className="mt-1 truncate text-sm font-semibold text-gray-950">
            {lastEvidenceAt ? formatDateTime(lastEvidenceAt) : 'Not verified'}
          </div>
        </div>
      </div>
      {evidenceRows.length > 0 ? (
        <div className="mt-4 space-y-3">
          {evidenceRows.map((row) => (
            <div key={row.evidence_id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-semibold uppercase text-indigo-600">{row.source_type}</div>
              <div className="mt-1 text-sm font-semibold leading-6 text-gray-950">
                {row.claim || selectedEntity.canonical_name}
              </div>
              {row.quote && (
                <div className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-6 text-gray-600">
                  {row.quote}
                </div>
              )}
              <button
                type="button"
                onClick={() =>
                  row.thread_id && onOpenThread(row.thread_id, row.message_id || undefined)
                }
                disabled={!row.thread_id}
                className="mt-3 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:border-indigo-200 hover:bg-indigo-50/60 disabled:cursor-default disabled:hover:border-gray-200 disabled:hover:bg-white"
              >
                <div className="truncate text-sm font-semibold text-gray-900">
                  {evidenceTitle(row) || row.message_id || row.thread_id}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {String(row.meta?.list_name || '') && <span>{String(row.meta?.list_name || '')}</span>}
                  {row.confidence && <span>{row.confidence}</span>}
                  {row.message_id && <span className="font-mono">{row.message_id}</span>}
                  {row.message_id && (
                    <a
                      href={loreUrl(row.message_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800"
                      title="在 lore.kernel.org 查看原文"
                    >
                      lore <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </button>
            </div>
          ))}
        </div>
      ) : evidence.sources.length > 0 ? (
        <div className="mt-4 space-y-2">
          {evidence.sources.map((source, index) => (
            <button
              key={`${source.message_id || source.thread_id}-${index}`}
              type="button"
              onClick={() =>
                source.thread_id && onOpenThread(source.thread_id, source.message_id || undefined)
              }
              disabled={!source.thread_id}
              className="block w-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-left hover:border-indigo-200 hover:bg-indigo-50/60 disabled:cursor-default disabled:hover:border-gray-200 disabled:hover:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-950">
                    {sourceTitle(source)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    {source.list_name && <span>{source.list_name}</span>}
                    {source.source && <span>{source.source}</span>}
                    {source.message_id && <span className="font-mono">{source.message_id}</span>}
                    {source.message_id && (
                      <a
                        href={loreUrl(source.message_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800"
                        title="在 lore.kernel.org 查看原文"
                      >
                        lore <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
                <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs font-medium text-gray-600">
                  Open thread
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : evidence.threadIds.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {evidence.threadIds.map((threadId) => (
            <button
              key={threadId}
              type="button"
              onClick={() => onOpenThread(threadId)}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-700 hover:border-indigo-200 hover:bg-indigo-50"
            >
              {threadId}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm leading-6 text-gray-500">
          No source evidence is attached yet. The most useful path is Ask, review answer, then save knowledge draft, because that preserves the emails behind the claim.
        </div>
      )}
    </section>
  );
}