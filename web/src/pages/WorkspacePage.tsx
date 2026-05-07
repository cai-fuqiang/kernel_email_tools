import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, NotebookText, Search, Tag as TagIcon } from 'lucide-react';
import { useAuth } from '../auth';
import ThreadDrawer from '../components/ThreadDrawer';
import EntityList from '../workspace/components/EntityList';
import EntityDetailPanel from '../workspace/components/EntityDetailPanel';
import {
  useWorkspaceData,
  type WorkspaceFilters,
  type WorkspaceView,
} from '../workspace/hooks/useWorkspaceData';
import type { WorkspaceEntity } from '../workspace/types';
import type { AnnotationListItem, SearchHit } from '../api/types';

const VALID_VIEWS: WorkspaceView[] = ['email', 'tag', 'annotation'];
const PAGE_SIZE = 20;

const VIEW_LABEL: Record<WorkspaceView, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  email: { label: 'Emails', icon: Mail },
  tag: { label: 'Tags', icon: TagIcon },
  annotation: { label: 'Annotations', icon: NotebookText },
};

export default function WorkspacePage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL 同步：view + q
  const urlView = searchParams.get('view') as WorkspaceView | null;
  const view: WorkspaceView = VALID_VIEWS.includes(urlView as WorkspaceView) ? (urlView as WorkspaceView) : 'email';
  const urlQ = searchParams.get('q') || '';

  const [qInput, setQInput] = useState(urlQ);
  const [q, setQ] = useState(urlQ);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Omit<WorkspaceFilters, 'q'>>({
    list_name: undefined,
    has_patch: undefined,
    annotation_type: 'all',
    publish_status: 'all',
  });

  // ThreadDrawer 状态
  const [threadOpen, setThreadOpen] = useState<{ threadId: string; focusMessageId?: string } | null>(null);

  useEffect(() => {
    setQInput(urlQ);
    setQ(urlQ);
  }, [urlQ]);

  useEffect(() => {
    setPage(1);
    setSelectedId(null);
  }, [view, q]);

  const effectiveFilters: WorkspaceFilters = useMemo(() => ({ q, ...filters }), [q, filters]);
  const data = useWorkspaceData(isAuthenticated ? view : 'email', effectiveFilters, page, PAGE_SIZE);

  const selectedEntity = useMemo(
    () => data.entities.find((e) => e.id === selectedId) || null,
    [data.entities, selectedId],
  );

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

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
      if (anchor?.version && anchor.file_path) {
        const params = new URLSearchParams({ v: anchor.version, path: anchor.file_path });
        if (anchor.start_line) params.set('line', String(anchor.start_line));
        navigate(`/kernel-code?${params.toString()}`);
        return;
      }
    }
    if (target.type === 'tag') {
      // 点击 tag 实体时，切到 tag view 并过滤到该 tag（简化：仅 q 匹配）
      const params = new URLSearchParams(searchParams);
      params.set('view', 'tag');
      params.set('q', target.ref);
      setSearchParams(params);
    }
  }

  // 选中项行内短展开（只给 email 做 preview，其余 kind 返回 null）
  function renderInlineExpansion(entity: WorkspaceEntity): React.ReactNode {
    if (entity.kind !== 'email_thread') return null;
    const hit = entity.raw as SearchHit;
    return (
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            {hit.list_name && <span className="rounded bg-slate-100 px-1.5 py-0.5">{hit.list_name}</span>}
            {hit.has_patch && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">patch</span>}
            {hit.source && <span className="rounded bg-slate-100 px-1.5 py-0.5">{hit.source}</span>}
          </div>
          {hit.snippet && (
            <div
              className="line-clamp-3 text-xs leading-relaxed text-slate-700"
              dangerouslySetInnerHTML={{ __html: hit.snippet }}
            />
          )}
        </div>
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            handleOpenTarget(entity);
          }}
          className="shrink-0 rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-800"
        >
          → 打开线程
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col">
      {/* Sticky Context Bar */}
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
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800"
            >
              搜索
            </button>
          </div>
        </div>

        {/* View-specific quick filters */}
        {view === 'email' && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5 text-slate-600">
              <input
                type="checkbox"
                checked={filters.has_patch || false}
                onChange={(e) => setFilters((f) => ({ ...f, has_patch: e.target.checked ? true : undefined }))}
                className="rounded border-slate-300"
              />
              has patch
            </label>
          </div>
        )}
        {view === 'annotation' && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
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

      {/* 两栏主体：EntityList + EntityDetailPanel */}
      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 border-r border-slate-200 bg-white">
          {data.loading ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">Loading…</div>
          ) : data.error ? (
            <div className="px-6 py-12 text-center text-sm text-rose-600">Error: {data.error}</div>
          ) : (
            <>
              <EntityList
                entities={data.entities}
                selectedId={selectedId}
                onSelect={(entity) => setSelectedId(entity.id)}
                renderInlineExpansion={renderInlineExpansion}
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

      {/* 未使用变量提示：避免 noUnusedLocals 报错（tag 相关 data 字段保留给未来 detail panel 使用） */}
      <span className="hidden" aria-hidden>
        {data.rawTags.length}
      </span>
    </div>
  );
}