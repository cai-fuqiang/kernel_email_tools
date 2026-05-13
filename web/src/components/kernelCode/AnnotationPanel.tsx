import { useEffect, useMemo, useState, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LocateFixed, Maximize2, X } from 'lucide-react';
import {
  approveAnnotationPublication,
  createCodeAnnotation,
  deleteCodeAnnotation,
  rejectAnnotationPublication,
  requestAnnotationPublication,
  updateCodeAnnotation,
  withdrawAnnotationPublication,
} from '../../api/client';
import type { CodeAnnotation } from '../../api/types';
import EmailTagEditor from '../EmailTagEditor';
import { useAuth } from '../../auth';
import { showToast } from '../Toast';
import ConfirmModal from '../ConfirmModal';
import InspectorDetailModal from './InspectorDetailModal';
import { getAnnotationLineRange, rankRollerItems } from './annotationSync';

type PendingAction =
  | { kind: 'approve'; annotationId: string }
  | { kind: 'reject'; annotationId: string }
  | { kind: 'delete'; annotationId: string; isReply: boolean };

function formatAnnotationLineRange(annotation: CodeAnnotation): string {
  const { start, end } = getAnnotationLineRange(annotation);
  if (start <= 0) return 'Line unknown';
  return `L${start}${end !== start ? `-${end}` : ''}`;
}

interface AnnotationPanelProps {
  annotations: CodeAnnotation[];
  selectedLines: Set<number>;
  version: string;
  filePath: string;
  onAnnotationCreated: () => void;
  hideHeader?: boolean;
  activeAnnotationId?: string | null;
  pinnedAnnotationId?: string | null;
  onJumpToAnnotation?: (annotation: CodeAnnotation, options?: { pin?: boolean }) => void;
  onRollerCenteredAnnotationChange?: (annotation: CodeAnnotation) => void;
  rollerContainerRef?: RefObject<HTMLDivElement>;
}

