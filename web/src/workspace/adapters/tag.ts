import type { TagTree, TagRead } from '../../api/types';
import type { WorkspaceBadge, WorkspaceEntity } from '../types';

/**
 * TagTree / TagRead -> WorkspaceEntity（kind='tag'）
 * - 紧凑卡片显示 tag 基本信息 + assignment 计数
 * - 详情面板懒加载 getTagTargets() 展开为 target 子列表（Stage 2 可能升级为独立 kind）
 */
export function tagToEntity(tag: TagTree | TagRead, childrenCount?: number): WorkspaceEntity {
  const assignmentCount = 'assignment_count' in tag ? (tag as TagTree).assignment_count : 0;
  const children = 'children' in tag ? (tag as TagTree).children : [];
  const hasChildren = childrenCount !== undefined ? childrenCount > 0 : (children?.length || 0) > 0;

  const badges: WorkspaceBadge[] = [{ label: 'tag', tone: 'muted' }];
  if (tag.visibility === 'public') badges.push({ label: 'public', tone: 'success' });
  if (tag.visibility === 'private') badges.push({ label: 'private', tone: 'muted' });
  if (tag.status && tag.status !== 'active') {
    badges.push({ label: tag.status, tone: 'warning' });
  }
  if (tag.tag_kind && tag.tag_kind !== 'general') {
    badges.push({ label: tag.tag_kind, tone: 'muted' });
  }

  const subtitleParts: string[] = [];
  if (assignmentCount > 0) subtitleParts.push(`${assignmentCount} targets`);
  if (hasChildren) subtitleParts.push(`${childrenCount ?? children.length} children`);
  if (tag.slug && tag.slug !== tag.name) subtitleParts.push(`slug: ${tag.slug}`);

  const counts = [];
  if (assignmentCount > 0) counts.push({ label: 'targets', value: assignmentCount });

  return {
    id: `tag:${tag.slug || tag.name}`,
    kind: 'tag',
    target: {
      type: 'tag',
      ref: tag.slug || tag.name,
    },
    title: tag.name,
    subtitle: subtitleParts.join(' · '),
    excerpt: tag.description || undefined,
    badges,
    meta: [
      { label: 'slug', value: tag.slug || '' },
      { label: 'kind', value: tag.tag_kind || 'general' },
      { label: 'visibility', value: tag.visibility || 'public' },
    ],
    counts: counts.length > 0 ? counts : undefined,
    updatedAt: 'updated_at' in tag ? (tag as TagRead).updated_at : undefined,
    raw: tag,
  };
}

/**
 * 递归把 TagTree 扁平化为 WorkspaceEntity 列表（平铺所有层级）
 */
export function flattenTagTreeToEntities(tree: TagTree[]): WorkspaceEntity[] {
  const out: WorkspaceEntity[] = [];
  const walk = (nodes: TagTree[]) => {
    for (const n of nodes) {
      out.push(tagToEntity(n));
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(tree);
  return out;
}