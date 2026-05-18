import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  getThread,
  startThreadTranslation,
  getTranslationJob,
  clearTranslationCache,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  exportAnnotations,
  importAnnotations,
  type TranslationJobResponse,
} from '../api/client';
import type { ThreadResponse } from '../api/types';
import ConfirmModal from './ConfirmModal';
import { showToast } from './Toast';
import LayeredEmailCard from './LayeredEmailCard';
import TreeEmailCard from './TreeEmailCard';
import StickyContextBar from './StickyContextBar';
import ThreadInspectorDock from './ThreadInspectorDock';
import { StatusBadge } from './ui';
import {
  buildThreadTree,
  buildNodeMap,
  getVisibleNodes,
  collectDescendantIds,
  type ThreadNode,
  type FoldLevel,
  type ViewMode,
  type TranslationMap,
} from '../utils/threadTree';
import {
  parseParagraphs,
  getDisplayBody,
  shouldTranslate,
} from '../utils/emailBody';

// 从线程中提取所有需要翻译的段落
function extractTranslatableParagraphs(thread: ThreadResponse | null): string[] {
  if (!thread) return [];
  const paragraphs = new Set<string>();
  for (const email of thread.emails) {
    const blocks = parseParagraphs(getDisplayBody(email));
    for (const block of blocks) {
      if (shouldTranslate(block)) {
        paragraphs.add(block.text);
      }
    }
  }
  return Array.from(paragraphs);
}

// =============================================================
// 主组件
// =============================================================
interface Props {
  threadId: string;
  focusMessageId?: string;
  focusAnnotationId?: string;
  onClose: () => void;
}