export default function AnnotationPanel({
  annotations,
  selectedLines,
  version,
  filePath,
  onAnnotationCreated,
  hideHeader = false,
  activeAnnotationId = null,
  pinnedAnnotationId = null,
  onJumpToAnnotation,
  onRollerCenteredAnnotationChange,
  rollerContainerRef,
}: AnnotationPanelProps) {
  const { canWrite, currentUser, isAdmin } = useAuth();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [previewAnnotation, setPreviewAnnotation] = useState<CodeAnnotation | null>(null);
  const [previewStartEditing, setPreviewStartEditing] = useState(false);

  const rootAnnotations = useMemo(() => annotations.filter(a => !a.in_reply_to), [annotations]);
  const repliesByParentId = useMemo(() => {
    const acc: Record<string, CodeAnnotation[]> = {};
    for (const annotation of annotations) {
      if (!annotation.in_reply_to) continue;
      if (!acc[annotation.in_reply_to]) acc[annotation.in_reply_to] = [];
      acc[annotation.in_reply_to].push(annotation);
    }
    return acc;
  }, [annotations]);
  const pinnedAnnotation = useMemo(
    () => rootAnnotations.find((annotation) => annotation.annotation_id === pinnedAnnotationId) || null,
    [pinnedAnnotationId, rootAnnotations],
  );
  const rollerItems = useMemo(
    () => rankRollerItems(rootAnnotations, activeAnnotationId),
    [activeAnnotationId, rootAnnotations],
  );
  const replyCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const [parentId, replies] of Object.entries(repliesByParentId)) {
      acc[parentId] = replies.length;
    }
    return acc;
  }, [repliesByParentId]);

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
      showToast(`Create failed: ${e instanceof Error ? e.message : e}`, 'error');
    } finally { setSaving(false); }
  };

  const lineInfo = selectedLines.size > 0
    ? `L${Array.from(selectedLines).sort((a, b) => a - b).join(', ')}` : '';

  const PublishButton = ({ a }: { a: CodeAnnotation }) => {
    if (isAdmin && a.publish_status === 'pending') return (
      <span className="flex gap-1">
        <button onClick={() => setPendingAction({ kind: 'approve', annotationId: a.annotation_id })}
          className="text-[10px] text-emerald-600">Approve</button>
        <button onClick={() => setPendingAction({ kind: 'reject', annotationId: a.annotation_id })}
          className="text-[10px] text-rose-600">Reject</button>
      </span>
    );
    if (!isAdmin && a.visibility === 'private' && a.author_user_id === currentUser?.user_id && a.publish_status !== 'pending')
      return <button onClick={async () => {
        try {
          await requestAnnotationPublication(a.annotation_id);
          onAnnotationCreated();
        } catch (e) {
          showToast(e instanceof Error ? e.message : 'Publication request failed', 'error');
        }
      }} className="text-[10px] text-amber-600">Request public</button>;
    if (a.publish_status === 'pending' && (isAdmin || a.author_user_id === currentUser?.user_id))
      return <button onClick={async () => {
        try {
          await withdrawAnnotationPublication(a.annotation_id);
          onAnnotationCreated();
        } catch (e) {
          showToast(e instanceof Error ? e.message : 'Withdraw failed', 'error');
        }
      }} className="text-[10px] text-slate-600">Withdraw</button>;
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
      showToast(e instanceof Error ? e.message : 'Action failed', 'error');
    }
  };

  const modalConfig = pendingAction && {
    approve: {
      title: 'Approve Publication',
      message: 'Approve this annotation publication request? You can leave an optional review note.',
      confirmLabel: 'Approve',
      variant: 'primary' as const,
      showInput: true,
      inputLabel: 'Review note (optional)',
      inputPlaceholder: 'For example: clear and ready to publish',
    },
    reject: {
      title: 'Reject Publication',
      message: 'Reject this annotation publication request? You can add an optional reason.',
      confirmLabel: 'Reject',
      variant: 'warning' as const,
      showInput: true,
      inputLabel: 'Rejection reason (optional)',
      inputPlaceholder: 'For example: add supporting evidence',
    },
    delete: {
      title: pendingAction?.kind === 'delete' && pendingAction.isReply ? 'Delete This Reply?' : 'Delete This Annotation?',
      message: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger' as const,
      showInput: false,
    },
  }[pendingAction.kind];

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-rose-100 text-rose-800',
  };

  const renderJumpButton = (annotation: CodeAnnotation) => {
    if (!onJumpToAnnotation) return null;
    const lineRange = formatAnnotationLineRange(annotation);
    const label = `Jump to ${lineRange}`;
    return (
      <button
        type="button"
        onClick={() => onJumpToAnnotation(annotation, { pin: true })}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-white hover:text-sky-700"
        aria-label={label}
        title={label}
      >
        <LocateFixed className="h-3.5 w-3.5" />
      </button>
    );
  };

  const rollerStyleFor = (position: number, active: boolean) => {
    const clamped = Math.max(-4, Math.min(4, position));
    const distance = Math.min(Math.abs(position), 4);
    const scale = active ? 1 : Math.max(0.9, 1 - distance * 0.045);
    const opacity = active ? 1 : Math.max(0.48, 1 - distance * 0.16);
    return {
      opacity,
      transform: `translateZ(${-distance * 24}px) rotateX(${-clamped * 2.5}deg) scale(${scale})`,
      transformStyle: 'preserve-3d',
    } as const;
  };

  const rootCardClasses = ({
    active = false,
    pinned = false,
  }: {
    active?: boolean;
    pinned?: boolean;
  }) =>
    [
      'bg-white border rounded-lg overflow-hidden transition-all duration-200',
      pinned
        ? 'border-sky-300 shadow-md ring-1 ring-sky-100'
        : active
          ? 'border-sky-300 shadow-md ring-1 ring-sky-100'
          : 'border-slate-300 shadow-sm',
    ].join(' ');

  const renderReplyCard = (reply: CodeAnnotation) => (
    <div key={reply.annotation_id} className="ml-4 bg-white border border-slate-300 border-l-4 border-l-green-500 rounded-lg overflow-hidden shadow-sm">
      <div className="px-3 py-2 bg-slate-100 flex items-center justify-between border-b border-slate-300">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-green-700 bg-green-50 px-1.5 py-0.5 rounded">Reply</span>
          <span className="text-xs text-slate-600">{formatAnnotationLineRange(reply)}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColors[reply.publish_status] || 'bg-slate-200 text-slate-900'}`}>{reply.publish_status}</span>
        </div>
        <div className="flex items-center gap-2">
          <PublishButton a={reply} />
          {canManage(reply) && (
            <button
              type="button"
              onClick={() => {
                setPreviewAnnotation(reply);
                setPreviewStartEditing(true);
              }}
              className="text-[10px] text-slate-600 hover:text-slate-950"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setPreviewAnnotation(reply);
              setPreviewStartEditing(false);
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-white hover:text-slate-900"
            aria-label="Open reply detail"
            title="Open reply detail"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          {canManage(reply) && (
            <button onClick={() => setPendingAction({ kind: 'delete', annotationId: reply.annotation_id, isReply: true })}
              className="text-[10px] text-slate-600 hover:text-red-500">Delete</button>
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
  );

  const renderRootCard = (
    root: CodeAnnotation,
    options: { active?: boolean; pinned?: boolean } = {},
  ) => {
    const isExpanded = expandedIds.has(root.annotation_id);
    const replies = repliesByParentId[root.annotation_id] || [];
    const replyCount = replyCounts[root.annotation_id] || 0;
    const sc = statusColors[root.publish_status] || 'bg-slate-200 text-slate-900';

    return (
      <div key={root.annotation_id} className="space-y-1">
        <div className={rootCardClasses(options)}>
          <div className={`px-3 py-2 flex items-center justify-between border-b border-slate-300 ${options.active || options.pinned ? 'bg-sky-50' : 'bg-slate-100'}`}>
            <div className="flex items-center gap-2">
              {replyCount > 0 && (
                <button onClick={() => toggleExpand(root.annotation_id)} className="text-[10px] text-slate-600 w-4">
                  {isExpanded ? '▼' : '▶'}
                </button>
              )}
              <span className="text-xs text-slate-600">{formatAnnotationLineRange(root)}</span>
              {replyCount > 0 && <span className="text-[10px] text-slate-600">({replyCount})</span>}
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sc}`}>{root.publish_status}</span>
            </div>
            <div className="flex items-center gap-2">
              {renderJumpButton(root)}
              <PublishButton a={root} />
              {canManage(root) && (
                <button
                  type="button"
                  onClick={() => {
                    setPreviewAnnotation(root);
                    setPreviewStartEditing(true);
                  }}
                  className="text-[10px] text-slate-600 hover:text-slate-950"
                >
                  Edit
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPreviewAnnotation(root);
                  setPreviewStartEditing(false);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-white hover:text-slate-900"
                aria-label="Open annotation detail"
                title="Open annotation detail"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              {canManage(root) && (
                <button onClick={() => setPendingAction({ kind: 'delete', annotationId: root.annotation_id, isReply: false })}
                  className="text-[10px] text-slate-600 hover:text-red-500">Delete</button>
              )}
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="markdown-content text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{root.body}</ReactMarkdown>
            </div>
            {root.publish_review_comment && (
              <div className="mt-2 rounded border border-slate-300 bg-slate-100 px-2 py-1 text-[10px] text-slate-700">
                Review note: {root.publish_review_comment}
              </div>
            )}
            <div className="mt-2">
              <EmailTagEditor targetType="annotation" targetRef={root.annotation_id} compact />
            </div>
          </div>
        </div>

        {isExpanded && replies.map(reply => renderReplyCard(reply))}
      </div>
    );
  };

  return (
    <>
    <div className="flex w-full flex-col bg-slate-100">
      {!hideHeader && <div className="flex items-center justify-between border-b border-slate-300 bg-white p-2.5">
        <h3 className="text-sm font-semibold text-slate-900">Annotations</h3>
        <div className="flex items-center gap-1.5">
          {canWrite && selectedLines.size > 0 && (
            <>
              <span className="text-[10px] text-slate-600">{lineInfo}</span>
              <button
                onClick={() => setIsComposerOpen(prev => !prev)}
                className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100"
              >
                {isComposerOpen ? 'Collapse' : 'New annotation'}
              </button>
            </>
          )}
        </div>
      </div>}

      {hideHeader && canWrite && selectedLines.size > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-600">{lineInfo}</span>
          <button
            onClick={() => setIsComposerOpen(prev => !prev)}
            className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100"
          >
            {isComposerOpen ? 'Collapse' : 'New annotation'}
          </button>
        </div>
      )}

      {canWrite && selectedLines.size > 0 && isComposerOpen && (
        <div className="border-b border-slate-300 bg-white px-2.5 py-2">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Annotation content (Markdown)..."
            className="w-full min-h-[60px] text-xs border border-slate-300 rounded-lg p-2 outline-none focus:border-indigo-400 resize-y"
          />
          <div className="flex gap-2 mt-2">
            <button onClick={handleCreate} disabled={!body.trim() || saving}
              className="px-3 py-1 text-xs font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save annotation'}
            </button>
            <button
              onClick={() => {
                setIsComposerOpen(false);
                setBody('');
              }}
              disabled={saving}
              className="px-3 py-1 text-xs font-medium text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300 disabled:opacity-50"
            >
              Cancel
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

      <div className="p-2">
        {pinnedAnnotation && (
          <div className="sticky top-0 z-20 mb-3 rounded-lg border border-sky-200 bg-sky-50/95 p-2 shadow-sm backdrop-blur">
            <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-800">Pinned</span>
              <span className="text-[10px] font-medium text-sky-700">{formatAnnotationLineRange(pinnedAnnotation)}</span>
            </div>
            {renderRootCard(pinnedAnnotation, {
              active: pinnedAnnotation.annotation_id === activeAnnotationId,
              pinned: true,
            })}
          </div>
        )}

        {!pinnedAnnotation && selectedLines.size > 0 && (
          <div className="sticky top-0 z-20 mb-3 rounded-lg border border-dashed border-slate-300 bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-sm backdrop-blur">
            Selected {lineInfo}; choose an annotation to pin it here.
          </div>
        )}

        {rollerItems.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-8">
            No annotations in this file yet
          </p>
        ) : (
          <section
            ref={rollerContainerRef}
            aria-label="Annotation roller"
            className="max-h-[58vh] overflow-y-auto overscroll-contain pr-1 [perspective:900px]"
            onScroll={(event) => {
              if (!onRollerCenteredAnnotationChange) return;
              const container = event.currentTarget;
              const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-annotation-id]'));
              const center = container.getBoundingClientRect().top + container.clientHeight / 2;
              const nearest = cards
                .map((card) => ({
                  id: card.dataset.annotationId || '',
                  distance: Math.abs(card.getBoundingClientRect().top + card.offsetHeight / 2 - center),
                }))
                .sort((a, b) => a.distance - b.distance)[0];
              if (!nearest?.id || nearest.id === activeAnnotationId) return;
              const annotation = rootAnnotations.find((item) => item.annotation_id === nearest.id);
              if (annotation) onRollerCenteredAnnotationChange(annotation);
            }}
          >
            <div className="space-y-2 [transform-style:preserve-3d]">
              {rollerItems.map(({ annotation, position, active }) => (
                <div
                  key={annotation.annotation_id}
                  className="origin-center transition-all duration-200 ease-out"
                  style={rollerStyleFor(position, active)}
                >
                  {renderRootCard(annotation, { active })}
                </div>
              ))}
            </div>
          </section>
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
    <AnnotationDetailModal
      annotation={previewAnnotation}
      initialEditing={previewStartEditing}
      replies={
        previewAnnotation
          ? annotations.filter((annotation) => annotation.in_reply_to === previewAnnotation.annotation_id)
          : []
      }
      onClose={() => {
        setPreviewAnnotation(null);
        setPreviewStartEditing(false);
      }}
      onRefresh={onAnnotationCreated}
    />
    </>
  );
}

