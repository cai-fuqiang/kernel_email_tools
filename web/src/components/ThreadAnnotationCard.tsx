import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  approveAnnotationPublication,
  rejectAnnotationPublication,
  requestAnnotationPublication,
  withdrawAnnotationPublication,
} from '../api/client';
import type { Annotation } from '../api/types';
import AnnotationIdBadge from './AnnotationIdBadge';
import EmailTagEditor from './EmailTagEditor';
import { showToast } from './Toast';
import { useAuth } from '../auth';
import ConfirmModal from './ConfirmModal';

// =============================================================
// 批注输入组件（Thread 抽屉内嵌版）
// =============================================================
export function AnnotationInput({
  onSubmit,
  onCancel,
  initialBody,
  submitLabel,
  showVisibility = true,
}: {
  onSubmit: (body: string, visibility: 'public' | 'private') => void;
  onCancel: () => void;
  initialBody?: string;
  submitLabel?: string;
  showVisibility?: boolean;
}) {
  const { canWrite, isAdmin } = useAuth();
  const [body, setBody] = useState(initialBody || '');
  const [visibility, setVisibility] = useState<'public' | 'private'>(isAdmin ? 'public' : 'private');

  useEffect(() => {
    if (!isAdmin) {
      setVisibility('private');
    }
  }, [isAdmin]);

  return (
    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full min-h-[80px] p-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 bg-white"
        placeholder="输入批注内容（支持 Markdown）..."
        autoFocus
        disabled={!canWrite}
      />
      {showVisibility && (
        <div className="mt-2 flex items-center gap-2 text-xs text-blue-700">
          <span>Visibility</span>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
            className="rounded border border-blue-300 bg-white px-2 py-1"
            disabled={!canWrite}
          >
            {isAdmin && <option value="public">Public</option>}
            <option value="private">Private</option>
          </select>
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => { if (body.trim()) onSubmit(body.trim(), visibility); }}
          disabled={!canWrite || !body.trim()}
          className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitLabel || '提交批注'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// =============================================================
// 线程抽屉内嵌批注卡片
//
// 与 components/AnnotationCard.tsx 的通用卡片不同：
// - 专用于 ThreadDrawer 线程树，蓝色边框 + "我的批注" chip + depth 缩进
// - 支持 highlighted (focusAnnotationId 高亮)
// - 内嵌发布审核按钮（申请公开 / 撤回 / 通过 / 驳回）
// =============================================================
export default function ThreadAnnotationCard({
  annotation,
  depth,
  highlighted = false,
  onEdit,
  onDelete,
  onReply,
  onRefresh,
}: {
  annotation: Annotation;
  depth: number;
  highlighted?: boolean;
  onEdit: (annotationId: string, body: string) => void;
  onDelete: (annotationId: string) => void;
  onReply: (annotationId: string) => void;
  onRefresh: () => void;
}) {
  const { canWrite, currentUser, isAdmin } = useAuth();
  const [editing, setEditing] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
  const canManage =
    !!currentUser &&
    (isAdmin ||
      (canWrite &&
        annotation.visibility === 'private' &&
        annotation.publish_status !== 'pending' &&
        annotation.author_user_id === currentUser.user_id));
  const canRequestPublish =
    !!currentUser &&
    !isAdmin &&
    annotation.visibility === 'private' &&
    annotation.author_user_id === currentUser.user_id &&
    annotation.publish_status !== 'pending';
  const canWithdrawPublish =
    !!currentUser &&
    annotation.publish_status === 'pending' &&
    (isAdmin || annotation.author_user_id === currentUser.user_id);
  const canReviewPublish = !!currentUser && isAdmin && annotation.publish_status === 'pending';
  const publishTone =
    annotation.publish_status === 'pending'
      ? 'bg-amber-100 text-amber-800'
      : annotation.publish_status === 'approved'
        ? 'bg-emerald-100 text-emerald-800'
        : annotation.publish_status === 'rejected'
          ? 'bg-rose-100 text-rose-800'
          : 'bg-slate-100 text-slate-700';

  const handleReviewConfirm = async (inputValue: string) => {
    if (!reviewAction) return;
    const action = reviewAction;
    setReviewAction(null);
    try {
      if (action === 'approve') {
        await approveAnnotationPublication(annotation.annotation_id, inputValue);
      } else {
        await rejectAnnotationPublication(annotation.annotation_id, inputValue);
      }
      onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : (action === 'approve' ? '审核通过失败' : '驳回失败'), 'error');
    }
  };

  return (
    <>
    <div
      data-annotation-id={annotation.annotation_id}
      className={`annotation-node border-l-4 rounded-lg p-4 my-2 transition-all ${
        highlighted ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-200' : 'border-blue-400 bg-blue-50'
      }`}
      style={{ marginLeft: depth > 0 ? `${Math.min(depth, 6) * 16}px` : 0 }}
    >
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="px-2 py-0.5 bg-blue-200 text-blue-800 text-xs rounded font-medium">我的批注</span>
        <span className="text-sm font-medium text-blue-900">{annotation.author}</span>
        <span className={`px-2 py-0.5 text-xs rounded font-medium ${annotation.visibility === 'private' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
          {annotation.visibility}
        </span>
        <span className={`px-2 py-0.5 text-xs rounded font-medium ${publishTone}`}>
          {annotation.publish_status}
        </span>
        <AnnotationIdBadge annotationId={annotation.annotation_id} compact className="bg-white/80" />
        <span className="text-xs text-blue-500 ml-auto">
          {new Date(annotation.created_at).toLocaleDateString('zh-CN', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </span>
        {annotation.updated_at !== annotation.created_at && (
          <span className="text-xs text-blue-400">(已编辑)</span>
        )}
      </div>
      {editing ? (
        <AnnotationInput
          initialBody={annotation.body}
          submitLabel="保存修改"
          onSubmit={(body) => { onEdit(annotation.annotation_id, body); setEditing(false); }}
          onCancel={() => setEditing(false)}
          showVisibility={false}
        />
      ) : (
        <>
          <div className="annotation-markdown text-sm text-blue-900 leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{annotation.body}</ReactMarkdown>
          </div>
          {annotation.publish_review_comment && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-white/70 px-3 py-2 text-xs text-blue-800">
              审核备注：{annotation.publish_review_comment}
            </div>
          )}
          <div className="mt-2">
            <EmailTagEditor
              targetType="annotation"
              targetRef={annotation.annotation_id}
              compact
            />
          </div>
          {(canRequestPublish || canWithdrawPublish || canReviewPublish) && (
            <div className="flex gap-2 mt-2">
              {canRequestPublish && (
                <button
                  onClick={async () => {
                    try {
                      await requestAnnotationPublication(annotation.annotation_id);
                      onRefresh();
                    } catch (e) {
                      showToast(e instanceof Error ? e.message : '申请公开失败', 'error');
                    }
                  }}
                  className="text-xs px-2 py-1 text-amber-700 bg-amber-100 hover:bg-amber-200 rounded transition-colors"
                >
                  申请公开
                </button>
              )}
              {canWithdrawPublish && (
                <button
                  onClick={async () => {
                    try {
                      await withdrawAnnotationPublication(annotation.annotation_id);
                      onRefresh();
                    } catch (e) {
                      showToast(e instanceof Error ? e.message : '撤回申请失败', 'error');
                    }
                  }}
                  className="text-xs px-2 py-1 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                >
                  撤回申请
                </button>
              )}
              {canReviewPublish && (
                <>
                  <button
                    onClick={() => setReviewAction('approve')}
                    className="text-xs px-2 py-1 text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded transition-colors"
                  >
                    通过公开
                  </button>
                  <button
                    onClick={() => setReviewAction('reject')}
                    className="text-xs px-2 py-1 text-rose-700 bg-rose-100 hover:bg-rose-200 rounded transition-colors"
                  >
                    驳回
                  </button>
                </>
              )}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            {canWrite && (
              <>
                <button
                  onClick={() => onReply(annotation.annotation_id)}
                  className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                >
                  回复
                </button>
                {canManage && (
                  <>
                    <button
                      onClick={() => setEditing(true)}
                      className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => onDelete(annotation.annotation_id)}
                      className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                    >
                      删除
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
    <ConfirmModal
      isOpen={reviewAction !== null}
      title={reviewAction === 'approve' ? '审核通过' : '驳回发布'}
      message={
        reviewAction === 'approve'
          ? '确认通过此批注的公开申请？可以留下审核备注。'
          : '确认驳回此批注的公开申请？可以填写驳回原因。'
      }
      confirmLabel={reviewAction === 'approve' ? '通过' : '驳回'}
      variant={reviewAction === 'approve' ? 'primary' : 'warning'}
      showInput
      inputLabel={reviewAction === 'approve' ? '审核备注（可选）' : '驳回原因（可选）'}
      inputPlaceholder={reviewAction === 'approve' ? '例如：内容清晰，通过' : '例如：内容需要补充证据'}
      onConfirm={handleReviewConfirm}
      onCancel={() => setReviewAction(null)}
    />
    </>
  );
}
