import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Code2,
  Library,
  Search,
  Tags,
} from 'lucide-react';
import {
  getKnowledgeStats,
  getStats,
  listAnnotations,
  listKnowledgeDrafts,
} from '../api/client';
import type {
  AnnotationListItem,
  KnowledgeDraft,
  KnowledgeStats,
  StatsResponse,
} from '../api/types';
import { useAuth } from '../auth';
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PageShell,
  SectionPanel,
  SkeletonLine,
  StatusBadge,
} from '../components/ui';

type LoadState<T> = {
  loading: boolean;
  error: string;
  data: T | null;
};

function initialState<T>(): LoadState<T> {
  return { loading: true, error: '', data: null };
}

function roleTone(role: string) {
  if (role === 'admin') return 'success';
  if (role === 'editor') return 'info';
  return 'muted';
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {message}
    </div>
  );
}

function MiniSkeleton() {
  return (
    <div className="space-y-3">
      <SkeletonLine className="w-2/3" />
      <SkeletonLine className="w-full" />
      <SkeletonLine className="w-5/6" />
    </div>
  );
}

function ActionTile({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group flex min-h-28 items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-white">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-950 group-hover:text-slate-700">{title}</div>
        <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>
      </div>
    </Link>
  );
}

function InboxItem({
  label,
  value,
  to,
  hint,
}: {
  label: string;
  value: ReactNode;
  to: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 transition hover:bg-slate-50"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
      </div>
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
    </Link>
  );
}

