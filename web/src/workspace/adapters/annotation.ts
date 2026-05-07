import type { AnnotationListItem, CodeAnnotation } from '../../api/types';
import type { WorkspaceBadge, WorkspaceEntity, WorkspaceTarget, WorkspaceTargetType } from '../types';

function truncate(text: string, n: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= n) return clean;
  return clean.slice(0, n) + '…';
}

function firstLine(text: string): string {
  const trimmed = (text || '').trim();
  const firstLineBreak = trimmed.indexOf('\n');
  if (firstLineBreak === -1) return trimmed;
  return trimmed.slice(0, firstLineBreak).trim();
}

function targetTypeFromAnnotation(targetType: string | undefined): WorkspaceTargetType {
  switch (targetType) {
    case 'email_thread':
      return 'email_thread';
    case 'email_message':
    case 'email_paragraph':
      return 'email_message';
    case 'code_line':
    case 'kernel_code':
      return 'code_line';
    case 'sdm_section':
    case 'sdm_spec':
      return 'sdm_section';
    default:
      return 'email_message';
  }
}

/**
 * 邮件批注 AnnotationListItem -> WorkspaceEntity
 */
export function annotationToEntity(a: AnnotationListItem): WorkspaceEntity {
  const dateLabel = a.created_at ? new Date(a.created_at).toLocaleDateString() : '';
  const subtitleParts = [
    a.author || 'unknown',
    dateLabel,
    a.target_label || a.target_ref,
  ].filter(Boolean);

  const badges: WorkspaceBadge[] = [{ label: 'annotation', tone: 'info' }];
  if (a.visibility === 'public') badges.push({ label: 'public', tone: 'success' });
  if (a.visibility === 'private') badges.push({ label: 'private', tone: 'muted' });
  if (a.publish_status === 'pending') badges.push({ label: 'pending review', tone: 'warning' });
  if (a.publish_status === 'rejected') badges.push({ label: 'rejected', tone: 'danger' });
  if (a.annotation_type && a.annotation_type !== 'email') {
    badges.push({ label: a.annotation_type, tone: 'muted' });
  }

  const target: WorkspaceTarget = {
    type: targetTypeFromAnnotation(a.target_type),
    ref: a.target_ref || a.thread_id || '',
    anchor: a.anchor || undefined,
  };

  return {
    id: `annotation:${a.annotation_id}`,
    kind: 'annotation',
    target,
    title: firstLine(a.body) || '(empty annotation)',
    subtitle: subtitleParts.join(' · '),
    excerpt: truncate(a.body || '', 180),
    badges,
    meta: [
      { label: 'author', value: a.author || '' },
      { label: 'visibility', value: a.visibility || '' },
      { label: 'target_type', value: a.target_type || '' },
    ],
    updatedAt: a.updated_at || a.created_at || undefined,
    raw: a,
  };
}

/**
 * 代码批注 CodeAnnotation -> WorkspaceEntity（与邮件批注同一 kind）
 */
export function codeAnnotationToEntity(a: CodeAnnotation): WorkspaceEntity {
  const dateLabel = a.created_at ? new Date(a.created_at).toLocaleDateString() : '';
  const locationLabel = `${a.file_path}:${a.start_line}${a.end_line && a.end_line !== a.start_line ? `-${a.end_line}` : ''}`;
  const subtitleParts = [a.author || 'unknown', dateLabel, `${a.version} · ${locationLabel}`];

  const badges: WorkspaceBadge[] = [
    { label: 'annotation', tone: 'info' },
    { label: 'code', tone: 'muted' },
  ];
  if (a.visibility === 'public') badges.push({ label: 'public', tone: 'success' });
  if (a.visibility === 'private') badges.push({ label: 'private', tone: 'muted' });
  if (a.publish_status === 'pending') badges.push({ label: 'pending review', tone: 'warning' });

  return {
    id: `annotation:${a.annotation_id}`,
    kind: 'annotation',
    target: {
      type: 'code_line',
      ref: `${a.version}:${a.file_path}`,
      anchor: { start_line: a.start_line, end_line: a.end_line, version: a.version, file_path: a.file_path },
    },
    title: firstLine(a.body) || '(empty annotation)',
    subtitle: subtitleParts.filter(Boolean).join(' · '),
    excerpt: truncate(a.body || '', 180),
    badges,
    meta: [
      { label: 'version', value: a.version },
      { label: 'file', value: a.file_path },
      { label: 'lines', value: `${a.start_line}–${a.end_line}` },
    ],
    updatedAt: a.updated_at || a.created_at || undefined,
    raw: a,
  };
}