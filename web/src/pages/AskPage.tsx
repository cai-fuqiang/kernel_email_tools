import { useState, useEffect } from 'react';
import { askQuestion, getTagStats, type TagStats } from '../api/client';
import type { AskResponse } from '../api/types';
import AskDraftPanel from '../components/AskDraftPanel';

export default function AskPage() {
  const [question, setQuestion] = useState('');
  const [sender, setSender] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState('');
  const [tagStats, setTagStats] = useState<TagStats[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

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

  const handleAsk = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setError('');
    try {
      setAnswer(await askQuestion(question, {
        list_name: selectedChannel || undefined,
        sender: sender || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const hasFilters = sender || dateFrom || dateTo || selectedTags.length > 0 || selectedChannel;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Ask a Question</h2>
        <p className="text-sm text-gray-500">Ask questions about kernel development discussions</p>
      </div>

      {/* 主搜索框 */}
      <div className="flex gap-3 mb-4">
        <input type="text" value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAsk()}
          placeholder="e.g. Why was the shmem mount behavior changed?"
          className="flex-1 px-4 py-3 bg-white border border-gray-300 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500 text-sm" />
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
        <button onClick={handleAsk} disabled={loading}
          className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm">
          {loading ? 'Thinking...' : 'Ask'}
        </button>
      </div>

      {/* 标签快捷筛选 */}
      {tagStats.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-xs text-gray-500">Filter by tags:</span>
          {tagStats.slice(0, 6).map(tag => (
            <button
              key={tag.name}
              onClick={() => handleTagToggle(tag.name)}
              className={`px-2 py-1 text-xs rounded-full transition-colors ${
                selectedTags.includes(tag.name)
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {/* 过滤开关 */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d={showFilters ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"} />
        </svg>
        Advanced Filters
        {hasFilters && (
          <span className="ml-1 px-1.5 py-0.5 bg-indigo-100 text-indigo-600 text-xs rounded">
            Active
          </span>
        )}
      </button>

      {/* 过滤选项 */}
      {showFilters && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Channel</label>
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                {CHANNEL_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Author</label>
              <input type="text" value={sender}
                onChange={e => setSender(e.target.value)}
                placeholder="Filter by sender"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From Date</label>
              <input type="date" value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To Date</label>
              <input type="date" value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          {/* 标签筛选 */}
          {tagStats.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <label className="block text-xs font-medium text-gray-600 mb-2">Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {tagStats.slice(0, 20).map(tag => (
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
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      {answer && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Answer
              <span className="text-xs font-normal text-gray-400 ml-auto">{answer.retrieval_mode} mode</span>
            </h3>
            <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{answer.answer}</div>
          </div>

          <AskDraftPanel answer={answer} />

          {answer.sources.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Sources ({answer.sources.length})</h3>
              <div className="space-y-2">
                {answer.sources.map((s, i) => (
                  <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{s.subject}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {s.sender} &middot; {s.date}
                          {s.source && <span> &middot; {s.source}</span>}
                          {typeof s.score === 'number' && <span> &middot; score {s.score.toFixed(3)}</span>}
                        </p>
                        {s.snippet && (
                          <p className="text-xs text-gray-600 mt-2 line-clamp-3">{s.snippet}</p>
                        )}
                      </div>
                      {s.list_name && (
                        <span className="shrink-0 px-2 py-1 rounded bg-white border border-gray-200 text-xs text-gray-500">
                          {s.list_name}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(answer.search_plan || answer.executed_queries?.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Search Plan</h3>
                {answer.search_plan?.goal && (
                  <p className="text-sm text-gray-800 mb-3">{answer.search_plan.goal}</p>
                )}
                <div className="space-y-3">
                  {answer.search_plan?.keyword_queries && answer.search_plan.keyword_queries.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Keyword queries</p>
                      <div className="flex flex-wrap gap-1.5">
                        {answer.search_plan.keyword_queries.map((q, i) => (
                          <span key={i} className="px-2 py-1 rounded bg-indigo-50 text-indigo-700 text-xs">{q}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {answer.search_plan?.semantic_queries && answer.search_plan.semantic_queries.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Semantic queries</p>
                      <div className="flex flex-wrap gap-1.5">
                        {answer.search_plan.semantic_queries.map((q, i) => (
                          <span key={i} className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-xs">{q}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {answer.search_plan?.rationale && (
                    <p className="text-xs text-gray-500">{answer.search_plan.rationale}</p>
                  )}
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Executed Queries</h3>
                <div className="space-y-2">
                  {answer.executed_queries.map((q, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-gray-700 truncate">{q.query}</span>
                      <span className="shrink-0 text-gray-500">{q.mode} · {q.hits}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {answer.threads && answer.threads.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Related Threads ({answer.threads.length})</h3>
              <div className="space-y-3">
                {answer.threads.map(thread => (
                  <div key={thread.thread_id} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{thread.subject || thread.thread_id}</p>
                      <span className="text-xs text-gray-500">{thread.message_count} messages</span>
                    </div>
                    <div className="space-y-1.5">
                      {thread.messages.slice(0, 4).map(msg => (
                        <div key={msg.message_id} className="text-xs text-gray-600">
                          <span className="font-medium text-gray-700">{msg.sender}</span>
                          <span className="text-gray-400"> · {msg.date}</span>
                          <p className="line-clamp-2 mt-0.5">{msg.preview}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!answer && !loading && <div className="text-center py-20 text-gray-400"><p>Ask a question about kernel mailing list discussions</p></div>}
    </div>
  );
}
