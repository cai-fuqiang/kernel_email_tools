import { useState, useEffect } from 'react';
import { searchEmails, getTagStats, summarizeSearchResults, createSummaryDraft, applySummaryDraft, type TagStats } from '../api/client';
import type { SearchResponse, SearchHit, SummarizeResponse, AskDraftResponse, SourceRef } from '../api/types';
import ThreadDrawer from '../components/ThreadDrawer';
import TagFilter from '../components/TagFilter';
import EmailTagEditor from '../components/EmailTagEditor';

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

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('hybrid');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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

  // AI 概括状态
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<SummarizeResponse | null>(null);
  const [draftBundle, setDraftBundle] = useState<AskDraftResponse | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftSaved, setDraftSaved] = useState<{ entities: number; annotations: number; tags: number; errors: number } | null>(null);
  const [showDraftPanel, setShowDraftPanel] = useState(false);

  // Channel/channel 选择状态
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  

  // 预定义的 channel 列表（与 settings.yaml 的 local_channels 对应）
  const CHANNEL_OPTIONS = [
    { value: '', label: 'All Channels' },
    { value: 'kvm', label: 'KVM' },
    { value: 'linux-mm', label: 'Linux-MM' },
    { value: 'lkml', label: 'LKML' },
  ];

  // 加载标签统计
  useEffect(() => {
    getTagStats().then(setTagStats).catch(() => {});
  }, []);

  // 检查是否有任何过滤条件
  const hasFilters = sender || dateFrom || dateTo || hasPatch !== null || selectedTags.length > 0 || selectedChannel;

  const handleSearch = async (p = 1) => {
    // 至少要有关键词或过滤条件
    if (!query.trim() && !hasFilters) return;
    setLoading(true);
    setError('');
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
      });
      setResult(data);
    } catch (e: any) {
      setError(e.message);
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
    try {
      const hits = result.hits.slice(0, 10);
      const resp = await summarizeSearchResults({
        query: query || 'kernel discussion',
        hits,
      });
      setSummary(resp);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSummarizing(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!summary || draftLoading) return;
    setDraftLoading(true);
    setDraftBundle(null);
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDraftLoading(false);
    }
  };

  const handleApplyDraft = async () => {
    if (!draftBundle) return;
    setDraftLoading(true);
    try {
      const resp = await applySummaryDraft(draftBundle);
      setDraftSaved({
        entities: resp.created_entities.length,
        annotations: resp.created_annotations.length,
        tags: resp.created_tag_assignments.length,
        errors: resp.errors.length,
      });
      if (resp.errors.length > 0) {
        setError(`Draft saved with ${resp.errors.length} error(s): ${resp.errors.map(e => e.message).join(', ')}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDraftLoading(false);
    }
  };

  const sourceByMessageId = new Map<string, { threadId: string; messageId: string }>();
  for (const source of summary?.sources || []) {
    if (!source.message_id || !source.thread_id) continue;
    sourceByMessageId.set(source.message_id.replace(/^<|>$/g, '').trim(), {
      threadId: source.thread_id,
      messageId: source.message_id,
    });
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Search Emails</h2>
        <p className="text-sm text-gray-500">Full-text search across kernel mailing list archives</p>
      </div>

      {/* 主要搜索栏 */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search emails... e.g. shmem mount"
            className="w-full px-4 py-3 pl-11 bg-white border border-gray-300 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          />
          <svg
            className="absolute left-3.5 top-3.5 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="px-3 py-3 bg-white border border-gray-300 rounded-xl text-sm"
        >
          <option value="hybrid">Hybrid</option>
          <option value="keyword">Keyword</option>
          <option value="semantic">Semantic</option>
        </select>
        {/* Channel/channel 选择器 */}
        <select
          value={selectedChannel}
          onChange={(e) => setSelectedChannel(e.target.value)}
          className="px-3 py-3 bg-white border border-gray-300 rounded-xl text-sm"
        >
          {CHANNEL_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button
          onClick={() => handleSearch()}
          disabled={loading}
          className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* 标签筛选快捷入口 */}
      {tagStats.length > 0 && (
        <div className="mb-4">
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
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
      >
        <svg
          className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Advanced Filters
        {hasFilters && <span className="ml-1 px-1.5 py-0.5 bg-indigo-100 text-indigo-600 text-xs rounded">Active</span>}
      </button>

      {/* 高级搜索面板 */}
      {showAdvanced && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
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
            <button
              onClick={resetFilters}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Reset filters
            </button>
            <button
              onClick={() => handleSearch()}
              disabled={loading || (!query.trim() && !hasFilters)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div>
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
            <button
              onClick={handleSummarize}
              disabled={summarizing || result.hits.length === 0}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg text-sm font-medium hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 shadow-sm flex items-center gap-2"
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
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  AI 概括前 {Math.min(result.hits.length, 10)} 条结果
                </>
              )}
            </button>
          </div>

          {/* AI 概括结果面板 */}
          {summary && (
            <div className="mb-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5">
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
                      已保存: {draftSaved.entities} 实体, {draftSaved.annotations} 批注, {draftSaved.tags} 标签
                    </span>
                  )}
                </div>
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {summary.answer.split(/(\[[^\]]+\])/g).map((part, i) => {
                  const m = part.match(/^\[([^\]]+)\]$/);
                  if (!m) return <span key={i}>{part}</span>;
                  const msgId = m[1].replace(/^<|>$/g, '').trim();
                  const src = summary.sources.find(s =>
                    (s.message_id || '').replace(/^<|>$/g, '').trim() === msgId
                  );
                  if (!src || !src.thread_id) return <span key={i}>{part}</span>;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedThread(src.thread_id!)}
                      className="mx-0.5 rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-xs text-indigo-700 hover:bg-indigo-100"
                      title="Open thread"
                    >
                      {part}
                    </button>
                  );
                })}
              </div>

              {/* 草稿面板 */}
              {showDraftPanel && draftBundle && (
                <div className="mt-4 pt-4 border-t border-indigo-200">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Knowledge Drafts</h4>
                  {draftBundle.warnings.length > 0 && (
                    <div className="mb-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
                      {draftBundle.warnings.join(', ')}
                    </div>
                  )}
                  <div className="space-y-3">
                    {draftBundle.knowledge_drafts.length > 0 && (
                      <details className="text-xs" open>
                        <summary className="font-medium text-gray-700 cursor-pointer">
                          Knowledge Entities ({draftBundle.knowledge_drafts.length})
                        </summary>
                        <div className="mt-2 space-y-2">
                          {draftBundle.knowledge_drafts.map((d, i) => (
                            <div key={i} className="bg-white rounded-lg p-3 border border-gray-200">
                              <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-xs font-medium">{d.entity_type}</span>
                                <span className="font-medium text-gray-800">{d.canonical_name}</span>
                              </div>
                              {d.summary && <p className="text-gray-600 mt-1">{d.summary}</p>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {draftBundle.annotation_drafts.length > 0 && (
                      <details className="text-xs">
                        <summary className="font-medium text-gray-700 cursor-pointer">
                          Annotations ({draftBundle.annotation_drafts.length})
                        </summary>
                        <div className="mt-2 space-y-1">
                          {draftBundle.annotation_drafts.map((d, i) => (
                            <div key={i} className="bg-white rounded p-2 border border-gray-100">
                              <span className="text-gray-500">{d.target_type}: {d.target_label || d.target_ref}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {draftBundle.tag_assignment_drafts.length > 0 && (
                      <details className="text-xs">
                        <summary className="font-medium text-gray-700 cursor-pointer">
                          Tag Assignments ({draftBundle.tag_assignment_drafts.length})
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {draftBundle.tag_assignment_drafts.map((d, i) => (
                            <span key={i} className={`px-2 py-0.5 rounded-full text-xs ${d.tag_exists ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 line-through'}`}>
                              {d.tag_name}
                            </span>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={handleApplyDraft}
                      disabled={draftLoading || !!draftSaved}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {draftLoading ? '保存中...' : draftSaved ? '已保存' : '保存选中草稿'}
                    </button>
                    <button
                      onClick={() => { setShowDraftPanel(false); setDraftBundle(null); }}
                      className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50"
                    >
                      关闭
                    </button>
                  </div>
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
        </div>
      )}

      {!result && !loading && (
        <div className="text-center py-20 text-gray-400">
          <p>Enter a query to search kernel mailing list emails</p>
        </div>
      )}

      {selectedThread && (
        <ThreadDrawer threadId={selectedThread} onClose={() => setSelectedThread(null)} />
      )}
    </div>
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