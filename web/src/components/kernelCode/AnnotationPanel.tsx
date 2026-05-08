import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  approveAnnotationPublication,
  createCodeAnnotation,
  deleteCodeAnnotation,
  rejectAnnotationPublication,
  requestAnnotationPublication,
  withdrawAnnotationPublication,
} from '../../api/client';
import type { CodeAnnotation } from '../../api/types';
import EmailTagEditor from '../EmailTagEditor';
import { useAuth } from '../../auth';
import { showToast } from '../Toast';
import ConfirmModal from '../ConfirmModal';

type PendingAction =
  | { kind: 'approve'; annotationId: string }
  | { kind: 'reject'; annotationId: string }
  | { kind: 'delete'; annotationId: string; isReply: boolean };

interface AnnotationPanelProps {
  annotations: CodeAnnotation[];
  selectedLines: Set<number>;
  version: string;
  filePath: string;
  onAnnotationCreated: () => void;
}

export default function AnnotationPanel({
  annotations,
  selectedLines,
  version,
  filePath,
  onAnnotationCreated,
}: AnnotationPanelProps) {
  const { canWrite, currentUser, isAdmin } = useAuth();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const rootAnnotations = useMemo(() => annotations.filter(a => !a.in_reply_to), [annotations]);
  const replyCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    annotations.forEach(a => {
      if (a.in_reply_to) acc[a.in_reply_to] = (acc[a.in_reply_to] || 0) + 1;
    });
    return acc;
  }, [annotations]);

  const canManage = (a: CodeAnnotation) =>
    !!currentUser && (isAdmin || (a.visibility === 'private' && a.publish_status !== 'pending' && a.author_user_id === currentUser.user_id));

  const toggleExpand = (id: string) =>
    setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  useEffect(() => {
    setExpandedIds(new Set(rootAnnotations.map(a => a.annotation_id)));
  }, [rootAnnotations]);

  useEffect(() => {
    if (selectedLines.size === 0) {
      setIsComposerOpen(false);
      setBody('');
    }
  }, [selectedLines]);

  const handleCreate = async () => {
    if (!body.trim() || selectedLines.size === 0) return;
    setSaving(true);
    try {
      const sorted = Array.from(selectedLines).sort((a, b) => a - b);
      await createCodeAnnotation({
        version, file_path: filePath,
        start_line: sorted[0], end_line: sorted[sorted.length - 1],
        body: body.trim(), visibility: isAdmin ? 'public' : 'private',
      });
      setBody('');
      setIsComposerOpen(false);
      onAnnotationCreated();
    } catch (e: unknown) {
      showToast(`创建失败: ${e instanceof Error ? e.message : e}`, 'error');
    } finally { setSaving(false); }
  };

  const lineInfo = selectedLines.size > 0
    ? `L${Array.from(selectedLines).sort((a, b) => a - b).join(', ')}` : '';

  const relevant = annotations.filter(a => {
    if (a.in_reply_to) return true;
    if (selectedLines.size === 0) return true;
    return Array.from(selectedLines).some(l => a.start_line <= l && a.end_line >= l);
  });

  const PublishButton = ({ a }: { a: CodeAnnotation }) => {
    if (isAdmin && a.publish_status === 'pending') return (
      <span className="flex gap-1">
        <button onClick={() => setPendingAction({ kind: 'approve', annotationId: a.annotation_id })}
          className="text-[10px] text-emerald-600">通过</button>
        <button onClick={() => setPendingAction({ kind: 'reject', annotationId: a.annotation_id })}
          className="text-[10px] text-rose-600">驳回</button>
      </span>
    );
    if (!isAdmin && a.visibility === 'private' && a.author_user_id === currentUser?.user_id && a.publish_status !== 'pending')
      return <button onClick={async () => {
        try {
          await requestAnnotationPublication(a.annotation_id);
          onAnnotationCreated();
        } catch (e) {
          showToast(e instanceof Error ? e.message : '申请公开失败', 'error');
        }
      }} className="text-[10px] text-amber-600">申请公开</button>;
    if (a.publish_status === 'pending' && (isAdmin || a.author_user_id === currentUser?.user_id))
      return <button onClick={async () => {
        try {
          await withdrawAnnotationPublication(a.annotation_id);
          onAnnotationCreated();
        } catch (e) {
          showToast(e instanceof Error ? e.message : '撤回失败', 'error');
        }
      }} className="text-[10px] text-slate-500">撤回</button>;
    return null;
  };

  const handleConfirmAction = async (inputValue: string) => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    try {
      if (action.kind === 'approve') {
        await approveAnnotationPublication(action.annotationId, inputValue);
      } else if (action.kind === 'reject') {
        await rejectAnnotationPublication(action.annotationId, inputValue);
      } else if (action.kind === 'delete') {
        await deleteCodeAnnotation(action.annotationId);
      }
      onAnnotationCreated();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败', 'error');
    }
  };

  const modalConfig = pendingAction && {
    approve: {
      title: '审核通过',
      message: '确认通过此注解的公开申请？可以留下审核备注。',
      confirmLabel: '通过',
      variant: 'primary' as const,
      showInput: true,
      inputLabel: '审核备注（可选）',
      inputPlaceholder: '例如：内容清晰，通过',
    },
    reject: {
      title: '驳回发布',
      message: '确认驳回此注解的公开申请？可以填写驳回原因。',
      confirmLabel: '驳回',
      variant: 'warning' as const,
      showInput: true,
      inputLabel: '驳回原因（可选）',
      inputPlaceholder: '例如：内容需要补充证据',
    },
    delete: {
      title: pendingAction?.kind === 'delete' && pendingAction.isReply ? '删除此回复？' : '删除此注解？',
      message: '删除后无法恢复。',
      confirmLabel: '删除',
      variant: 'danger' as const,
      showInput: false,
    },
  }[pendingAction.kind];

  return (
    <>
    <div className="flex w-full flex-col overflow-hidden bg-gray-50">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white p-2.5">
        <h3 className="text-sm font-semibold text-gray-700">注解</h3>
        <div className="flex items-center gap-1.5">
          {canWrite && selectedLines.size > 0 && (
            <>
              <span className="text-[10px] text-gray-400">{lineInfo}</span>
              <button
                onClick={() => setIsComposerOpen(prev => !prev)}
                className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100"
              >
                {isComposerOpen ? '收起' : '新增注解'}
              </button>
            </>
          )}
        </div>
      </div>

      {canWrite && selectedLines.size > 0 && isComposerOpen && (
        <div className="border-b border-gray-100 bg-white px-2.5 py-2">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="注解内容（Markdown）..."
            className="w-full min-h-[60px] text-xs border border-gray-200 rounded-lg p-2 outline-none focus:border-indigo-400 resize-y"
          />
          <div className="flex gap-2 mt-2">
            <button onClick={handleCreate} disabled={!body.trim() || saving}
              className="px-3 py-1 text-xs font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-50">
              {saving ? '保存中...' : '保存注解'}
            </button>
            <button
              onClick={() => {
                setIsComposerOpen(false);
                setBody('');
              }}
              disabled={saving}
              className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              取消
            </button>
          </div>
          <div className="mt-2">
            <EmailTagEditor
              targetType="kernel_line_range"
              targetRef={`${version}:${filePath}`}
              anchor={{ start_line: Math.min(...selectedLines), end_line: Math.max(...selectedLines) }}
            />
          </div>
        </div>
      )}

      <div className="max-h-72 overflow-y-auto p-2">
        {relevant.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">
            {selectedLines.size > 0 ? '所选行没有注解' : '点击行号添加注解'}
          </p>
        ) : (
          <div className="space-y-2">
            {rootAnnotations.filter(a => relevant.includes(a)).map(root => {
              const isExpanded = expandedIds.has(root.annotation_id);
              const replies = annotations.filter(a => a.in_reply_to === root.annotation_id);
              const replyCount = replyCounts[root.annotation_id] || 0;
              const statusColors: Record<string, string> = {
                pending: 'bg-amber-100 text-amber-800',
                approved: 'bg-emerald-100 text-emerald-800',
                rejected: 'bg-rose-100 text-rose-800',
              };
              const sc = statusColors[root.publish_status] || 'bg-slate-100 text-slate-700';

              return (
                <div key={root.annotation_id} className="space-y-1">
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                    <div className="px-3 py-2 bg-gray-50 flex items-center justify-between border-b border-gray-200">
                      <div className="flex items-center gap-2">
                        {replyCount > 0 && (
                          <button onClick={() => toggleExpand(root.annotation_id)} className="text-[10px] text-gray-400 w-4">
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        )}
                        <span className="text-xs text-gray-400">L{root.start_line}{root.end_line !== root.start_line ? `-${root.end_line}` : ''}</span>
                        {replyCount > 0 && <span className="text-[10px] text-gray-400">({replyCount})</span>}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sc}`}>{root.publish_status}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <PublishButton a={root} />
                        {canManage(root) && (
                          <button onClick={() => setPendingAction({ kind: 'delete', annotationId: root.annotation_id, isReply: false })}
                            className="text-[10px] text-gray-400 hover:text-red-500">删除</button>
                        )}
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <div className="markdown-content text-xs">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{root.body}</ReactMarkdown>
                      </div>
                      {root.publish_review_comment && (
                        <div className="mt-2 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] text-gray-600">
                          审核备注：{root.publish_review_comment}
                        </div>
                      )}
                      <div className="mt-2">
                        <EmailTagEditor targetType="annotation" targetRef={root.annotation_id} compact />
                      </div>
                    </div>
                  </div>

                  {isExpanded && replies.map(reply => (
                    <div key={reply.annotation_id} className="ml-4 bg-white border border-gray-200 border-l-4 border-l-green-500 rounded-lg overflow-hidden shadow-sm">
                      <div className="px-3 py-2 bg-gray-50 flex items-center justify-between border-b border-gray-200">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-green-500 bg-green-50 px-1.5 py-0.5 rounded">回复</span>
                          <span className="text-xs text-gray-400">L{reply.start_line}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColors[reply.publish_status] || 'bg-slate-100 text-slate-700'}`}>{reply.publish_status}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <PublishButton a={reply} />
                          {canManage(reply) && (
                            <button onClick={() => setPendingAction({ kind: 'delete', annotationId: reply.annotation_id, isReply: true })}
                              className="text-[10px] text-gray-400 hover:text-red-500">删除</button>
                          )}
                        </div>
                      </div>
                      <div className="px-3 py-2">
                        <div className="markdown-content text-xs">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply.body}</ReactMarkdown>
                        </div>
                        <div className="mt-2">
                          <EmailTagEditor targetType="annotation" targetRef={reply.annotation_id} compact />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    <ConfirmModal
      isOpen={!!pendingAction}
      title={modalConfig?.title || ''}
      message={modalConfig?.message || ''}
      confirmLabel={modalConfig?.confirmLabel}
      variant={modalConfig?.variant}
      showInput={modalConfig?.showInput}
      inputLabel={modalConfig?.inputLabel}
      inputPlaceholder={modalConfig?.inputPlaceholder}
      onConfirm={handleConfirmAction}
      onCancel={() => setPendingAction(null)}
    />
    </>
  );
}
