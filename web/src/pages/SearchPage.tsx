import { useState, useEffect } from 'react';
import { ChevronDown, Search, Sparkles } from 'lucide-react';
import { searchEmails, listAnnotations, getTagStats, getChannels, summarizeSearchResults, createSummaryDraft, applySummaryDraft, type TagStats } from '../api/client';
import type { SearchResponse, SearchHit, SummarizeResponse, AskDraftResponse, SourceRef, ChannelOption, AnnotationListItem } from '../api/types';
import ThreadDrawer from '../components/ThreadDrawer';
import TagFilter from '../components/TagFilter';
import EmailTagEditor from '../components/EmailTagEditor';
import DraftReviewPanel from '../components/DraftReviewPanel';
import type { AskDraftApplyResponse } from '../api/types';
import { EmptyState, PageHeader, PageShell, PrimaryButton, SecondaryButton, SectionPanel, SkeletonCard, StatusBadge } from '../components/ui';
import { showToast } from '../components/Toast';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlightSnippet(snippet: string): string {
  return escapeHtml(snippet).replace(
    /&lt;&lt;(.*?)&gt;&gt;/g,
    '<mark class="bg-yellow-100 px-0.5 rounded">$1</mark>'
  );
}

function normalizeMessageId(value: string): string {
  return value
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function resolveCitationSource(
  citation: string,
  sources: SourceRef[],
) {
  const normalized = normalizeMessageId(citation);
  const exact = sources.find((source) => normalizeMessageId(source.message_id || '') === normalized);
  if (exact) return exact;

  const candidates = sources.filter((source) => {
    const id = normalizeMessageId(source.message_id || '');
    if (!id) return false;
    if (normalized.includes('...')) {
      const [prefix, suffix] = normalized.split('...', 2);
      return (!prefix || id.startsWith(prefix)) && (!suffix || id.endsWith(suffix));
    }
    return normalized.length >= 8 && (id.includes(normalized) || normalized.includes(id));
  });

  return candidates.length === 1 ? candidates[0] : undefined;
}

function compactSender(sender: string): string {
  return (sender.split('<')[0] || sender).replace(/^"|"$/g, '').trim() || 'unknown';
}

function compactDate(date: string): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return date.slice(0, 10);
}

