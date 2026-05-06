import type {
  AskDraftResponse,
  KnowledgeDraft,
  KnowledgeEntity,
  KnowledgeEvidence,
} from '../../api/types';

export const DEFAULT_ENTITY_TYPE = 'concept';

export const ENTITY_TYPES = [
  'concept',
  'subsystem',
  'mechanism',
  'issue',
  'symbol',
  'patch_discussion',
];

export const RELATION_TYPES = [
  'related_to',
  'part_of',
  'explains',
  'caused_by',
  'fixed_by',
  'supersedes',
  'introduced_in',
  'removed_in',
  'affects_version',
];

export type ThreadFocus = {
  threadId: string;
  focusMessageId?: string;
};

export type KnowledgeEvidenceSource = {
  message_id: string;
  thread_id: string;
  subject: string;
  sender: string;
  date: string;
  list_name: string;
  source: string;
};

export function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

export function extractKnowledgeEvidence(entity: KnowledgeEntity | null) {
  const ask = entity?.meta?.ask;
  if (!ask || typeof ask !== 'object') {
    return {
      question: '',
      generatedAt: '',
      sources: [] as KnowledgeEvidenceSource[],
      threadIds: [] as string[],
    };
  }
  const askMeta = ask as Record<string, unknown>;
  const rawSources = Array.isArray(askMeta.sources) ? askMeta.sources : [];
  const sources = rawSources
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((source) => ({
      message_id: String(source.message_id || ''),
      thread_id: String(source.thread_id || ''),
      subject: String(source.subject || ''),
      sender: String(source.sender || ''),
      date: String(source.date || ''),
      list_name: String(source.list_name || ''),
      source: String(source.source || ''),
    }))
    .filter((source) => source.message_id || source.thread_id || source.subject);

  return {
    question: String(askMeta.question || ''),
    generatedAt: String(askMeta.generated_at || ''),
    sources,
    threadIds: asStringList(askMeta.thread_ids),
  };
}

export function formatDate(value?: string) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

export function formatDateTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function readableType(value: string) {
  return value.replace(/_/g, ' ');
}

export function relationLabel(value: string) {
  return readableType(value);
}

export function evidenceCount(entity: KnowledgeEntity) {
  const evidence = extractKnowledgeEvidence(entity);
  return evidence.sources.length || evidence.threadIds.length;
}

export function statusTone(status: string) {
  if (status === 'active') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === 'deprecated') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

export function sourceTitle(source: KnowledgeEvidenceSource) {
  const sender = source.sender.split('<')[0].trim() || source.sender;
  const date = formatDate(source.date);
  const subject = source.subject || source.message_id || source.thread_id;
  return [sender, date, subject].filter(Boolean).join(' · ');
}

export function evidenceTitle(row: KnowledgeEvidence) {
  const meta = row.meta || {};
  const sender = String(meta.sender || '').split('<')[0].trim();
  const date = formatDate(String(meta.date || ''));
  const subject = String(meta.subject || row.message_id || row.thread_id);
  return [sender, date, subject].filter(Boolean).join(' · ');
}

export function normalizeDraftPayload(payload: unknown): AskDraftResponse {
  const raw =
    payload && typeof payload === 'object' ? (payload as Partial<AskDraftResponse>) : {};
  return {
    draft_id: raw.draft_id || '',
    knowledge_drafts: Array.isArray(raw.knowledge_drafts) ? raw.knowledge_drafts : [],
    annotation_drafts: Array.isArray(raw.annotation_drafts) ? raw.annotation_drafts : [],
    tag_assignment_drafts: Array.isArray(raw.tag_assignment_drafts)
      ? raw.tag_assignment_drafts
      : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
  };
}

export function agentDraftMeta(draft: KnowledgeDraft) {
  const payload = draft.payload as unknown as Record<string, unknown>;
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : null;
  const runId = typeof payload.agent_run_id === 'string' ? payload.agent_run_id : '';
  const review = typeof payload.self_review === 'string' ? payload.self_review : '';
  return { confidence, runId, review };
}

export function relationEntityName(
  entity: { canonical_name?: string } | null | undefined,
  fallback: string,
) {
  return entity?.canonical_name || fallback;
}