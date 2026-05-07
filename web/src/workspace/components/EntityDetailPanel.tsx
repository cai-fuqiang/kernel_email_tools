import { useMemo, useState } from 'react';
import { X, ExternalLink, Maximize2, Trash2 } from 'lucide-react';
import type { AnnotationListItem, CodeAnnotation, SearchHit, TagRead, TagTargetItem, TagTree } from '../../api/types';
import type { WorkspaceEntity, WorkspaceEntityKind } from '../types';
import AnnotationCard from '../../components/AnnotationCard';
import ConfirmModal from '../../components/ConfirmModal';
import { showToast } from '../../components/Toast';
import TagSummaryCard from './TagSummaryCard';

/**
 * Annotation action handlers exposed by the parent page. These map 1:1 to the
 * shared AnnotationCard callbacks so that delete / edit / publish workflows
 * reuse the exact same logic as ThreadDrawer / AnnotationTree /
 * kernelCode AnnotationPanel.
 */
export interface AnnotationActionCallbacks {
  onEdit?: (a: AnnotationListItem | CodeAnnotation, body: string) => Promise<void> | void;
  onDelete?: (a: AnnotationListItem | CodeAnnotation) => Promise<void> | void;
  onRequestPublish?: (a: AnnotationListItem | CodeAnnotation) => Promise<void> | void;
  onWithdrawPublish?: (a: AnnotationListItem | CodeAnnotation) => Promise<void> | void;
  onApprovePublish?: (a: AnnotationListItem | CodeAnnotation, comment: string) => Promise<void> | void;
  onRejectPublish?: (a: AnnotationListItem | CodeAnnotation, comment: string) => Promise<void> | void;
}

interface EntityDetailPanelProps {
  entity: WorkspaceEntity | null;
  /** 打开完整 ThreadDrawer / 跳转 kernel-code 等 */
  onOpenTarget?: (entity: WorkspaceEntity) => void;
  /** 点击 tag 详情面板里的某个 target item（用于 tag 视图下的跳转） */
  onOpenTagTarget?: (target: TagTargetItem) => void;
  /** Tag 删除回调（annotation 的删除由 AnnotationCard 内部按钮触发）。 */
  onDeleteTag?: (entity: WorkspaceEntity) => Promise<void> | void;
  /** 是否允许当前用户删除 tag；annotation 的权限由 annotationPermissions 控制。 */
  canDeleteTag?: (entity: WorkspaceEntity) => boolean;
  /** Annotation card 的动作回调（edit / delete / publish-*）。 */
  annotationActions?: AnnotationActionCallbacks;
  /**
   * 为当前批注计算各动作的可见性。字段语义与 AnnotationCard 的 `can*` 完全一致，
   * 父层可复用后端 RBAC 规则（admin 全权；author 仅可操作自己的 private 且非
   * pending；public 批注仅 admin 可改/删等）。
   */
  annotationPermissions?: (a: AnnotationListItem | CodeAnnotation) => {
    canManage: boolean;
    canRequestPublish: boolean;
    canWithdrawPublish: boolean;
    canApprovePublish: boolean;
    canRejectPublish: boolean;
  };
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
  annotationActions?: AnnotationActionCallbacks;
  annotationPermissions?: (a: AnnotationListItem | CodeAnnotation) => {
    canManage: boolean;
    canRequestPublish: boolean;
    canWithdrawPublish: boolean;
    canApprovePublish: boolean;
    canRejectPublish: boolean;
  };
}

// 各 kind renderer（返回 ReactNode）。kind 差异收敛在此 map 内，外层布局/操作区共用。
const RENDERERS: Record<WorkspaceEntityKind, (entity: WorkspaceEntity, ctx: RendererCtx) => React.ReactNode> = {
  email_thread: (entity) => renderEmailThread(entity.raw as SearchHit),
  annotation: (entity, ctx) => (
    <AnnotationDetail
      annotation={entity.raw as AnnotationListItem | CodeAnnotation}
      actions={ctx.annotationActions}
      computePermissions={ctx.annotationPermissions}
    />
  ),
  tag: (entity, ctx) => (
    <TagSummaryCard tag={entity.raw as TagTree | TagRead} onOpenTarget={ctx.onOpenTagTarget} />
  ),
  knowledge_entity: () => (
    <div className="p-5 text-sm text-slate-500">Knowledge entity 详情暂未实现，请跳转 Knowledge 页面查看。</div>
  ),
};

