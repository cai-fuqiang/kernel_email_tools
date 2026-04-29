import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CircleStop, Play, RefreshCw, RotateCcw } from 'lucide-react';
import {
  cancelAgentResearchRun,
  createAgentResearchRun,
  getAgentResearchRun,
  getChannels,
  listAgentResearchRuns,
  retryAgentResearchRun,
} from '../api/client';
import type { AgentResearchRun, AgentResearchRunDetailResponse, AgentRunAction } from '../api/types';
import { showToast } from '../components/Toast';
import {
  EmptyState,
  PageHeader,
  PageShell,
  PrimaryButton,
  SecondaryButton,
  SectionPanel,
  StatusBadge,
} from '../components/ui';

type ChannelOption = { value: string; label: string };

function statusTone(status: string) {
  if (status === 'needs_review' || status === 'accepted') return 'success';
  if (status === 'running' || status === 'queued') return 'info';
  if (status === 'failed' || status === 'rejected') return 'danger';
  if (status === 'cancelled') return 'warning';
  return 'muted';
}

function formatDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function compactJson(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function actionTitle(action: AgentRunAction) {
  return action.action_type.replace(/_/g, ' ');
}

export default function AgentResearchPage() {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [runs, setRuns] = useState<AgentResearchRun[]>([]);
  const [detail, setDetail] = useState<AgentResearchRunDetailResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [topic, setTopic] = useState('');
  const [listName, setListName] = useState('');
  const [sender, setSender] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [hasPatch, setHasPatch] = useState('');
  const [maxIterations, setMaxIterations] = useState(3);
  const [maxSearches, setMaxSearches] = useState(6);
  const [maxThreads, setMaxThreads] = useState(20);

  const activeRun = detail?.run;
  const isLive = activeRun?.status === 'queued' || activeRun?.status === 'running';
  const canSubmit = topic.trim().length > 0 && !starting;

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAgentResearchRuns('', 1, 30);
      setRuns(data.runs);
      if (!selectedRunId && data.runs[0]) {
        setSelectedRunId(data.runs[0].run_id);
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load research runs', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedRunId]);

  const loadDetail = useCallback(async (runId: string) => {
    if (!runId) {
      setDetail(null);
      return;
    }
    try {
      const data = await getAgentResearchRun(runId);
      setDetail(data);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load run detail', 'error');
    }
  }, []);

  useEffect(() => {
    getChannels().then(setChannels).catch(() => setChannels([]));
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    void loadDetail(selectedRunId);
  }, [loadDetail, selectedRunId]);

  useEffect(() => {
    if (!isLive || !selectedRunId) return undefined;
    const timer = window.setInterval(() => {
      void loadDetail(selectedRunId);
      void loadRuns();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [isLive, loadDetail, loadRuns, selectedRunId]);

  const selectedDraftIds = useMemo(() => activeRun?.draft_ids || [], [activeRun]);

  const handleStart = async () => {
    if (!canSubmit) return;
    setStarting(true);
    try {
      const tags = tagsText.split(',').map((tag) => tag.trim()).filter(Boolean);
      const run = await createAgentResearchRun({
        topic: topic.trim(),
        list_name: listName || undefined,
        sender: sender.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        tags: tags.length > 0 ? tags : undefined,
        has_patch: hasPatch === '' ? null : hasPatch === 'true',
        budget: {
          max_iterations: maxIterations,
          max_searches: maxSearches,
          max_threads: maxThreads,
        },
      });
      setSelectedRunId(run.run_id);
      setTopic('');
      await loadRuns();
      await loadDetail(run.run_id);
      showToast('Agent research run queued', 'success');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to start research run', 'error');
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeRun) return;
    try {
      const run = await cancelAgentResearchRun(activeRun.run_id);
      setDetail((prev) => prev ? { ...prev, run } : prev);
      await loadRuns();
      showToast('Run cancelled', 'success');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to cancel run', 'error');
    }
  };

  const handleRetry = async () => {
    if (!activeRun) return;
    try {
      const run = await retryAgentResearchRun(activeRun.run_id);
      setSelectedRunId(run.run_id);
      await loadRuns();
      await loadDetail(run.run_id);
      showToast('Retry queued', 'success');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to retry run', 'error');
    }
  };

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="AI Agent"
        title="Research Runs"
        description="Start a topic-driven research task, watch its search and synthesis trace, then review the generated knowledge draft."
        actions={
          <SecondaryButton onClick={loadRuns} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </SecondaryButton>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
        <div className="space-y-6">
          <SectionPanel title="New run" description="The agent searches existing mail evidence and writes a draft for human review.">
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Topic</span>
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Why did the scheduler discussion reject approach X?"
                  className="mt-1 min-h-[104px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">List</span>
                  <select
                    value={listName}
                    onChange={(e) => setListName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">All lists</option>
                    {channels.map((channel) => (
                      <option key={channel.value} value={channel.value}>{channel.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Sender</span>
                  <input
                    value={sender}
                    onChange={(e) => setSender(e.target.value)}
                    placeholder="name or email"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">To</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Tags</span>
                  <input
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="comma-separated"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Patch filter</span>
                  <select
                    value={hasPatch}
                    onChange={(e) => setHasPatch(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Any</option>
                    <option value="true">Has patch</option>
                    <option value="false">No patch</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Iterations</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Searches</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={maxSearches}
                    onChange={(e) => setMaxSearches(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Threads</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={maxThreads}
                    onChange={(e) => setMaxThreads(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <PrimaryButton onClick={handleStart} disabled={!canSubmit} className="w-full">
                <Play className="h-4 w-4" />
                {starting ? 'Starting...' : 'Start research'}
              </PrimaryButton>
            </div>
          </SectionPanel>

          <SectionPanel title="Recent runs">
            {runs.length === 0 ? (
              <EmptyState title="No runs yet" />
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <button
                    key={run.run_id}
                    type="button"
                    onClick={() => setSelectedRunId(run.run_id)}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      run.run_id === selectedRunId
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="line-clamp-2 text-sm font-medium text-slate-950">{run.topic}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDateTime(run.updated_at)}</div>
                      </div>
                      <StatusBadge tone={statusTone(run.status)}>{run.status}</StatusBadge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </SectionPanel>
        </div>

        <div className="space-y-6">
          {!activeRun ? (
            <EmptyState title="Select or start a run" description="Run detail and trace will appear here." />
          ) : (
            <>
              <SectionPanel
                title="Run detail"
                actions={
                  <>
                    {isLive && (
                      <SecondaryButton onClick={handleCancel}>
                        <CircleStop className="h-4 w-4" />
                        Cancel
                      </SecondaryButton>
                    )}
                    {(activeRun.status === 'failed' || activeRun.status === 'cancelled') && (
                      <SecondaryButton onClick={handleRetry}>
                        <RotateCcw className="h-4 w-4" />
                        Retry
                      </SecondaryButton>
                    )}
                  </>
                }
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={statusTone(activeRun.status)}>{activeRun.status}</StatusBadge>
                    <StatusBadge tone="muted">{activeRun.agent_name}</StatusBadge>
                    <StatusBadge tone="info">confidence {(activeRun.confidence || 0).toFixed(2)}</StatusBadge>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-950">{activeRun.topic}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Created {formatDateTime(activeRun.created_at)} · Updated {formatDateTime(activeRun.updated_at)}
                    </div>
                  </div>
                  {activeRun.summary && (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                      {activeRun.summary}
                    </p>
                  )}
                  {activeRun.failure_reason && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {activeRun.failure_reason}
                    </div>
                  )}
                  {selectedDraftIds.length > 0 && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <div className="text-sm font-medium text-emerald-800">Draft ready for review</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {selectedDraftIds.map((draftId) => (
                          <span key={draftId} className="rounded bg-white/70 px-2 py-1 text-xs text-emerald-700">
                            {draftId}
                          </span>
                        ))}
                        <Link to="/knowledge" className="text-xs font-medium text-emerald-800 underline">
                          Open Knowledge Draft Inbox
                        </Link>
                      </div>
                    </div>
                  )}
                  <div className="grid gap-3 md:grid-cols-2">
                    <MetaBox title="Filters" value={activeRun.filters} />
                    <MetaBox title="Budget" value={activeRun.budget} />
                  </div>
                </div>
              </SectionPanel>

              <SectionPanel title="Trace">
                {detail.actions.length === 0 ? (
                  <EmptyState title="No actions recorded yet" />
                ) : (
                  <div className="space-y-3">
                    {detail.actions.map((action) => {
                      const usage = action.token_usage as Record<string, number> | undefined;
                      return (
                      <div key={action.action_id} className="rounded-lg border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Bot className="h-4 w-4 text-slate-500" />
                            <div className="text-sm font-semibold capitalize text-slate-950">{actionTitle(action)}</div>
                            <StatusBadge tone={statusTone(action.status)}>{action.status}</StatusBadge>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            {action.iteration_index > 0 && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5">iter {action.iteration_index}</span>
                            )}
                            <span>{formatDateTime(action.created_at)}</span>
                          </div>
                        </div>
                        {usage && usage.total_tokens > 0 && (
                          <div className="mt-1 text-[11px] text-slate-400">
                            Tokens: {usage.total_tokens.toLocaleString()} (prompt {usage.prompt_tokens?.toLocaleString() || 0}, completion {usage.completion_tokens?.toLocaleString() || 0})
                          </div>
                        )}
                        {action.error && (
                          <div className="mt-2 rounded border border-rose-100 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
                            {action.error}
                          </div>
                        )}
                        {Object.keys(action.payload || {}).length > 0 && (
                          <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                            {compactJson(action.payload)}
                          </pre>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
              </SectionPanel>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function MetaBox({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase text-slate-500">{title}</div>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
        {compactJson(value) || '{}'}
      </pre>
    </div>
  );
}
