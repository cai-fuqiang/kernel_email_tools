import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Inbox, Plus, RefreshCw } from 'lucide-react';
import EmailTagEditor from '../components/EmailTagEditor';
import ThreadDrawer from '../components/ThreadDrawer';
import KnowledgeGraphView from '../components/KnowledgeGraphView';
import DraftReviewPanel from '../components/DraftReviewPanel';
import {
  acceptKnowledgeDraft,
  createAnnotation,
  createKnowledgeEntity,
  createKnowledgeRelation,
  deleteKnowledgeEntity,
  deleteKnowledgeRelation,
  getKnowledgeEntity,
  getKnowledgeGraph,
  getKnowledgeStats,
  listKnowledgeDrafts,
  listKnowledgeEvidence,
  listAnnotations,
  listKnowledgeEntities,
  listKnowledgeRelations,
  mergeKnowledgeEntities,
  rejectKnowledgeDraft,
  updateKnowledgeDraft,
  updateKnowledgeRelation,
  updateKnowledgeEntity,
} from '../api/client';
import type {
  AnnotationListItem,
  AskDraftApplyResponse,
  AskDraftResponse,
  KnowledgeDraft,
  KnowledgeEntity,
  KnowledgeEvidence,
  KnowledgeRelation,
  KnowledgeGraphResponse,
  KnowledgeStats,
} from '../api/types';
import { useAuth } from '../auth';
import { PageHeader, PrimaryButton, SecondaryButton, StatusBadge } from '../components/ui';

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

function evidenceTitle(row: KnowledgeEvidence) {
  const meta = row.meta || {};
  const sender = String(meta.sender || '').split('<')[0].trim();
  const date = formatDate(String(meta.date || ''));
  const subject = String(meta.subject || row.message_id || row.thread_id);
  return [sender, date, subject].filter(Boolean).join(' · ');
}

function normalizeDraftPayload(payload: unknown): AskDraftResponse {
  const raw = payload && typeof payload === 'object' ? payload as Partial<AskDraftResponse> : {};
  return {
    draft_id: raw.draft_id || '',
    knowledge_drafts: Array.isArray(raw.knowledge_drafts) ? raw.knowledge_drafts : [],
    annotation_drafts: Array.isArray(raw.annotation_drafts) ? raw.annotation_drafts : [],
    tag_assignment_drafts: Array.isArray(raw.tag_assignment_drafts) ? raw.tag_assignment_drafts : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
  };
}

