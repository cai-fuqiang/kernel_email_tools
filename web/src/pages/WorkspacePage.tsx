import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, NotebookText, Search, Tag as TagIcon } from 'lucide-react';
import { useAuth } from '../auth';
import ThreadDrawer from '../components/ThreadDrawer';
import EntityList from '../workspace/components/EntityList';
import EntityDetailPanel, {
  type AnnotationActionCallbacks,
} from '../workspace/components/EntityDetailPanel';
import ConfirmModal from '../components/ConfirmModal';
import EmailFilterBar from '../workspace/components/EmailFilterBar';
import {
  useWorkspaceData,
  type WorkspaceFilters,
  type WorkspaceView,
} from '../workspace/hooks/useWorkspaceData';
import type { WorkspaceEntity } from '../workspace/types';
import type { AnnotationListItem, ChannelOption, CodeAnnotation, TagTargetItem, TagTree } from '../api/types';
import {
  deleteAnnotation,
  deleteCodeAnnotation,
  deleteTag,
  getChannels,
  getTagStats,
  requestAnnotationPublication,
  withdrawAnnotationPublication,
  approveAnnotationPublication,
  rejectAnnotationPublication,
  updateAnnotation,
  type TagStats,
} from '../api/client';
import { showToast } from '../components/Toast';

const VALID_VIEWS: WorkspaceView[] = ['email', 'tag', 'annotation'];
const PAGE_SIZE = 20;

const VIEW_LABEL: Record<WorkspaceView, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  email: { label: 'Emails', icon: Mail },
  tag: { label: 'Tags', icon: TagIcon },
  annotation: { label: 'Annotations', icon: NotebookText },
};

const DEFAULT_FILTERS: Omit<WorkspaceFilters, 'q'> = {
  mode: 'hybrid',
  list_name: undefined,
  sender: undefined,
  date_from: undefined,
  date_to: undefined,
  has_patch: undefined,
  tags: undefined,
  tag_mode: 'any',
  sort_by: '',
  sort_order: '',
  annotation_type: 'all',
  publish_status: 'all',
};

