import { useState, useEffect } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import {
  searchEmails,
  listAnnotations,
  getTagStats,
  getChannels,
  summarizeSearchResults,
  createSummaryDraft,
  applySummaryDraft,
  createTagAssignment,
  type TagStats,
} from '../api/client';
import type {
  SearchResponse,
  SummarizeResponse,
  AskDraftResponse,
  AskDraftApplyResponse,
  SourceRef,
  ChannelOption,
  AnnotationListItem,
} from '../api/types';
import ThreadDrawer from '../components/ThreadDrawer';
import StickyContextBar from '../components/StickyContextBar';
import {
  EmptyState,
  PageHeader,
  PageShell,
  PrimaryButton,
  SectionPanel,
  SkeletonCard,
  StatusBadge,
} from '../components/ui';
import { showToast } from '../components/Toast';
import { useAuth } from '../auth';
import SearchBar from '../components/search/SearchBar';
import AdvancedFilters from '../components/search/AdvancedFilters';
import SummaryPanel from '../components/search/SummaryPanel';
import BatchTagBar from '../components/search/BatchTagBar';
import AnnotationResults from '../components/search/AnnotationResults';
import ResultCard from '../components/search/ResultCard';
import SearchInspectorDock from '../components/search/SearchInspectorDock';
import { errorMessage } from '../components/search/searchUtils';
import { useContributions } from '../hooks/useContributions';

