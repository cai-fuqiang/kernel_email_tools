/**
 * Standardized meta schema for KnowledgeEntity.
 *
 * `KnowledgeEntity.meta` is a flexible JSONB; PLAN-31001 Phase 2 standardizes a
 * few well-known keys so the UI can render rich link-outs consistently.
 *
 * Keys recognized here:
 * - `kernel_versions`: version timeline entries.
 * - `source_files`: kernel source file paths.
 * - `symbols`: identifier names (functions / structs / macros).
 * - `timeline`: human-curated feature/topic timeline entries.
 *
 * All other keys under `meta` are preserved untouched (e.g. `meta.ask` populated
 * by the Ask draft pipeline).
 */

export const KERNEL_VERSION_RELATIONSHIPS = [
  'introduced',
  'last_seen',
  'removed',
  'affected',
  'fixed',
  'note',
] as const;

export type KernelVersionRelationship = (typeof KERNEL_VERSION_RELATIONSHIPS)[number];

export interface KernelVersionEntry {
  version: string;
  relationship: KernelVersionRelationship;
  note?: string;
}

export const KNOWLEDGE_TIMELINE_EVENT_TYPES = [
  'mail_thread',
  'patch_revision',
  'commit',
  'code_location',
  'external_link',
  'annotation',
  'decision',
  'open_question',
  'note',
] as const;

export type KnowledgeTimelineEventType = (typeof KNOWLEDGE_TIMELINE_EVENT_TYPES)[number];

export interface KnowledgeTimelineEvent {
  id: string;
  event_type: KnowledgeTimelineEventType;
  title: string;
  date?: string;
  summary?: string;
  source_ref?: string;
  url?: string;
  thread_id?: string;
  message_id?: string;
  evidence_id?: string;
  code_path?: string;
  line_start?: number;
  line_end?: number;
  review_state?: 'confirmed' | 'needs_review' | 'unknown';
}

export interface KnowledgeEntityMetaSchema {
  kernel_versions: KernelVersionEntry[];
  source_files: string[];
  symbols: string[];
  timeline: KnowledgeTimelineEvent[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const s = String(item ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeRelationship(value: unknown): KernelVersionRelationship {
  const s = String(value ?? '').trim();
  return (KERNEL_VERSION_RELATIONSHIPS as readonly string[]).includes(s)
    ? (s as KernelVersionRelationship)
    : 'note';
}

function asKernelVersionEntries(value: unknown): KernelVersionEntry[] {
  if (!Array.isArray(value)) return [];
  const out: KernelVersionEntry[] = [];
  for (const item of value) {
    if (!item) continue;
    // Accept either a string ("v6.8") or an object.
    if (typeof item === 'string') {
      const v = item.trim();
      if (v) out.push({ version: v, relationship: 'note' });
      continue;
    }
    if (typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const version = String(rec.version ?? '').trim();
      if (!version) continue;
      const relationship = normalizeRelationship(rec.relationship);
      const note = String(rec.note ?? '').trim();
      out.push(note ? { version, relationship, note } : { version, relationship });
    }
  }
  return out;
}

function normalizeTimelineEventType(value: unknown): KnowledgeTimelineEventType {
  const s = String(value ?? '').trim();
  return (KNOWLEDGE_TIMELINE_EVENT_TYPES as readonly string[]).includes(s)
    ? (s as KnowledgeTimelineEventType)
    : 'note';
}

function normalizeReviewState(value: unknown): KnowledgeTimelineEvent['review_state'] {
  const s = String(value ?? '').trim();
  if (s === 'confirmed' || s === 'needs_review' || s === 'unknown') return s;
  return 'needs_review';
}

function optionalString(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  return s || undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function asTimelineEntries(value: unknown): KnowledgeTimelineEvent[] {
  if (!Array.isArray(value)) return [];
  const out: KnowledgeTimelineEvent[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const rec = item as Record<string, unknown>;
    const title = optionalString(rec.title);
    if (!title) return;
    const lineStart = optionalPositiveNumber(rec.line_start);
    const lineEnd = optionalPositiveNumber(rec.line_end);
    out.push({
      id: optionalString(rec.id) || `timeline-${index + 1}`,
      event_type: normalizeTimelineEventType(rec.event_type),
      title,
      date: optionalString(rec.date),
      summary: optionalString(rec.summary),
      source_ref: optionalString(rec.source_ref),
      url: optionalString(rec.url),
      thread_id: optionalString(rec.thread_id),
      message_id: optionalString(rec.message_id),
      evidence_id: optionalString(rec.evidence_id),
      code_path: optionalString(rec.code_path),
      line_start: lineStart,
      line_end: lineEnd,
      review_state: normalizeReviewState(rec.review_state),
    });
  });
  return out.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
}

/**
 * Extract the standardized knowledge-meta view from a raw `entity.meta`.
 * Returns empty arrays for missing keys. Safe to call on `undefined`.
 */
export function extractKnowledgeMeta(meta: unknown): KnowledgeEntityMetaSchema {
  const rec = asRecord(meta);
  return {
    kernel_versions: asKernelVersionEntries(rec.kernel_versions),
    source_files: asStringArray(rec.source_files),
    symbols: asStringArray(rec.symbols),
    timeline: asTimelineEntries(rec.timeline),
  };
}

/**
 * Merge standardized fields back into the original `meta`, preserving any
 * unknown keys (e.g. `meta.ask`).
 *
 * Empty arrays are removed so callers round-trip cleanly (no churn on save).
 */
export function mergeKnowledgeMeta(
  original: unknown,
  schema: KnowledgeEntityMetaSchema,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...asRecord(original) };

  if (schema.kernel_versions.length > 0) {
    merged.kernel_versions = schema.kernel_versions.map((entry) =>
      entry.note
        ? { version: entry.version, relationship: entry.relationship, note: entry.note }
        : { version: entry.version, relationship: entry.relationship },
    );
  } else {
    delete merged.kernel_versions;
  }

  if (schema.source_files.length > 0) {
    merged.source_files = [...schema.source_files];
  } else {
    delete merged.source_files;
  }

  if (schema.symbols.length > 0) {
    merged.symbols = [...schema.symbols];
  } else {
    delete merged.symbols;
  }

  if (schema.timeline.length > 0) {
    merged.timeline = schema.timeline.map((entry) => {
      const item: Record<string, unknown> = {
        id: entry.id,
        event_type: entry.event_type,
        title: entry.title,
        review_state: entry.review_state || 'needs_review',
      };
      if (entry.date) item.date = entry.date;
      if (entry.summary) item.summary = entry.summary;
      if (entry.source_ref) item.source_ref = entry.source_ref;
      if (entry.url) item.url = entry.url;
      if (entry.thread_id) item.thread_id = entry.thread_id;
      if (entry.message_id) item.message_id = entry.message_id;
      if (entry.evidence_id) item.evidence_id = entry.evidence_id;
      if (entry.code_path) item.code_path = entry.code_path;
      if (entry.line_start) item.line_start = entry.line_start;
      if (entry.line_end) item.line_end = entry.line_end;
      return item;
    });
  } else {
    delete merged.timeline;
  }

  return merged;
}

/**
 * Pick the "canonical" kernel version to use when building source links,
 * in priority order:
 *   1. an entry tagged `introduced`
 *   2. the first entry at all
 *   3. fallback `latest`
 */
export function pickPrimaryVersion(
  versions: KernelVersionEntry[],
  fallback = 'latest',
): string {
  const introduced = versions.find((v) => v.relationship === 'introduced');
  if (introduced) return introduced.version;
  if (versions.length > 0) return versions[0].version;
  return fallback;
}
