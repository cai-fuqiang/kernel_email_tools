import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  Languages,
  MessageSquareText,
  Pin,
  PinOff,
  Tags,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  getTargetTags,
  type TranslationJobResponse,
} from '../api/client';
import type { Annotation, TagRead } from '../api/types';
import EmailTagEditor from './EmailTagEditor';

type DockPanel = 'tags' | 'annotations' | 'translations';

interface ThreadInspectorDockProps {
  threadId: string;
  annotations: Annotation[];
  translationStats: {
    total: number;
    translated: number;
  };
  translationProgress: number;
  translationJob: TranslationJobResponse | null;
  translating: boolean;
  cacheMessage: { type: 'success' | 'error'; text: string } | null;
  onTranslate: () => void;
  onClearAllCache: () => void;
  onImportAnnotations: () => void;
  onExportAnnotations: () => void;
}

function trimText(value: string, length = 92) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1)}...`;
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function TagPreview({ threadId, visible }: { threadId: string; visible: boolean }) {
  const [directTags, setDirectTags] = useState<TagRead[]>([]);
  const [aggregatedTags, setAggregatedTags] = useState<TagRead[]>([]);

  const refreshTags = useCallback(async () => {
    if (!threadId) return;
    const bundle = await getTargetTags('email_thread', threadId);
    setDirectTags(bundle.direct_tags);
    setAggregatedTags(bundle.aggregated_tags);
  }, [threadId]);

  useEffect(() => {
    if (!visible) return;
    refreshTags().catch(() => {});
  }, [refreshTags, visible]);

  const aggregatedOnly = useMemo(() => {
    const directNames = new Set(directTags.map((tag) => tag.name));
    return aggregatedTags.filter((tag) => !directNames.has(tag.name));
  }, [aggregatedTags, directTags]);

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Direct tags</div>
        {directTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {directTags.slice(0, 8).map((tag) => (
              <span
                key={tag.slug}
                className="rounded px-2 py-1 text-xs font-medium"
                style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            No direct tags yet.
          </div>
        )}
      </div>

      {aggregatedOnly.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Aggregated</div>
          <div className="flex flex-wrap gap-1.5">
            {aggregatedOnly.slice(0, 8).map((tag) => (
              <span key={tag.slug} className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                {tag.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <EmailTagEditor targetType="email_thread" targetRef={threadId} placeholder="Add thread tag..." />
      </div>
    </div>
  );
}

export default function ThreadInspectorDock({
  threadId,
  annotations,
  translationStats,
  translationProgress,
  translationJob,
  translating,
  cacheMessage,
  onTranslate,
  onClearAllCache,
  onImportAnnotations,
  onExportAnnotations,
}: ThreadInspectorDockProps) {
  const [hoveredPanel, setHoveredPanel] = useState<DockPanel | null>(null);
  const [pinnedPanel, setPinnedPanel] = useState<DockPanel | null>(null);
  const activePanel = pinnedPanel || hoveredPanel;
  const panelVisible = !!activePanel;
  const translatedCount = translationJob?.completed ?? translationStats.translated;
  const translationTotal = translationJob?.total ?? translationStats.total;

  const items: Array<{
    id: DockPanel;
    label: string;
    count: number;
    icon: typeof Tags;
    tone: string;
  }> = [
    { id: 'tags', label: 'Tags', count: 0, icon: Tags, tone: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
    { id: 'annotations', label: 'Annotations', count: annotations.length, icon: MessageSquareText, tone: 'text-sky-600 bg-sky-50 border-sky-100' },
    { id: 'translations', label: 'Translations', count: translatedCount, icon: Languages, tone: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
  ];

  const title = activePanel === 'tags'
    ? 'Tags'
    : activePanel === 'annotations'
      ? 'Annotations'
      : 'Translations';

  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-3 z-30 md:absolute md:bottom-auto md:left-auto md:right-3 md:top-24"
      onMouseLeave={() => {
        if (!pinnedPanel) setHoveredPanel(null);
      }}
    >
      {panelVisible && (
        <div className="pointer-events-auto fixed inset-x-3 bottom-16 max-h-[72vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/12 md:absolute md:bottom-auto md:left-auto md:right-14 md:top-0 md:max-h-[calc(100vh-8rem)] md:w-80">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-950">{title}</div>
              <div className="mt-0.5 text-xs text-slate-500">Hover for a glance. Pin to keep actions open.</div>
            </div>
            <button
              type="button"
              onClick={() => setPinnedPanel((current) => (current === activePanel ? null : activePanel))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              title={pinnedPanel === activePanel ? 'Unpin panel' : 'Pin panel'}
            >
              {pinnedPanel === activePanel ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          </div>

          {activePanel === 'tags' && <TagPreview threadId={threadId} visible={activePanel === 'tags'} />}

          {activePanel === 'annotations' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onImportAnnotations}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Upload size={13} />
                  Import
                </button>
                {annotations.length > 0 && (
                  <button
                    type="button"
                    onClick={onExportAnnotations}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <Download size={13} />
                    Export
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {annotations.length > 0 ? annotations.slice(0, 3).map((annotation) => (
                  <div key={annotation.annotation_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>{annotation.author || 'unknown'}</span>
                      <span>{formatDate(annotation.updated_at || annotation.created_at)}</span>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-700">{trimText(annotation.body)}</div>
                  </div>
                )) : (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    No annotations on this thread yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {activePanel === 'translations' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
                  <span>{translatedCount}/{translationTotal} paragraphs</span>
                  <span>{translationJob ? `${translationProgress}%` : translating ? 'running' : 'idle'}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className={`h-full transition-all duration-500 ${translationJob?.status === 'failed' ? 'bg-red-400' : 'bg-emerald-500'}`}
                    style={{ width: `${translationProgress}%` }}
                  />
                </div>
                {translationJob?.error && <div className="mt-2 text-xs text-red-600">{translationJob.error}</div>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onTranslate}
                  disabled={translating || translationStats.total === 0}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Languages size={13} />
                  {translating ? 'Translating' : 'Translate'}
                </button>
                <button
                  type="button"
                  onClick={onClearAllCache}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 px-3 py-2 text-xs font-medium text-orange-600 hover:bg-orange-50"
                >
                  <Trash2 size={13} />
                  Cache
                </button>
              </div>
              {cacheMessage && (
                <div className={`rounded-lg px-3 py-2 text-xs ${cacheMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {cacheMessage.text}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="pointer-events-auto flex justify-end gap-2 md:flex-col">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activePanel === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => setHoveredPanel(item.id)}
              onFocus={() => setHoveredPanel(item.id)}
              onClick={() => setPinnedPanel((current) => (current === item.id ? null : item.id))}
              className={`relative inline-flex h-11 w-11 items-center justify-center rounded-lg border bg-white shadow-lg shadow-slate-900/8 transition-all hover:-translate-x-0.5 ${active ? item.tone : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-950'}`}
              title={item.label}
            >
              <Icon size={17} />
              {item.count > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-slate-950 px-1.5 py-0.5 text-center text-[10px] font-semibold text-white">
                  {item.count > 99 ? '99+' : item.count}
                </span>
              )}
              {item.id === 'translations' && translating && (
                <span className="absolute bottom-1 right-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
