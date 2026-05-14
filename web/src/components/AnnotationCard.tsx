import { useState } from 'react';
import type { AnnotationRelation, AnnotationRelationCreate } from '../api/types';
import AnnotationMarkdown from './AnnotationMarkdown';
import AnnotationRelationsPanel from './AnnotationRelationsPanel';
import AnnotationActions from './AnnotationActions';
import AnnotationIdBadge from './AnnotationIdBadge';
import EmailTagEditor from './EmailTagEditor';
import { useAuth } from '../auth';
import { Clock3, Info, Shield, Tags, UserRound } from 'lucide-react';

interface AnnotationCardProps {
  annotationId: string;
  annotationType: string;
  author: string;
  authorUserId?: string | null;
  visibility?: 'public' | 'private';
  publishStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  body: string;
  createdAt: string;
  updatedAt: string;
  publishReviewComment?: string;
  targetLabel: string;
  targetSubtitle: string;
  anchorLabel?: string;
  relations?: AnnotationRelation[];
  relationsLoading?: boolean;
  relationsError?: string;
  onEdit: (body: string) => void;
  onDelete: () => void;
  onReply: () => void;
  onOpenAnnotation?: (annotationId: string) => void;
  onCreateRelation?: (payload: AnnotationRelationCreate) => Promise<void>;
  onDeleteRelation?: (relationId: string) => Promise<void>;
  onRequestPublish?: () => void;
  onWithdrawPublish?: () => void;
  onApprovePublish?: () => void;
  onRejectPublish?: () => void;
  onPreview?: () => void;
  onJump?: () => void;
  showDetailsPopover?: boolean;
  canManage?: boolean;
  canReply?: boolean;
  canRequestPublish?: boolean;
  canWithdrawPublish?: boolean;
  canApprovePublish?: boolean;
  canRejectPublish?: boolean;
}

const TYPE_THEME: Record<string, { chip: string; panel: string; text: string }> = {
  email: {
    chip: 'bg-sky-100 text-sky-700 border border-sky-200',
    panel: 'bg-white/80 border border-sky-100',
    text: 'text-slate-700',
  },
  code: {
    chip: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
    panel: 'bg-white/80 border border-indigo-100',
    text: 'text-slate-700',
  },
};