export default function WorkspacePage() {
  const { isAuthenticated, isAdmin, canWrite, currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlView = searchParams.get('view') as WorkspaceView | null;
  const view: WorkspaceView = VALID_VIEWS.includes(urlView as WorkspaceView) ? (urlView as WorkspaceView) : 'email';
  const urlQ = searchParams.get('q') || '';

  const [qInput, setQInput] = useState(urlQ);
  const [q, setQ] = useState(urlQ);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Omit<WorkspaceFilters, 'q'>>(DEFAULT_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([{ value: '', label: 'All channels' }]);
  const [tagStats, setTagStats] = useState<TagStats[]>([]);

  const [threadOpen, setThreadOpen] = useState<{ threadId: string; focusMessageId?: string } | null>(null);

  // 加载元数据
  useEffect(() => {
    if (!isAuthenticated) return;
    getChannels()
      .then((data) => setChannelOptions([{ value: '', label: 'All channels' }, ...data]))
      .catch(() => {});
    getTagStats()
      .then(setTagStats)
      .catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    setQInput(urlQ);
    setQ(urlQ);
  }, [urlQ]);

  useEffect(() => {
    setPage(1);
    setSelectedId(null);
  }, [view, q, filters]);

  const effectiveFilters: WorkspaceFilters = useMemo(() => ({ q, ...filters }), [q, filters]);
  const data = useWorkspaceData(isAuthenticated ? view : 'email', effectiveFilters, page, PAGE_SIZE);

  const selectedEntity = useMemo(
    () => data.entities.find((e) => e.id === selectedId) || null,
    [data.entities, selectedId],
  );

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const semanticNeedsQuery = view === 'email' && filters.mode === 'semantic' && !q.trim();

  // email view 无任何条件时的引导提示
  const showEmailEmptyHint =
    view === 'email' &&
    !q.trim() &&
    !filters.sender &&
    !filters.date_from &&
    !filters.date_to &&
    filters.has_patch === undefined &&
    !filters.list_name &&
    !(filters.tags && filters.tags.length > 0);

  function handleSwitchView(next: WorkspaceView) {
    const params = new URLSearchParams(searchParams);
    params.set('view', next);
    setSearchParams(params, { replace: true });
  }

  function handleSubmitQuery() {
    const params = new URLSearchParams(searchParams);
    if (qInput) params.set('q', qInput);
    else params.delete('q');
    setSearchParams(params);
    setQ(qInput);
  }

  function handleOpenTarget(entity: WorkspaceEntity) {
    const target = entity.target;
    if (target.type === 'email_thread') {
      const anchor = target.anchor as { message_id?: string } | undefined;
      setThreadOpen({ threadId: target.ref, focusMessageId: anchor?.message_id });
      return;
    }
    if (target.type === 'email_message') {
      const raw = entity.raw as AnnotationListItem;
      if (raw.thread_id) {
        setThreadOpen({ threadId: raw.thread_id });
        return;
      }
    }
    if (target.type === 'code_line') {
      const anchor = target.anchor as { version?: string; file_path?: string; start_line?: number } | undefined;
      let version = anchor?.version || '';
      let filePath = anchor?.file_path || '';
      // 兜底：target.ref 形如 "<version>:<file_path>"
      if ((!version || !filePath) && target.ref) {
        const idx = target.ref.indexOf(':');
        if (idx > 0) {
          version = version || target.ref.slice(0, idx);
          filePath = filePath || target.ref.slice(idx + 1);
        }
      }
      if (version && filePath) {
        const params = new URLSearchParams({ v: version, path: filePath });
        if (anchor?.start_line) params.set('line', String(anchor.start_line));
        navigate(`/kernel-code?${params.toString()}`);
        return;
      }
    }
    if (target.type === 'tag') {
      const params = new URLSearchParams(searchParams);
      params.set('view', 'tag');
      params.set('q', target.ref);
      setSearchParams(params);
    }
  }

  function handleOpenTagTarget(t: TagTargetItem) {
    const meta = t.target_meta || {};
    const anchor = t.anchor || {};
    if (t.target_type === 'email_thread') {
      setThreadOpen({ threadId: t.target_ref });
      return;
    }
    if (t.target_type === 'email_message' || t.target_type === 'email_paragraph') {
      const threadId = (meta.thread_id as string) || (anchor.thread_id as string) || t.target_ref;
      const messageId = (meta.message_id as string) || t.target_ref;
      setThreadOpen({ threadId, focusMessageId: messageId });
      return;
    }
    if (t.target_type === 'code_line' || t.target_type === 'kernel_code') {
      const version = (anchor.version as string) || (meta.version as string);
      const filePath = (anchor.file_path as string) || (meta.file_path as string);
      const startLine = (anchor.start_line as number | undefined) || (meta.start_line as number | undefined);
      if (version && filePath) {
        const params = new URLSearchParams({ v: version, path: filePath });
        if (startLine) params.set('line', String(startLine));
        navigate(`/kernel-code?${params.toString()}`);
        return;
      }
    }
    // sdm_section / knowledge / 其它：暂无统一打开方式，console 留痕便于排查
    console.warn('[Workspace] no handler for tag target type', t.target_type, t.target_ref);
  }

  // ── Tag 视图 ────────────────────────────────────────────────────────────

  function canDeleteTag(entity: WorkspaceEntity): boolean {
    if (!isAuthenticated) return false;
    if (isAdmin) return true;
    // editor 只能删自己的 private tag（后端规则）
    const tag = entity.raw as TagTree | { visibility?: string; owner_user_id?: string | null; created_by_user_id?: string | null };
    if (tag.visibility === 'public') return false;
    return Boolean(currentUser && (
      (tag as { owner_user_id?: string | null }).owner_user_id === currentUser.user_id ||
      (tag as { created_by_user_id?: string | null }).created_by_user_id === currentUser.user_id
    ));
  }

  async function handleDeleteTag(entity: WorkspaceEntity) {
    const t = entity.raw as TagTree | { id: number; name: string };
    await deleteTag(t.id);
    showToast('标签已删除', 'success');
    setSelectedId(null);
    data.refresh();
  }

  // ── Annotation 视图 ────────────────────────────────────────────────────

  /** 按后端 RBAC 规则计算各 publish 动作的可见性。 */
  function annotationPermissions(a: AnnotationListItem | CodeAnnotation) {
    const authorMatch = Boolean(currentUser && a.author_user_id && a.author_user_id === currentUser.user_id);
    const isOwnPrivate = authorMatch && a.visibility === 'private' && a.publish_status !== 'pending';
    return {
      canManage: Boolean(currentUser && (isAdmin || (canWrite && isOwnPrivate))),
      canRequestPublish: Boolean(
        currentUser && !isAdmin && authorMatch && a.visibility === 'private' && a.publish_status !== 'pending',
      ),
      canWithdrawPublish: Boolean(currentUser && a.publish_status === 'pending' && (isAdmin || authorMatch)),
      canApprovePublish: Boolean(currentUser && isAdmin && a.publish_status === 'pending'),
      canRejectPublish: Boolean(currentUser && isAdmin && a.publish_status === 'pending'),
    };
  }

  const [annotationConfirm, setAnnotationConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);

  const annotationActions: AnnotationActionCallbacks = {
    onEdit: async (a, body) => {
      try {
        await updateAnnotation(a.annotation_id, body);
        showToast('已保存', 'success');
        data.refresh();
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), 'error');
      }
    },
    onDelete: (a) => {
      setAnnotationConfirm({
        title: '删除批注',
        message: '确定删除这个批注？此操作不可撤销。',
        confirmLabel: '删除',
        action: async () => {
          if (a.annotation_type === 'code') {
            await deleteCodeAnnotation(a.annotation_id);
          } else {
            await deleteAnnotation(a.annotation_id);
          }
          showToast('批注已删除', 'success');
          setSelectedId(null);
          data.refresh();
        },
      });
    },
    onRequestPublish: (a) => {
      requestAnnotationPublication(a.annotation_id)
        .then(() => { showToast('已提交公开申请', 'success'); data.refresh(); })
        .catch((e) => showToast(e instanceof Error ? e.message : String(e), 'error'));
    },
    onWithdrawPublish: (a) => {
      withdrawAnnotationPublication(a.annotation_id)
        .then(() => { showToast('已撤回申请', 'success'); data.refresh(); })
        .catch((e) => showToast(e instanceof Error ? e.message : String(e), 'error'));
    },
    onApprovePublish: (a, comment) => {
      approveAnnotationPublication(a.annotation_id, comment)
        .then(() => { showToast('已通过公开申请', 'success'); data.refresh(); })
        .catch((e) => showToast(e instanceof Error ? e.message : String(e), 'error'));
    },
    onRejectPublish: (a, comment) => {
      rejectAnnotationPublication(a.annotation_id, comment)
        .then(() => { showToast('已驳回', 'success'); data.refresh(); })
        .catch((e) => showToast(e instanceof Error ? e.message : String(e), 'error'));
    },
  };

  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
            {VALID_VIEWS.map((v) => {
              const { label, icon: Icon } = VIEW_LABEL[v];
              const active = v === view;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => handleSwitchView(v)}
                  className={
                    active
                      ? 'flex items-center gap-1.5 rounded-md bg-white px-3 py-1 font-medium text-slate-900 shadow-sm'
                      : 'flex items-center gap-1.5 rounded-md px-3 py-1 text-slate-600 hover:text-slate-900'
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>

          <div className="relative flex-1">
            <input
              type="text"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitQuery()}
              placeholder={view === 'email' ? '搜索邮件…' : view === 'tag' ? '过滤标签…' : '搜索批注…'}
              className="w-full max-w-2xl rounded-lg border border-slate-300 bg-white px-4 py-2 pl-10 text-sm focus:border-slate-900 focus:outline-none"
            />
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">
              <span className="font-semibold text-slate-900">{data.total}</span> 条
            </span>
            <button
              type="button"
              onClick={handleSubmitQuery}
              disabled={semanticNeedsQuery}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              搜索
            </button>
          </div>
        </div>

        {/* View-specific filter row */}
        <div className="mt-2">
          {view === 'email' && (
            <EmailFilterBar
              filters={effectiveFilters}
              onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
              channelOptions={channelOptions}
              tagStats={tagStats}
              expanded={advancedOpen}
              onToggleExpanded={() => setAdvancedOpen((o) => !o)}
              semanticNeedsQuery={semanticNeedsQuery}
            />
          )}
          {view === 'annotation' && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={filters.annotation_type}
                onChange={(e) => setFilters((f) => ({ ...f, annotation_type: e.target.value as WorkspaceFilters['annotation_type'] }))}
                className="rounded border-slate-300 px-2 py-1 text-xs"
              >
                <option value="all">所有类型</option>
                <option value="email">email</option>
                <option value="code">code</option>
                <option value="sdm_spec">sdm_spec</option>
              </select>
              <select
                value={filters.publish_status}
                onChange={(e) => setFilters((f) => ({ ...f, publish_status: e.target.value as WorkspaceFilters['publish_status'] }))}
                className="rounded border-slate-300 px-2 py-1 text-xs"
              >
                <option value="all">所有状态</option>
                <option value="pending">pending review</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 border-r border-slate-200 bg-white">
          {showEmailEmptyHint ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">
              <div className="mb-2 text-slate-700 font-medium">请输入关键词或选择过滤条件</div>
              <div className="text-xs">
                可按 sender / date / has patch / tag 过滤，或切换到 <b>Tags</b> / <b>Annotations</b> 视图。
              </div>
            </div>
          ) : data.loading ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">Loading…</div>
          ) : data.error ? (
            <div className="px-6 py-12 text-center text-sm text-rose-600">Error: {data.error}</div>
          ) : (
            <>
              <EntityList
                entities={data.entities}
                selectedId={selectedId}
                onSelect={(entity) => setSelectedId(entity.id)}
                onActivate={handleOpenTarget}
              />
              {data.total > 0 && view !== 'tag' && (
                <div className="flex items-center justify-center gap-2 p-4 text-xs text-slate-500">
                  <button
                    className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    ‹ 上一页
                  </button>
                  <span>
                    Page {page} / {totalPages}
                  </span>
                  <button
                    className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    下一页 ›
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <aside className="hidden w-[26rem] shrink-0 bg-white xl:block">
          <EntityDetailPanel
            entity={selectedEntity}
            onOpenTarget={handleOpenTarget}
            onOpenTagTarget={handleOpenTagTarget}
            onDeleteTag={handleDeleteTag}
            canDeleteTag={canDeleteTag}
            annotationActions={annotationActions}
            annotationPermissions={annotationPermissions}
            onClose={() => setSelectedId(null)}
          />
        </aside>
      </div>

      {threadOpen && (
        <ThreadDrawer
          threadId={threadOpen.threadId}
          focusMessageId={threadOpen.focusMessageId}
          onClose={() => setThreadOpen(null)}
        />
      )}

      {annotationConfirm && (
        <ConfirmModal
          isOpen
          title={annotationConfirm.title}
          message={annotationConfirm.message}
          confirmLabel={annotationConfirm.confirmLabel}
          cancelLabel="取消"
          variant="danger"
          onConfirm={() => {
            void annotationConfirm.action();
            setAnnotationConfirm(null);
          }}
          onCancel={() => setAnnotationConfirm(null)}
        />
      )}
    </div>
  );
}