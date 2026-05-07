/**
 * PLAN-31005 Stage 1：统一工作台实体模型
 *
 * - 首期只收敛 4 种 kind：email_thread / annotation / tag / knowledge_entity
 * - Adapter 纯函数：每种 kind 一个 `toWorkspaceEntity(raw): WorkspaceEntity`
 * - `EntityList` 组件内禁止出现 `entity.kind === ...` 分支，
 *   所有 kind 差异收敛在 adapter 和 detail renderer map 中
 */

export type WorkspaceEntityKind =
  | 'email_thread'
  | 'annotation'
  | 'tag'
  | 'knowledge_entity';

export type WorkspaceTargetType =
  | 'email_thread'
  | 'email_message'
  | 'code_line'
  | 'sdm_section'
  | 'knowledge'
  | 'tag';

export interface WorkspaceTarget {
  type: WorkspaceTargetType;
  ref: string;
  anchor?: Record<string, unknown>;
}

export type BadgeTone = 'muted' | 'info' | 'success' | 'warning' | 'danger';

export interface WorkspaceBadge {
  label: string;
  tone?: BadgeTone;
}

export interface WorkspaceMeta {
  label: string;
  value: string;
}

export interface WorkspaceCount {
  label: string;
  value: number;
}

export interface WorkspaceEntity {
  /** 全局唯一 id，形如 `email_thread:<thread_id>` / `annotation:<annotation_id>` / `tag:<slug>` */
  id: string;
  kind: WorkspaceEntityKind;
  target: WorkspaceTarget;
  /** 主行标题 */
  title: string;
  /** 次行：sender · date · channel / target label / etc. */
  subtitle?: string;
  /** 1 行摘要（建议 line-clamp-1） */
  excerpt?: string;
  /** 小 chip 列表（PATCH / kasan / public 等） */
  badges: WorkspaceBadge[];
  /** 2–4 个 key-value 补充信息（当前不强制展示，给 detail panel 使用） */
  meta: WorkspaceMeta[];
  /** 数量 counters（批注数、evidence 数等） */
  counts?: WorkspaceCount[];
  updatedAt?: string;
  /** 原始后端对象，详情面板按 kind 取用 */
  raw: unknown;
}