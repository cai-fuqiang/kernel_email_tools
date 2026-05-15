import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { LocateFixed, Maximize2, PanelRightOpen, X } from 'lucide-react';
import {
  approveAnnotationPublication,
  createAnnotationRelation,
  createCodeAnnotation,
  deleteAnnotationRelation,
  deleteCodeAnnotation,
  listCodeAnnotations,
  listAnnotationRelations,
  rejectAnnotationPublication,
  requestAnnotationPublication,
  updateCodeAnnotation,
  withdrawAnnotationPublication,
} from '../../api/client';
import type { AnnotationRelation, AnnotationRelationCreate, CodeAnnotation } from '../../api/types';
import EmailTagEditor from '../EmailTagEditor';
import AnnotationIdBadge from '../AnnotationIdBadge';
import AnnotationMarkdown from '../AnnotationMarkdown';
import AnnotationRelationsPanel from '../AnnotationRelationsPanel';
import VariableTracePanel from '../VariableTracePanel';
import { useAuth } from '../../auth';
import { showToast } from '../Toast';
import ConfirmModal from '../ConfirmModal';
import InspectorDetailModal from './InspectorDetailModal';
import AnnotationQuickPreviewPopover from './AnnotationQuickPreviewPopover';
import { pickRollerActiveAnnotationId, rankRollerItems } from './annotationSync';
import {
  formatAnnotationPreviewLineRange,
  handleAnnotationPreviewButtonClick,
  resolveAnnotationCardClickAction,
  shouldIgnoreAnnotationCardClick,
} from './annotationPreview';

type PendingAction =
  | { kind: 'approve'; annotationId: string }
  | { kind: 'reject'; annotationId: string }
  | { kind: 'delete'; annotationId: string; isReply: boolean };

export function shouldShowSecondaryKernelRangeTagging(): boolean {
  return true;
}

export function getKernelRangeTaggingLabel(): string {
  return 'Advanced: tag selected lines';
}

