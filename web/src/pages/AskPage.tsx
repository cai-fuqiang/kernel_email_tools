import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageSquarePlus } from 'lucide-react';
import {
  askQuestion,
  deleteAskConversation,
  getAskConversation,
  getChannels,
  getTagStats,
  listAskConversations,
  saveAskConversation,
  type TagStats,
} from '../api/client';
import type { AskConversationListItem, AskMessage, AskResponse, AskTurn, SourceRef, ChannelOption } from '../api/types';
import AskDraftPanel from '../components/AskDraftPanel';
import ThreadDrawer from '../components/ThreadDrawer';
import { EmptyState, PageHeader, PrimaryButton, SecondaryButton, SectionPanel, SkeletonBlock, SkeletonCard, SkeletonLine, StatusBadge } from '../components/ui';
import { showToast } from '../components/Toast';
import { useAuth } from '../auth';
import ConversationCard, { type ConversationTurn } from '../components/ask/ConversationCard';

type ThreadFocus = {
  threadId: string;
  focusMessageId?: string;
};

function turnHistory(turns: ConversationTurn[]): AskMessage[] {
  return turns.flatMap((turn) => {
    const items: AskMessage[] = [{ role: 'user', content: turn.question }];
    if (turn.response?.answer) {
      items.push({ role: 'assistant', content: turn.response.answer });
    }
    return items;
  }).slice(-10);
}

function turnsToSaveData(turns: ConversationTurn[]) {
  return turns
    .filter((t) => t.response || t.error)
    .map((t) => ({
      question: t.question,
      answer: t.response?.answer || '',
      sources: t.response?.sources || [],
      search_plan: t.response?.search_plan || {},
      threads: t.response?.threads || [],
      retrieval_stats: t.response?.retrieval_stats || {},
      model: t.response?.model || '',
      error: t.error || '',
    }));
}

function turnsFromLoaded(loaded: AskTurn[]): ConversationTurn[] {
  return loaded.map((t) => ({
    id: t.turn_id,
    question: t.question,
    response: {
      question: t.question,
      answer: t.answer,
      sources: t.sources as unknown as SourceRef[],
      search_plan: t.search_plan as AskResponse['search_plan'],
      executed_queries: [],
      threads: t.threads as unknown as AskResponse['threads'],
      retrieval_stats: t.retrieval_stats as AskResponse['retrieval_stats'],
      model: t.model,
      retrieval_mode: '',
    },
    error: t.error || undefined,
  }));
}

