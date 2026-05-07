import { Mail, NotebookText, Tag as TagIcon, BookOpen, type LucideIcon } from 'lucide-react';
import type { BadgeTone, WorkspaceEntity, WorkspaceEntityKind } from '../types';

const KIND_ICON: Record<WorkspaceEntityKind, LucideIcon> = {
  email_thread: Mail,
  annotation: NotebookText,
  tag: TagIcon,
  knowledge_entity: BookOpen,
};

const TONE_CLASS: Record<BadgeTone, string> = {
  muted: 'bg-slate-100 text-slate-600',
  info: 'bg-sky-100 text-sky-700',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
};

interface EntityListProps {
  entities: WorkspaceEntity[];
  selectedId?: string | null;
  onSelect: (entity: WorkspaceEntity) => void;
  emptyMessage?: string;
}

/**
 * Kind-agnostic 实体列表组件
 *
 * 严格约束：本文件内禁止出现 `entity.kind === 'xxx'` 的差异化分支。
 * 所有 kind 差异都收敛在 adapter（数据形状）和 detail renderer（详情态）中。
 * KIND_ICON 通过 map 索引而非 if/switch，未来扩展只需扩 map。
 *
 * 选中项仅通过高亮（bg-indigo-50 + border-l-2）提示，完整详情交给右侧 EntityDetailPanel。
 */
export default function EntityList({
  entities,
  selectedId,
  onSelect,
  emptyMessage = '没有匹配的实体',
}: EntityListProps) {
  if (entities.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-slate-500">{emptyMessage}</div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {entities.map((entity) => {
        const Icon = KIND_ICON[entity.kind];
        const isSelected = entity.id === selectedId;

        return (
          <li
            key={entity.id}
            className={
              isSelected
                ? 'cursor-pointer border-l-2 border-indigo-500 bg-indigo-50/40 px-4 py-2.5'
                : 'cursor-pointer px-4 py-2.5 hover:bg-slate-50'
            }
            onClick={() => onSelect(entity)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-500" />}
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {entity.title}
                  </span>
                  {entity.badges.slice(0, 4).map((b, i) => (
                    <span
                      key={`${b.label}-${i}`}
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        TONE_CLASS[b.tone || 'muted']
                      }`}
                    >
                      {b.label}
                    </span>
                  ))}
                </div>
                {entity.subtitle && (
                  <div className="mt-0.5 truncate text-xs text-slate-500">{entity.subtitle}</div>
                )}
                {entity.excerpt && (
                  <div className="mt-0.5 truncate text-xs text-slate-600">{entity.excerpt}</div>
                )}
              </div>
              {entity.counts && entity.counts.length > 0 && (
                <div className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                  {entity.counts.map((c) => (
                    <span key={c.label} title={c.label}>
                      {c.label === 'tags' ? '🏷' : c.label === 'targets' ? '⚓' : '·'} {c.value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}