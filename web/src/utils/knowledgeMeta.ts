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

export interface KnowledgeEntityMetaSchema {
  kernel_versions: KernelVersionEntry[];
  source_files: string[];
  symbols: string[];
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