function AnnotationDetailModal({
  annotation,
  replies,
  onClose,
  onRefresh,
  initialEditing = false,
}: {
  annotation: CodeAnnotation | null;
  replies: CodeAnnotation[];
  onClose: () => void;
  onRefresh: () => void;
  initialEditing?: boolean;
}) {
  const { currentUser, isAdmin } = useAuth();
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [draftBody, setDraftBody] = useState(annotation?.body || '');
  const [draftVisibility, setDraftVisibility] = useState<'public' | 'private'>(annotation?.visibility || 'private');
  const [saving, setSaving] = useState(false);
  const annotationId = annotation?.annotation_id || '';

  useEffect(() => {
    if (!annotation) return;
    setDraftBody(annotation.body);
    setDraftVisibility(annotation.visibility);
    setIsEditing(initialEditing);
    setSaving(false);
  }, [annotationId, initialEditing]);

  if (!annotation) return null;

  const canManage =
    !!currentUser &&
    (isAdmin ||
      (annotation.visibility === 'private' &&
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
  const canEditVisibility = !!currentUser && isAdmin;

  const handleSave = async () => {
    if (!draftBody.trim() || saving) return;
    setSaving(true);
    try {
      await updateCodeAnnotation(annotation.annotation_id, {
        body: draftBody.trim(),
        ...(canEditVisibility ? { visibility: draftVisibility } : {}),
      });
      showToast('Annotation updated', 'success');
      setDraftBody(draftBody.trim());
      setDraftVisibility(canEditVisibility ? draftVisibility : annotation.visibility);
      setIsEditing(false);
      onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Update failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestPublish = async () => {
    try {
      await requestAnnotationPublication(annotation.annotation_id);
      showToast('Publication requested', 'success');
      onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Publication request failed', 'error');
    }
  };

  const handleWithdrawPublish = async () => {
    try {
      await withdrawAnnotationPublication(annotation.annotation_id);
      showToast('Publication request withdrawn', 'success');
      onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Withdraw failed', 'error');
    }
  };

  return (
    <InspectorDetailModal
      isOpen={!!annotation}
      onClose={onClose}
      title={`${formatAnnotationLineRange(annotation)} annotation`}
      subtitle={
        <span>
          {annotation.visibility} · {annotation.publish_status}
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isEditing && canRequestPublish && (
            <button
              type="button"
              onClick={handleRequestPublish}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
            >
              Request public
            </button>
          )}
          {!isEditing && canWithdrawPublish && (
            <button
              type="button"
              onClick={handleWithdrawPublish}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
            >
              Withdraw
            </button>
          )}
          {!isEditing && canManage && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
            >
              Edit
            </button>
          )}
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraftBody(annotation.body);
                  setDraftVisibility(annotation.visibility);
                  setIsEditing(false);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !draftBody.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-600"
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
              Close
            </button>
          )}
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="min-w-0 rounded-lg border border-slate-300 bg-white p-4">
          {isEditing ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                  Body
                </label>
                <textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  className="min-h-[320px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-400"
                  placeholder="Write annotation content..."
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-300 bg-slate-100 px-3 py-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Visibility</div>
                  <div className="mt-1 text-xs text-slate-600">
                    {canEditVisibility ? 'Admins can switch public/private.' : 'Only private edits are allowed here; use Request public after saving.'}
                  </div>
                </div>
                <select
                  value={draftVisibility}
                  onChange={(e) => setDraftVisibility(e.target.value as 'public' | 'private')}
                  disabled={!canEditVisibility}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none disabled:bg-slate-200"
                >
                  <option value="private">private</option>
                  {canEditVisibility && <option value="public">public</option>}
                </select>
              </div>
            </div>
          ) : (
            <>
              <div className="markdown-content text-sm leading-6">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{annotation.body}</ReactMarkdown>
              </div>
              {annotation.publish_review_comment && (
                <div className="mt-4 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-700">
                  Review note: {annotation.publish_review_comment}
                </div>
              )}
            </>
          )}
        </section>
        <aside className="space-y-3">
          <div className="rounded-lg border border-slate-300 bg-slate-100 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              Target
            </div>
            <dl className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Version</dt>
                <dd className="font-medium text-slate-950">{annotation.version}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Path</dt>
                <dd className="min-w-0 truncate font-mono text-slate-950">{annotation.file_path}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Range</dt>
                <dd className="font-medium text-slate-950">{formatAnnotationLineRange(annotation)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Visibility</dt>
                <dd className="font-medium text-slate-950">{annotation.visibility}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Status</dt>
                <dd className="font-medium text-slate-950">{annotation.publish_status}</dd>
              </div>
            </dl>
          </div>
          {replies.length > 0 && (
            <div className="rounded-lg border border-slate-300 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                Replies
              </div>
              <div className="mt-2 max-h-[50vh] space-y-2 overflow-y-auto">
                {replies.map((reply) => (
                  <div key={reply.annotation_id} className="rounded-lg border border-slate-300 bg-slate-100 p-2">
                    <div className="mb-1 text-[10px] font-medium text-slate-600">
                      {formatAnnotationLineRange(reply)} · {reply.publish_status}
                    </div>
                    <div className="markdown-content text-xs">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply.body}</ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </InspectorDetailModal>
  );
}
