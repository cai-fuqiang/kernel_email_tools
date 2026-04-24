import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileText, Mail, ScrollText } from 'lucide-react';
import AnnotationCard from './AnnotationCard';
import ThreadDrawer from './ThreadDrawer';
import {
  approveAnnotationPublication,
  createAnnotation,
  deleteAnnotation,
  rejectAnnotationPublication,
  requestAnnotationPublication,
  updateAnnotation,
  withdrawAnnotationPublication,
} from '../api/client';
import { useAuth } from '../auth';
import type { AnnotationListItem } from '../api/types';

interface AnnotationTreeProps {
  annotations: AnnotationListItem[];
  onAnnotationsChange?: () => void;
}

interface TreeNode {
  annotation: AnnotationListItem;
  children: TreeNode[];
  level: number;
}

function buildTree(annotations: AnnotationListItem[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const annotation of annotations) {
    nodes.set(annotation.annotation_id, {
      annotation,
      children: [],
      level: 0,
    });
  }

  for (const annotation of annotations) {
    const node = nodes.get(annotation.annotation_id);
    if (!node) continue;

    const parentId = annotation.parent_annotation_id || '';
    if (parentId && nodes.has(parentId)) {
      const parent = nodes.get(parentId)!;
      node.level = parent.level + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function getTargetIcon(type: string) {
  if (type === 'email_thread') return Mail;
  if (type === 'kernel_file') return FileText;
  if (type === 'knowledge_entity') return ScrollText;
  return ScrollText;
}

function getAnchorLabel(annotation: AnnotationListItem): string {
  if (annotation.annotation_type === 'code') {
    const start = annotation.start_line || Number(annotation.anchor?.['start_line'] || 0);
    const end = annotation.end_line || Number(annotation.anchor?.['end_line'] || start);
    return start > 0 ? `L${start}${end > start ? `-${end}` : ''}` : '';
  }

  const messageId = String(annotation.anchor?.['message_id'] || annotation.in_reply_to || '');
  return messageId ? '邮件节点' : '';
}

export default function AnnotationTree({ annotations, onAnnotationsChange }: AnnotationTreeProps) {
  const navigate = useNavigate();
  const { canWrite, currentUser, isAdmin } = useAuth();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [drawerThreadId, setDrawerThreadId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);

  const tree = useMemo(() => buildTree(annotations), [annotations]);

  useEffect(() => {
    const expandable = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          expandable.add(node.annotation.annotation_id);
          walk(node.children);
        }
      }
    };
    walk(tree);
    setExpandedIds(expandable);
  }, [tree]);

  const handleJump = (annotation: AnnotationListItem) => {
    if (annotation.target_type === 'email_thread' && annotation.thread_id) {
      setDrawerThreadId(annotation.thread_id);
      return;
    }

    if (annotation.target_type === 'kernel_file' && annotation.version && annotation.file_path) {
      const line = annotation.start_line || Number(annotation.anchor?.['start_line'] || 1);
      navigate(`/kernel-code?v=${encodeURIComponent(annotation.version)}&path=${encodeURIComponent(annotation.file_path)}&line=${line}`);
      return;
    }

    if (annotation.target_type === 'sdm_spec') {
      const query = annotation.target_label || annotation.target_ref;
      navigate(`/manual/search?q=${encodeURIComponent(query)}`);
      return;
    }

    if (annotation.target_type === 'knowledge_entity') {
      navigate(`/knowledge?entity_id=${encodeURIComponent(annotation.target_ref)}`);
    }
  };

  const handleReplySubmit = async (parent: AnnotationListItem) => {
    if (!replyBody.trim()) return;

    setReplyLoading(true);
    try {
      await createAnnotation({
        annotation_type: parent.annotation_type,
        body: replyBody.trim(),
        visibility: isAdmin ? parent.visibility : 'private',
        parent_annotation_id: parent.annotation_id,
        target_type: parent.target_type,
        target_ref: parent.target_ref,
        target_label: parent.target_label,
        target_subtitle: parent.target_subtitle,
        anchor: parent.anchor,
        thread_id: parent.thread_id,
        in_reply_to: parent.in_reply_to,
        version: parent.version,
        file_path: parent.file_path,
        start_line: parent.start_line,
        end_line: parent.end_line,
        meta: parent.meta,
      });
      setReplyingTo(null);
      setReplyBody('');
      onAnnotationsChange?.();
    } catch (error) {
      alert(error instanceof Error ? error.message : '回复失败');
    } finally {
      setReplyLoading(false);
    }
  };

  const renderNode = (node: TreeNode) => {
    const { annotation, children, level } = node;
    const isExpanded = expandedIds.has(annotation.annotation_id);
    const hasChildren = children.length > 0;
    const Icon = getTargetIcon(annotation.target_type);
    const anchorLabel = getAnchorLabel(annotation);

    return (
      <div key={annotation.annotation_id} className="space-y-3">
        <div className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 p-5 shadow-[0_12px_40px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-start gap-3">
            <button
              onClick={() => {
                if (!hasChildren) return;
                setExpandedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(annotation.annotation_id)) next.delete(annotation.annotation_id);
                  else next.add(annotation.annotation_id);
                  return next;
                });
              }}
              className="mt-0.5 flex min-w-[74px] items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600"
            >
              {hasChildren ? (
                <>
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {children.length} 回复
                </>
              ) : (
                <span>单条</span>
              )}
            </button>

            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="rounded-2xl bg-slate-900 p-2 text-white">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-semibold text-slate-900">
                    {annotation.target_label || annotation.email_subject || annotation.file_path || annotation.target_ref}
                  </h3>
                  {anchorLabel && (
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                      {anchorLabel}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {annotation.target_subtitle || annotation.email_sender || annotation.target_type}
                </p>
              </div>
              <button
                onClick={() => handleJump(annotation)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
              >
                跳转定位
              </button>
            </div>
          </div>

          <div className="mt-4">
            <AnnotationCard
              annotationId={annotation.annotation_id}
              annotationType={annotation.annotation_type}
              author={annotation.author}
              authorUserId={annotation.author_user_id}
              visibility={annotation.visibility}
              publishStatus={annotation.publish_status}
              body={annotation.body}
              createdAt={annotation.created_at}
              updatedAt={annotation.updated_at}
              publishReviewComment={annotation.publish_review_comment}
              targetLabel={annotation.target_label || annotation.email_subject || annotation.file_path || annotation.target_ref}
              targetSubtitle={annotation.target_subtitle || annotation.email_sender || annotation.target_type}
              anchorLabel={anchorLabel}
              canManage={
                !!currentUser &&
                (isAdmin ||
                  (canWrite &&
                    annotation.visibility === 'private' &&
                    annotation.publish_status !== 'pending' &&
                    annotation.author_user_id === currentUser.user_id))
              }
              canReply={canWrite}
              canRequestPublish={
                !!currentUser &&
                !isAdmin &&
                annotation.visibility === 'private' &&
                annotation.author_user_id === currentUser.user_id &&
                annotation.publish_status !== 'pending'
              }
              canWithdrawPublish={
                !!currentUser &&
                annotation.publish_status === 'pending' &&
                (isAdmin || annotation.author_user_id === currentUser.user_id)
              }
              canApprovePublish={!!currentUser && isAdmin && annotation.publish_status === 'pending'}
              canRejectPublish={!!currentUser && isAdmin && annotation.publish_status === 'pending'}
              onEdit={async (body) => {
                if (!currentUser) return;
                if (!(isAdmin || (annotation.visibility === 'private' && annotation.publish_status !== 'pending' && annotation.author_user_id === currentUser.user_id))) return;
                await updateAnnotation(annotation.annotation_id, body);
                onAnnotationsChange?.();
              }}
              onDelete={async () => {
                if (!currentUser) return;
                if (!(isAdmin || (annotation.visibility === 'private' && annotation.publish_status !== 'pending' && annotation.author_user_id === currentUser.user_id))) return;
                if (!confirm('确定要删除这个标注吗？')) return;
                await deleteAnnotation(annotation.annotation_id);
                onAnnotationsChange?.();
              }}
              onRequestPublish={async () => {
                try {
                  await requestAnnotationPublication(annotation.annotation_id);
                  onAnnotationsChange?.();
                } catch (error) {
                  alert(error instanceof Error ? error.message : '申请公开失败');
                }
              }}
              onWithdrawPublish={async () => {
                try {
                  await withdrawAnnotationPublication(annotation.annotation_id);
                  onAnnotationsChange?.();
                } catch (error) {
                  alert(error instanceof Error ? error.message : '撤回申请失败');
                }
              }}
              onApprovePublish={async () => {
                try {
                  const reviewComment = window.prompt('审核备注（可选）', '') || '';
                  await approveAnnotationPublication(annotation.annotation_id, reviewComment);
                  onAnnotationsChange?.();
                } catch (error) {
                  alert(error instanceof Error ? error.message : '审核通过失败');
                }
              }}
              onRejectPublish={async () => {
                try {
                  const reviewComment = window.prompt('驳回原因（可选）', '') || '';
                  await rejectAnnotationPublication(annotation.annotation_id, reviewComment);
                  onAnnotationsChange?.();
                } catch (error) {
                  alert(error instanceof Error ? error.message : '驳回失败');
                }
              }}
              onReply={() => {
                if (!canWrite) return;
                setReplyingTo(annotation.annotation_id);
                setReplyBody('');
              }}
              onJump={() => handleJump(annotation)}
            />
          </div>

          {canWrite && replyingTo === annotation.annotation_id && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-2 text-sm font-medium text-slate-700">回复此标注</div>
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                className="min-h-[96px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                placeholder="输入回复内容，支持 Markdown"
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleReplySubmit(annotation)}
                  disabled={!replyBody.trim() || replyLoading}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {replyLoading ? '提交中...' : '提交回复'}
                </button>
                <button
                  onClick={() => {
                    setReplyingTo(null);
                    setReplyBody('');
                  }}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>

        {hasChildren && isExpanded && (
          <div
            className="space-y-3 border-l-2 border-slate-200 pl-4"
            style={{ marginLeft: `${Math.min(level * 20 + 12, 72)}px` }}
          >
            {children.map((child) => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  if (tree.length === 0) return null;

  return (
    <>
      <div className="space-y-4">{tree.map((node) => renderNode(node))}</div>
      {drawerThreadId && <ThreadDrawer threadId={drawerThreadId} onClose={() => setDrawerThreadId(null)} />}
    </>
  );
}
