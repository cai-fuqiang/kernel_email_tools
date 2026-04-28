import { useState } from 'react';
import type { AskDraftApplyResponse, AskDraftResponse } from '../api/types';

type Props = {
  draft: AskDraftResponse;
  onChange: (draft: AskDraftResponse) => void;
  onSave: () => void;
  saving?: boolean;
  saved?: AskDraftApplyResponse | null;
  error?: string;
  compact?: boolean;
};

type Tab = 'knowledge' | 'annotations' | 'tags';

function selectedCount(draft: AskDraftResponse) {
  return [
    ...draft.knowledge_drafts,
    ...draft.annotation_drafts,
    ...draft.tag_assignment_drafts,
  ].filter((item) => item.selected).length;
}

function updateDraftList<T>(
  list: T[],
  index: number,
  patch: Partial<T>,
) {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

function sourceCount(draft: AskDraftResponse) {
  const counts = draft.knowledge_drafts.map((item) => {
    const ask = item.meta?.ask;
    if (!ask || typeof ask !== 'object') return 0;
    const sources = (ask as Record<string, unknown>).sources;
    return Array.isArray(sources) ? sources.length : 0;
  });
  return counts.reduce((sum, value) => sum + value, 0);
}

export default function DraftReviewPanel({
  draft,
  onChange,
  onSave,
  saving = false,
  saved = null,
  error = '',
  compact = false,
}: Props) {
  const activeTabs: Tab[] = ['knowledge', 'annotations', 'tags'];
  const [activeTab, setActiveTab] = useDraftTab(draft);
  const selected = selectedCount(draft);
  const sources = sourceCount(draft);

  const updateKnowledge = (index: number, patch: Record<string, unknown>) => {
    onChange({
      ...draft,
      knowledge_drafts: updateDraftList(draft.knowledge_drafts, index, patch),
    });
  };

  const updateAnnotation = (index: number, patch: Record<string, unknown>) => {
    onChange({
      ...draft,
      annotation_drafts: updateDraftList(draft.annotation_drafts, index, patch),
    });
  };

  const updateTag = (index: number, patch: Record<string, unknown>) => {
    onChange({
      ...draft,
      tag_assignment_drafts: updateDraftList(draft.tag_assignment_drafts, index, patch),
    });
  };

  const setAll = (selectedValue: boolean) => {
    onChange({
      ...draft,
      knowledge_drafts: draft.knowledge_drafts.map((item) => ({ ...item, selected: selectedValue })),
      annotation_drafts: draft.annotation_drafts.map((item) => ({ ...item, selected: selectedValue })),
      tag_assignment_drafts: draft.tag_assignment_drafts.map((item) => ({
        ...item,
        selected: item.tag_exists === false ? false : selectedValue,
      })),
    });
  };

  return (
    <div className={compact ? 'rounded-xl border border-gray-200 bg-white p-4' : 'rounded-xl border border-gray-200 bg-white p-5'}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Review before saving</h3>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Keep the durable explanation, source-backed notes, and existing tags. Missing tags stay unselected until they are created.
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={saving || selected === 0 || !!saved}
          className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : `Save ${selected}`}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-medium uppercase text-gray-400">Selected</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{selected}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-medium uppercase text-gray-400">Knowledge</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{draft.knowledge_drafts.length}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-medium uppercase text-gray-400">Notes</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{draft.annotation_drafts.length}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-medium uppercase text-gray-400">Sources</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{sources}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setAll(true)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
          Select all saveable
        </button>
        <button type="button" onClick={() => setAll(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
          Clear selection
        </button>
      </div>

      {draft.warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          {draft.warnings.map((warning, i) => <div key={i}>{warning}</div>)}
        </div>
      )}

      {error && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {saved && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
          Saved {saved.created_entities.length} knowledge items, {saved.created_annotations.length} notes, and {saved.created_tag_assignments.length} tag assignments.
          {saved.created_entities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {saved.created_entities.map((entity) => (
                <a
                  key={entity.entity_id}
                  href={`/knowledge?entity_id=${encodeURIComponent(entity.entity_id)}`}
                  className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                >
                  Open {entity.canonical_name}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2 border-b border-gray-200">
        {activeTabs.map((tab) => {
          const label = tab === 'knowledge'
            ? `Knowledge (${draft.knowledge_drafts.length})`
            : tab === 'annotations'
              ? `Notes (${draft.annotation_drafts.length})`
              : `Tags (${draft.tag_assignment_drafts.length})`;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-3 py-2 text-sm ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {activeTab === 'knowledge' && (
        <div className="mt-4 space-y-4">
          {draft.knowledge_drafts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">No knowledge draft was generated.</div>
          ) : draft.knowledge_drafts.map((item, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                <input type="checkbox" checked={item.selected} onChange={(e) => updateKnowledge(i, { selected: e.target.checked })} />
                Save as knowledge item
              </label>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">
                <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={item.canonical_name} onChange={(e) => updateKnowledge(i, { canonical_name: e.target.value })} />
                <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={item.entity_type} onChange={(e) => updateKnowledge(i, { entity_type: e.target.value })} />
              </div>
              <input className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={item.aliases.join(', ')} onChange={(e) => updateKnowledge(i, { aliases: e.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="Aliases, comma-separated" />
              <textarea className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6" rows={3} value={item.summary} onChange={(e) => updateKnowledge(i, { summary: e.target.value })} />
              <textarea className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6" rows={7} value={item.description} onChange={(e) => updateKnowledge(i, { description: e.target.value })} />
            </div>
          ))}
        </div>
      )}

      {activeTab === 'annotations' && (
        <div className="mt-4 space-y-4">
          {draft.annotation_drafts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">No note draft was generated.</div>
          ) : draft.annotation_drafts.map((item, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                <input type="checkbox" checked={item.selected} onChange={(e) => updateAnnotation(i, { selected: e.target.checked })} />
                Save as human note
              </label>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={item.target_type} onChange={(e) => updateAnnotation(i, { target_type: e.target.value })} />
                <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={item.target_label || item.target_ref} onChange={(e) => updateAnnotation(i, { target_label: e.target.value })} />
                <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={item.visibility} onChange={(e) => updateAnnotation(i, { visibility: e.target.value as 'public' | 'private' })}>
                  <option value="private">private</option>
                  <option value="public">public</option>
                </select>
              </div>
              <textarea className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6" rows={8} value={item.body} onChange={(e) => updateAnnotation(i, { body: e.target.value })} />
            </div>
          ))}
        </div>
      )}

      {activeTab === 'tags' && (
        <div className="mt-4 space-y-3">
          {draft.tag_assignment_drafts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">No tag draft was generated.</div>
          ) : draft.tag_assignment_drafts.map((item, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3">
              <div className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-3">
                <input type="checkbox" checked={item.selected} disabled={item.tag_exists === false} onChange={(e) => updateTag(i, { selected: e.target.checked })} />
                <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={item.tag_name} onChange={(e) => updateTag(i, { tag_name: e.target.value })} />
                <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={item.target_ref} onChange={(e) => updateTag(i, { target_ref: e.target.value })} />
                <span className={`text-xs ${item.tag_exists === false ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {item.tag_exists === false ? 'create tag first' : 'ready'}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-500">{item.target_type}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function useDraftTab(draft: AskDraftResponse): [Tab, (tab: Tab) => void] {
  const initial = draft.knowledge_drafts.length > 0
    ? 'knowledge'
    : draft.annotation_drafts.length > 0
      ? 'annotations'
      : 'tags';
  const [activeTab, setActiveTab] = useState<Tab>(initial);
  return [activeTab, setActiveTab];
}
