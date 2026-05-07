import type { SearchHit } from '../../api/types';
import type { WorkspaceBadge, WorkspaceEntity } from '../types';

/**
 * 将 SearchHit（邮件搜索结果）转换为统一 WorkspaceEntity
 * - kind: 'email_thread'（搜索命中粒度虽是 message，但前端打开的是 thread，target 用 email_thread）
 * - id 用 thread_id + message_id 组合保证唯一（同 thread 不同 message 都应独立展示）
 */
export function emailHitToEntity(hit: SearchHit): WorkspaceEntity {
  const senderName = (hit.sender || '').split('<')[0].trim() || hit.sender || 'unknown';
  const dateLabel = hit.date ? new Date(hit.date).toLocaleDateString() : '';
  const subtitleParts = [senderName, dateLabel, hit.list_name].filter(Boolean);

  const badges: WorkspaceBadge[] = [];
  if (hit.has_patch) badges.push({ label: 'PATCH', tone: 'success' });
  for (const tag of (hit.tags || []).slice(0, 3)) {
    badges.push({ label: tag, tone: 'warning' });
  }
  if ((hit.tags?.length || 0) > 3) {
    badges.push({ label: `+${(hit.tags?.length || 0) - 3}`, tone: 'muted' });
  }
  if (hit.source) badges.push({ label: hit.source, tone: 'muted' });

  const threadRef = hit.thread_id || hit.message_id;

  return {
    id: `email_thread:${threadRef}:${hit.message_id}`,
    kind: 'email_thread',
    target: {
      type: 'email_thread',
      ref: threadRef,
      anchor: hit.message_id ? { message_id: hit.message_id } : undefined,
    },
    title: hit.subject || '(no subject)',
    subtitle: subtitleParts.join(' · '),
    excerpt: hit.snippet || undefined,
    badges,
    meta: [
      { label: 'sender', value: hit.sender || '' },
      { label: 'list', value: hit.list_name || '' },
      { label: 'score', value: hit.score?.toFixed(3) ?? '0' },
    ],
    counts: (hit.tags?.length || 0) > 0 ? [{ label: 'tags', value: hit.tags.length }] : undefined,
    updatedAt: hit.date || undefined,
    raw: hit,
  };
}