export default function AnnotationCard({
  annotationId,
  annotationType,
  author,
  authorUserId,
  visibility = 'public',
  publishStatus = 'none',
  body,
  createdAt,
  updatedAt,
  publishReviewComment,
  targetLabel,
  targetSubtitle,
  anchorLabel,
  relations,
  relationsLoading,
  relationsError,
  onEdit,
  onDelete,
  onReply,
  onOpenAnnotation,
  onCreateRelation,
  onDeleteRelation,
  onRequestPublish,
  onWithdrawPublish,
  onApprovePublish,
  onRejectPublish,
  onPreview,
  onJump,
  showDetailsPopover = true,
  canManage,
  canReply,
  canRequestPublish,
  canWithdrawPublish,
  canApprovePublish,
  canRejectPublish,
}: AnnotationCardProps) {
  const { canWrite, currentUser, isAdmin } = useAuth();
  const [editing, setEditing] = useState(false);
  const resolvedCanManage =
    canManage ??
    (!!currentUser &&
      (isAdmin ||
        (canWrite &&
          visibility === 'private' &&
          !!authorUserId &&
          authorUserId === currentUser.user_id)));
  const resolvedCanReply = canReply ?? canWrite;
  const statusTone =
    publishStatus === 'pending'
      ? 'bg-amber-50 text-amber-700'
      : publishStatus === 'approved'
        ? 'bg-emerald-50 text-emerald-700'
        : publishStatus === 'rejected'
          ? 'bg-rose-50 text-rose-700'
          : 'bg-slate-100 text-slate-600';
  const [editBody, setEditBody] = useState(body);
  const theme = TYPE_THEME[annotationType] || {
    chip: 'bg-amber-100 text-amber-700 border border-amber-200',
    panel: 'bg-white/80 border border-amber-100',
    text: 'text-slate-700',
  };

  return (
    <div className={`group/annotation-card relative rounded-2xl ${theme.panel} p-4 shadow-sm backdrop-blur-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${theme.chip}`}>
              {annotationType}
            </span>
            {anchorLabel && <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{anchorLabel}</span>}
            <AnnotationIdBadge annotationId={annotationId} compact />
          </div>
          <div className="mt-2 truncate text-sm font-semibold text-slate-900">
            {targetLabel || 'Untitled target'}
          </div>
        </div>

        {showDetailsPopover && (
          <div className="relative shrink-0">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-950"
              aria-label="Annotation details"
            >
              <Info size={14} />
            </button>
            <div className="fixed inset-x-3 bottom-3 z-50 mt-2 hidden max-h-[72vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-900/10 group-hover/annotation-card:block group-focus-within/annotation-card:block md:absolute md:bottom-auto md:left-auto md:right-0 md:top-full md:max-h-[calc(100vh-8rem)] md:w-72">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-slate-950">Annotation details</div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${statusTone}`}>
                  {publishStatus}
                </span>
              </div>

              <div className="space-y-2 text-xs text-slate-600">
                {targetSubtitle && (
                  <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                    <div className="text-[11px] text-slate-400">Target</div>
                    <div className="truncate font-medium text-slate-700">{targetSubtitle}</div>
                  </div>
                )}
                <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                  <div className="text-[11px] text-slate-400">Annotation ID</div>
                  <div className="mt-1">
                    <AnnotationIdBadge annotationId={annotationId} compact />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                    <div className="flex items-center gap-1 text-[11px] text-slate-400">
                      <UserRound size={12} />
                      Author
                    </div>
                    <div className="truncate font-medium text-slate-700">{author}</div>
                  </div>
                  <div className={`rounded-lg px-2 py-1.5 ${visibility === 'private' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    <div className="flex items-center gap-1 text-[11px]">
                      <Shield size={12} />
                      Visibility
                    </div>
                    <div className="font-semibold">{visibility}</div>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <Clock3 size={12} />
                    Timeline
                  </div>
                  <div className="mt-0.5 text-slate-700">
                    Created {new Date(createdAt).toLocaleString('zh-CN')}
                  </div>
                  {updatedAt !== createdAt && (
                    <div className="mt-0.5 text-slate-500">
                      Edited {new Date(updatedAt).toLocaleString('zh-CN')}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <Tags size={12} />
                    Tags
                  </div>
                  <EmailTagEditor
                    targetType="annotation"
                    targetRef={annotationId}
                    compact
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-4">
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="min-h-[96px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                const next = editBody.trim();
                if (!next) return;
                onEdit(next);
                setEditing(false);
              }}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            >
              保存
            </button>
            <button
              onClick={() => {
                setEditBody(body);
                setEditing(false);
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <AnnotationMarkdown
            body={body}
            className={`mt-4 text-sm leading-7 ${theme.text}`}
            onOpenAnnotation={onOpenAnnotation}
          />
          {publishReviewComment && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              审核备注：{publishReviewComment}
            </div>
          )}
          {onOpenAnnotation && onCreateRelation && onDeleteRelation ? (
            <AnnotationRelationsPanel
              annotationId={annotationId}
              relations={relations ?? []}
              loading={relationsLoading ?? false}
              error={relationsError ?? ''}
              onOpenAnnotation={onOpenAnnotation}
              onCreateRelation={onCreateRelation}
              onDeleteRelation={onDeleteRelation}
            />
          ) : null}
          {(canRequestPublish || canWithdrawPublish || canApprovePublish || canRejectPublish) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {canRequestPublish && (
                <button
                  onClick={() => onRequestPublish?.()}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700"
                >
                  申请公开
                </button>
              )}
              {canWithdrawPublish && (
                <button
                  onClick={() => onWithdrawPublish?.()}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                >
                  撤回申请
                </button>
              )}
              {canApprovePublish && (
                <button
                  onClick={() => onApprovePublish?.()}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"
                >
                  通过公开
                </button>
              )}
              {canRejectPublish && (
                <button
                  onClick={() => onRejectPublish?.()}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700"
                >
                  驳回
                </button>
              )}
            </div>
          )}
          {resolvedCanManage || resolvedCanReply ? (
            <AnnotationActions
              onEdit={() => {
                if (resolvedCanManage) setEditing(true);
              }}
              onDelete={resolvedCanManage ? onDelete : () => {}}
              onReply={resolvedCanReply ? onReply : () => {}}
              onPreview={onPreview ? (() => onPreview()) : undefined}
              showEdit={resolvedCanManage}
              showDelete={resolvedCanManage}
              showReply={resolvedCanReply}
              showPreview={!!onPreview}
              variant={annotationType === 'code' ? 'code' : 'email'}
            />
          ) : onJump ? (
            <div className="mt-2">
              <button
                onClick={() => onJump()}
                className="text-xs px-2 py-1 rounded transition-colors text-slate-600 hover:bg-slate-100"
              >
                Jump
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
