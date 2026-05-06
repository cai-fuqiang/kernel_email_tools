import type { SourceRef } from '../../api/types';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function highlightSnippet(snippet: string): string {
  return escapeHtml(snippet).replace(
    /&lt;&lt;(.*?)&gt;&gt;/g,
    '<mark class="bg-yellow-100 px-0.5 rounded">$1</mark>'
  );
}

export function normalizeMessageId(value: string): string {
  return value
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function resolveCitationSource(
  citation: string,
  sources: SourceRef[],
): SourceRef | undefined {
  const normalized = normalizeMessageId(citation);
  const exact = sources.find(
    (source) => normalizeMessageId(source.message_id || '') === normalized,
  );
  if (exact) return exact;

  const candidates = sources.filter((source) => {
    const id = normalizeMessageId(source.message_id || '');
    if (!id) return false;
    if (normalized.includes('...')) {
      const [prefix, suffix] = normalized.split('...', 2);
      return (!prefix || id.startsWith(prefix)) && (!suffix || id.endsWith(suffix));
    }
    return normalized.length >= 8 && (id.includes(normalized) || normalized.includes(id));
  });

  return candidates.length === 1 ? candidates[0] : undefined;
}

export function compactSender(sender: string): string {
  return (sender.split('<')[0] || sender).replace(/^"|"$/g, '').trim() || 'unknown';
}

export function compactDate(date: string): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return date.slice(0, 10);
}

export function truncateText(text: string, max = 54): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function citationLabel(source: SourceRef): string {
  const parts = [
    compactSender(source.sender || ''),
    compactDate(source.date || ''),
    truncateText(source.subject || source.message_id || 'email'),
  ].filter(Boolean);
  return `[${parts.join(' · ')}]`;
}