import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquareText, Pin, PinOff, Tags } from 'lucide-react';
import { getTargetTags } from '../../api/client';
import type { AnnotationListItem, KnowledgeEntity, TagRead } from '../../api/types';
import EmailTagEditor from '../EmailTagEditor';
import { formatDateTime } from './knowledgeUtils';

type DockPanel = 'tags' | 'notes';

interface KnowledgeInspectorDockProps {
  entity: KnowledgeEntity;
  annotations: AnnotationListItem[];
  annotationBody: string;
  canWrite: boolean;
  saving: boolean;
  onAnnotationBodyChange: (value: string) => void;
  onCreateAnnotation: () => void;
}

function trimText(value: string, length = 96) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1)}...`;
}

export default function KnowledgeInspectorDock({
  entity,
  annotations,
  annotationBody,
  canWrite,
  saving,
  onAnnotationBodyChange,
  onCreateAnnotation,
}: KnowledgeInspectorDockProps) {
  const [hoveredPanel, setHoveredPanel] = useState<DockPanel | null>(null);
  const [pinnedPanel, setPinnedPanel] = useState<DockPanel | null>(null);
  const [directTags, setDirectTags] = useState<TagRead[]>([]);
  const [aggregatedTags, setAggregatedTags] = useState<TagRead[]>([]);
  const activePanel = pinnedPanel || hoveredPanel;

  const loadTags = useCallback(async () => {
    if (!entity.entity_id) return;
    const bundle = await getTargetTags('knowledge_entity', entity.entity_id);
    setDirectTags(bundle.direct_tags);
    setAggregatedTags(bundle.aggregated_tags);
  }, [entity.entity_id]);

  useEffect(() => {
    loadTags().catch(() => {});
  }, [loadTags]);

  const aggregatedOnly = useMemo(() => {
    const directNames = new Set(directTags.map((tag) => tag.name));
    return aggregatedTags.filter((tag) => !directNames.has(tag.name));
  }, [aggregatedTags, directTags]);

  const title = activePanel === 'tags' ? 'Entity tags' : 'Human notes';
  const items: Array<{
    id: DockPanel;
    label: string;
    count: number;
    icon: typeof Tags;
    tone: string;
  }> = [
    { id: 'tags', label: 'Tags', count: directTags.length + aggregatedOnly.length, icon: Tags, tone: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
    { id: 'notes', label: 'Notes', count: annotations.length, icon: MessageSquareText, tone: 'text-sky-600 bg-sky-50 border-sky-100' },
  ];

  return (
    <div
      className="pointer-events-none absolute right-3 top-28 z-20 hidden md:block"
      onMouseLeave={() => {
        if (!pinnedPanel) setHoveredPanel(null);
      }}
    >
      {activePanel && (
        <div className="pointer-events-auto absolute right-14 top-0 w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/12">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-950">{title}</div>
              <div className="mt-0.5 text-xs text-slate-500">{entity.canonical_name}</div>
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

          {activePanel === 'tags' && (
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
                <EmailTagEditor
                  targetType="knowledge_entity"
                  targetRef={entity.entity_id}
                  placeholder="Add entity tag..."
                />
              </div>
            </div>
          )}

          {activePanel === 'notes' && (
            <div className="space-y-3">
              {canWrite && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <textarea
                    value={annotationBody}
                    onChange={(event) => onAnnotationBodyChange(event.target.value)}
                    placeholder="Add a reviewer note..."
                    className="min-h-20 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs leading-5"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={onCreateAnnotation}
                      disabled={saving || !annotationBody.trim()}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Add note
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {annotations.length > 0 ? annotations.slice(0, 3).map((annotation) => (
                  <div key={annotation.annotation_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>{annotation.author || 'unknown'}</span>
                      <span>{formatDateTime(annotation.updated_at)}</span>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-700">{trimText(annotation.body)}</div>
                  </div>
                )) : (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    No human notes yet.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="pointer-events-auto flex flex-col gap-2">
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