function ActivityRow({
  title,
  subtitle,
  to,
  badge,
}: {
  title: string;
  subtitle: string;
  to: string;
  badge: string;
}) {
  return (
    <Link to={to} className="block rounded-lg px-3 py-2 transition hover:bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{title}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div>
        </div>
        <StatusBadge tone="muted" className="shrink-0">
          {badge}
        </StatusBadge>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { currentUser, isAdmin } = useAuth();
  const [mailStats, setMailStats] = useState<LoadState<StatsResponse>>(initialState);
  const [knowledgeStats, setKnowledgeStats] = useState<LoadState<KnowledgeStats>>(initialState);
  const [drafts, setDrafts] = useState<LoadState<KnowledgeDraft[]>>(initialState);
  const [annotations, setAnnotations] = useState<LoadState<AnnotationListItem[]>>(initialState);

  useEffect(() => {
    getStats()
      .then((data) => setMailStats({ loading: false, error: '', data }))
      .catch((error: unknown) =>
        setMailStats({ loading: false, error: error instanceof Error ? error.message : 'Failed to load mail stats', data: null }),
      );
    getKnowledgeStats()
      .then((data) => setKnowledgeStats({ loading: false, error: '', data }))
      .catch((error: unknown) =>
        setKnowledgeStats({ loading: false, error: error instanceof Error ? error.message : 'Failed to load knowledge stats', data: null }),
      );
    listKnowledgeDrafts({ status: 'new', page_size: 20 })
      .then((data) => setDrafts({ loading: false, error: '', data: data.drafts }))
      .catch((error: unknown) =>
        setDrafts({ loading: false, error: error instanceof Error ? error.message : 'Failed to load drafts', data: null }),
      );
    listAnnotations({ page_size: 30 })
      .then((data) => setAnnotations({ loading: false, error: '', data: data.annotations }))
      .catch((error: unknown) =>
        setAnnotations({ loading: false, error: error instanceof Error ? error.message : 'Failed to load annotations', data: null }),
      );
  }, []);

  const channelCount = Object.keys(mailStats.data?.lists || {}).length;
  const privateAnnotations = useMemo(
    () => (annotations.data || []).filter((item) => item.visibility === 'private' && item.publish_status !== 'approved'),
    [annotations.data],
  );
  const pendingAnnotations = useMemo(
    () => (annotations.data || []).filter((item) => item.publish_status === 'pending'),
    [annotations.data],
  );
  const recentActivities = [
    ...(knowledgeStats.data?.recent || []).map((entity) => ({
      title: entity.canonical_name,
      subtitle: `${entity.entity_type} updated ${formatDate(entity.updated_at)}`,
      to: `/knowledge?entity_id=${encodeURIComponent(entity.entity_id)}`,
      badge: 'Knowledge',
      date: entity.updated_at,
    })),
    ...(annotations.data || []).slice(0, 5).map((annotation) => ({
      title: annotation.target_label || annotation.email_subject || annotation.annotation_id,
      subtitle: `${annotation.visibility} annotation ${formatDate(annotation.updated_at)}`,
      to: '/workspace?view=annotation',
      badge: 'Note',
      date: annotation.updated_at,
    })),
  ]
    .sort((a, b) => new Date(b.date || '').getTime() - new Date(a.date || '').getTime())
    .slice(0, 10);
  const latestCodeAnnotation = useMemo(
    () =>
      (annotations.data || []).find(
        (annotation) => annotation.target_type === 'code' && annotation.file_path,
      ) || null,
    [annotations.data],
  );
  const continueContextLabel = latestCodeAnnotation?.file_path
    ? `${latestCodeAnnotation.file_path}${latestCodeAnnotation.start_line ? `:${latestCodeAnnotation.start_line}` : ''}`
    : 'Resume from your last code context in Kernel Code';

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="Workbench"
        title={`Hello, ${currentUser?.display_name || 'researcher'}`}
        description="Continue your active code and annotation work, then branch into search or knowledge review."
        meta={currentUser && <StatusBadge tone={roleTone(currentUser.role)}>{currentUser.role}</StatusBadge>}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Channels" value={mailStats.loading ? '...' : channelCount.toLocaleString()} hint="Indexed mailing lists" />
        <MetricCard label="Emails" value={mailStats.loading ? '...' : (mailStats.data?.total_emails || 0).toLocaleString()} hint="Searchable messages" />
        <MetricCard label="Knowledge" value={knowledgeStats.loading ? '...' : (knowledgeStats.data?.by_status.active || knowledgeStats.data?.total_entities || 0).toLocaleString()} hint="Accepted active entities" />
      </div>

      <SectionPanel title="Continue Working" description="Return to the most specific code context available.">
        <button
          type="button"
          onClick={() => navigate('/kernel-code')}
          className="group flex w-full items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Code2 className="h-4 w-4 text-slate-700" />
              Continue last code context
            </div>
            <div className="mt-1 truncate text-sm text-slate-600">{continueContextLabel}</div>
          </div>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-slate-700" />
        </button>
      </SectionPanel>

      <SectionPanel title="Search" description="Search stays one click away whenever you need broader discovery.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ActionTile to="/workspace" icon={Search} title="Mail and thread search" description="Find threads by subsystem, symptom, patch, or tag." />
          <ActionTile to="/manual/search" icon={BookOpen} title="Manual lookup" description="Search Intel SDM and related technical references." />
          <ActionTile to="/annotations" icon={Bookmark} title="Annotation lookup" description="Find annotations by ID, source, or recent activity." />
        </div>
      </SectionPanel>

      <SectionPanel title="My Inbox" description="Review queues surfaced in one place.">
        {drafts.loading || annotations.loading ? (
          <MiniSkeleton />
        ) : drafts.error || annotations.error ? (
          <SectionError message={drafts.error || annotations.error} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InboxItem label="Knowledge drafts" value={drafts.data?.length || 0} hint="New drafts waiting for review" to="/knowledge" />
            <InboxItem label="Private annotations" value={privateAnnotations.length} hint="Unpublished notes in your working set" to="/workspace?view=annotation" />
            {isAdmin && (
              <InboxItem
                label="Admin approvals"
                value={pendingAnnotations.length}
                hint="Pending annotations awaiting review"
                to="/admin/annotation-review"
              />
            )}
          </div>
        )}
      </SectionPanel>

      <SectionPanel title="Knowledge Surfaces">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ActionTile to="/knowledge" icon={Library} title="Browse knowledge" description="Edit entities, evidence, relations, and review drafts." />
          <ActionTile to="/kernel-code" icon={Code2} title="Kernel Code" description="Inspect code targets, versions, and linked annotations." />
          <ActionTile to="/tags" icon={Tags} title="Tag maintenance" description="Manage tag hierarchy for filtering and cleanup workflows." />
        </div>
      </SectionPanel>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <SectionPanel title="Recent Activity">
          {knowledgeStats.loading || annotations.loading ? (
            <MiniSkeleton />
          ) : recentActivities.length === 0 ? (
            <EmptyState title="No recent activity yet" description="Search results, accepted knowledge, and annotations will appear here." />
          ) : (
            <div className="divide-y divide-slate-100">
              {recentActivities.map((item) => (
                <ActivityRow key={`${item.badge}:${item.title}:${item.date}`} {...item} />
              ))}
            </div>
          )}
        </SectionPanel>

        <SectionPanel title="Index Health" description="A compact readout of the search corpus available right now.">
          {mailStats.loading || knowledgeStats.loading ? (
            <MiniSkeleton />
          ) : mailStats.error || knowledgeStats.error ? (
            <SectionError message={mailStats.error || knowledgeStats.error} />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-500">Mail corpus</span>
                <span className="text-sm font-semibold text-slate-950">{(mailStats.data?.total_emails || 0).toLocaleString()} emails</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-500">Knowledge graph</span>
                <span className="text-sm font-semibold text-slate-950">{(knowledgeStats.data?.total_entities || 0).toLocaleString()} entities</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-500">Relations</span>
                <span className="text-sm font-semibold text-slate-950">{(knowledgeStats.data?.total_relations || 0).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-500">Semantic search</span>
                <StatusBadge tone="info">Available when vectors are indexed</StatusBadge>
              </div>
            </div>
          )}
        </SectionPanel>
      </div>
    </PageShell>
  );
}
