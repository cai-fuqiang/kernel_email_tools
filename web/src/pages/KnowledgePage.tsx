import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import EmailTagEditor from '../components/EmailTagEditor';
import ThreadDrawer from '../components/ThreadDrawer';
import KnowledgeGraphView from '../components/KnowledgeGraphView';
import {
  createAnnotation,
  createKnowledgeEntity,
  createKnowledgeRelation,
  deleteKnowledgeEntity,
  deleteKnowledgeRelation,
  getKnowledgeEntity,
  getKnowledgeGraph,
  listAnnotations,
  listKnowledgeEntities,
  listKnowledgeRelations,
  updateKnowledgeRelation,
  updateKnowledgeEntity,
} from '../api/client';
import type { AnnotationListItem, KnowledgeEntity, KnowledgeRelation, KnowledgeGraphResponse } from '../api/types';
import { useAuth } from '../auth';

const DEFAULT_ENTITY_TYPE = 'concept';
const ENTITY_TYPES = ['concept', 'subsystem', 'mechanism', 'issue', 'symbol', 'patch_discussion'];
const RELATION_TYPES = ['related_to', 'part_of', 'explains', 'caused_by', 'fixed_by', 'supersedes'];

type ThreadFocus = {
  threadId: string;
  focusMessageId?: string;
};

type KnowledgeEvidenceSource = {
  message_id: string;
  thread_id: string;
  subject: string;
  sender: string;
  date: string;
  list_name: string;
  source: string;
};

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function extractKnowledgeEvidence(entity: KnowledgeEntity | null) {
  const ask = entity?.meta?.ask;
  if (!ask || typeof ask !== 'object') {
    return { question: '', generatedAt: '', sources: [] as KnowledgeEvidenceSource[], threadIds: [] as string[] };
  }
  const askMeta = ask as Record<string, unknown>;
  const rawSources = Array.isArray(askMeta.sources) ? askMeta.sources : [];
  const sources = rawSources
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((source) => ({
      message_id: String(source.message_id || ''),
      thread_id: String(source.thread_id || ''),
      subject: String(source.subject || ''),
      sender: String(source.sender || ''),
      date: String(source.date || ''),
      list_name: String(source.list_name || ''),
      source: String(source.source || ''),
    }))
    .filter((source) => source.message_id || source.thread_id || source.subject);

  return {
    question: String(askMeta.question || ''),
    generatedAt: String(askMeta.generated_at || ''),
    sources,
    threadIds: asStringList(askMeta.thread_ids),
  };
}

function formatDate(value?: string) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatDateTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function readableType(value: string) {
  return value.replace(/_/g, ' ');
}

function relationLabel(value: string) {
  return readableType(value);
}

function evidenceCount(entity: KnowledgeEntity) {
  const evidence = extractKnowledgeEvidence(entity);
  return evidence.sources.length || evidence.threadIds.length;
}

function statusTone(status: string) {
  if (status === 'active') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === 'deprecated') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

function sourceTitle(source: KnowledgeEvidenceSource) {
  const sender = source.sender.split('<')[0].trim() || source.sender;
  const date = formatDate(source.date);
  const subject = source.subject || source.message_id || source.thread_id;
  return [sender, date, subject].filter(Boolean).join(' · ');
}

function relationEntityName(entity: KnowledgeEntity | null | undefined, fallback: string) {
  return entity?.canonical_name || fallback;
}