export default function SearchPage() {
  const { isAuthenticated } = useAuth();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('semantic');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [inspectedMessageId, setInspectedMessageId] = useState<string>('');
  const [page, setPage] = useState(1);
  const [tagStats, setTagStats] = useState<TagStats[]>([]);

  // 高级搜索状态
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sender, setSender] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hasPatch, setHasPatch] = useState<boolean | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<'any' | 'all'>('any');
  const [sortBy, setSortBy] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<string>('');

  // AI 概括状态
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<SummarizeResponse | null>(null);
  const [draftBundle, setDraftBundle] = useState<AskDraftResponse | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftSaved, setDraftSaved] = useState<AskDraftApplyResponse | null>(null);
  const [showDraftPanel, setShowDraftPanel] = useState(false);

  // Annotation search
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [annotationResults, setAnnotationResults] = useState<AnnotationListItem[]>([]);
  const [annotationTotal, setAnnotationTotal] = useState(0);

  // 批量标签操作
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [batchTagInput, setBatchTagInput] = useState('');
  const [batchTagging, setBatchTagging] = useState(false);

  // Channel 选择状态
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([
    { value: '', label: 'All Channels' },
  ]);

  // 加载 channel 列表和标签统计
  useEffect(() => {
    if (!isAuthenticated) return;
    getChannels()
      .then((channels) => {
        setChannelOptions([{ value: '', label: 'All Channels' }, ...channels]);
      })
      .catch(() => {});
    getTagStats().then(setTagStats).catch(() => {});
  }, [isAuthenticated]);

  // 检查是否有任何过滤条件
  const hasFilters =
    !!sender ||
    !!dateFrom ||
    !!dateTo ||
    hasPatch !== null ||
    selectedTags.length > 0 ||
    !!selectedChannel;
  const semanticNeedsQuery = mode === 'semantic' && !query.trim();

  const handleSearch = async (p = 1) => {
    if (!query.trim() && !hasFilters) return;
    if (semanticNeedsQuery) return;
    setLoading(true);
    setPage(p);
    try {
      const data = await searchEmails(query, {
        mode,
        page: p,
        page_size: 20,
        list_name: selectedChannel || undefined,
        sender: sender || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        has_patch: hasPatch ?? undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        tag_mode: tagMode,
        sort_by: sortBy || undefined,
        sort_order: sortOrder || undefined,
      });
      setResult(data);
      setInspectedMessageId(data.hits[0]?.message_id || '');

      // 并行搜索批注
      if (includeAnnotations && query.trim()) {
        try {
          const annRes = await listAnnotations({ q: query.trim(), page: 1, page_size: 10 });
          setAnnotationResults(annRes.annotations);
          setAnnotationTotal(annRes.total);
        } catch {
          setAnnotationResults([]);
          setAnnotationTotal(0);
        }
      } else {
        setAnnotationResults([]);
        setAnnotationTotal(0);
      }
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Search failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const totalPages = result ? Math.ceil(result.total / result.page_size) : 0;
  const activeFilterLabels = [
    selectedChannel ? `channel:${selectedChannel}` : '',
    sender ? `sender:${sender}` : '',
    dateFrom ? `from:${dateFrom}` : '',
    dateTo ? `to:${dateTo}` : '',
    hasPatch !== null ? (hasPatch ? 'patches' : 'no patches') : '',
    selectedTags.length > 0 ? `tags:${selectedTags.join(', ')}` : '',
  ].filter(Boolean);

  // PLAN-34001: 批量查询命中邮件/线程的知识库贡献度
  const hitMessageIds = result?.hits.map((h) => h.message_id) || [];
  const hitThreadIds = result?.hits.map((h) => h.thread_id).filter(Boolean) || [];
  const { byMessageId: contribByMessage, byThreadId: contribByThread } = useContributions(
    hitMessageIds,
    hitThreadIds,
  );
  const inspectedHit =
    result?.hits.find((hit) => hit.message_id === inspectedMessageId) ||
    result?.hits[0] ||
    null;
  const inspectedStats = inspectedHit
    ? contribByMessage[inspectedHit.message_id] || contribByThread[inspectedHit.thread_id]
    : null;

  const handleToggleSelect = (messageId: string) => {
    setSelectedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (!result) return;
    if (selectedMessages.size === result.hits.length) {
      setSelectedMessages(new Set());
    } else {
      setSelectedMessages(new Set(result.hits.map((h) => h.message_id)));
    }
  };

  const handleBatchTag = async () => {
    const tagName = batchTagInput.trim();
    if (!tagName || selectedMessages.size === 0) return;
    setBatchTagging(true);
    let done = 0;
    let failed = 0;
    for (const messageId of selectedMessages) {
      try {
        await createTagAssignment({
          tag_name: tagName,
          target_type: 'email_message',
          target_ref: messageId,
        });
        done++;
      } catch {
        failed++;
      }
    }
    setBatchTagging(false);
    setBatchTagInput('');
    setSelectedMessages(new Set());
    if (failed > 0) {
      showToast(`已打标签 ${done} 封，${failed} 封失败`, 'error');
    } else {
      showToast(`已为 ${done} 封邮件打上标签 "${tagName}"`, 'success');
    }
  };

  const resetFilters = () => {
    setSender('');
    setDateFrom('');
    setDateTo('');
    setHasPatch(null);
    setSelectedTags([]);
    setSelectedChannel('');
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleSummarize = async () => {
    if (!result || summarizing) return;
    setSummarizing(true);
    setSummary(null);
    setDraftBundle(null);
    setDraftSaved(null);
    try {
      const hits = result.hits.slice(0, 10);
      const resp = await summarizeSearchResults({
        query: query || 'kernel discussion',
        hits,
      });
      setSummary(resp);
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Summarize failed'), 'error');
    } finally {
      setSummarizing(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!summary || draftLoading) return;
    setDraftLoading(true);
    setDraftBundle(null);
    setDraftSaved(null);
    try {
      const sources: SourceRef[] = summary.sources.map((s) => ({
        message_id: s.message_id,
        subject: s.subject,
        sender: s.sender,
        date: s.date,
        snippet: s.snippet,
        thread_id: s.thread_id,
        list_name: s.list_name,
      }));
      const bundle = await createSummaryDraft(
        query || 'kernel discussion',
        summary.answer,
        sources,
      );
      setDraftBundle(bundle);
      setShowDraftPanel(true);
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Create draft failed'), 'error');
    } finally {
      setDraftLoading(false);
    }
  };

  const handleApplyDraft = async () => {
    if (!draftBundle) return;
    setDraftLoading(true);
    try {
      const resp = await applySummaryDraft(draftBundle);
      setDraftSaved(resp);
      if (resp.errors.length > 0) {
        showToast(
          `Draft saved with ${resp.errors.length} error(s): ${resp.errors
            .map((e) => e.message)
            .join(', ')}`,
          'error',
        );
      }
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Apply draft failed'), 'error');
    } finally {
      setDraftLoading(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Research"
        title="Search Emails"
        description="Find source discussions first, then summarize and promote durable findings into Knowledge."
        meta={
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="muted">Search</StatusBadge>
            <StatusBadge tone="info">Summarize</StatusBadge>
            <StatusBadge tone="success">Draft Knowledge</StatusBadge>
          </div>
        }
      />

      <SectionPanel
        title="Find discussions"
        description="Start broad, then tighten with channel, tags, author, date, or patch filters."
      >
        <SearchBar
          query={query}
          onQueryChange={setQuery}
          mode={mode}
          onModeChange={setMode}
          selectedChannel={selectedChannel}
          onChannelChange={setSelectedChannel}
          channelOptions={channelOptions}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChange={(by, order) => {
            setSortBy(by);
            setSortOrder(order);
          }}
          loading={loading}
          semanticNeedsQuery={semanticNeedsQuery}
          onSearch={() => handleSearch()}
          tagStats={tagStats}
          selectedTags={selectedTags}
          onTagToggle={handleTagToggle}
        />

        <button
          onClick={() => {
            setShowAdvanced(!showAdvanced);
            if (showAdvanced) resetFilters();
          }}
          className="mt-4 flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
          />
          Advanced Filters
          {hasFilters && (
            <StatusBadge tone="info" className="ml-1 py-0.5">
              Active
            </StatusBadge>
          )}
        </button>

        {showAdvanced && (
          <AdvancedFilters
            sender={sender}
            onSenderChange={setSender}
            dateFrom={dateFrom}
            onDateFromChange={setDateFrom}
            dateTo={dateTo}
            onDateToChange={setDateTo}
            hasPatch={hasPatch}
            onHasPatchChange={setHasPatch}
            tagStats={tagStats}
            selectedTags={selectedTags}
            tagMode={tagMode}
            onTagToggle={handleTagToggle}
            onTagModeChange={setTagMode}
            includeAnnotations={includeAnnotations}
            onIncludeAnnotationsChange={setIncludeAnnotations}
            onResetFilters={resetFilters}
            loading={loading}
            hasFilters={hasFilters}
            query={query}
            semanticNeedsQuery={semanticNeedsQuery}
            onSearch={() => handleSearch()}
          />
        )}
      </SectionPanel>

      {result && (
        <SectionPanel className="relative">
          <StickyContextBar
            title={query.trim() || 'Filtered email search'}
            subtitle={`${result.total.toLocaleString()} result${result.total === 1 ? '' : 's'} · ${result.mode}`}
            meta={
              <>
                {activeFilterLabels.slice(0, 3).map((label) => (
                  <StatusBadge key={label} tone="muted">
                    {label}
                  </StatusBadge>
                ))}
                {activeFilterLabels.length > 3 && (
                  <StatusBadge tone="muted">+{activeFilterLabels.length - 3} filters</StatusBadge>
                )}
              </>
            }
            actions={
              summary ? (
                <PrimaryButton onClick={handleCreateDraft} disabled={draftLoading}>
                  <Sparkles className="h-4 w-4" />
                  Save draft
                </PrimaryButton>
              ) : (
                <PrimaryButton
                  onClick={handleSummarize}
                  disabled={summarizing || result.hits.length === 0}
                >
                  <Sparkles className="h-4 w-4" />
                  Summarize
                </PrimaryButton>
              )
            }
          />
          <p className="text-sm text-gray-500 mb-4">
            Found <span className="font-semibold text-gray-900">{result.total}</span> results
            {selectedChannel && (
              <span className="ml-2">
                <span className="text-gray-400">in channel:</span>
                <span className="ml-1 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium">
                  {selectedChannel}
                </span>
              </span>
            )}
            {selectedTags.length > 0 && (
              <span className="ml-2">
                <span className="text-gray-400">in tags:</span>
                {selectedTags.map((t) => (
                  <span
                    key={t}
                    className="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs"
                  >
                    {t}
                  </span>
                ))}
              </span>
            )}
            <span className="ml-2 px-2 py-0.5 bg-gray-100 rounded-full text-xs">
              {result.mode}
            </span>
          </p>

          {/* AI 概括按钮 */}
          <div className="mb-4">
            <PrimaryButton
              onClick={handleSummarize}
              disabled={summarizing || result.hits.length === 0}
            >
              {summarizing ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  概括中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  AI 概括前 {Math.min(result.hits.length, 10)} 条结果
                </>
              )}
            </PrimaryButton>
          </div>

          {summary && (
            <SummaryPanel
              summary={summary}
              draftBundle={draftBundle}
              draftSaved={draftSaved}
              draftLoading={draftLoading}
              showDraftPanel={showDraftPanel}
              onCreateDraft={handleCreateDraft}
              onDraftChange={(next) => {
                setDraftBundle(next);
                setDraftSaved(null);
              }}
              onApplyDraft={handleApplyDraft}
              onCloseDraft={() => {
                setShowDraftPanel(false);
                setDraftBundle(null);
                setDraftSaved(null);
              }}
              onOpenThread={setSelectedThread}
            />
          )}

          {selectedMessages.size > 0 && (
            <BatchTagBar
              selectedCount={selectedMessages.size}
              batchTagInput={batchTagInput}
              onBatchTagInputChange={setBatchTagInput}
              batchTagging={batchTagging}
              onBatchTag={handleBatchTag}
              onCancel={() => {
                setSelectedMessages(new Set());
                setBatchTagInput('');
              }}
            />
          )}

          <div className="space-y-3">
            {result.hits.length > 0 && (
              <div className="flex items-center gap-2 mb-1">
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedMessages.size === result.hits.length}
                    onChange={handleSelectAll}
                    className="w-3.5 h-3.5 rounded border-slate-300"
                  />
                  全选
                </label>
              </div>
            )}
            {result.hits.map((hit) => (
              <ResultCard
                key={hit.message_id}
                hit={hit}
                onThread={() => setSelectedThread(hit.thread_id)}
                onInspect={(nextHit) => setInspectedMessageId(nextHit.message_id)}
                selected={selectedMessages.has(hit.message_id)}
                onToggleSelect={handleToggleSelect}
                messageStats={contribByMessage[hit.message_id]}
                threadStats={contribByThread[hit.thread_id]}
              />
            ))}
          </div>

          <SearchInspectorDock
            hit={inspectedHit}
            stats={inspectedStats}
            onOpenThread={setSelectedThread}
          />

          <AnnotationResults
            annotationResults={annotationResults}
            annotationTotal={annotationTotal}
            onOpenThread={setSelectedThread}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => handleSearch(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-50"
              >
                Prev
              </button>
              <span className="text-sm text-gray-600">
                Page {page}/{totalPages}
              </span>
              <button
                onClick={() => handleSearch(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          )}
        </SectionPanel>
      )}

      {loading && (
        <SectionPanel title="Searching...">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </SectionPanel>
      )}

      {!result && !loading && (
        <EmptyState
          title="Search the mailing list archive"
          description="Try a subsystem, function name, regression symptom, or historical decision. Good search results become the evidence for durable knowledge."
        />
      )}

      {selectedThread && (
        <ThreadDrawer threadId={selectedThread} onClose={() => setSelectedThread(null)} />
      )}
    </PageShell>
  );
}
