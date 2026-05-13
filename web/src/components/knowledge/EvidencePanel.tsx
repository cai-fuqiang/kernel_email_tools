import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { KnowledgeEntity, KnowledgeEvidence } from '../../api/types';
import { loreUrl } from '../../utils/externalLinks';
import { PrimaryButton } from '../ui';
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
  canWrite: boolean;
  saving: boolean;
  onOpenThread: (threadId: string, focusMessageId?: string) => void;
  onCreateEvidence: (data: {
    source_type: string;
    message_id: string;
    thread_id: string;
    claim: string;
    quote: string;
    confidence: string;
    meta: Record<string, unknown>;
  }) => Promise<void>;
}

const sourceTypeOptions = [
  ['email', 'Email message'],
  ['mail_thread', 'Mail thread'],
  ['patch_revision', 'Patch revision'],
  ['commit', 'Commit'],
  ['code_location', 'Code location'],
  ['external_url', 'External URL'],
  ['annotation', 'Annotation'],
  ['manual', 'Manual note'],
] as const;

type EvidenceForm = {
  source_type: string;
  claim: string;
  quote: string;
  confidence: string;
  message_id: string;
  thread_id: string;
  source_ref: string;
  url: string;
  code_path: string;
};

const emptyEvidenceForm: EvidenceForm = {
  source_type: 'email',
  claim: '',
  quote: '',
  confidence: 'needs_review',
  message_id: '',
  thread_id: '',
  source_ref: '',
  url: '',
  code_path: '',
};

export default function EvidencePanel({
  selectedEntity,
  evidence,
  evidenceRows,
  directEvidenceCount,
  generatedEvidenceCount,
  lastEvidenceAt,
  canWrite,
  saving,
  onOpenThread,
  onCreateEvidence,
}: EvidencePanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EvidenceForm>(emptyEvidenceForm);
  const hasManualEvidence =
    form.claim.trim() ||
    form.message_id.trim() ||
    form.thread_id.trim() ||
    form.source_ref.trim() ||
    form.url.trim() ||
    form.code_path.trim();

  const submitEvidence = async () => {
    if (!hasManualEvidence) return;
    try {
      await onCreateEvidence({
        source_type: form.source_type,
        message_id: form.message_id.trim(),
        thread_id: form.thread_id.trim(),
        claim: form.claim.trim(),
        quote: form.quote.trim(),
        confidence: form.confidence.trim(),
        meta: {
          source_ref: form.source_ref.trim(),
          url: form.url.trim(),
          code_path: form.code_path.trim(),
        },
      });
      setForm(emptyEvidenceForm);
      setShowForm(false);
    } catch {
      // Keep the draft in place; the parent already surfaces the error.
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-950">Evidence</h2>
          <p className="text-sm text-gray-600">
            Claim-level evidence kept with this item, including mails, patch revisions, commits, code locations, and external references.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {evidence.generatedAt && (
            <span className="text-xs font-medium text-gray-600">
              Captured {formatDateTime(evidence.generatedAt)}
            </span>
          )}
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              {showForm ? 'Close' : 'Add evidence'}
            </button>
          )}
        </div>
      </div>

      {showForm && canWrite && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_160px]">
            <select
              value={form.source_type}
              onChange={(e) => setForm((prev) => ({ ...prev, source_type: e.target.value }))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {sourceTypeOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={form.claim}
              onChange={(e) => setForm((prev) => ({ ...prev, claim: e.target.value }))}
              placeholder="Claim this evidence supports"
              className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <select
              value={form.confidence}
              onChange={(e) => setForm((prev) => ({ ...prev, confidence: e.target.value }))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="confirmed">confirmed</option>
              <option value="needs_review">needs_review</option>
              <option value="unknown">unknown</option>
            </select>
          </div>
          <textarea
            value={form.quote}
            onChange={(e) => setForm((prev) => ({ ...prev, quote: e.target.value }))}
            rows={2}
            placeholder="Short quote or note"
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6"
          />
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <input
              value={form.thread_id}
              onChange={(e) => setForm((prev) => ({ ...prev, thread_id: e.target.value }))}
              placeholder="thread id"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <input
              value={form.message_id}
              onChange={(e) => setForm((prev) => ({ ...prev, message_id: e.target.value }))}
              placeholder="message id"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <input
              value={form.source_ref}
              onChange={(e) => setForm((prev) => ({ ...prev, source_ref: e.target.value }))}
              placeholder="commit / patch / evidence ref"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <input
              value={form.code_path}
              onChange={(e) => setForm((prev) => ({ ...prev, code_path: e.target.value }))}
              placeholder="kernel path"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <input
              value={form.url}
              onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              placeholder="external url"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm md:col-span-2"
            />
          </div>
          <div className="mt-3 flex justify-end">
            <PrimaryButton
              type="button"
              onClick={submitEvidence}
              disabled={saving || !hasManualEvidence}
            >
              Save evidence
            </PrimaryButton>
          </div>
        </div>
        )}

      {evidence.question && (
        <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm leading-6 text-indigo-950">
          Ask question: {evidence.question}
        </div>
      )}
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase text-gray-600">Direct evidence</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">{directEvidenceCount}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase text-gray-600">Generated sources</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">{generatedEvidenceCount}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase text-gray-600">Last verified</div>
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
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  {String(row.meta?.list_name || '') && <span>{String(row.meta?.list_name || '')}</span>}
                  {row.confidence && <span>{row.confidence}</span>}
                  {row.message_id && <span className="font-mono">{row.message_id}</span>}
                  {String(row.meta?.source_ref || '') && (
                    <span className="font-mono">{String(row.meta?.source_ref || '')}</span>
                  )}
                  {String(row.meta?.code_path || '') && (
                    <span className="font-mono">{String(row.meta?.code_path || '')}</span>
                  )}
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
                  {String(row.meta?.url || '') && (
                    <a
                      href={String(row.meta?.url || '')}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800"
                    >
                      link <ExternalLink className="h-3 w-3" />
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
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
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
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm leading-6 text-gray-600">
          No evidence is attached yet. Add the mail thread, patch revision, commit, code location, or external link that supports the next claim you want to keep.
        </div>
      )}
    </section>
  );
}