export default function KnowledgePage() {
  const { canWrite, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedEntityId = searchParams.get('entity_id') || '';

  const [entities, setEntities] = useState<KnowledgeEntity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<KnowledgeEntity | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationListItem[]>([]);
  const [relations, setRelations] = useState<{ outgoing: KnowledgeRelation[]; incoming: KnowledgeRelation[] }>({
    outgoing: [],
    incoming: [],
  });
  const [loading, setLoading] = useState(false);
  const [annotationLoading, setAnnotationLoading] = useState(false);
  const [relationLoading, setRelationLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newEntity, setNewEntity] = useState({
    entity_type: DEFAULT_ENTITY_TYPE,
    canonical_name: '',
    aliases: '',
    summary: '',
    description: '',
  });
  const [annotationBody, setAnnotationBody] = useState('');
  const [relationForm, setRelationForm] = useState({
    relation_type: 'related_to',
    target_entity_id: '',
    description: '',
  });
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');
  const [graphDepth, setGraphDepth] = useState(1);
  const [graphData, setGraphData] = useState<KnowledgeGraphResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [relationDrafts, setRelationDrafts] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedThread, setSelectedThread] = useState<ThreadFocus | null>(null);

  const loadEntities = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listKnowledgeEntities({ q: query || undefined, page_size: 100 });
      setEntities(res.entities);
      if (!selectedEntityId && res.entities.length > 0) {
        setSearchParams({ entity_id: res.entities[0].entity_id }, { replace: true });
      }
      if (selectedEntityId) {
        const existing = res.entities.find((item) => item.entity_id === selectedEntityId);
        if (existing) {
          setSelectedEntity(existing);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load knowledge items');
    } finally {
      setLoading(false);
    }
  }, [query, selectedEntityId, setSearchParams]);

  const loadSelectedEntity = useCallback(async () => {
    if (!selectedEntityId) {
      setSelectedEntity(null);
      return;
    }
    const local = entities.find((item) => item.entity_id === selectedEntityId);
    if (local) {
      setSelectedEntity(local);
      return;
    }
    try {
      const entity = await getKnowledgeEntity(selectedEntityId);
      setSelectedEntity(entity);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load knowledge item');
    }
  }, [entities, selectedEntityId]);

  const loadAnnotations = useCallback(async () => {
    if (!selectedEntityId) {
      setAnnotations([]);
      return;
    }
    setAnnotationLoading(true);
    try {
      const res = await listAnnotations({
        target_type: 'knowledge_entity',
        target_ref: selectedEntityId,
        page_size: 100,
      });
      setAnnotations(res.annotations);
    } catch {
      setAnnotations([]);
    } finally {
      setAnnotationLoading(false);
    }
  }, [selectedEntityId]);

  const loadRelations = useCallback(async () => {
    if (!selectedEntityId) {
      setRelations({ outgoing: [], incoming: [] });
      return;
    }
    setRelationLoading(true);
    try {
      const res = await listKnowledgeRelations(selectedEntityId);
      setRelations(res);
      setRelationDrafts({});
    } catch {
      setRelations({ outgoing: [], incoming: [] });
    } finally {
      setRelationLoading(false);
    }
  }, [selectedEntityId]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  useEffect(() => {
    loadSelectedEntity();
  }, [loadSelectedEntity]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  useEffect(() => {
    loadRelations();
  }, [loadRelations]);

  const loadGraph = useCallback(async (depth: number) => {
    if (!selectedEntityId) return;
    setGraphLoading(true);
    try {
      const data = await getKnowledgeGraph(selectedEntityId, depth);
      setGraphData(data);
    } catch {
      setGraphData(null);
    } finally {
      setGraphLoading(false);
    }
  }, [selectedEntityId]);

  useEffect(() => {
    if (viewMode === 'graph') {
      loadGraph(graphDepth);
    }
  }, [viewMode, graphDepth, loadGraph]);

  const selectedAliases = useMemo(
    () => (selectedEntity?.aliases || []).join(', '),
    [selectedEntity]
  );
  const evidence = useMemo(() => extractKnowledgeEvidence(selectedEntity), [selectedEntity]);
  const selectedEvidenceCount = selectedEntity ? evidence.sources.length || evidence.threadIds.length : 0;
  const relationCount = relations.outgoing.length + relations.incoming.length;
  const relationTargets = useMemo(
    () => entities.filter((entity) => entity.entity_id !== selectedEntityId),
    [entities, selectedEntityId]
  );

  const handleCreateEntity = async () => {
    if (!newEntity.canonical_name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const entity = await createKnowledgeEntity({
        entity_type: newEntity.entity_type.trim() || DEFAULT_ENTITY_TYPE,
        canonical_name: newEntity.canonical_name.trim(),
        aliases: newEntity.aliases.split(',').map((item) => item.trim()).filter(Boolean),
        summary: newEntity.summary.trim(),
        description: newEntity.description.trim(),
      });
      setNewEntity({
        entity_type: DEFAULT_ENTITY_TYPE,
        canonical_name: '',
        aliases: '',
        summary: '',
        description: '',
      });
      setShowCreate(false);
      await loadEntities();
      setSearchParams({ entity_id: entity.entity_id });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create knowledge item');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEntity = async () => {
    if (!selectedEntity || !canWrite) return;
    setSaving(true);
    setError('');
    try {
      const updated = await updateKnowledgeEntity(selectedEntity.entity_id, {
        canonical_name: selectedEntity.canonical_name,
        aliases: selectedAliases.split(',').map((item) => item.trim()).filter(Boolean),
        summary: selectedEntity.summary,
        description: selectedEntity.description,
        status: selectedEntity.status,
      });
      setSelectedEntity(updated);
      await loadEntities();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update knowledge item');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAnnotation = async () => {
    if (!selectedEntity || !annotationBody.trim()) return;
    setSaving(true);
    setError('');
    try {
      await createAnnotation({
        annotation_type: 'email',
        body: annotationBody.trim(),
        visibility: isAdmin ? 'public' : 'private',
        target_type: 'knowledge_entity',
        target_ref: selectedEntity.entity_id,
        target_label: selectedEntity.canonical_name,
        target_subtitle: selectedEntity.entity_type,
      });
      setAnnotationBody('');
      await loadAnnotations();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create note');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRelation = async () => {
    if (!selectedEntity || !relationForm.target_entity_id || !canWrite) return;
    setSaving(true);
    setError('');
    try {
      await createKnowledgeRelation({
        source_entity_id: selectedEntity.entity_id,
        target_entity_id: relationForm.target_entity_id,
        relation_type: relationForm.relation_type,
        description: relationForm.description.trim(),
      });
      setRelationForm({ relation_type: 'related_to', target_entity_id: '', description: '' });
      await loadRelations();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create relation');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRelationDescription = async (relation: KnowledgeRelation) => {
    if (!canWrite) return;
    setSaving(true);
    setError('');
    try {
      await updateKnowledgeRelation(relation.relation_id, {
        description: relationDrafts[relation.relation_id] ?? relation.description,
      });
      await loadRelations();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update relation');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRelation = async (relationId: string) => {
    if (!canWrite) return;
    setSaving(true);
    setError('');
    try {
      await deleteKnowledgeRelation(relationId);
      await loadRelations();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete relation');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntity = async (forceDelete: boolean) => {
    if (!selectedEntity || !canWrite) return;
    setSaving(true);
    setError('');
    try {
      await deleteKnowledgeEntity(selectedEntity.entity_id, forceDelete);
      setShowDeleteConfirm(false);
      setSelectedEntity(null);
      setSearchParams({}, { replace: true });
      await loadEntities();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to delete entity';
      try {
        const jsonPart = msg.split(': ').slice(1).join(': ') || msg;
        const parsed = JSON.parse(jsonPart);
        const blocked = parsed?.blocked_by || parsed?.detail?.blocked_by;
        if (blocked) {
          setError(
            `Cannot delete: ${blocked.length} relation(s) exist. Force delete will also remove them.`
          );
        } else {
          setError(msg);
        }
      } catch {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="flex w-[380px] shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-gray-950">Knowledge</h1>
              <p className="mt-1 text-sm leading-5 text-gray-500">
                Reviewed concepts distilled from mailing-list evidence.
              </p>
            </div>
            <div className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600">
              {entities.length}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadEntities()}
              placeholder="Find concepts, subsystems, bugs..."
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              onClick={loadEntities}
              className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Search
            </button>
          </div>

          {canWrite && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowCreate((value) => !value)}
                className="w-full rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:border-indigo-200 hover:bg-indigo-50"
              >
                {showCreate ? 'Hide quick capture' : 'Capture a new knowledge item'}
              </button>
            </div>
          )}
        </div>

        {showCreate && (
          <div className="border-b border-gray-200 bg-gray-50 p-4">
            <div className="text-sm font-semibold text-gray-900">Quick capture</div>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              Use this for a reviewed idea. Ask answers can still create richer drafts with source evidence.
            </p>
            <div className="mt-3 space-y-3">
              <input
                value={newEntity.canonical_name}
                onChange={(e) => setNewEntity((prev) => ({ ...prev, canonical_name: e.target.value }))}
                placeholder="Name, for example O(1) scheduler"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <select
                value={newEntity.entity_type}
                onChange={(e) => setNewEntity((prev) => ({ ...prev, entity_type: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>{readableType(type)}</option>
                ))}
              </select>
              <input
                value={newEntity.aliases}
                onChange={(e) => setNewEntity((prev) => ({ ...prev, aliases: e.target.value }))}
                placeholder="Aliases, comma-separated"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <textarea
                value={newEntity.summary}
                onChange={(e) => setNewEntity((prev) => ({ ...prev, summary: e.target.value }))}
                placeholder="One or two sentences that explain why this matters"
                className="min-h-[76px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                onClick={handleCreateEntity}
                disabled={saving || !newEntity.canonical_name.trim()}
                className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Create draft
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-5 text-sm text-gray-500">Loading knowledge...</div>
          ) : entities.length === 0 ? (
            <div className="p-5 text-sm leading-6 text-gray-500">
              No knowledge items yet. Start from an Ask answer, then save the useful parts as drafts.
            </div>
          ) : (
            entities.map((entity) => {
              const count = evidenceCount(entity);
              const selected = selectedEntityId === entity.entity_id;
              return (
                <button
                  key={entity.entity_id}
                  onClick={() => setSearchParams({ entity_id: entity.entity_id })}
                  className={`w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${
                    selected ? 'bg-indigo-50/80' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-600">
                      {readableType(entity.entity_type)}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusTone(entity.status)}`}>
                      {entity.status}
                    </span>
                  </div>
                  <div className="mt-2 truncate text-sm font-semibold text-gray-950">{entity.canonical_name}</div>
                  {entity.summary ? (
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{entity.summary}</div>
                  ) : (
                    <div className="mt-1 text-xs text-gray-400">No summary yet</div>
                  )}
                  <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
                    <span>{count ? `${count} source${count > 1 ? 's' : ''}` : 'No source evidence'}</span>
                    <span>Updated {formatDate(entity.updated_at)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!selectedEntity ? (
          <div className="mx-auto flex h-full max-w-3xl items-center px-8">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Knowledge workflow</div>
              <h2 className="mt-2 text-3xl font-semibold text-gray-950">Turn useful email history into reusable kernel knowledge.</h2>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {[
                  ['1', 'Ask or search', 'Find the discussion that explains a behavior, tradeoff, or subsystem decision.'],
                  ['2', 'Review evidence', 'Keep the source emails visible so every claim can be checked later.'],
                  ['3', 'Save knowledge', 'Promote the stable explanation into a concept, issue, or mechanism with notes.'],
                ].map(([step, title, body]) => (
                  <div key={step} className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="text-xs font-semibold text-indigo-600">Step {step}</div>
                    <div className="mt-2 text-sm font-semibold text-gray-900">{title}</div>
                    <div className="mt-1 text-sm leading-5 text-gray-500">{body}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl p-6 space-y-5">
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold uppercase text-indigo-700">
                      {readableType(selectedEntity.entity_type)}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(selectedEntity.status)}`}>
                      {selectedEntity.status}
                    </span>
                    <span className="text-xs text-gray-400">Updated {formatDateTime(selectedEntity.updated_at)}</span>
                  </div>
                  <input
                    value={selectedEntity.canonical_name}
                    onChange={(e) => setSelectedEntity((prev) => (prev ? { ...prev, canonical_name: e.target.value } : prev))}
                    className="mt-3 w-full rounded-lg border border-transparent bg-transparent px-0 py-1 text-3xl font-semibold text-gray-950 outline-none focus:border-gray-300 focus:bg-white focus:px-3"
                    disabled={!canWrite}
                  />
                  <input
                    value={selectedAliases}
                    onChange={(e) => setSelectedEntity((prev) => (prev ? { ...prev, aliases: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) } : prev))}
                    placeholder="Add aliases that people may search for"
                    className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
                    disabled={!canWrite}
                  />
                </div>
                <div className="w-72 shrink-0">
                  <EmailTagEditor targetType="knowledge_entity" targetRef={selectedEntity.entity_id} />
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="mt-3 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete entity
                    </button>
                  )}
                </div>
              </div>
            </section>

            {showDeleteConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                  <h3 className="text-lg font-semibold text-gray-950">Delete &ldquo;{selectedEntity.canonical_name}&rdquo;?</h3>
                  <p className="mt-2 text-sm leading-5 text-gray-600">
                    This will permanently delete this knowledge entity and its tag assignments.
                    {relationCount > 0 && (
                      <span className="mt-1 block font-medium text-red-600">
                        Warning: {relationCount} relation(s) exist. Use force delete to also remove them.
                      </span>
                    )}
                  </p>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    {relationCount > 0 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteEntity(true)}
                        disabled={saving}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Force delete (with relations)
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteEntity(false)}
                      disabled={saving}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {relationCount > 0 ? 'Try delete' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <section className="grid gap-3 md:grid-cols-5">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Sources</div>
                <div className="mt-2 text-2xl font-semibold text-gray-950">{selectedEvidenceCount}</div>
                <div className="mt-1 text-xs text-gray-500">linked emails or threads</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Notes</div>
                <div className="mt-2 text-2xl font-semibold text-gray-950">{annotations.length}</div>
                <div className="mt-1 text-xs text-gray-500">human review comments</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Relations</div>
                <div className="mt-2 text-2xl font-semibold text-gray-950">{relationCount}</div>
                <div className="mt-1 text-xs text-gray-500">linked knowledge items</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Type</div>
                <div className="mt-2 text-sm font-semibold capitalize text-gray-950">{readableType(selectedEntity.entity_type)}</div>
                <div className="mt-1 text-xs text-gray-500">what this item represents</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Review state</div>
                <select
                  value={selectedEntity.status}
                  onChange={(e) => setSelectedEntity((prev) => (prev ? { ...prev, status: e.target.value } : prev))}
                  disabled={!canWrite}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="deprecated">deprecated</option>
                </select>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-950">Explanation</h2>
                  <p className="text-sm text-gray-500">Keep this concise enough to reuse in future Ask answers.</p>
                </div>
                <button
                  onClick={handleSaveEntity}
                  disabled={!canWrite || saving}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
              <div className="mt-4">
                <label className="text-sm font-medium text-gray-700">Short answer</label>
                <textarea
                  value={selectedEntity.summary}
                  onChange={(e) => setSelectedEntity((prev) => (prev ? { ...prev, summary: e.target.value } : prev))}
                  placeholder="A reusable one-paragraph explanation."
                  className="mt-2 min-h-[96px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
                  disabled={!canWrite}
                />
              </div>
              <div className="mt-4">
                <label className="text-sm font-medium text-gray-700">Detailed note</label>
                <textarea
                  value={selectedEntity.description}
                  onChange={(e) => setSelectedEntity((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                  placeholder="Add background, tradeoffs, timelines, and caveats that should survive beyond one Ask session."
                  className="mt-2 min-h-[210px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
                  disabled={!canWrite}
                />
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-950">Related knowledge</h2>
                  <p className="text-sm text-gray-500">
                    Start the knowledge graph with explicit, reviewable relationships between concepts.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-400">
                    {relationLoading ? 'Loading...' : `${relationCount} relations`}
                  </div>
                  <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        viewMode === 'list'
                          ? 'bg-white text-gray-950 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      List
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('graph')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        viewMode === 'graph'
                          ? 'bg-white text-gray-950 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Graph
                    </button>
                  </div>
                </div>
              </div>

              {viewMode === 'graph' ? (
                <div className="mt-4">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-500">Depth:</span>
                    {[1, 2, 3].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setGraphDepth(d)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                          graphDepth === d
                            ? 'bg-indigo-600 text-white'
                            : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {d} hop{d > 1 ? 's' : ''}
                      </button>
                    ))}
                  </div>
                  {graphLoading ? (
                    <div className="flex h-[520px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-500">
                      Loading graph...
                    </div>
                  ) : graphData && graphData.nodes.length > 0 ? (
                    <KnowledgeGraphView
                      nodes={graphData.nodes}
                      edges={graphData.edges}
                      centerEntityId={selectedEntity.entity_id}
                      onNodeClick={(entityId) => setSearchParams({ entity_id: entityId })}
                    />
                  ) : (
                    <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
                      No graph data available.
                    </div>
                  )}
                </div>
              ) : (
                <>

              {canWrite && (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="grid gap-3 md:grid-cols-[160px_1fr]">
                    <select
                      value={relationForm.relation_type}
                      onChange={(e) => setRelationForm((prev) => ({ ...prev, relation_type: e.target.value }))}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                      {RELATION_TYPES.map((type) => (
                        <option key={type} value={type}>{relationLabel(type)}</option>
                      ))}
                    </select>
                    <select
                      value={relationForm.target_entity_id}
                      onChange={(e) => setRelationForm((prev) => ({ ...prev, target_entity_id: e.target.value }))}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="">Choose related knowledge...</option>
                      {relationTargets.map((entity) => (
                        <option key={entity.entity_id} value={entity.entity_id}>
                          {entity.canonical_name} ({readableType(entity.entity_type)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={relationForm.description}
                    onChange={(e) => setRelationForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Explain the relationship, for example: CFS superseded the O(1) scheduler in the 2.6 era."
                    className="mt-3 min-h-[72px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={handleCreateRelation}
                      disabled={saving || !relationForm.target_entity_id}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Add relation
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900">This item points to</div>
                  <div className="mt-2 space-y-2">
                    {relations.outgoing.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                        No outgoing relations yet.
                      </div>
                    ) : relations.outgoing.map((relation) => (
                      <div key={relation.relation_id} className="rounded-xl border border-gray-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => setSearchParams({ entity_id: relation.target_entity_id })}
                            className="min-w-0 text-left"
                          >
                            <div className="text-xs font-semibold uppercase text-indigo-600">{relationLabel(relation.relation_type)}</div>
                            <div className="mt-1 truncate text-sm font-semibold text-gray-950">
                              {relationEntityName(relation.target_entity, relation.target_entity_id)}
                            </div>
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRelation(relation.relation_id)}
                              className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <textarea
                          value={relationDrafts[relation.relation_id] ?? relation.description}
                          onChange={(e) => setRelationDrafts((prev) => ({ ...prev, [relation.relation_id]: e.target.value }))}
                          disabled={!canWrite}
                          placeholder="No relationship note yet."
                          className="mt-2 min-h-[64px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
                        />
                        {canWrite && (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleSaveRelationDescription(relation)}
                              disabled={saving}
                              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                            >
                              Save note
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-semibold text-gray-900">Other items pointing here</div>
                  <div className="mt-2 space-y-2">
                    {relations.incoming.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                        No incoming relations yet.
                      </div>
                    ) : relations.incoming.map((relation) => (
                      <div key={relation.relation_id} className="rounded-xl border border-gray-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => setSearchParams({ entity_id: relation.source_entity_id })}
                            className="min-w-0 text-left"
                          >
                            <div className="text-xs font-semibold uppercase text-indigo-600">{relationLabel(relation.relation_type)}</div>
                            <div className="mt-1 truncate text-sm font-semibold text-gray-950">
                              {relationEntityName(relation.source_entity, relation.source_entity_id)}
                            </div>
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRelation(relation.relation_id)}
                              className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <textarea
                          value={relationDrafts[relation.relation_id] ?? relation.description}
                          onChange={(e) => setRelationDrafts((prev) => ({ ...prev, [relation.relation_id]: e.target.value }))}
                          disabled={!canWrite}
                          placeholder="No relationship note yet."
                          className="mt-2 min-h-[64px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
                        />
                        {canWrite && (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleSaveRelationDescription(relation)}
                              disabled={saving}
                              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                            >
                              Save note
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
                </>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-950">Source emails</h2>
                  <p className="text-sm text-gray-500">
                    Evidence kept with this item. Open a source before promoting a draft to active knowledge.
                  </p>
                </div>
                {evidence.generatedAt && (
                  <span className="text-xs text-gray-400">Captured {formatDateTime(evidence.generatedAt)}</span>
                )}
              </div>
              {evidence.question && (
                <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm leading-6 text-indigo-950">
                  Ask question: {evidence.question}
                </div>
              )}
              {evidence.sources.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {evidence.sources.map((source, index) => (
                    <button
                      key={`${source.message_id || source.thread_id}-${index}`}
                      type="button"
                      onClick={() => source.thread_id && setSelectedThread({ threadId: source.thread_id, focusMessageId: source.message_id || undefined })}
                      disabled={!source.thread_id}
                      className="block w-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-left hover:border-indigo-200 hover:bg-indigo-50/60 disabled:cursor-default disabled:hover:border-gray-200 disabled:hover:bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-gray-950">
                            {sourceTitle(source)}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            {source.list_name && <span>{source.list_name}</span>}
                            {source.source && <span>{source.source}</span>}
                            {source.message_id && <span className="font-mono">{source.message_id}</span>}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs font-medium text-gray-600">
                          Open thread
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : evidence.threadIds.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {evidence.threadIds.map((threadId) => (
                    <button
                      key={threadId}
                      type="button"
                      onClick={() => setSelectedThread({ threadId })}
                      className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-700 hover:border-indigo-200 hover:bg-indigo-50"
                    >
                      {threadId}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm leading-6 text-gray-500">
                  No source evidence is attached yet. The most useful path is Ask, review answer, then save knowledge draft, because that preserves the emails behind the claim.
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-950">Human notes</h2>
                  <p className="text-sm text-gray-500">Corrections, review decisions, and follow-up questions linked to this item.</p>
                </div>
                <div className="text-sm text-gray-400">{annotations.length} items</div>
              </div>

              {canWrite && (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <textarea
                    value={annotationBody}
                    onChange={(e) => setAnnotationBody(e.target.value)}
                    placeholder="Add a reviewer note, correction, or follow-up question..."
                    className="min-h-[96px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={handleCreateAnnotation}
                      disabled={saving || !annotationBody.trim()}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Add note
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-3">
                {annotationLoading ? (
                  <div className="text-sm text-gray-500">Loading notes...</div>
                ) : annotations.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                    No human notes yet.
                  </div>
                ) : (
                  annotations.map((annotation) => (
                    <div key={annotation.annotation_id} className="rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-gray-800">{annotation.author}</div>
                        <div className="text-xs text-gray-400">
                          {formatDateTime(annotation.updated_at)}
                        </div>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{annotation.body}</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </main>
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
