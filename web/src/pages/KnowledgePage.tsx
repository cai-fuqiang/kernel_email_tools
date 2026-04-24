import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import EmailTagEditor from '../components/EmailTagEditor';
import {
  createAnnotation,
  createKnowledgeEntity,
  getKnowledgeEntity,
  listAnnotations,
  listKnowledgeEntities,
  updateKnowledgeEntity,
} from '../api/client';
import type { AnnotationListItem, KnowledgeEntity } from '../api/types';
import { useAuth } from '../auth';

const DEFAULT_ENTITY_TYPE = 'concept';

export default function KnowledgePage() {
  const { canWrite, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedEntityId = searchParams.get('entity_id') || '';

  const [entities, setEntities] = useState<KnowledgeEntity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<KnowledgeEntity | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [annotationLoading, setAnnotationLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [newEntity, setNewEntity] = useState({
    entity_type: DEFAULT_ENTITY_TYPE,
    canonical_name: '',
    aliases: '',
    summary: '',
    description: '',
  });
  const [annotationBody, setAnnotationBody] = useState('');

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
      setError(e instanceof Error ? e.message : 'Failed to load entities');
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
      setError(e instanceof Error ? e.message : 'Failed to load entity');
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

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  useEffect(() => {
    loadSelectedEntity();
  }, [loadSelectedEntity]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  const selectedAliases = useMemo(
    () => (selectedEntity?.aliases || []).join(', '),
    [selectedEntity]
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
      await loadEntities();
      setSearchParams({ entity_id: entity.entity_id });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create entity');
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
      setError(e instanceof Error ? e.message : 'Failed to update entity');
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
      setError(e instanceof Error ? e.message : 'Failed to create annotation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen flex">
      <aside className="w-80 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-5 border-b border-gray-200">
          <h1 className="text-xl font-semibold text-gray-900">Knowledge Base</h1>
          <p className="text-sm text-gray-500 mt-1">Manage stable concepts, issues, subsystems, symbols, and other knowledge entities.</p>
          <div className="mt-4 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadEntities()}
              placeholder="Search entities..."
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button onClick={loadEntities} className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white">
              Search
            </button>
          </div>
        </div>

        <div className="p-4 border-b border-gray-200 bg-gray-50 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">New Entity</div>
          <input
            value={newEntity.canonical_name}
            onChange={(e) => setNewEntity((prev) => ({ ...prev, canonical_name: e.target.value }))}
            placeholder="Canonical name"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            disabled={!canWrite}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={newEntity.entity_type}
              onChange={(e) => setNewEntity((prev) => ({ ...prev, entity_type: e.target.value }))}
              placeholder="entity type"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              disabled={!canWrite}
            />
            <input
              value={newEntity.aliases}
              onChange={(e) => setNewEntity((prev) => ({ ...prev, aliases: e.target.value }))}
              placeholder="aliases, comma-separated"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              disabled={!canWrite}
            />
          </div>
          <textarea
            value={newEntity.summary}
            onChange={(e) => setNewEntity((prev) => ({ ...prev, summary: e.target.value }))}
            placeholder="Short summary"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[72px]"
            disabled={!canWrite}
          />
          <button
            onClick={handleCreateEntity}
            disabled={!canWrite || saving || !newEntity.canonical_name.trim()}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Create Entity
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-gray-400">Loading entities...</div>
          ) : entities.length === 0 ? (
            <div className="p-4 text-sm text-gray-400">No entities yet.</div>
          ) : (
            entities.map((entity) => (
              <button
                key={entity.entity_id}
                onClick={() => setSearchParams({ entity_id: entity.entity_id })}
                className={`w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${
                  selectedEntityId === entity.entity_id ? 'bg-indigo-50' : 'bg-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-600">
                    {entity.entity_type}
                  </span>
                  <span className="text-sm font-medium text-gray-900">{entity.canonical_name}</span>
                </div>
                <div className="mt-1 text-xs text-gray-500 font-mono">{entity.entity_id}</div>
                {entity.summary && <div className="mt-1 text-xs text-gray-500 line-clamp-2">{entity.summary}</div>}
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-gray-50">
        {error && <div className="m-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {!selectedEntity ? (
          <div className="h-full flex items-center justify-center text-gray-400">Select a knowledge entity to inspect or edit it.</div>
        ) : (
          <div className="max-w-5xl mx-auto p-6 space-y-6">
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold uppercase text-indigo-700">
                      {selectedEntity.entity_type}
                    </span>
                    <span className="text-xs text-gray-400">{selectedEntity.status}</span>
                  </div>
                  <div className="mt-2 text-xs font-mono text-gray-400">{selectedEntity.entity_id}</div>
                </div>
                <div className="w-64">
                  <EmailTagEditor targetType="knowledge_entity" targetRef={selectedEntity.entity_id} />
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Canonical Name</label>
                  <input
                    value={selectedEntity.canonical_name}
                    onChange={(e) => setSelectedEntity((prev) => (prev ? { ...prev, canonical_name: e.target.value } : prev))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    disabled={!canWrite}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Aliases</label>
                  <input
                    value={selectedAliases}
                    onChange={(e) => setSelectedEntity((prev) => (prev ? { ...prev, aliases: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) } : prev))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    disabled={!canWrite}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Summary</label>
                <textarea
                  value={selectedEntity.summary}
                  onChange={(e) => setSelectedEntity((prev) => (prev ? { ...prev, summary: e.target.value } : prev))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[84px]"
                  disabled={!canWrite}
                />
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Description</label>
                <textarea
                  value={selectedEntity.description}
                  onChange={(e) => setSelectedEntity((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[160px]"
                  disabled={!canWrite}
                />
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleSaveEntity}
                  disabled={!canWrite || saving}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Save Entity
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Annotations</h2>
                  <p className="text-sm text-gray-500">Non-structured commentary and discussion linked to this entity.</p>
                </div>
                <div className="text-sm text-gray-400">{annotations.length} items</div>
              </div>

              {canWrite && (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <textarea
                    value={annotationBody}
                    onChange={(e) => setAnnotationBody(e.target.value)}
                    placeholder="Write an annotation about this entity..."
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[96px]"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={handleCreateAnnotation}
                      disabled={saving || !annotationBody.trim()}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Add Annotation
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-3">
                {annotationLoading ? (
                  <div className="text-sm text-gray-400">Loading annotations...</div>
                ) : annotations.length === 0 ? (
                  <div className="text-sm text-gray-400">No annotations attached to this entity yet.</div>
                ) : (
                  annotations.map((annotation) => (
                    <div key={annotation.annotation_id} className="rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-gray-800">{annotation.author}</div>
                        <div className="text-xs text-gray-400">
                          {new Date(annotation.updated_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{annotation.body}</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