function formatAnnotationLineRange(annotation: CodeAnnotation): string {
  return formatAnnotationPreviewLineRange(annotation);
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
  onFocusAnnotation?: (annotation: CodeAnnotation) => void;
  onJumpToAnnotation?: (annotation: CodeAnnotation, options?: { pin?: boolean }) => void;
  onTogglePinAnnotation?: (annotation: CodeAnnotation) => void;
  onPreviewAnnotation?: (annotation: CodeAnnotation, event: ReactMouseEvent<HTMLButtonElement>) => void;
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
  onFocusAnnotation,
  onJumpToAnnotation,
  onTogglePinAnnotation,
  onPreviewAnnotation,
  onRollerCenteredAnnotationChange,
  rollerContainerRef,
}: AnnotationPanelProps) {
  const { canWrite, currentUser, isAdmin } = useAuth();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [showRangeTaggingTools, setShowRangeTaggingTools] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [previewAnnotation, setPreviewAnnotation] = useState<CodeAnnotation | null>(null);
  const [previewStartEditing, setPreviewStartEditing] = useState(false);
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [inlineEditBody, setInlineEditBody] = useState('');
  const [inlineEditSaving, setInlineEditSaving] = useState(false);

  const startInlineEdit = (annotation: CodeAnnotation) => {
    setInlineEditingId(annotation.annotation_id);
    setInlineEditBody(annotation.body);
  };

  const cancelInlineEdit = () => {
    setInlineEditingId(null);
    setInlineEditBody('');
  };

  const submitInlineEdit = async (annotation: CodeAnnotation) => {
    const trimmed = inlineEditBody.trim();
    if (!trimmed || inlineEditSaving) return;
    setInlineEditSaving(true);
    try {
      await updateCodeAnnotation(annotation.annotation_id, { body: trimmed });
      setInlineEditingId(null);
      setInlineEditBody('');
      onAnnotationCreated();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setInlineEditSaving(false);
    }
  };
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const cardClickTimerRef = useRef<number | null>(null);
  const captureFocusedAnnotationRef = useRef<string | null>(null);
  const captureFocusCleanupTimerRef = useRef<number | null>(null);
  const clickDetailPinnedAnnotationRef = useRef<string | null>(null);
  const clickDetailPinCleanupTimerRef = useRef<number | null>(null);

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
      setShowRangeTaggingTools(false);
    }
  }, [selectedLines]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setPrefersReducedMotion(query.matches);
    updateMotionPreference();
    query.addEventListener('change', updateMotionPreference);
    return () => query.removeEventListener('change', updateMotionPreference);
  }, []);

  useEffect(() => () => {
    if (captureFocusCleanupTimerRef.current !== null) {
      window.clearTimeout(captureFocusCleanupTimerRef.current);
    }
    if (clickDetailPinCleanupTimerRef.current !== null) {
      window.clearTimeout(clickDetailPinCleanupTimerRef.current);
    }
  }, []);

  const markCaptureFocusedAnnotation = (annotationId: string) => {
    captureFocusedAnnotationRef.current = annotationId;
    if (captureFocusCleanupTimerRef.current !== null) {
      window.clearTimeout(captureFocusCleanupTimerRef.current);
    }
    captureFocusCleanupTimerRef.current = window.setTimeout(() => {
      if (captureFocusedAnnotationRef.current === annotationId) {
        captureFocusedAnnotationRef.current = null;
      }
      captureFocusCleanupTimerRef.current = null;
    }, 0);
  };

  const consumeCaptureFocusedAnnotation = (annotationId: string) => {
    if (captureFocusedAnnotationRef.current !== annotationId) return false;
    captureFocusedAnnotationRef.current = null;
    if (captureFocusCleanupTimerRef.current !== null) {
      window.clearTimeout(captureFocusCleanupTimerRef.current);
      captureFocusCleanupTimerRef.current = null;
    }
    return true;
  };

  const markClickDetailPinnedAnnotation = (annotationId: string) => {
    clickDetailPinnedAnnotationRef.current = annotationId;
    if (clickDetailPinCleanupTimerRef.current !== null) {
      window.clearTimeout(clickDetailPinCleanupTimerRef.current);
    }
    clickDetailPinCleanupTimerRef.current = window.setTimeout(() => {
      if (clickDetailPinnedAnnotationRef.current === annotationId) {
        clickDetailPinnedAnnotationRef.current = null;
      }
      clickDetailPinCleanupTimerRef.current = null;
    }, 350);
  };

  const consumeClickDetailPinnedAnnotation = (annotationId: string) => {
    if (clickDetailPinnedAnnotationRef.current !== annotationId) return false;
    clickDetailPinnedAnnotationRef.current = null;
    if (clickDetailPinCleanupTimerRef.current !== null) {
      window.clearTimeout(clickDetailPinCleanupTimerRef.current);
      clickDetailPinCleanupTimerRef.current = null;
    }
    return true;
  };

  useEffect(() => () => {
    if (cardClickTimerRef.current !== null) {
      window.clearTimeout(cardClickTimerRef.current);
      cardClickTimerRef.current = null;
    }
  }, []);

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
        onClick={() => onJumpToAnnotation(annotation, { pin: false })}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-white hover:text-sky-700"
        aria-label={label}
        title={label}
      >
        <LocateFixed className="h-3.5 w-3.5" />
      </button>
    );
  };

  const renderPreviewButton = (annotation: CodeAnnotation) => {
    if (!onPreviewAnnotation) return null;
    const lineRange = formatAnnotationLineRange(annotation);
    const label = `Preview annotation for ${lineRange}`;
    return (
      <button
        type="button"
        data-no-annotation-select
        onClick={(event) => {
          handleAnnotationPreviewButtonClick(annotation, event, (selected) => {
            onPreviewAnnotation(selected, event);
          });
        }}
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:bg-white hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
        aria-label={label}
        title={label}
      >
        <PanelRightOpen className="h-3.5 w-3.5" />
      </button>
    );
  };

  const rollerStyleFor = (position: number, active: boolean) => {
    const distance = Math.min(Math.abs(position), 4);
    const scale = active ? 1.03 : Math.max(0.94, 0.985 - distance * 0.02);
    const opacity = active ? 1 : Math.max(0.7, 1 - distance * 0.08);
    if (prefersReducedMotion) {
      return {
        opacity,
        transform: active ? 'scale(1.01)' : 'none',
        zIndex: active ? 2 : 1,
      } as const;
    }
    return {
      opacity,
      transform: `scale(${scale})`,
      zIndex: active ? 2 : 1,
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
        ? 'border-sky-400 shadow-md ring-1 ring-sky-200'
        : active
          ? 'border-sky-400 shadow-lg ring-1 ring-sky-200'
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
          {renderPreviewButton(reply)}
          <PublishButton a={reply} />
          {canManage(reply) && inlineEditingId !== reply.annotation_id && (
            <button
              type="button"
              onClick={() => startInlineEdit(reply)}
              className="text-[10px] text-slate-600 hover:text-slate-950"
            >
              编辑
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setPreviewAnnotation(reply);
              setPreviewStartEditing(false);
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-white hover:text-slate-900"
            aria-label="打开回复详情"
            title="打开回复详情"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          {canManage(reply) && (
            <button onClick={() => setPendingAction({ kind: 'delete', annotationId: reply.annotation_id, isReply: true })}
              className="text-[10px] text-slate-600 hover:text-red-500">删除</button>
          )}
        </div>
      </div>
      <div className="px-3 py-2">
        {inlineEditingId === reply.annotation_id ? (
          <div>
            <textarea
              value={inlineEditBody}
              onChange={(e) => setInlineEditBody(e.target.value)}
              className="w-full min-h-[72px] text-xs border border-slate-300 rounded-lg p-2 outline-none focus:border-indigo-400 resize-y"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => submitInlineEdit(reply)}
                disabled={!inlineEditBody.trim() || inlineEditSaving}
                className="px-3 py-1 text-xs font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-50"
              >
                {inlineEditSaving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={cancelInlineEdit}
                disabled={inlineEditSaving}
                className="px-3 py-1 text-xs font-medium text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300 disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <AnnotationMarkdown
            body={reply.body}
            className="markdown-content text-xs"
            onOpenAnnotation={(annotationId) => {
              const target = annotations.find((item) => item.annotation_id === annotationId);
              if (target) {
                setPreviewAnnotation(target);
                setPreviewStartEditing(false);
              }
            }}
          />
        )}
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
      <div
        key={root.annotation_id}
        data-annotation-id={root.annotation_id}
        className={`space-y-1 ${onJumpToAnnotation || onFocusAnnotation ? 'cursor-pointer' : ''}`}
        title={resolveAnnotationCardClickAction({ active: Boolean(options.active), pinned: Boolean(options.pinned) }) === 'jump'
          ? 'Click to jump to code. Double-click to pin.'
          : 'Click to focus this annotation. Double-click to pin.'}
        onClickCapture={(event) => {
          if (event.detail > 1 && onTogglePinAnnotation) {
            event.preventDefault();
            event.stopPropagation();
            if (cardClickTimerRef.current !== null) {
              window.clearTimeout(cardClickTimerRef.current);
              cardClickTimerRef.current = null;
            }
            captureFocusedAnnotationRef.current = null;
            markClickDetailPinnedAnnotation(root.annotation_id);
            onTogglePinAnnotation(root);
            return;
          }
          if (!onFocusAnnotation || options.active || options.pinned) return;
          if (event.button !== 0 || event.detail > 1) return;
          markCaptureFocusedAnnotation(root.annotation_id);
          onFocusAnnotation(root);
        }}
        onClick={(event) => {
          if (consumeCaptureFocusedAnnotation(root.annotation_id)) return;
          if ((!onJumpToAnnotation && !onFocusAnnotation) || shouldIgnoreAnnotationCardClick(event.target)) return;
          if (event.detail > 1) return;
          if (cardClickTimerRef.current !== null) {
            window.clearTimeout(cardClickTimerRef.current);
          }
          cardClickTimerRef.current = window.setTimeout(() => {
            cardClickTimerRef.current = null;
            const action = resolveAnnotationCardClickAction({
              active: Boolean(options.active),
              pinned: Boolean(options.pinned),
            });
            if (action === 'jump') {
              onJumpToAnnotation?.(root, { pin: false });
            } else {
              onFocusAnnotation?.(root);
            }
          }, 180);
        }}
        onDoubleClick={(event) => {
          if (consumeClickDetailPinnedAnnotation(root.annotation_id)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (!onTogglePinAnnotation || shouldIgnoreAnnotationCardClick(event.target)) return;
          event.preventDefault();
          event.stopPropagation();
          if (cardClickTimerRef.current !== null) {
            window.clearTimeout(cardClickTimerRef.current);
            cardClickTimerRef.current = null;
          }
          onTogglePinAnnotation(root);
        }}
      >
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
            <div className="flex items-center gap-2" data-no-annotation-select>
              {renderPreviewButton(root)}
              {renderJumpButton(root)}
              <PublishButton a={root} />
              {canManage(root) && inlineEditingId !== root.annotation_id && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); startInlineEdit(root); }}
                  className="text-[10px] text-slate-600 hover:text-slate-950"
                  data-no-annotation-select
                >
                  编辑
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPreviewAnnotation(root);
                  setPreviewStartEditing(false);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-white hover:text-slate-900"
                aria-label="打开标注详情"
                title="打开标注详情"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              {canManage(root) && (
                <button onClick={() => setPendingAction({ kind: 'delete', annotationId: root.annotation_id, isReply: false })}
                  className="text-[10px] text-slate-600 hover:text-red-500">删除</button>
              )}
            </div>
          </div>
          <div className="px-3 py-2">
            {inlineEditingId === root.annotation_id ? (
              <div data-no-annotation-select>
                <textarea
                  value={inlineEditBody}
                  onChange={(e) => setInlineEditBody(e.target.value)}
                  className="w-full min-h-[72px] text-xs border border-slate-300 rounded-lg p-2 outline-none focus:border-indigo-400 resize-y"
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => submitInlineEdit(root)}
                    disabled={!inlineEditBody.trim() || inlineEditSaving}
                    className="px-3 py-1 text-xs font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-50"
                  >
                    {inlineEditSaving ? '保存中...' : '保存'}
                  </button>
                  <button
                    onClick={cancelInlineEdit}
                    disabled={inlineEditSaving}
                    className="px-3 py-1 text-xs font-medium text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300 disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <AnnotationMarkdown
                body={root.body}
                className="markdown-content text-xs"
                onOpenAnnotation={(annotationId) => {
                  const target = annotations.find((item) => item.annotation_id === annotationId);
                  if (target) {
                    setPreviewAnnotation(target);
                    setPreviewStartEditing(false);
                  }
                }}
              />
            )}
            {root.publish_review_comment && (
              <div className="mt-2 rounded border border-slate-300 bg-slate-100 px-2 py-1 text-[10px] text-slate-700">
              审核备注：{root.publish_review_comment}
              </div>
            )}
            <div className="mt-2" data-no-annotation-select>
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
          {shouldShowSecondaryKernelRangeTagging() && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowRangeTaggingTools((prev) => !prev)}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
              >
                {getKernelRangeTaggingLabel()}
              </button>
              {showRangeTaggingTools && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
                    Direct line-range tag
                  </div>
                  <EmailTagEditor
                    targetType="kernel_line_range"
                    targetRef={`${version}:${filePath}`}
                    anchor={{ start_line: Math.min(...selectedLines), end_line: Math.max(...selectedLines) }}
                  />
                </div>
              )}
            </div>
          )}
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
            className="max-h-[58vh] overflow-y-auto overscroll-contain pr-1"
            onScroll={(event) => {
              if (!onRollerCenteredAnnotationChange) return;
              const container = event.currentTarget;
              const containerRect = container.getBoundingClientRect();
              const id = pickRollerActiveAnnotationId({
                scrollTop: container.scrollTop,
                clientHeight: container.clientHeight,
                scrollHeight: container.scrollHeight,
                cards: Array.from(container.querySelectorAll<HTMLElement>('[data-annotation-id]')).map((card) => ({
                  id: card.dataset.annotationId || '',
                  top: card.getBoundingClientRect().top - containerRect.top + container.scrollTop,
                  height: card.offsetHeight,
                })),
              });
              if (!id || id === activeAnnotationId) return;
              const annotation = rootAnnotations.find((item) => item.annotation_id === id);
              if (annotation) onRollerCenteredAnnotationChange(annotation);
            }}
          >
            <div className="space-y-2 py-[14vh]">
              {rollerItems.map(({ annotation, position, active }) => (
                <div
                  key={annotation.annotation_id}
                  className="relative origin-center transition-all duration-200 ease-out"
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
      allAnnotations={annotations}
      initialEditing={previewStartEditing}
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
  allAnnotations,
  onClose,
  onRefresh,
  initialEditing = false,
}: {
  annotation: CodeAnnotation | null;
  allAnnotations: CodeAnnotation[];
  onClose: () => void;
  onRefresh: () => void;
  initialEditing?: boolean;
}) {
  const { currentUser, isAdmin } = useAuth();
  const [currentAnnotation, setCurrentAnnotation] = useState<CodeAnnotation | null>(annotation);
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [draftBody, setDraftBody] = useState(annotation?.body || '');
  const [draftVisibility, setDraftVisibility] = useState<'public' | 'private'>(annotation?.visibility || 'private');
  const [saving, setSaving] = useState(false);
  const [relations, setRelations] = useState<AnnotationRelation[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [codePreviewAnnotation, setCodePreviewAnnotation] = useState<CodeAnnotation | null>(null);
  const [relationsError, setRelationsError] = useState('');
  const relationsRequestRef = useRef(0);
  const modalContentRef = useRef<HTMLDivElement | null>(null);

  async function loadRelations(annotationId: string) {
    const requestId = relationsRequestRef.current + 1;
    relationsRequestRef.current = requestId;
    setRelationsLoading(true);
    setRelationsError('');
    try {
      const data = await listAnnotationRelations(annotationId, 'both');
      if (relationsRequestRef.current !== requestId) return;
      setRelations(data.relations);
    } catch (error) {
      if (relationsRequestRef.current !== requestId) return;
      setRelationsError(error instanceof Error ? error.message : 'Failed to load annotation relations');
    } finally {
      if (relationsRequestRef.current === requestId) setRelationsLoading(false);
    }
  }

  useEffect(() => {
    if (!annotation) return;
    setCurrentAnnotation(annotation);
    setDraftBody(annotation.body);
    setDraftVisibility(annotation.visibility);
    setIsEditing(initialEditing);
    setSaving(false);
    void loadRelations(annotation.annotation_id);
  }, [annotation, initialEditing]);

  useEffect(() => {
    if (!currentAnnotation || isEditing) return;
    const latest = allAnnotations.find((item) => item.annotation_id === currentAnnotation.annotation_id);
    if (latest && latest !== currentAnnotation) {
      setCurrentAnnotation(latest);
      setDraftBody(latest.body);
      setDraftVisibility(latest.visibility);
    }
  }, [allAnnotations, currentAnnotation, isEditing]);

  if (!currentAnnotation) return null;

  const visibleReplies = allAnnotations.filter(
    (item) => item.in_reply_to === currentAnnotation.annotation_id,
  );

  const canManage =
    !!currentUser &&
    (isAdmin ||
      (currentAnnotation.visibility === 'private' &&
        currentAnnotation.publish_status !== 'pending' &&
        currentAnnotation.author_user_id === currentUser.user_id));
  const canRequestPublish =
    !!currentUser &&
    !isAdmin &&
    currentAnnotation.visibility === 'private' &&
    currentAnnotation.author_user_id === currentUser.user_id &&
    currentAnnotation.publish_status !== 'pending';
  const canWithdrawPublish =
    !!currentUser &&
    currentAnnotation.publish_status === 'pending' &&
    (isAdmin || currentAnnotation.author_user_id === currentUser.user_id);
  const canEditVisibility = !!currentUser && isAdmin;

  const handleSave = async () => {
    if (!draftBody.trim() || saving) return;
    setSaving(true);
    try {
      const updated = await updateCodeAnnotation(currentAnnotation.annotation_id, {
        body: draftBody.trim(),
        ...(canEditVisibility ? { visibility: draftVisibility } : {}),
      });
      showToast('Annotation updated', 'success');
      setCurrentAnnotation(updated);
      setDraftBody(updated.body);
      setDraftVisibility(updated.visibility);
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
      await requestAnnotationPublication(currentAnnotation.annotation_id);
      showToast('Publication requested', 'success');
      onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Publication request failed', 'error');
    }
  };

  const handleWithdrawPublish = async () => {
    try {
      await withdrawAnnotationPublication(currentAnnotation.annotation_id);
      showToast('Publication request withdrawn', 'success');
      onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Withdraw failed', 'error');
    }
  };

  const handleOpenAnnotation = (annotationId: string) => {
    const target = allAnnotations.find((item) => item.annotation_id === annotationId);
    if (!target) {
      showToast(`Annotation ${annotationId} is not loaded in this file`, 'info');
      return;
    }
    setCurrentAnnotation(target);
    setDraftBody(target.body);
    setDraftVisibility(target.visibility);
    setIsEditing(false);
    setSaving(false);
    void loadRelations(target.annotation_id);
  };

  const handleCreateRelation = async (payload: AnnotationRelationCreate) => {
    if (payload.meta?.reverse_direction) {
      const nextMeta = { ...payload.meta };
      delete nextMeta.reverse_direction;
      await createAnnotationRelation(payload.target_annotation_id, {
        target_annotation_id: currentAnnotation.annotation_id,
        relation_type: payload.relation_type,
        description: payload.description,
        meta: nextMeta,
      });
    } else {
      await createAnnotationRelation(currentAnnotation.annotation_id, payload);
    }
    await loadRelations(currentAnnotation.annotation_id);
  };

  const handleDeleteRelation = async (relationId: string) => {
    await deleteAnnotationRelation(relationId);
    await loadRelations(currentAnnotation.annotation_id);
  };

  const handleSearchRelationCandidates = async (query: string) => {
    const result = await listCodeAnnotations({
      q: query,
      page: 1,
      page_size: 20,
    });
    return result.annotations.filter(
      (item) => item.annotation_id !== currentAnnotation.annotation_id,
    );
  };

  return (
    <>
    <InspectorDetailModal
      isOpen={!!annotation}
      onClose={onClose}
      title={`${formatAnnotationLineRange(currentAnnotation)} annotation`}
      subtitle={
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
            {currentAnnotation.visibility}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
            {currentAnnotation.publish_status}
          </span>
          <AnnotationIdBadge annotationId={currentAnnotation.annotation_id} compact showCopyLink />
        </div>
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
                  setDraftBody(currentAnnotation.body);
                  setDraftVisibility(currentAnnotation.visibility);
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
      <div className="space-y-4" ref={modalContentRef}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
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
                <AnnotationMarkdown body={currentAnnotation.body} onOpenAnnotation={handleOpenAnnotation} />
              </div>
              {currentAnnotation.publish_review_comment && (
                <div className="mt-4 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-700">
                  Review note: {currentAnnotation.publish_review_comment}
                </div>
              )}
            </>
          )}
        </section>
        <aside className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Target
              </div>
              <button
                type="button"
                onClick={() => setCodePreviewAnnotation(currentAnnotation)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-white hover:text-sky-700"
                title="预览代码"
              >
                <PanelRightOpen className="h-3.5 w-3.5" />
              </button>
            </div>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="space-y-1">
                <dt className="text-slate-500">Annotation ID</dt>
                <dd><AnnotationIdBadge annotationId={currentAnnotation.annotation_id} compact showCopyLink className="max-w-full" /></dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Version</dt>
                <dd className="font-medium text-slate-950">{currentAnnotation.version}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-slate-500">Path</dt>
                <dd className="break-all font-mono text-slate-950">{currentAnnotation.file_path}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Range</dt>
                <dd className="font-medium text-slate-950">{formatAnnotationLineRange(currentAnnotation)}</dd>
              </div>
            </dl>
          </div>
          <VariableTracePanel
            annotationId={currentAnnotation.annotation_id}
            relations={relations}
            onOpenAnnotation={handleOpenAnnotation}
          />
        </aside>
        </div>
        {visibleReplies.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              Replies
            </div>
            <div className="mt-2 max-h-[28vh] space-y-2 overflow-y-auto">
              {visibleReplies.map((reply) => (
                <div key={reply.annotation_id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] font-medium text-slate-600">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{formatAnnotationLineRange(reply)} · {reply.publish_status}</span>
                      <AnnotationIdBadge annotationId={reply.annotation_id} compact showCopyLink />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenAnnotation(reply.annotation_id)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-white hover:text-sky-700"
                      title="在此面板中查看"
                    >
                      <PanelRightOpen className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="markdown-content text-xs">
                    <AnnotationMarkdown body={reply.body} onOpenAnnotation={handleOpenAnnotation} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <AnnotationRelationsPanel
          annotationId={currentAnnotation.annotation_id}
          subjectAnnotation={currentAnnotation}
          candidateAnnotations={allAnnotations}
          relations={relations}
          loading={relationsLoading}
          error={relationsError}
          avoidRect={modalContentRef.current?.closest('[role="dialog"]')?.querySelector(':scope > div')?.getBoundingClientRect() ?? null}
          onOpenAnnotation={handleOpenAnnotation}
          onCreateRelation={handleCreateRelation}
          onDeleteRelation={handleDeleteRelation}
          onSearchAnnotations={handleSearchRelationCandidates}
        />
      </div>
    </InspectorDetailModal>
    <AnnotationQuickPreviewPopover
      isOpen={!!codePreviewAnnotation}
      annotation={codePreviewAnnotation}
      anchorRect={null}
      avoidRect={null}
      onClose={() => setCodePreviewAnnotation(null)}
      onOpenFullPreview={() => {}}
      onOpenInAtlas={() => {}}
      onOpenAnnotation={handleOpenAnnotation}
    />
    </>
  );
}
