import type { AnnotationListItem, CodeAnnotation } from '../../api/types';
import { normalizeCodeTarget } from '../../utils/codeTarget';
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
    case 'kernel_file':
      return 'code_line';
    case 'sdm_section':
    case 'sdm_spec':
      return 'sdm_section';
    default:
      return 'email_message';
  }
}

/**
 * 解析 kernel_file / code_line 类批注的 anchor。
 *
 * AnnotationORM 行内字段（version/file_path/start_line/end_line）和 anchor JSON
 * 都可能存在；优先用显式字段，缺失时回退到 anchor，再回退到 `ref` 形如
 * `<version>:<file_path>` 的拆分（kernel_file 类批注的常见落库形态）。
 */
function buildCodeAnchor(a: AnnotationListItem): Record<string, unknown> {
  const codeTarget = normalizeCodeTarget(a);
  if (codeTarget) {
    return {
      ...(a.anchor || {}),
      version: codeTarget.version,
      file_path: codeTarget.path,
      start_line: codeTarget.start_line,
      end_line: codeTarget.end_line,
    };
  }
  const raw = (a.anchor || {}) as Record<string, unknown>;
  const anyA = a as unknown as {
    version?: string;
    file_path?: string;
    start_line?: number;
    end_line?: number;
  };
  let version = (anyA.version as string) || (raw.version as string) || '';
  let filePath = (anyA.file_path as string) || (raw.file_path as string) || '';
  if ((!version || !filePath) && a.target_ref) {
    const idx = a.target_ref.indexOf(':');
    if (idx > 0) {
      version = version || a.target_ref.slice(0, idx);
      filePath = filePath || a.target_ref.slice(idx + 1);
    }
  }
  return {
    ...raw,
    version,
    file_path: filePath,
    start_line: (anyA.start_line as number | undefined) ?? (raw.start_line as number | undefined),
    end_line: (anyA.end_line as number | undefined) ?? (raw.end_line as number | undefined),
  };
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

  const mappedType = targetTypeFromAnnotation(a.target_type);
  const target: WorkspaceTarget = {
    type: mappedType,
    ref: a.target_ref || a.thread_id || '',
    anchor: mappedType === 'code_line' ? buildCodeAnchor(a) : a.anchor || undefined,
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
  const codeTarget = normalizeCodeTarget(a);
  const locationLabel = codeTarget
    ? `${codeTarget.path}:${codeTarget.start_line}${codeTarget.end_line && codeTarget.end_line !== codeTarget.start_line ? `-${codeTarget.end_line}` : ''}`
    : `${a.file_path}:${a.start_line}${a.end_line && a.end_line !== a.start_line ? `-${a.end_line}` : ''}`;
  const subtitleParts = [a.author || 'unknown', dateLabel, `${codeTarget?.version || a.version} · ${locationLabel}`];

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
      ref: codeTarget?.target_ref || `${a.version}:${a.file_path}`,
      anchor: codeTarget
        ? { start_line: codeTarget.start_line, end_line: codeTarget.end_line, version: codeTarget.version, file_path: codeTarget.path }
        : { start_line: a.start_line, end_line: a.end_line, version: a.version, file_path: a.file_path },
    },
    title: firstLine(a.body) || '(empty annotation)',
    subtitle: subtitleParts.filter(Boolean).join(' · '),
    excerpt: truncate(a.body || '', 180),
    badges,
    meta: [
      { label: 'version', value: codeTarget?.version || a.version },
      { label: 'file', value: codeTarget?.path || a.file_path },
      { label: 'lines', value: `${codeTarget?.start_line || a.start_line}–${codeTarget?.end_line || a.end_line}` },
    ],
    updatedAt: a.updated_at || a.created_at || undefined,
    raw: a,
  };
}