export default function ThreadDrawer({ threadId, focusMessageId, focusAnnotationId, onClose }: Props) {
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [threadTree, setThreadTree] = useState<ThreadNode[]>([]);
  const [translations, setTranslations] = useState<TranslationMap>(new Map());
  const [translating, setTranslating] = useState(false);
  const [translationJob, setTranslationJob] = useState<TranslationJobResponse | null>(null);
  const [cacheMessage, setCacheMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [, setFoldLevel] = useState<FoldLevel>('expanded');
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'layered' : 'tree',
  );
  const [layeredExpandedIds, setLayeredExpandedIds] = useState<Set<number>>(new Set());
  const [highlightedTarget, setHighlightedTarget] = useState<string | null>(null);

  // Confirm modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string; message: string; variant: 'danger' | 'primary' | 'warning';
    confirmLabel: string; showInput: boolean; inputLabel?: string; inputPlaceholder?: string;
  }>({ title: '', message: '', variant: 'danger', confirmLabel: '确定', showInput: false });
  const confirmCallback = useRef<((val: string) => void) | null>(null);
  const openConfirm = useCallback((
    opts: { title: string; message: string; variant?: 'danger' | 'primary' | 'warning'; confirmLabel?: string; showInput?: boolean; inputLabel?: string; inputPlaceholder?: string },
    callback: (val: string) => void,
  ) => {
    setConfirmConfig({ title: opts.title, message: opts.message, variant: opts.variant || 'danger', confirmLabel: opts.confirmLabel || '确定', showInput: opts.showInput || false, inputLabel: opts.inputLabel, inputPlaceholder: opts.inputPlaceholder });
    confirmCallback.current = callback;
    setConfirmOpen(true);
  }, []);

  const nodeMap = useMemo(() => buildNodeMap(threadTree), [threadTree]);

  const visibleNodes = useMemo(() => {
    if (viewMode !== 'layered') return [];
    return getVisibleNodes(threadTree, layeredExpandedIds);
  }, [viewMode, threadTree, layeredExpandedIds]);

  const clearCacheMessage = useCallback(() => { setCacheMessage(null); }, []);

  const handleClearParagraphCache = useCallback(async (paragraph: string) => {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(paragraph);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      const result = await clearTranslationCache('paragraph', hashHex);
      if (result.success) {
        setCacheMessage({ type: 'success', text: '段落缓存已清除' });
        setTranslations(prev => { const next = new Map(prev); next.delete(paragraph); return next; });
      } else {
        setCacheMessage({ type: 'error', text: result.message });
      }
      setTimeout(clearCacheMessage, 2000);
    } catch {
      setCacheMessage({ type: 'error', text: '清除缓存失败' });
      setTimeout(clearCacheMessage, 2000);
    }
  }, [clearCacheMessage]);

  const handleClearAllCache = useCallback(async () => {
    try {
      const result = await clearTranslationCache('all');
      if (result.success) {
        setCacheMessage({ type: 'success', text: `已清除全部缓存 (${result.cleared_count} 条)` });
        setTranslations(new Map());
      } else {
        setCacheMessage({ type: 'error', text: result.message });
      }
      setTimeout(clearCacheMessage, 2000);
    } catch {
      setCacheMessage({ type: 'error', text: '清除缓存失败' });
      setTimeout(clearCacheMessage, 2000);
    }
  }, [clearCacheMessage]);

  const handleTranslationUpdate = useCallback((para: string, translation: string) => {
    setTranslations(prev => {
      const next = new Map(prev);
      next.set(para, { translation, loading: false });
      return next;
    });
  }, []);

  // 批注相关状态
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // 重建线程树（将批注混入）
  const rebuildTree = useCallback((t: ThreadResponse) => {
    const tree = buildThreadTree(t.emails, t.annotations || []);
    setThreadTree(tree);
    return tree;
  }, []);

  const handleAddAnnotation = useCallback(async (_threadId: string, inReplyTo: string, body: string, visibility: 'public' | 'private') => {
    try {
      await createAnnotation({
        annotation_type: 'email',
        thread_id: threadId,
        in_reply_to: inReplyTo,
        body,
        visibility,
      });
      // 重新加载线程数据
      const t = await getThread(threadId);
      setThread(t);
      rebuildTree(t);
    } catch (e) {
      showToast(`创建批注失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [threadId, rebuildTree]);

  const handleEditAnnotation = useCallback(async (annotationId: string, body: string) => {
    try {
      await updateAnnotation(annotationId, body);
      const t = await getThread(threadId);
      setThread(t);
      rebuildTree(t);
    } catch (e) {
      showToast(`更新批注失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [threadId, rebuildTree]);

  const handleRefreshThread = useCallback(async () => {
    try {
      const t = await getThread(threadId);
      setThread(t);
      rebuildTree(t);
    } catch (e) {
      showToast(`刷新线程失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [threadId, rebuildTree]);

  const handleDeleteAnnotation = useCallback(async (annotationId: string) => {
    openConfirm({ title: '删除批注', message: '确定删除这条批注？', variant: 'danger', confirmLabel: '删除' }, async () => {
      try {
        await deleteAnnotation(annotationId);
        const t = await getThread(threadId);
        setThread(t);
        rebuildTree(t);
      } catch (e) {
        showToast(`删除批注失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    });
  }, [threadId, rebuildTree, openConfirm]);

  const handleExportAnnotations = useCallback(async () => {
    try {
      const data = await exportAnnotations(threadId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `annotations-${threadId.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(`导出批注失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [threadId]);

  const handleImportAnnotations = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await importAnnotations(data);
        if (result.total_imported > 0) {
          // 重新加载线程
          const t = await getThread(threadId);
          setThread(t);
          rebuildTree(t);
        }
        showToast(`导入完成：${result.total_imported} 条批注`, 'success');
      } catch (err) {
        showToast(`导入失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    };
    input.click();
  }, [threadId, rebuildTree]);

  useEffect(() => {
    setLoading(true);
    setTranslations(new Map());
    setTranslationJob(null);
    setTranslating(false);
    getThread(threadId)
      .then(t => {
        setThread(t);
        rebuildTree(t);
        if (t.emails.length > 0) {
          setExpandedIds(new Set([t.emails[0].id]));
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [threadId, rebuildTree]);

  useEffect(() => {
    if (!translationJob || !['pending', 'running'].includes(translationJob.status)) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const nextJob = await getTranslationJob(translationJob.job_id);
        setTranslationJob(nextJob);
      } catch {
        // 轮询失败静默处理，下次间隔会重试
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [translationJob]);

  useEffect(() => {
    if (!translationJob) return;
    setTranslating(['pending', 'running'].includes(translationJob.status));
    setTranslations(prev => {
      const next = new Map(prev);
      translationJob.items.forEach((item) => {
        next.set(item.source_text, {
          translation: item.translated_text,
          loading: ['pending', 'running'].includes(translationJob.status) && !item.translated_text,
          error: item.error || undefined,
        });
      });
      return next;
    });
  }, [translationJob]);

  useEffect(() => {
    if (!thread) return;
    const focusAnnotation = focusAnnotationId?.trim();
    const focusMessage = focusMessageId?.trim();
    const targetKey = focusAnnotation
      ? `annotation:${focusAnnotation}`
      : focusMessage
        ? `message:${focusMessage}`
        : '';
    const selector = focusAnnotation
      ? `[data-annotation-id="${CSS.escape(focusAnnotation)}"]`
      : focusMessage
        ? `[data-message-id="${CSS.escape(focusMessage)}"]`
        : '';
    if (!selector || !targetKey) return;

    setViewMode(
      typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
        ? 'layered'
        : 'tree',
    );
    const timer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedTarget(targetKey);
      window.setTimeout(() => {
        setHighlightedTarget((current) => (current === targetKey ? null : current));
      }, 2200);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [thread, focusAnnotationId, focusMessageId]);

  const handleOpenAnnotationReference = useCallback((annotationId: string) => {
    const targetAnnotationId = annotationId.trim();
    if (!targetAnnotationId) return;

    const emailIds = thread?.emails.map((email) => email.id) || [];
    setExpandedIds(new Set(emailIds));
    setLayeredExpandedIds(new Set(emailIds));
    setViewMode(
      typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
        ? 'layered'
        : 'tree',
    );

    const targetKey = `annotation:${targetAnnotationId}`;
    setHighlightedTarget(targetKey);
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-annotation-id="${CSS.escape(targetAnnotationId)}"]`,
      );
      if (!target) {
        showToast(`Annotation ${targetAnnotationId} is not visible in this thread`, 'info');
        setHighlightedTarget((current) => (current === targetKey ? null : current));
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => {
        setHighlightedTarget((current) => (current === targetKey ? null : current));
      }, 2200);
    }, 120);
  }, [thread]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = () => {
    if (thread) {
      setFoldLevel('expanded');
      setExpandedIds(new Set(thread.emails.map(e => e.id)));
      setLayeredExpandedIds(new Set(thread.emails.map(e => e.id)));
    }
  };

  const collapseAll = () => {
    if (thread) {
      setFoldLevel('collapsed');
      setExpandedIds(new Set());
      setLayeredExpandedIds(new Set());
    }
  };

  // 分层展开模式：切换单个邮件展开状态，折叠时级联折叠所有后代
  const toggleLayeredExpand = useCallback((id: number) => {
    setLayeredExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        const node = nodeMap.get(id);
        if (node) {
          for (const descId of collectDescendantIds(node)) {
            next.delete(descId);
          }
        }
      } else {
        next.add(id);
      }
      return next;
    });
  }, [nodeMap]);

  const enterLayeredMode = useCallback(() => {
    setViewMode('layered');
    if (threadTree.length > 0) {
      setLayeredExpandedIds(new Set([threadTree[0].email.id]));
    } else {
      setLayeredExpandedIds(new Set());
    }
  }, [threadTree]);

  const enterTreeMode = useCallback(() => {
    setViewMode('tree');
    if (thread) {
      setExpandedIds(new Set(thread.emails.map(e => e.id)));
    }
  }, [thread]);

  const handleTranslate = useCallback(async () => {
    if (!thread || translating) return;
    try {
      setTranslating(true);
      const job = await startThreadTranslation(thread.thread_id || threadId, 'auto', 'zh-CN');
      setTranslationJob(job);
    } catch (e) {
      showToast(`启动翻译失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
      setTranslating(false);
    }
  }, [thread, threadId, translating]);

  const translationStats = useMemo(() => {
    const total = extractTranslatableParagraphs(thread).length;
    const translated = Array.from(translations.values()).filter(t => !!t.translation).length;
    return { total, translated };
  }, [thread, translations]);

  const translationProgress = translationJob?.total
    ? Math.min(100, Math.round((translationJob.completed / translationJob.total) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex overflow-hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto flex h-screen w-full min-w-0 flex-col overflow-hidden bg-gray-50 md:w-[90vw]">
        {thread && (
          <ThreadInspectorDock
            threadId={threadId}
            annotations={thread.annotations || []}
            translationStats={translationStats}
            translationProgress={translationProgress}
            translationJob={translationJob}
            translating={translating}
            cacheMessage={cacheMessage}
            onTranslate={handleTranslate}
            onClearAllCache={handleClearAllCache}
            onImportAnnotations={handleImportAnnotations}
            onExportAnnotations={handleExportAnnotations}
          />
        )}
        {/* 顶部工具栏 */}
        <StickyContextBar
          className="mx-0 md:mx-0"
          title={thread?.emails[0]?.subject || 'Thread'}
          subtitle={`${thread?.emails.length ?? 0} emails · ${thread?.annotations?.length ?? 0} annotations · ${threadTree.length} roots`}
          meta={
            <>
              <StatusBadge tone={viewMode === 'tree' ? 'info' : 'muted'}>Tree</StatusBadge>
              <StatusBadge tone={viewMode === 'layered' ? 'info' : 'muted'}>Layered</StatusBadge>
            </>
          }
          actions={
            <>
              <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
                <button
                  onClick={enterTreeMode}
                  className={`rounded px-2 py-1.5 text-xs transition-colors ${
                    viewMode === 'tree' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-200'
                  }`}
                  title="树形模式"
                >
                  树形
                </button>
                <button
                  onClick={enterLayeredMode}
                  className={`rounded px-2 py-1.5 text-xs transition-colors ${
                    viewMode === 'layered' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-200'
                  }`}
                  title="分层展开"
                >
                  分层
                </button>
              </div>
              <button onClick={expandAll} className="rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100">全部展开</button>
              <button onClick={collapseAll} className="rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100">全部收起</button>
              <button
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                &#x2715;
              </button>
            </>
          }
        />
        {/* 内容区域 */}
        <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 md:p-6">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-gray-400 text-lg">加载中...</div>
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center py-20">
              <div className="text-red-600 text-lg">{error}</div>
            </div>
          )}
          {thread && (
            <div className="thread min-w-0">
              <div className="mb-4 flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-600 md:mb-6 md:gap-6 md:px-4">
                <span><strong className="text-gray-900">{thread.emails.length}</strong> 封邮件</span>
                <span><strong className="text-gray-900">{threadTree.length}</strong> 个主题</span>
                {thread.annotations && thread.annotations.length > 0 && (
                  <span><strong className="text-blue-600">{thread.annotations.length}</strong> 条批注</span>
                )}
                {translationStats.total > 0 && (
                  <span><strong className="text-gray-900">{translationStats.total}</strong> 段落可翻译</span>
                )}
              </div>
              <div className="min-w-0 space-y-3">
                {viewMode === 'tree' ? (
                  threadTree.map((rootNode, idx) => (
                    <TreeEmailCard 
                      key={`${rootNode.email.id}-${idx}`}
                      node={rootNode}
                      expandedIds={expandedIds}
                      highlightedTarget={highlightedTarget}
                      toggleExpand={toggleExpand}
                      translations={translations}
                      onTranslationUpdate={handleTranslationUpdate}
                      onClearParagraphCache={handleClearParagraphCache}
                      onAddAnnotation={handleAddAnnotation}
                      onEditAnnotation={handleEditAnnotation}
                      onDeleteAnnotation={handleDeleteAnnotation}
                      replyingTo={replyingTo}
                      onSetReplyingTo={setReplyingTo}
                      threadId={threadId}
                      onRefresh={handleRefreshThread}
                      onOpenAnnotationReference={handleOpenAnnotationReference}
                    />
                  ))
                ) : (
                  visibleNodes.map((node) => (
                    <LayeredEmailCard
                      key={node.email.id}
                      node={node}
                      isExpanded={layeredExpandedIds.has(node.email.id)}
                      highlightedTarget={highlightedTarget}
                      onToggleExpand={toggleLayeredExpand}
                      translations={translations}
                      onTranslationUpdate={handleTranslationUpdate}
                      onClearParagraphCache={handleClearParagraphCache}
                      onAddAnnotation={handleAddAnnotation}
                      onEditAnnotation={handleEditAnnotation}
                      onDeleteAnnotation={handleDeleteAnnotation}
                      replyingTo={replyingTo}
                      onSetReplyingTo={setReplyingTo}
                      threadId={threadId}
                      onRefresh={handleRefreshThread}
                      onOpenAnnotationReference={handleOpenAnnotationReference}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`
        .email-thread > summary {
          cursor: pointer;
          list-style: none;
        }
        .email-thread > summary::-webkit-details-marker {
          display: none;
        }
        .email-content {
          background: white;
          border: 1px solid #e5e7eb;
        }
        .email-paragraph {
          padding: 12px 16px;
          border-bottom: 1px solid #f3f4f6;
        }
        .email-paragraph:last-child {
          border-bottom: none;
        }
        .bilingual-block {
          display: flex;
          border-bottom: 1px solid #e5e7eb;
          min-width: 0;
        }
        .bilingual-block:last-child {
          border-bottom: none;
        }
        .bilingual-original {
          flex: 0 0 40%;
          padding: 12px 16px;
          background: #fafafa;
          border-right: 2px solid #e5e7eb;
        }
        .bilingual-translation {
          flex: 0 0 60%;
          padding: 12px 16px;
          background: #f0f9ff;
        }
        .patch-diff {
          border-left: 3px solid #22c55e;
        }
        .diff-line {
          display: flex;
          padding: 0 12px;
          min-height: 20px;
          line-height: 20px;
        }
        .diff-line-no {
          display: inline-block;
          width: 42px;
          flex-shrink: 0;
          text-align: right;
          padding-right: 10px;
          color: #6b7280;
          user-select: none;
          border-right: 1px solid #374151;
          margin-right: 10px;
        }
        .diff-target-link,
        .diff-target-placeholder {
          display: inline-block;
          width: 54px;
          flex-shrink: 0;
          margin-right: 10px;
          text-align: right;
          font-size: 11px;
        }
        .diff-target-link {
          color: #93c5fd;
          text-decoration: none;
        }
        .diff-target-link:hover {
          color: #dbeafe;
          text-decoration: underline;
        }
        .diff-hunk-actions {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-left: 12px;
          flex-shrink: 0;
        }
        .diff-action-button {
          border: 1px solid #475569;
          border-radius: 6px;
          background: rgba(15, 23, 42, 0.4);
          color: #cbd5e1;
          padding: 2px 8px;
          font-size: 11px;
          line-height: 1.4;
        }
        .diff-action-button:hover {
          background: rgba(30, 41, 59, 0.9);
          color: #f8fafc;
        }
        .diff-hunk-editor {
          margin: 6px 12px 10px 126px;
          border: 1px solid #1e293b;
          border-radius: 10px;
          background: #0f172a;
          padding: 10px;
        }
        .diff-hunk-editor-label {
          margin-bottom: 6px;
          color: #94a3b8;
          font-size: 11px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
        .diff-line-text {
          white-space: pre;
          min-width: 0;
          overflow-wrap: anywhere;
        }
        @media (max-width: 767px) {
          .bilingual-block {
            display: block;
          }
          .bilingual-original,
          .bilingual-translation {
            flex: none;
            width: 100%;
            border-right: 0;
          }
          .bilingual-original {
            border-bottom: 1px solid #e5e7eb;
          }
          .diff-line {
            min-width: 0;
          }
          .diff-line-text {
            white-space: pre-wrap;
            word-break: break-word;
          }
        }
        .diff-add {
          background: rgba(34, 197, 94, 0.15);
        }
        .diff-add .diff-line-text {
          color: #4ade80;
        }
        .diff-del {
          background: rgba(239, 68, 68, 0.15);
        }
        .diff-del .diff-line-text {
          color: #f87171;
        }
        .diff-hunk {
          background: rgba(96, 165, 250, 0.10);
        }
        .diff-hunk .diff-line-text {
          color: #60a5fa;
        }
        .diff-header .diff-line-text {
          color: #fbbf24;
          font-weight: 600;
        }
        .diff-meta .diff-line-text {
          color: #9ca3af;
          font-weight: 600;
        }
        .diff-ctx .diff-line-text {
          color: #d1d5db;
        }
        @media (max-width: 768px) {
          .bilingual-block {
            flex-direction: column;
          }
          .bilingual-original {
            border-right: none;
            border-bottom: 2px dashed #e5e7eb;
          }
        }
      `}</style>
      <ConfirmModal
        isOpen={confirmOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        variant={confirmConfig.variant}
        confirmLabel={confirmConfig.confirmLabel}
        showInput={confirmConfig.showInput}
        inputLabel={confirmConfig.inputLabel}
        inputPlaceholder={confirmConfig.inputPlaceholder}
        onConfirm={(val) => { confirmCallback.current?.(val); setConfirmOpen(false); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