export default function AskPage() {
  const { isAuthenticated } = useAuth();
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
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([{ value: '', label: 'All Channels' }]);

  // Conversation history state
  const [conversationId, setConversationId] = useState<string>('');
  const [conversations, setConversations] = useState<AskConversationListItem[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    getChannels().then((channels) => {
      setChannelOptions([{ value: '', label: 'All Channels' }, ...channels]);
    }).catch(() => {});
    getTagStats().then(setTagStats).catch(() => {});
  }, [isAuthenticated]);

  const loadConversationList = useCallback(async () => {
    try {
      const res = await listAskConversations(1, 50);
      setConversations(res.conversations);
      return res.conversations;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadConversationList().then((convs) => {
      if (convs.length > 0 && !conversationId) {
        loadConversation(convs[0].conversation_id);
      }
    });
  }, [isAuthenticated, loadConversationList]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save after turns change (when a turn completes)
  useEffect(() => {
    if (turns.length === 0 || savingRef.current) return;
    const completed = turns.filter((t) => t.response || t.error);
    if (completed.length === 0) return;
    savingRef.current = true;
    const convId = conversationId;
    const title = turns[0]?.question || 'New conversation';
    const model = completed.find((t) => t.response?.model)?.response?.model || '';
    saveAskConversation({
      conversation_id: convId || undefined,
      title,
      model,
      turns: turnsToSaveData(turns),
    }).then((saved) => {
      if (!convId) {
        setConversationId(saved.conversation_id);
        showToast('Conversation saved', 'success');
      }
      loadConversationList();
    }).catch((e) => {
      showToast(`Failed to save: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error');
    }).finally(() => {
      savingRef.current = false;
    });
  }, [turns, conversationId, loadConversationList]);

  const loadConversation = async (convId: string) => {
    setConvLoading(true);
    try {
      const conv = await getAskConversation(convId);
      setConversationId(conv.conversation_id);
      setTurns(turnsFromLoaded(conv.turns));
    } catch (e) {
      showToast(`Failed to load conversation: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error');
    } finally {
      setConvLoading(false);
    }
  };

  const handleNewConversation = () => {
    setTurns([]);
    setConversationId('');
  };

  const handleDeleteConversation = async (convId: string) => {
    try {
      await deleteAskConversation(convId);
      if (conversationId === convId) {
        setTurns([]);
        setConversationId('');
      }
      await loadConversationList();
      showToast('Conversation deleted', 'info');
    } catch (e) {
      showToast(`Failed to delete: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error');
    }
  };

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
      showToast(message, 'error');
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
    <div className="flex min-h-screen bg-slate-50 lg:h-screen">
      {/* History Sidebar */}
      <aside
        className={`hidden lg:flex ${
          showSidebar ? 'w-[300px]' : 'w-0'
        } shrink-0 overflow-hidden border-r border-slate-200 bg-white transition-all`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">History</h3>
              <button
                onClick={() => setShowSidebar(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-600"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="p-4 text-xs text-gray-400">No saved conversations yet.</div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.conversation_id}
                  onClick={() => loadConversation(conv.conversation_id)}
                  className={`w-full border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50 ${
                    conversationId === conv.conversation_id ? 'bg-slate-100' : ''
                  }`}
                >
                  <div className="truncate text-sm font-medium text-gray-900">{conv.title}</div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
                    <span>{conv.turn_count} turns</span>
                    <span>·</span>
                    <span>{new Date(conv.updated_at).toLocaleDateString()}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(conv.conversation_id);
                    }}
                    className="mt-1 text-[10px] text-red-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* Toggle sidebar button when hidden */}
      {!showSidebar && (
        <button
          onClick={() => setShowSidebar(true)}
          className="absolute left-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-r-lg border border-l-0 border-slate-200 bg-white p-2 text-slate-400 hover:text-slate-600 lg:block"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col space-y-5 p-4 md:p-8">
          <PageHeader
            eyebrow="Ask Agent"
            title="Ask a Question"
            description="Ask follow-up questions over mailing-list evidence, then turn useful answers into reviewable knowledge drafts."
            meta={
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="muted">Multi-turn</StatusBadge>
                <StatusBadge tone="info">Evidence linked</StatusBadge>
                {conversationId && <StatusBadge tone="success">Auto-saving</StatusBadge>}
              </div>
            }
            actions={
              <SecondaryButton
                onClick={handleNewConversation}
                disabled={loading}
              >
                <MessageSquarePlus className="h-4 w-4" />
                New conversation
              </SecondaryButton>
            }
          />

          {convLoading && (
            <div className="mb-4 space-y-2">
              <SkeletonLine className="w-1/3" />
              <SkeletonLine className="w-1/2" />
            </div>
          )}

          <SectionPanel title="Question" description="Use English or Chinese. The agent can expand query terms and cite source emails.">
          <div className="flex flex-col gap-3 lg:flex-row">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
              placeholder={turns.length ? 'Ask a follow-up...' : 'e.g. Why was the shmem mount behavior changed?'}
              className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
            />
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
            >
              {channelOptions.map((opt) =>(
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <PrimaryButton
              onClick={handleAsk}
              disabled={loading || !question.trim()}
            >
              {loading ? 'Thinking...' : turns.length ? 'Send' : 'Ask'}
            </PrimaryButton>
          </div>

          {tagStats.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
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
              className="mt-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showFilters ? 'M19 9l-7 7-7-7' : 'M9 5l7 7-7 7'} />
            </svg>
            Advanced Filters
            {hasFilters && <span className="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-600">Active</span>}
          </button>

          {showFilters && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Channel</label>
                  <select value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    {channelOptions.map((opt) =><option key={opt.value} value={opt.value}>{opt.label}</option>)}
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
          </SectionPanel>

          <div className="flex-1 space-y-6">
            {turns.length === 0 && !loading && (
              <EmptyState
                title="Ask over the archive"
                description="Start with a mechanism, regression, patch discussion, or historical design question. Follow-ups keep prior turns as context."
              />
            )}

            {loading && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <SkeletonBlock className="h-6 w-1/3" />
                  <SkeletonLine className="w-full" />
                  <SkeletonLine className="w-5/6" />
                  <SkeletonLine className="w-4/6" />
                  <div className="pt-3 space-y-2">
                    <SkeletonCard />
                    <SkeletonCard />
                  </div>
                </div>
              </div>
            )}

            {[...turns].reverse().map((turn) => (
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
      </main>
    </div>
  );
}

