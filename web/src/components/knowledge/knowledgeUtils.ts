import type {
  AnnotationListItem,
  KnowledgeDraftPayload,
  KnowledgeEntity,
  KnowledgeEvidence,
} from '../../api/types';

export const DEFAULT_ENTITY_TYPE = 'feature_topic';

export const ENTITY_TYPES = [
  'feature_topic',
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
  'has_subtopic',
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
  const meta = entity?.meta;
  if (!meta || typeof meta !== 'object') {
    return {
      question: '',
      generatedAt: '',
      sources: [] as KnowledgeEvidenceSource[],
      threadIds: [] as string[],
    };
  }
  const record = meta as Record<string, unknown>;
  const rawSources = Array.isArray(record.sources) ? record.sources : [];
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
    question: String(record.question || ''),
    generatedAt: String(record.generated_at || ''),
    sources,
    threadIds: asStringList(record.thread_ids),
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

export function normalizeDraftPayload(payload: unknown): KnowledgeDraftPayload {
  const raw =
    payload && typeof payload === 'object' ? (payload as Partial<KnowledgeDraftPayload>) : {};
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

export function relationEntityName(
  entity: { canonical_name?: string } | null | undefined,
  fallback: string,
) {
  return entity?.canonical_name || fallback;
}

export function extractSubtopicParent(entity: Pick<KnowledgeEntity, 'meta'> | null | undefined) {
  const raw = entity?.meta?.subtopic_parent;
  if (!raw || typeof raw !== 'object') return null;
  const parent = raw as Record<string, unknown>;
  const entityId = String(parent.entity_id || '').trim();
  const canonicalName = String(parent.canonical_name || '').trim();
  if (!entityId || !canonicalName) return null;
  return {
    entity_id: entityId,
    canonical_name: canonicalName,
  };
}

export function isPromotedKnowledgeAnnotation(annotation: Pick<AnnotationListItem, 'annotation_type' | 'pinned'>) {
  return annotation.annotation_type === 'claim'
    || annotation.annotation_type === 'summary'
    || annotation.annotation_type === 'link'
    || (annotation.annotation_type === 'note' && annotation.pinned);
}

export function annotationDisplayLabel(annotation: Pick<AnnotationListItem, 'short_label' | 'body' | 'annotation_id'>) {
  return annotation.short_label || annotation.body || annotation.annotation_id;
}
