import { useEffect, useState } from 'react';
import { askQuestion, getTagStats, type TagStats } from '../api/client';
import type { AskMessage, AskResponse, SourceRef } from '../api/types';
import AskDraftPanel from '../components/AskDraftPanel';
import ThreadDrawer from '../components/ThreadDrawer';

type ThreadFocus = {
  threadId: string;
  focusMessageId?: string;
};

type ConversationTurn = {
  id: string;
  question: string;
  response?: AskResponse;
  error?: string;
};

function normalizeMessageId(value: string): string {
  return value
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function buildSourceMap(answer?: AskResponse | null) {
  const sourceByMessageId = new Map<string, SourceRef>();
  for (const source of answer?.sources || []) {
    if (!source.message_id || !source.thread_id) continue;
    sourceByMessageId.set(normalizeMessageId(source.message_id), source);
  }
  return sourceByMessageId;
}

function resolveCitationSource(
  citation: string,
  sourceByMessageId: Map<string, SourceRef>,
) {
  const normalized = normalizeMessageId(citation);
  const exact = sourceByMessageId.get(normalized);
  if (exact) return exact;

  const ids = [...sourceByMessageId.keys()];
  const candidates = normalized.includes('...')
    ? ids.filter((id) => {
      const [prefix, suffix] = normalized.split('...', 2);
      return (!prefix || id.startsWith(prefix)) && (!suffix || id.endsWith(suffix));
    })
    : ids.filter((id) => normalized.length >= 8 && (id.includes(normalized) || normalized.includes(id)));

  return candidates.length === 1 ? sourceByMessageId.get(candidates[0]) : undefined;
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

function citationLabel(source: SourceRef): string {
  const parts = [
    compactSender(source.sender || ''),
    compactDate(source.date || ''),
    truncateText(source.subject || source.message_id || 'email'),
  ].filter(Boolean);
  return `[${parts.join(' · ')}]`;
}

function renderAnswerWithLinks(
  text: string,
  sourceByMessageId: Map<string, SourceRef>,
  onOpenSource: (threadId: string, messageId?: string) => void,
) {
  return text.split(/(\[[^\]]+\])/g).map((part, index) => {
    const match = part.match(/^\[([^\]]+)\]$/);
    if (!match) return <span key={index}>{part}</span>;
    const source = resolveCitationSource(match[1], sourceByMessageId);
    if (!source) return <span key={index}>{part}</span>;
    return (
      <button
        key={index}
        type="button"
        onClick={() => onOpenSource(source.thread_id || '', source.message_id)}
        className="mx-0.5 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
        title={`Open cited email: ${source.message_id}`}
      >
        {citationLabel(source)}
      </button>
    );
  });
}

function turnHistory(turns: ConversationTurn[]): AskMessage[] {
  return turns.flatMap((turn) => {
    const items: AskMessage[] = [{ role: 'user', content: turn.question }];
    if (turn.response?.answer) {
      items.push({ role: 'assistant', content: turn.response.answer });
    }
    return items;
  }).slice(-10);
}

const CHANNEL_OPTIONS = [
  { value: '', label: 'All Channels' },
  { value: 'kvm', label: 'KVM' },
  { value: 'linux-mm', label: 'Linux-MM' },
  { value: 'lkml', label: 'LKML' },
];

