import { useMemo } from 'react';
import { X, ExternalLink } from 'lucide-react';
import type { AnnotationListItem, CodeAnnotation, SearchHit, TagRead, TagTargetItem, TagTree } from '../../api/types';
import type { WorkspaceEntity, WorkspaceEntityKind } from '../types';
import TagSummaryCard from './TagSummaryCard';

interface EntityDetailPanelProps {
  entity: WorkspaceEntity | null;
  /** 打开完整 ThreadDrawer / 跳转 kernel-code 等 */
  onOpenTarget?: (entity: WorkspaceEntity) => void;
  /** 点击 tag 详情面板里的某个 target item（用于 tag 视图下的跳转） */
  onOpenTagTarget?: (target: TagTargetItem) => void;
  onClose?: () => void;
}

/**
 * 按 kind 分发详情渲染的外壳。
 *
 * 核心约束：本组件内唯一的 kind 分支集中在 `RENDERERS` map 上，
 * 不要在公共 header / 操作区里写 if-kind 逻辑。
 * 新增 kind 只需扩充 RENDERERS。
 */

interface RendererCtx {
  onOpenTagTarget?: (target: TagTargetItem) => void;
}

// 各 kind renderer（返回 ReactNode）。kind 差异收敛在此 map 内，外层布局/操作区共用。
const RENDERERS: Record<WorkspaceEntityKind, (entity: WorkspaceEntity, ctx: RendererCtx) => React.ReactNode> = {
  email_thread: (entity) => renderEmailThread(entity.raw as SearchHit),
  annotation: (entity) => renderAnnotation(entity.raw as AnnotationListItem | CodeAnnotation),
  tag: (entity, ctx) => (
    <TagSummaryCard tag={entity.raw as TagTree | TagRead} onOpenTarget={ctx.onOpenTagTarget} />
  ),
  knowledge_entity: () => (
    <div className="p-5 text-sm text-slate-500">Knowledge entity 详情暂未实现，请跳转 Knowledge 页面查看。</div>
  ),
};

export default function EntityDetailPanel({ entity, onOpenTarget, onOpenTagTarget, onClose }: EntityDetailPanelProps) {
  const rendered = useMemo(() => {
    if (!entity) return null;
    const r = RENDERERS[entity.kind];
    return r ? r(entity, { onOpenTagTarget }) : <div className="p-5 text-sm text-slate-500">未知 kind: {entity.kind}</div>;
  }, [entity, onOpenTagTarget]);

  if (!entity) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-12 text-center text-sm text-slate-400">
        选中左侧一项以查看详情
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {entity.badges.slice(0, 5).map((b, i) => (
                <span
                  key={i}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                >
                  {b.label}
                </span>
              ))}
            </div>
            <h2 className="text-sm font-semibold leading-snug text-slate-950">{entity.title}</h2>
            {entity.subtitle && (
              <div className="mt-1 text-xs text-slate-500">{entity.subtitle}</div>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close detail"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {onOpenTarget && (
            <button
              type="button"
              onClick={() => onOpenTarget(entity)}
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white hover:bg-slate-800"
            >
              <ExternalLink className="h-3 w-3" />
              打开完整视图
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{rendered}</div>
    </div>
  );
}

function renderEmailThread(hit: SearchHit) {
  const senderName = (hit.sender || '').split('<')[0].trim() || hit.sender;
  const dateLabel = hit.date ? new Date(hit.date).toLocaleString() : '';

  return (
    <div className="space-y-4 p-5 text-sm">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Overview</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500">sender</dt>
          <dd className="text-slate-800">{hit.sender}</dd>
          <dt className="text-slate-500">date</dt>
          <dd className="text-slate-800">{dateLabel}</dd>
          <dt className="text-slate-500">channel</dt>
          <dd className="text-slate-800">{hit.list_name || '—'}</dd>
          <dt className="text-slate-500">thread_id</dt>
          <dd className="truncate font-mono text-[11px] text-slate-700">{hit.thread_id || hit.message_id}</dd>
          <dt className="text-slate-500">source</dt>
          <dd className="text-slate-800">{hit.source || '—'}</dd>
          <dt className="text-slate-500">score</dt>
          <dd className="text-slate-800">{hit.score?.toFixed(3) ?? '0'}</dd>
        </dl>
      </div>

      {hit.snippet && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Snippet</div>
          <div
            className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700"
            dangerouslySetInnerHTML={{ __html: hit.snippet }}
          />
        </div>
      )}

      {hit.tags && hit.tags.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tags</div>
          <div className="flex flex-wrap gap-1">
            {hit.tags.map((t) => (
              <span key={t} className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">{t}</span>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-slate-500">
        点击上方「打开完整视图」查看整个 thread（所有邮件、批注、翻译、patch diff）。
        <span className="mt-1 block text-slate-400">— sender {senderName}</span>
      </div>
    </div>
  );
}

function renderAnnotation(a: AnnotationListItem | CodeAnnotation) {
  return (
    <div className="space-y-4 p-5 text-sm">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Target</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500">type</dt>
          <dd className="text-slate-800">{a.target_type}</dd>
          <dt className="text-slate-500">ref</dt>
          <dd className="truncate font-mono text-[11px] text-slate-700">{a.target_ref}</dd>
          <dt className="text-slate-500">label</dt>
          <dd className="text-slate-800">{a.target_label || '—'}</dd>
        </dl>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Body</div>
        <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-700">
          {a.body}
        </pre>
      </div>
    </div>
  );
}