function truncateText(text: string, max = 54): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function citationLabel(source: SourceRef): string {
  const parts = [
    compactSender(source.sender || ''),
    compactDate(source.date || ''),
    truncateText(source.subject || source.message_id || 'email'),
  ].filter(Boolean);
  return `[${parts.join(' · ')}]`;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('semantic');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
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

  // Channel/channel 选择状态
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([{ value: '', label: 'All Channels' }]);

  // 加载 channel 列表和标签统计
  useEffect(() => {
    getChannels().then((channels) => {
      setChannelOptions([{ value: '', label: 'All Channels' }, ...channels]);
    }).catch(() => {});
    getTagStats().then(setTagStats).catch(() => {});
  }, []);

  // 检查是否有任何过滤条件
  const hasFilters = sender || dateFrom || dateTo || hasPatch !== null || selectedTags.length > 0 || selectedChannel;
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

  const resetFilters = () => {
    setSender('');
    setDateFrom('');
    setDateTo('');
    setHasPatch(null);
    setSelectedTags([]);
    setSelectedChannel('');
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
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
      const sources: SourceRef[] = summary.sources.map(s => ({
        message_id: s.message_id,
        subject: s.subject,
        sender: s.sender,
        date: s.date,
        snippet: s.snippet,
        thread_id: s.thread_id,
        list_name: s.list_name,
      }));
      const bundle = await createSummaryDraft(query || 'kernel discussion', summary.answer, sources);
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
        showToast(`Draft saved with ${resp.errors.length} error(s): ${resp.errors.map(e => e.message).join(', ')}`, 'error');
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

      {/* 主要搜索栏 */}
      <SectionPanel title="Find discussions" description="Start broad, then tighten with channel, tags, author, date, or patch filters.">
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="flex-1 relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search emails... e.g. shmem mount"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pl-11 text-sm shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
          />
          <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
        </div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
        >
          <option value="hybrid">Hybrid</option>
          <option value="keyword">Keyword</option>
          <option value="semantic">Semantic</option>
        </select>
        {/* Channel/channel 选择器 */}
        <select
          value={selectedChannel}
          onChange={(e) => setSelectedChannel(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
        >
          {channelOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={`${sortBy}:${sortOrder}`}
          onChange={(e) => {
            const [by, order] = e.target.value.split(':');
            setSortBy(by);
            setSortOrder(order);
          }}
          className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
        >
          <option value=":">Relevance (default)</option>
          <option value="date:desc">Newest first</option>
          <option value="date:asc">Oldest first</option>
        </select>
        <PrimaryButton
          onClick={() => handleSearch()}
          disabled={loading || semanticNeedsQuery}
        >
          {loading ? 'Searching...' : 'Search'}
        </PrimaryButton>
      </div>
      {semanticNeedsQuery && (
        <p className="mt-2 text-xs text-amber-700">
          Semantic search needs query text. Use Keyword or Hybrid for filter-only searches.
        </p>
      )}

      {/* 标签筛选快捷入口 */}
      {tagStats.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Popular tags:</span>
            {tagStats.slice(0, 8).map(tag => (
              <button
                key={tag.name}
                onClick={() => handleTagToggle(tag.name)}
                className={`px-2 py-1 text-xs rounded-full transition-colors ${
                  selectedTags.includes(tag.name)
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tag.name} ({tag.count})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 高级搜索切换 */}
      <button
        onClick={() => {
          setShowAdvanced(!showAdvanced);
          if (showAdvanced) resetFilters();
        }}
        className="mt-4 flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        Advanced Filters
        {hasFilters && <StatusBadge tone="info" className="ml-1 py-0.5">Active</StatusBadge>}
      </button>

      {/* 高级搜索面板 */}
      {showAdvanced && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 发件人过滤 */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sender</label>
              <input
                type="text"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="e.g. torvalds"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* 起始日期 */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* 结束日期 */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* 是否包含补丁 */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Has Patch</label>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setHasPatch(hasPatch === true ? null : true)}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border ${
                    hasPatch === true
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Yes
                </button>
                <button
                  onClick={() => setHasPatch(hasPatch === false ? null : false)}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border ${
                    hasPatch === false
                      ? 'bg-red-50 border-red-300 text-red-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  No
                </button>
              </div>
            </div>
          </div>

          {/* 标签筛选 */}
          {tagStats.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <TagFilter
                tags={tagStats}
                selectedTags={selectedTags}
                tagMode={tagMode}
                onTagToggle={handleTagToggle}
                onTagModeChange={setTagMode}
              />
            </div>
          )}

          {/* 搜索按钮 */}
          <div className="mt-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <SecondaryButton
                onClick={resetFilters}
                className="px-3 py-1.5 text-xs"
              >
                Reset filters
              </SecondaryButton>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeAnnotations}
                  onChange={(e) => setIncludeAnnotations(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300"
                />
                搜索批注
              </label>
            </div>
            <PrimaryButton
              onClick={() => handleSearch()}
              disabled={loading || (!query.trim() && !hasFilters) || semanticNeedsQuery}
            >
              {loading ? 'Searching...' : 'Search'}
            </PrimaryButton>
          </div>
        </div>
      )}
      </SectionPanel>

      {result && (
        <SectionPanel>
          <p className="text-sm text-gray-500 mb-4">
            Found <span className="font-semibold text-gray-900">{result.total}</span> results
            {selectedChannel && (
              <span className="ml-2">
                <span className="text-gray-400">in channel:</span>
                <span className="ml-1 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium">{selectedChannel}</span>
              </span>
            )}
            {selectedTags.length > 0 && (
              <span className="ml-2">
                <span className="text-gray-400">in tags:</span>
                {selectedTags.map(t => (
                  <span key={t} className="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs">{t}</span>
                ))}
              </span>
            )}
            <span className="ml-2 px-2 py-0.5 bg-gray-100 rounded-full text-xs">{result.mode}</span>
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
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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

          {/* AI 概括结果面板 */}
          {summary && (
            <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  AI 概括
                  <span className="text-xs font-normal text-gray-400">by {summary.model}</span>
                </h3>
                <div className="flex items-center gap-2">
                  {!showDraftPanel && (
                    <button
                      onClick={handleCreateDraft}
                      disabled={draftLoading}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {draftLoading ? '生成草稿中...' : '创建草稿'}
                    </button>
                  )}
                  {draftSaved && (
                    <span className="text-xs text-green-600">
                      已保存: {draftSaved.created_entities.length} 实体, {draftSaved.created_annotations.length} 批注, {draftSaved.created_tag_assignments.length} 标签
                    </span>
                  )}
                </div>
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {summary.answer.split(/(\[[^\]]+\])/g).map((part, i) => {
                  const m = part.match(/^\[([^\]]+)\]$/);
                  if (!m) return <span key={i}>{part}</span>;
                  const src = resolveCitationSource(m[1], summary.sources);
                  if (!src || !src.thread_id) return <span key={i}>{part}</span>;
                  return (
	                    <button
	                      key={i}
	                      type="button"
	                      onClick={() => setSelectedThread(src.thread_id!)}
	                      className="mx-0.5 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
	                      title={`Open cited email: ${src.message_id}`}
	                    >
	                      {citationLabel(src)}
	                    </button>
                  );
                })}
              </div>

              {/* 草稿面板 */}
              {showDraftPanel && draftBundle && (
                <div className="mt-4 pt-4 border-t border-indigo-200">
                  <DraftReviewPanel
                    draft={draftBundle}
                    onChange={(nextDraft) => {
                      setDraftBundle(nextDraft);
                      setDraftSaved(null);
                    }}
                    onSave={handleApplyDraft}
                    saving={draftLoading}
                    saved={draftSaved}
                    compact
                  />
                  <button
                    onClick={() => { setShowDraftPanel(false); setDraftBundle(null); setDraftSaved(null); }}
                    className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    关闭草稿
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            {result.hits.map((hit) => (
              <ResultCard
                key={hit.message_id}
                hit={hit}
                onThread={() => setSelectedThread(hit.thread_id)}
              />
            ))}
          </div>
          {annotationResults.length > 0 && (
            <div className="mt-6 pt-4 border-t border-slate-200">
              <p className="text-sm text-slate-500 mb-3">
                批注匹配 <span className="font-semibold text-slate-900">{annotationTotal}</span> 条
              </p>
              <div className="space-y-2">
                {annotationResults.map((ann) => (
                  <button
                    key={ann.annotation_id}
                    type="button"
                    onClick={() => ann.thread_id && setSelectedThread(ann.thread_id)}
                    className="block w-full rounded-lg border border-purple-200 bg-purple-50/50 p-4 text-left hover:bg-purple-50 transition"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">批注</span>
                      <span className="text-xs text-slate-500">{ann.author}</span>
                      <span className="text-xs text-slate-400">{ann.created_at ? new Date(ann.created_at).toLocaleDateString() : ''}</span>
                    </div>
                    <div className="text-sm text-slate-700 line-clamp-3">{ann.body}</div>
                    {ann.email_subject && (
                      <div className="mt-1 text-[11px] text-slate-400 truncate">
                        在: {ann.email_subject}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
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

function ResultCard({
  hit,
  onThread,
}: {
  hit: SearchHit;
  onThread: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{hit.subject}</h3>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
            <span className="font-medium text-gray-700">
              {hit.sender.split('<')[0].trim()}
            </span>
            <span>{hit.date ? new Date(hit.date).toLocaleDateString() : ''}</span>
            {hit.has_patch && (
              <span className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs font-medium">
                patch
              </span>
            )}
            {hit.source && (
              <span className="px-1.5 py-0.5 bg-sky-50 text-sky-700 rounded text-xs font-medium">
                {hit.source}
              </span>
            )}
          </div>
          {/* 可编辑标签 */}
          <div className="mt-2">
            <EmailTagEditor messageId={hit.message_id} initialTags={hit.tags || []} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-600 rounded-full font-medium">
            {hit.score.toFixed(3)}
          </span>
          <button
            onClick={onThread}
            className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
          >
            Thread
          </button>
        </div>
      </div>
      {hit.snippet && (
        <p
          className="mt-3 text-xs text-gray-600 leading-relaxed line-clamp-2"
          dangerouslySetInnerHTML={{
            __html: highlightSnippet(hit.snippet),
          }}
        />
      )}
    </div>
  );
}