export default function AskPage() {
  const [question, setQuestion] = useState('');
  const [sender, setSender] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [tagStats, setTagStats] = useState<TagStats[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadFocus | null>(null);
  const [selectedChannel, setSelectedChannel] = useState('');

  useEffect(() => {
    getTagStats().then(setTagStats).catch(() => {});
  }, []);

  const hasFilters = sender || dateFrom || dateTo || selectedTags.length > 0 || selectedChannel;
  const latestAnswer = [...turns].reverse().find((turn) => turn.response)?.response || null;

  const handleAsk = async () => {
    const text = question.trim();
    if (!text || loading) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const previousTurns = turns;
    setQuestion('');
    setLoading(true);
    setTurns((prev) => [...prev, { id, question: text }]);
    try {
      const response = await askQuestion(text, {
        history: turnHistory(previousTurns),
        list_name: selectedChannel || undefined,
        sender: sender || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });
      setTurns((prev) => prev.map((turn) => turn.id === id ? { ...turn, response } : turn));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Ask failed';
      setTurns((prev) => prev.map((turn) => turn.id === id ? { ...turn, error: message } : turn));
    } finally {
      setLoading(false);
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
    );
  };

  const openThread = (threadId: string, focusMessageId?: string) => {
    if (!threadId) return;
    setSelectedThread({ threadId, focusMessageId });
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Ask a Question</h2>
          <p className="mt-1 text-sm text-gray-500">Ask follow-up questions about kernel development discussions.</p>
        </div>
        {turns.length > 0 && (
          <button
            onClick={() => setTurns([])}
            disabled={loading}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            New conversation
          </button>
        )}
      </div>

      <div className="mb-4 flex gap-3">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          placeholder={turns.length ? 'Ask a follow-up...' : 'e.g. Why was the shmem mount behavior changed?'}
          className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm shadow-sm focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={selectedChannel}
          onChange={(e) => setSelectedChannel(e.target.value)}
          className="rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm"
        >
          {CHANNEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button
          onClick={handleAsk}
          disabled={loading || !question.trim()}
          className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Thinking...' : turns.length ? 'Send' : 'Ask'}
        </button>
      </div>

      {tagStats.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Filter by tags:</span>
          {tagStats.slice(0, 6).map((tag) => (
            <button
              key={tag.name}
              onClick={() => handleTagToggle(tag.name)}
              className={`rounded-full px-2 py-1 text-xs transition-colors ${
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

      <button
        onClick={() => setShowFilters(!showFilters)}
        className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showFilters ? 'M19 9l-7 7-7-7' : 'M9 5l7 7-7 7'} />
        </svg>
        Advanced Filters
        {hasFilters && <span className="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-600">Active</span>}
      </button>

      {showFilters && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Channel</label>
              <select value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {CHANNEL_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Author</label>
              <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="Filter by sender" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">From Date</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">To Date</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
          </div>
          {tagStats.length > 0 && (
            <div className="mt-4 border-t border-gray-200 pt-4">
              <label className="mb-2 block text-xs font-medium text-gray-600">Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {tagStats.slice(0, 20).map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => handleTagToggle(tag.name)}
                    className={`rounded-full px-2 py-1 text-xs transition-colors ${
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

      <div className="flex-1 space-y-6">
        {turns.length === 0 && !loading && (
          <div className="py-20 text-center text-gray-400">
            <p>Ask a question, then follow up without restating all context.</p>
          </div>
        )}

        {turns.map((turn) => (
          <ConversationCard
            key={turn.id}
            turn={turn}
            onOpenThread={openThread}
          />
        ))}
      </div>

      {latestAnswer && <AskDraftPanel answer={latestAnswer} />}

      {selectedThread && (
        <ThreadDrawer
          threadId={selectedThread.threadId}
          focusMessageId={selectedThread.focusMessageId}
          onClose={() => setSelectedThread(null)}
        />
      )}
    </div>
  );
}

function ConversationCard({
  turn,
  onOpenThread,
}: {
  turn: ConversationTurn;
  onOpenThread: (threadId: string, focusMessageId?: string) => void;
}) {
  const sourceByMessageId = buildSourceMap(turn.response);
  const standalone = turn.response?.retrieval_stats?.standalone_question;
  return (
    <div className="space-y-3">
      <div className="ml-auto max-w-3xl rounded-2xl bg-gray-900 px-4 py-3 text-sm text-white">
        {turn.question}
      </div>

      {turn.error && (
        <div className="max-w-3xl rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {turn.error}
        </div>
      )}

      {turn.response ? (
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Answer
            <span className="ml-auto text-xs font-normal text-gray-400">{turn.response.retrieval_mode} mode</span>
          </div>
          {typeof standalone === 'string' && standalone && standalone !== turn.question && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Rewritten for retrieval: {standalone}
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
            {renderAnswerWithLinks(turn.response.answer, sourceByMessageId, onOpenThread)}
          </div>

          {turn.response.sources.length > 0 && (
            <details className="rounded-xl border border-gray-100 bg-gray-50 p-3" open>
              <summary className="cursor-pointer text-sm font-semibold text-gray-700">Sources ({turn.response.sources.length})</summary>
              <div className="mt-3 space-y-2">
                {turn.response.sources.map((source, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => onOpenThread(source.thread_id || '', source.message_id)}
                    disabled={!source.thread_id}
                    className="block w-full rounded-lg border border-gray-100 bg-white p-3 text-left hover:border-indigo-200 hover:bg-indigo-50/30 disabled:cursor-default"
                  >
                    <p className="truncate text-sm font-medium text-gray-900">{source.subject}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {source.sender} · {source.date}
                      {source.source && <span> · {source.source}</span>}
                      {typeof source.score === 'number' && <span> · score {source.score.toFixed(3)}</span>}
                    </p>
                    {source.snippet && <p className="mt-2 line-clamp-3 text-xs text-gray-600">{source.snippet}</p>}
                  </button>
                ))}
              </div>
            </details>
          )}

          <details className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-gray-700">Retrieval Details</summary>
            <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-gray-500">Search Plan</p>
                {turn.response.search_plan?.goal && <p className="mb-2 text-sm text-gray-800">{turn.response.search_plan.goal}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {(turn.response.search_plan?.keyword_queries || []).map((query, index) => (
                    <span key={`k-${index}`} className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{query}</span>
                  ))}
                  {(turn.response.search_plan?.semantic_queries || []).map((query, index) => (
                    <span key={`s-${index}`} className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{query}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-gray-500">Executed Queries</p>
                <div className="space-y-1">
                  {turn.response.executed_queries.map((query, index) => (
                    <div key={index} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-gray-700">{query.query}</span>
                      <span className="shrink-0 text-gray-500">{query.mode} · {query.hits}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>
      ) : (
        <div className="max-w-3xl rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-400">
          Thinking...
        </div>
      )}
    </div>
  );
}
