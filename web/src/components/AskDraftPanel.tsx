import { useState } from 'react';
import { applyAskDraft, createAskDraft } from '../api/client';
import type { AskDraftResponse, AskResponse } from '../api/types';

type Props = {
  answer: AskResponse;
};

type Tab = 'knowledge' | 'annotations' | 'tags';

export default function AskDraftPanel({ answer }: Props) {
  const [draft, setDraft] = useState<AskDraftResponse | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('knowledge');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadDraft = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      setDraft(await createAskDraft(answer));
    } catch (e: any) {
      setError(e.message || 'Failed to create drafts');
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await applyAskDraft(draft);
      const counts = [
        `${result.created_entities.length} knowledge`,
        `${result.created_annotations.length} annotations`,
        `${result.created_tag_assignments.length} tags`,
      ].join(', ');
      setMessage(`Saved ${counts}${result.errors.length ? ` with ${result.errors.length} error(s)` : ''}.`);
      if (result.errors.length) {
        setError(result.errors.map(e => `${e.type}[${e.index}]: ${e.message}`).join('\n'));
      }
    } catch (e: any) {
      setError(e.message || 'Failed to save drafts');
    } finally {
      setSaving(false);
    }
  };

  const updateKnowledge = (index: number, patch: Record<string, unknown>) => {
    setDraft(prev => !prev ? prev : {
      ...prev,
      knowledge_drafts: prev.knowledge_drafts.map((item, i) => i === index ? { ...item, ...patch } : item),
    });
  };

  const updateAnnotation = (index: number, patch: Record<string, unknown>) => {
    setDraft(prev => !prev ? prev : {
      ...prev,
      annotation_drafts: prev.annotation_drafts.map((item, i) => i === index ? { ...item, ...patch } : item),
    });
  };

  const updateTag = (index: number, patch: Record<string, unknown>) => {
    setDraft(prev => !prev ? prev : {
      ...prev,
      tag_assignment_drafts: prev.tag_assignment_drafts.map((item, i) => i === index ? { ...item, ...patch } : item),
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Knowledge Drafts</h3>
          <p className="text-xs text-gray-500 mt-1">Convert this answer into editable knowledge, annotations, and tag assignments.</p>
        </div>
        {!draft ? (
          <button
            onClick={loadDraft}
            disabled={loading}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Drafts'}
          </button>
        ) : (
          <button
            onClick={saveDraft}
            disabled={saving}
            className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Selected Drafts'}
          </button>
        )}
      </div>

      {error && <div className="mb-3 whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {message && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</div>}

      {draft && (
        <>
          {draft.warnings.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {draft.warnings.map((warning, i) => <div key={i}>{warning}</div>)}
            </div>
          )}

          <div className="flex gap-2 mb-4 border-b border-gray-200">
            {[
              ['knowledge', `Knowledge (${draft.knowledge_drafts.length})`],
              ['annotations', `Annotations (${draft.annotation_drafts.length})`],
              ['tags', `Tags (${draft.tag_assignment_drafts.length})`],
            ].map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as Tab)}
                className={`px-3 py-2 text-sm border-b-2 ${
                  activeTab === tab
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'knowledge' && (
            <div className="space-y-4">
              {draft.knowledge_drafts.map((item, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                    <input type="checkbox" checked={item.selected} onChange={e => updateKnowledge(i, { selected: e.target.checked })} />
                    Create knowledge entity
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={item.canonical_name} onChange={e => updateKnowledge(i, { canonical_name: e.target.value })} />
                    <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={item.entity_type} onChange={e => updateKnowledge(i, { entity_type: e.target.value })} />
                  </div>
                  <textarea className="mt-3 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} value={item.summary} onChange={e => updateKnowledge(i, { summary: e.target.value })} />
                  <textarea className="mt-3 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" rows={8} value={item.description} onChange={e => updateKnowledge(i, { description: e.target.value })} />
                </div>
              ))}
            </div>
          )}

          {activeTab === 'annotations' && (
            <div className="space-y-4">
              {draft.annotation_drafts.map((item, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                    <input type="checkbox" checked={item.selected} onChange={e => updateAnnotation(i, { selected: e.target.checked })} />
                    Create annotation
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={item.target_type} onChange={e => updateAnnotation(i, { target_type: e.target.value })} />
                    <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={item.target_ref} onChange={e => updateAnnotation(i, { target_ref: e.target.value })} />
                    <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={item.visibility} onChange={e => updateAnnotation(i, { visibility: e.target.value })}>
                      <option value="private">private</option>
                      <option value="public">public</option>
                    </select>
                  </div>
                  <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" rows={10} value={item.body} onChange={e => updateAnnotation(i, { body: e.target.value })} />
                </div>
              ))}
            </div>
          )}

          {activeTab === 'tags' && (
            <div className="space-y-3">
              {draft.tag_assignment_drafts.map((item, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-3">
                  <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-3 items-center">
                    <input type="checkbox" checked={item.selected} disabled={item.tag_exists === false} onChange={e => updateTag(i, { selected: e.target.checked })} />
                    <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={item.tag_name} onChange={e => updateTag(i, { tag_name: e.target.value })} />
                    <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={item.target_ref} onChange={e => updateTag(i, { target_ref: e.target.value })} />
                    <span className={`text-xs ${item.tag_exists === false ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {item.tag_exists === false ? 'missing' : 'ready'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">{item.target_type}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
