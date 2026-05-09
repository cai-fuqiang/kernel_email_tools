import {
  Code2,
  ExternalLink,
  GitCommitHorizontal,
  HelpCircle,
  Mail,
  MessageSquareText,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  KnowledgeTimelineEvent,
  KnowledgeTimelineEventType,
} from '../../utils/knowledgeMeta';
import { KNOWLEDGE_TIMELINE_EVENT_TYPES } from '../../utils/knowledgeMeta';
import { PrimaryButton, SecondaryButton, StatusBadge } from '../ui';
import { formatDate } from './knowledgeUtils';

interface KnowledgeTimelinePanelProps {
  timeline: KnowledgeTimelineEvent[];
  canWrite: boolean;
  onChange: (timeline: KnowledgeTimelineEvent[]) => void;
  onOpenThread: (threadId: string, focusMessageId?: string) => void;
}

const eventLabels: Record<KnowledgeTimelineEventType, string> = {
  mail_thread: 'Mail thread',
  patch_revision: 'Patch revision',
  commit: 'Commit',
  code_location: 'Code location',
  external_link: 'External link',
  annotation: 'Annotation',
  decision: 'Decision',
  open_question: 'Open question',
  note: 'Note',
};

const reviewTones = {
  confirmed: 'success',
  needs_review: 'warning',
  unknown: 'muted',
} as const;

function newTimelineEvent(): KnowledgeTimelineEvent {
  return {
    id: `timeline-${Date.now()}`,
    event_type: 'mail_thread',
    title: '',
    date: '',
    summary: '',
    source_ref: '',
    url: '',
    thread_id: '',
    message_id: '',
    code_path: '',
    review_state: 'needs_review',
  };
}

function eventIcon(type: KnowledgeTimelineEventType) {
  if (type === 'mail_thread' || type === 'patch_revision') return Mail;
  if (type === 'commit') return GitCommitHorizontal;
  if (type === 'code_location') return Code2;
  if (type === 'open_question') return HelpCircle;
  return MessageSquareText;
}

function sortedTimeline(timeline: KnowledgeTimelineEvent[]) {
  return [...timeline].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
}

export default function KnowledgeTimelinePanel({
  timeline,
  canWrite,
  onChange,
  onOpenThread,
}: KnowledgeTimelinePanelProps) {
  const updateEvent = (id: string, patch: Partial<KnowledgeTimelineEvent>) => {
    onChange(timeline.map((event) => (event.id === id ? { ...event, ...patch } : event)));
  };

  const removeEvent = (id: string) => {
    onChange(timeline.filter((event) => event.id !== id));
  };

  const addEvent = () => {
    onChange([...timeline, newTimelineEvent()]);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Topic timeline</h2>
          <p className="mt-1 text-sm leading-5 text-slate-500">
            Manually connect the important mails, patch revisions, commits, code points, and decisions behind this topic.
          </p>
        </div>
        {canWrite && (
          <PrimaryButton type="button" onClick={addEvent}>
            <Plus className="h-4 w-4" />
            Add event
          </PrimaryButton>
        )}
      </div>

      {timeline.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm leading-6 text-slate-500">
          No timeline yet. Start with the first proposal, an important review thread, a rejected alternative, the merged commit, or an open question that still needs evidence.
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {sortedTimeline(timeline).map((event) => {
            const Icon = eventIcon(event.event_type);
            return (
              <div key={event.id} className="grid gap-3 border-l-2 border-slate-200 pl-4 md:grid-cols-[minmax(0,1fr)_160px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-xs font-semibold uppercase text-indigo-600">
                      {eventLabels[event.event_type]}
                    </span>
                    <StatusBadge tone={reviewTones[event.review_state || 'needs_review']}>
                      {event.review_state || 'needs_review'}
                    </StatusBadge>
                    <span className="text-xs text-slate-400">{formatDate(event.date)}</span>
                  </div>

                  {canWrite ? (
                    <div className="mt-3 grid gap-3">
                      <div className="grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_140px]">
                        <select
                          value={event.event_type}
                          onChange={(e) =>
                            updateEvent(event.id, {
                              event_type: e.target.value as KnowledgeTimelineEventType,
                            })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          {KNOWLEDGE_TIMELINE_EVENT_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {eventLabels[type]}
                            </option>
                          ))}
                        </select>
                        <input
                          value={event.title}
                          onChange={(e) => updateEvent(event.id, { title: e.target.value })}
                          placeholder="What happened?"
                          className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                          value={event.date || ''}
                          onChange={(e) => updateEvent(event.id, { date: e.target.value })}
                          placeholder="YYYY-MM-DD"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <textarea
                        value={event.summary || ''}
                        onChange={(e) => updateEvent(event.id, { summary: e.target.value })}
                        rows={2}
                        placeholder="Why this event matters, what changed, or what still needs review."
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm leading-6"
                      />
                      <div className="grid gap-2 md:grid-cols-3">
                        <input
                          value={event.thread_id || ''}
                          onChange={(e) => updateEvent(event.id, { thread_id: e.target.value })}
                          placeholder="thread id"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                          value={event.message_id || ''}
                          onChange={(e) => updateEvent(event.id, { message_id: e.target.value })}
                          placeholder="message id"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                          value={event.url || ''}
                          onChange={(e) => updateEvent(event.id, { url: e.target.value })}
                          placeholder="external url"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                          value={event.source_ref || ''}
                          onChange={(e) => updateEvent(event.id, { source_ref: e.target.value })}
                          placeholder="commit / evidence / source ref"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                          value={event.code_path || ''}
                          onChange={(e) => updateEvent(event.id, { code_path: e.target.value })}
                          placeholder="kernel path"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <select
                          value={event.review_state || 'needs_review'}
                          onChange={(e) =>
                            updateEvent(event.id, {
                              review_state: e.target.value as KnowledgeTimelineEvent['review_state'],
                            })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="confirmed">confirmed</option>
                          <option value="needs_review">needs_review</option>
                          <option value="unknown">unknown</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <div className="text-base font-semibold text-slate-950">{event.title}</div>
                      {event.summary && (
                        <p className="mt-1 text-sm leading-6 text-slate-600">{event.summary}</p>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                    {event.source_ref && <span className="font-mono">{event.source_ref}</span>}
                    {event.code_path && <span className="font-mono">{event.code_path}</span>}
                    {event.thread_id && (
                      <button
                        type="button"
                        onClick={() => onOpenThread(event.thread_id || '', event.message_id)}
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700 hover:bg-indigo-100"
                      >
                        Open thread
                      </button>
                    )}
                    {event.url && (
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50"
                      >
                        Link <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>

                {canWrite && (
                  <div className="flex items-start justify-end">
                    <SecondaryButton
                      type="button"
                      onClick={() => removeEvent(event.id)}
                      className="px-3 text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </SecondaryButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
