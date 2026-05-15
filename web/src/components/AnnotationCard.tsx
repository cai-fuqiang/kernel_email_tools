import { useState } from 'react';
import type {
  AnnotationRelation,
  AnnotationRelationCreate,
  CodeAnnotation,
} from '../api/types';
import AnnotationMarkdown from './AnnotationMarkdown';
import AnnotationRelationsPanel from './AnnotationRelationsPanel';
import AnnotationActions from './AnnotationActions';
import AnnotationIdBadge from './AnnotationIdBadge';
import EmailTagEditor from './EmailTagEditor';
import { useAuth } from '../auth';
import { Shield, Tags } from 'lucide-react';

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
  subjectAnnotation?: CodeAnnotation | null;
  candidateAnnotations?: CodeAnnotation[];
  onCreateRelation?: (payload: AnnotationRelationCreate) => Promise<void>;
  onDeleteRelation?: (relationId: string) => Promise<void>;
  onSearchAnnotations?: (query: string) => Promise<CodeAnnotation[]>;
  onRequestPublish?: () => void;
  onWithdrawPublish?: () => void;
  onApprovePublish?: () => void;
  onRejectPublish?: () => void;
  onPreview?: () => void;
  onJump?: () => void;
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
  author: _author,
  authorUserId,
  visibility = 'public',
  publishStatus = 'none',
  body,
  createdAt: _createdAt,
  updatedAt: _updatedAt,
  publishReviewComment,
  targetLabel,
  targetSubtitle: _targetSubtitle,
  anchorLabel,
  relations,
  relationsLoading,
  relationsError,
  onEdit,
  onDelete,
  onReply,
  onOpenAnnotation,
  subjectAnnotation,
  candidateAnnotations = [],
  onCreateRelation,
  onDeleteRelation,
  onSearchAnnotations,
  onRequestPublish,
  onWithdrawPublish,
  onApprovePublish,
  onRejectPublish,
  onPreview,
  onJump,
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
  const [tagsOpen, setTagsOpen] = useState(false);
  const theme = TYPE_THEME[annotationType] || {
    chip: 'bg-amber-100 text-amber-700 border border-amber-200',
    panel: 'bg-white/80 border border-amber-100',
    text: 'text-slate-700',
  };

  return (
    <div className={`relative rounded-2xl ${theme.panel} p-4 shadow-sm backdrop-blur-sm`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${theme.chip}`}>
              {annotationType}
            </span>
            {anchorLabel && <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{anchorLabel}</span>}
            <AnnotationIdBadge annotationId={annotationId} compact showCopyLink />
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
              visibility === 'private'
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}>
              <Shield size={10} />
              {visibility}
            </span>
            {publishStatus !== 'none' && (
              <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${statusTone}`}>
                {publishStatus}
              </span>
            )}
          </div>
          <div className="mt-2 truncate text-sm font-semibold text-slate-900">
            {targetLabel || 'Untitled target'}
          </div>
        </div>
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
              subjectAnnotation={subjectAnnotation ?? null}
              candidateAnnotations={candidateAnnotations}
              relations={relations ?? []}
              loading={relationsLoading ?? false}
              error={relationsError ?? ''}
              onOpenAnnotation={onOpenAnnotation}
              onCreateRelation={onCreateRelation}
              onDeleteRelation={onDeleteRelation}
              onSearchAnnotations={onSearchAnnotations ?? (async () => [])}
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
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setTagsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              <Tags size={13} />
              标签
              <span className="text-[10px]">{tagsOpen ? '▴' : '▾'}</span>
            </button>
            {tagsOpen && (
              <div className="mt-2">
                <EmailTagEditor
                  targetType="annotation"
                  targetRef={annotationId}
                  compact
                />
              </div>
            )}
          </div>
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