export default function EntityDetailPanel({
  entity,
  onOpenTarget,
  onOpenTagTarget,
  onDeleteTag,
  canDeleteTag,
  annotationActions,
  annotationPermissions,
  onClose,
}: EntityDetailPanelProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rendered = useMemo(() => {
    if (!entity) return null;
    const r = RENDERERS[entity.kind];
    return r
      ? r(entity, { onOpenTagTarget, annotationActions, annotationPermissions })
      : <div className="p-5 text-sm text-slate-500">未知 kind: {entity.kind}</div>;
  }, [entity, onOpenTagTarget, annotationActions, annotationPermissions]);

  // 仅 tag kind 在外层渲染删除按钮；annotation 的删除由 AnnotationCard 内部按钮触发。
  const tagDeletable = Boolean(
    entity && entity.kind === 'tag' && onDeleteTag && (canDeleteTag ? canDeleteTag(entity) : true),
  );

  async function handleDeleteConfirm() {
    if (!entity || !onDeleteTag || deleting) return;
    setDeleting(true);
    try {
      await onDeleteTag(entity);
      setConfirmOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setDeleting(false);
    }
  }

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
          {tagDeletable && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50"
            >
              <Trash2 className="h-3 w-3" />
              删除标签
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{rendered}</div>

      <ConfirmModal
        isOpen={confirmOpen}
        title="删除标签"
        message={`确认删除标签「${entity.title}」？该标签下的所有子标签和绑定关系将一并删除，且不可撤销。`}
        confirmLabel={deleting ? '删除中…' : '删除'}
        cancelLabel="取消"
        variant="danger"
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
        onCancel={() => {
          if (!deleting) setConfirmOpen(false);
        }}
      />
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

function AnnotationDetail({
  annotation: a,
  actions,
  computePermissions,
}: {
  annotation: AnnotationListItem | CodeAnnotation;
  actions?: AnnotationActionCallbacks;
  computePermissions?: (a: AnnotationListItem | CodeAnnotation) => {
    canManage: boolean;
    canRequestPublish: boolean;
    canWithdrawPublish: boolean;
    canApprovePublish: boolean;
    canRejectPublish: boolean;
  };
}) {
  const perms = computePermissions ? computePermissions(a) : undefined;
  const [expanded, setExpanded] = useState(false);

  function targetSubtitle(): string {
    if ('file_path' in a && a.file_path) return `${a.version || ''} ${a.file_path}`.trim();
    if ('thread_id' in a && a.thread_id) return a.thread_id;
    return a.target_ref || '';
  }

  function renderAnnotationCard() {
    return (
      <AnnotationCard
        annotationId={a.annotation_id}
        annotationType={a.annotation_type || 'email'}
        author={a.author || ''}
        authorUserId={a.author_user_id}
        visibility={a.visibility}
        publishStatus={a.publish_status}
        body={a.body || ''}
        createdAt={a.created_at}
        updatedAt={a.updated_at || a.created_at}
        publishReviewComment={a.publish_review_comment}
        targetLabel={a.target_label || a.annotation_id}
        targetSubtitle={targetSubtitle()}
        canManage={perms?.canManage}
        canRequestPublish={perms?.canRequestPublish}
        canWithdrawPublish={perms?.canWithdrawPublish}
        canApprovePublish={perms?.canApprovePublish}
        canRejectPublish={perms?.canRejectPublish}
        canReply={false}
        onEdit={actions?.onEdit ? (body) => actions.onEdit!(a, body) : () => {}}
        onDelete={actions?.onDelete ? () => actions!.onDelete!(a) : () => {}}
        onReply={() => {}}
        onRequestPublish={actions?.onRequestPublish ? () => actions!.onRequestPublish!(a) : undefined}
        onWithdrawPublish={actions?.onWithdrawPublish ? () => actions!.onWithdrawPublish!(a) : undefined}
        onApprovePublish={actions?.onApprovePublish ? () => {
          const comment = window.prompt('审核备注（可选）') ?? '';
          void actions!.onApprovePublish!(a, comment);
        } : undefined}
        onRejectPublish={actions?.onRejectPublish ? () => {
          const comment = window.prompt('驳回原因（可选）') ?? '';
          void actions!.onRejectPublish!(a, comment);
        } : undefined}
        showDetailsPopover={false}
      />
    );
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span className="font-medium text-slate-600">{a.target_type}</span>
          <span className="truncate font-mono text-slate-500">{a.target_ref}</span>
          {a.target_label && <span className="text-slate-600">· {a.target_label}</span>}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
          aria-label="放大查看批注"
          title="放大查看"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {renderAnnotationCard()}

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpanded(false)}
        >
          <div
            className="flex max-h-[92vh] w-[min(960px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Annotation</div>
                <h3 className="mt-1 truncate text-base font-semibold text-slate-950">
                  {a.target_label || a.annotation_id}
                </h3>
                <div className="mt-1 truncate font-mono text-[11px] text-slate-500">
                  {a.target_type} · {targetSubtitle()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="关闭放大查看"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {renderAnnotationCard()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