function agentDraftMeta(draft: KnowledgeDraft) {
  const payload = draft.payload as unknown as Record<string, unknown>;
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : null;
  const runId = typeof payload.agent_run_id === 'string' ? payload.agent_run_id : '';
  const review = typeof payload.self_review === 'string' ? payload.self_review : '';
  return { confidence, runId, review };
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
  const [evidenceRows, setEvidenceRows] = useState<KnowledgeEvidence[]>([]);
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
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('graph');
  const [graphDepth, setGraphDepth] = useState(1);
  const [graphData, setGraphData] = useState<KnowledgeGraphResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [drafts, setDrafts] = useState<KnowledgeDraft[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftFilter, setDraftFilter] = useState<string>('all');
  const [activeDraft, setActiveDraft] = useState<KnowledgeDraft | null>(null);
  const [activeDraftPayload, setActiveDraftPayload] = useState<AskDraftResponse | null>(null);
  const [draftSaved, setDraftSaved] = useState<AskDraftApplyResponse | null>(null);
  const [draftError, setDraftError] = useState('');
  const [draftSaving, setDraftSaving] = useState(false);
  const [relationDrafts, setRelationDrafts] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedThread, setSelectedThread] = useState<ThreadFocus | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');

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

  const loadEvidence = useCallback(async () => {
    if (!selectedEntityId) {
      setEvidenceRows([]);
      return;
    }
    try {
      setEvidenceRows(await listKnowledgeEvidence(selectedEntityId));
    } catch {
      setEvidenceRows([]);
    }
  }, [selectedEntityId]);

  const loadDrafts = useCallback(async () => {
    setDraftLoading(true);
    try {
      const opts: { status?: string; source_type?: string; page_size: number } = { page_size: 20 };
      if (draftFilter === 'agent') {
        opts.source_type = 'agent_research';
        opts.status = 'new';
      } else if (draftFilter === 'accepted') {
        opts.source_type = 'agent_research';
        opts.status = 'accepted';
      } else if (draftFilter === 'rejected') {
        opts.source_type = 'agent_research';
        opts.status = 'rejected';
      } else {
        opts.status = 'new';
      }
      const res = await listKnowledgeDrafts(opts);
      setDrafts(res.drafts);
    } catch {
      setDrafts([]);
    } finally {
      setDraftLoading(false);
    }
  }, [draftFilter]);

  useEffect(() => { loadEntities(); }, [loadEntities]);
  useEffect(() => { loadSelectedEntity(); }, [loadSelectedEntity]);
  useEffect(() => { loadAnnotations(); }, [loadAnnotations]);
  useEffect(() => { loadRelations(); }, [loadRelations]);
  useEffect(() => { loadEvidence(); }, [loadEvidence]);
  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  useEffect(() => {
    setGraphData(null);
    setGraphDepth(1);
    setViewMode('graph');
  }, [selectedEntityId]);

  useEffect(() => {
    getKnowledgeStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, [entities.length]);

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
  }, [viewMode, graphDepth, loadGraph, relations.outgoing.length, relations.incoming.length]);

  const selectedAliases = useMemo(
    () => (selectedEntity?.aliases || []).join(', '),
    [selectedEntity]
  );
  const evidence = useMemo(() => extractKnowledgeEvidence(selectedEntity), [selectedEntity]);
  const selectedEvidenceCount = selectedEntity ? evidenceRows.length || evidence.sources.length || evidence.threadIds.length : 0;
  const directEvidenceCount = evidenceRows.filter((row) => row.source_type !== 'generated').length;
  const generatedEvidenceCount = evidence.sources.length + evidence.threadIds.length;
  const evidenceDates = evidenceRows
    .map((row) => row.created_at)
    .filter(Boolean)
    .sort();
  const lastEvidenceAt = evidenceDates[evidenceDates.length - 1] || evidence.generatedAt;
  const relationCount = relations.outgoing.length + relations.incoming.length;
  const relationTargets = useMemo(
    () => entities.filter((entity) => entity.entity_id !== selectedEntityId),
    [entities, selectedEntityId]
  );
  const activeDraftCounts = activeDraftPayload
    ? activeDraftPayload.knowledge_drafts.length + activeDraftPayload.annotation_drafts.length + activeDraftPayload.tag_assignment_drafts.length
    : 0;

  const handleCreateEntity = async () => {
    if (!newEntity.canonical_name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const result = await createKnowledgeEntity({
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
      setSearchParams({ entity_id: result.entity.entity_id });
      if (result.suggestions?.duplicates?.length) {
        const names = result.suggestions.duplicates
          .map((d) => d.canonical_name)
          .join(', ');
        setError(
          `Created. Possible duplicates found: ${names}. Consider reviewing to avoid fragmentation.`
        );
      }
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
      await loadEvidence();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update knowledge item');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenDraft = (draft: KnowledgeDraft) => {
    setActiveDraft(draft);
    setActiveDraftPayload(normalizeDraftPayload(draft.payload));
    setDraftSaved(null);
    setDraftError('');
  };

  const handleAcceptDraft = async () => {
    if (!activeDraft || !activeDraftPayload) return;
    setDraftSaving(true);
    setDraftError('');
    try {
      await updateKnowledgeDraft(activeDraft.draft_id, {
        payload: activeDraftPayload as unknown as Record<string, unknown>,
        status: 'reviewing',
      });
      const result = await acceptKnowledgeDraft(activeDraft.draft_id);
      setDraftSaved(result);
      await loadDrafts();
      await loadEntities();
      await loadEvidence();
    } catch (e: unknown) {
      setDraftError(e instanceof Error ? e.message : 'Failed to accept draft');
    } finally {
      setDraftSaving(false);
    }
  };

  const handleRejectDraft = async (draft: KnowledgeDraft) => {
    setDraftSaving(true);
    setDraftError('');
    try {
      await rejectKnowledgeDraft(draft.draft_id, 'Rejected from Knowledge Draft Inbox');
      if (activeDraft?.draft_id === draft.draft_id) {
        setActiveDraft(null);
        setActiveDraftPayload(null);
      }
      await loadDrafts();
    } catch (e: unknown) {
      setDraftError(e instanceof Error ? e.message : 'Failed to reject draft');
    } finally {
      setDraftSaving(false);
    }
  };

  const handleMergeEntity = async () => {
    if (!selectedEntity || !mergeTargetId || !canWrite) return;
    setSaving(true);
    setError('');
    try {
      const result = await mergeKnowledgeEntities(selectedEntity.entity_id, mergeTargetId);
      setMergeTargetId('');
      await loadEntities();
      setSearchParams({ entity_id: result.target.entity_id });
      setError(`Merged into ${result.target.canonical_name}. Moved ${Object.values(result.moved).reduce((sum, value) => sum + value, 0)} linked records.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to merge entity');
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
    <div className="min-h-screen bg-slate-50 xl:flex xl:h-screen">
      <aside className="flex max-h-[50vh] w-full shrink-0 flex-col border-b border-slate-200 bg-white xl:max-h-none xl:w-[390px] xl:border-b-0 xl:border-r">
        <div className="border-b border-slate-200 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-950">Knowledge</h1>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                Reviewed ideas with evidence, notes, and relations.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
              {entities.length}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadEntities()}
              placeholder="Find concepts, subsystems, bugs..."
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
            />
            <PrimaryButton
              onClick={loadEntities}
              className="px-3"
            >
              Search
            </PrimaryButton>
          </div>

          {stats && (
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <div className="rounded-md bg-gray-50 px-2 py-1.5 text-center">
                <div className="text-xs font-semibold text-gray-800">{stats.total_entities}</div>
                <div className="text-[9px] text-gray-400">entities</div>
              </div>
              <div className="rounded-md bg-gray-50 px-2 py-1.5 text-center">
                <div className="text-xs font-semibold text-gray-800">{stats.total_relations}</div>
                <div className="text-[9px] text-gray-400">relations</div>
              </div>
              <div className="rounded-md bg-gray-50 px-2 py-1.5 text-center">
                <div className="text-xs font-semibold text-gray-800">
                  {Object.keys(stats.by_type).length}
                </div>
                <div className="text-[9px] text-gray-400">types</div>
              </div>
              <div className="rounded-md bg-gray-50 px-2 py-1.5 text-center">
                <div className="text-xs font-semibold text-gray-800">
                  {stats.by_status.active || 0}
                </div>
                <div className="text-[9px] text-gray-400">active</div>
              </div>
            </div>
          )}

          {canWrite && (
            <div className="mt-3">
              <SecondaryButton
                type="button"
                onClick={() => setShowCreate((value) => !value)}
                className="w-full justify-start border-dashed"
              >
                <Plus className="h-4 w-4" />
                {showCreate ? 'Hide quick capture' : 'Capture a new knowledge item'}
              </SecondaryButton>
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

        <div className="border-b border-slate-200 bg-amber-50/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Inbox className="h-4 w-4 text-amber-600" />
                Draft Inbox
              </div>
              <p className="mt-1 text-xs leading-5 text-gray-500">Ask/Search drafts waiting for human review.</p>
            </div>
            <SecondaryButton
              type="button"
              onClick={loadDrafts}
              className="border-amber-200 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </SecondaryButton>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {[
              { value: 'all', label: 'All' },
              { value: 'human', label: 'Human' },
              { value: 'agent', label: 'AI Agent' },
              { value: 'accepted', label: 'Accepted Agent' },
              { value: 'rejected', label: 'Rejected Agent' },
            ].map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setDraftFilter(filter.value)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                  draftFilter === filter.value
                    ? 'bg-amber-200 text-amber-800'
                    : 'bg-white/60 text-slate-600 hover:bg-amber-100 hover:text-amber-700'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {draftError && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {draftError}
            </div>
          )}
          <div className="mt-3 space-y-2">
            {draftLoading ? (
              <div className="text-xs text-gray-500">Loading drafts...</div>
            ) : drafts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-amber-200 bg-white/70 px-3 py-3 text-xs leading-5 text-gray-500">
                No drafts for this filter. Ask or Search can generate candidates here.
              </div>
            ) : [...drafts]
              .sort((a, b) => {
                const aConf = agentDraftMeta(a).confidence;
                const bConf = agentDraftMeta(b).confidence;
                if (aConf !== null && bConf !== null) return bConf - aConf;
                if (aConf !== null) return -1;
                if (bConf !== null) return 1;
                return 0;
              })
              .slice(0, 6).map((draft) => {
              const agentMeta = agentDraftMeta(draft);
              return (
              <div key={draft.draft_id} className="rounded-lg border border-amber-100 bg-white p-3">
                <button
                  type="button"
                  onClick={() => handleOpenDraft(draft)}
                  className="block w-full text-left"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-gray-900">
                        {draft.question || draft.source_ref || draft.source_type}
                      </div>
                      {draft.source_type === 'agent_research' ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                            AI Research Agent
                          </span>
                          {agentMeta.confidence !== null && (
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              agentMeta.confidence >= 0.7 ? 'bg-emerald-100 text-emerald-700' :
                              agentMeta.confidence >= 0.5 ? 'bg-amber-100 text-amber-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              confidence {agentMeta.confidence.toFixed(2)}
                            </span>
                          )}
                          {agentMeta.runId && (
                            <Link
                              to={`/agent-research?run_id=${agentMeta.runId}`}
                              className="text-[10px] text-purple-600 underline hover:text-purple-800"
                              onClick={(e) => e.stopPropagation()}
                            >
                              run {agentMeta.runId.slice(-12)}
                            </Link>
                          )}
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Created by {draft.created_by || 'human'}
                        </div>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      draft.source_type === 'agent_research'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {draft.source_type}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400">Created {formatDateTime(draft.created_at)}</div>
                </button>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenDraft(draft)}
                    className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white"
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRejectDraft(draft)}
                    disabled={draftSaving}
                    className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        </div>

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
	                    selected ? 'bg-slate-100' : 'bg-white'
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
          <div className="m-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {activeDraft && activeDraftPayload && (
          <div className="m-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-gray-950">Review draft from {activeDraft.source_type}</div>
                <div className="mt-1 text-xs leading-5 text-gray-500">
                  {activeDraft.question || activeDraft.source_ref || activeDraft.draft_id}
                  {activeDraftCounts > 0 && <span> · {activeDraftCounts} candidate items</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveDraft(null);
                  setActiveDraftPayload(null);
                  setDraftSaved(null);
                  setDraftError('');
                }}
                className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-700"
              >
                Close
              </button>
            </div>
            <DraftReviewPanel
              draft={activeDraftPayload}
              onChange={setActiveDraftPayload}
              onSave={handleAcceptDraft}
              saving={draftSaving}
              saved={draftSaved}
              error={draftError}
              compact
            />
          </div>
        )}

        {!selectedEntity ? (
          <div className="mx-auto flex h-full max-w-3xl items-center px-8">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Knowledge workflow</div>
              <h2 className="mt-2 text-3xl font-semibold text-slate-950">Turn useful email history into reusable kernel knowledge.</h2>
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
          <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
            <PageHeader
              eyebrow="Knowledge Workbench"
              title={selectedEntity.canonical_name}
              description="Review the stable explanation, check evidence, add notes, and connect related knowledge."
              meta={
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="muted">{readableType(selectedEntity.entity_type)}</StatusBadge>
                  <StatusBadge tone={selectedEntity.status === 'active' ? 'success' : selectedEntity.status === 'deprecated' ? 'warning' : 'muted'}>
                    {selectedEntity.status}
                  </StatusBadge>
                  <StatusBadge tone="info">{selectedEvidenceCount} evidence</StatusBadge>
                  <StatusBadge tone="muted">{relationCount} relations</StatusBadge>
                </div>
              }
            />
	            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
	                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-700">
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
                  {canWrite && relationTargets.length > 0 && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="text-xs font-semibold text-gray-700">Merge this duplicate into</div>
                      <select
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                      >
                        <option value="">Choose target...</option>
                        {relationTargets.map((entity) => (
                          <option key={entity.entity_id} value={entity.entity_id}>
                            {entity.canonical_name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleMergeEntity}
                        disabled={saving || !mergeTargetId}
                        className="mt-2 w-full rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Merge into target
                      </button>
                    </div>
                  )}
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
                  <h2 className="text-lg font-semibold text-gray-950">Local knowledge graph</h2>
                  <p className="text-sm text-gray-500">
                    Explore this item's immediate neighborhood, then switch to List to edit the reviewed relations.
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
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <span className="text-xs font-medium text-gray-500">Neighborhood depth:</span>
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
                    <span className="text-xs text-gray-400">
                      Click a node to open that knowledge item.
                    </span>
                  </div>
                  {relationCount === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center">
                      <div className="text-sm font-semibold text-gray-900">No graph relations yet</div>
                      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500">
                        A useful graph starts with explicit relationships. Add a relation in List view, then return here to see the local map.
                      </p>
                      <button
                        type="button"
                        onClick={() => setViewMode('list')}
                        className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                      >
                        Add relation
                      </button>
                    </div>
                  ) : graphLoading ? (
                    <div className="flex h-[520px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-500">
                      Loading graph...
                    </div>
                  ) : graphData && graphData.edges.length > 0 ? (
                    <KnowledgeGraphView
                      nodes={graphData.nodes}
                      edges={graphData.edges}
                      centerEntityId={selectedEntity.entity_id}
                      onNodeClick={(entityId) => setSearchParams({ entity_id: entityId })}
                    />
                  ) : (
                    <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
                      No graph data available for the selected depth.
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
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase text-gray-400">Direct evidence</div>
                  <div className="mt-1 text-sm font-semibold text-gray-950">{directEvidenceCount}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase text-gray-400">Generated sources</div>
                  <div className="mt-1 text-sm font-semibold text-gray-950">{generatedEvidenceCount}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase text-gray-400">Last verified</div>
                  <div className="mt-1 truncate text-sm font-semibold text-gray-950">
                    {lastEvidenceAt ? formatDateTime(lastEvidenceAt) : 'Not verified'}
                  </div>
                </div>
              </div>
              {evidenceRows.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {evidenceRows.map((row) => (
                    <div key={row.evidence_id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <div className="text-xs font-semibold uppercase text-indigo-600">{row.source_type}</div>
                      <div className="mt-1 text-sm font-semibold leading-6 text-gray-950">
                        {row.claim || selectedEntity.canonical_name}
                      </div>
                      {row.quote && (
                        <div className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-6 text-gray-600">
                          {row.quote}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => row.thread_id && setSelectedThread({ threadId: row.thread_id, focusMessageId: row.message_id || undefined })}
                        disabled={!row.thread_id}
                        className="mt-3 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:border-indigo-200 hover:bg-indigo-50/60 disabled:cursor-default disabled:hover:border-gray-200 disabled:hover:bg-white"
                      >
                        <div className="truncate text-sm font-semibold text-gray-900">
                          {evidenceTitle(row) || row.message_id || row.thread_id}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          {String(row.meta?.list_name || '') && <span>{String(row.meta?.list_name || '')}</span>}
                          {row.confidence && <span>{row.confidence}</span>}
                          {row.message_id && <span className="font-mono">{row.message_id}</span>}
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              ) : evidence.sources.length > 0 ? (
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
