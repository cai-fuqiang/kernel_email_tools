import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { showToast } from '../Toast';
import ThreadDrawer from '../ThreadDrawer';
import DraftReviewPanel from '../DraftReviewPanel';
import KnowledgeEntityMetaPanel from '../KnowledgeEntityMetaPanel';
import DraftInboxPanel from './DraftInboxPanel';
import EntityListPanel, {
  type NewEntityForm,
} from './EntityListPanel';
import EntityDetailHeader, {
  DeleteConfirmModal,
} from './EntityDetailHeader';
import EntityMetricsCards from './EntityMetricsCards';
import EntityExplanationEditor from './EntityExplanationEditor';
import KnowledgeTimelinePanel from './KnowledgeTimelinePanel';
import EntityRelationsPanel, {
  type RelationForm,
  type ViewMode,
} from './EntityRelationsPanel';
import EvidencePanel from './EvidencePanel';
import HumanNotesPanel from './HumanNotesPanel';
import EntityHistoryPanel from './EntityHistoryPanel';
import KnowledgeInspectorDock from './KnowledgeInspectorDock';
import {
  DEFAULT_ENTITY_TYPE,
  extractKnowledgeEvidence,
  normalizeDraftPayload,
  readableType,
  type ThreadFocus,
} from './knowledgeUtils';
import {
  extractKnowledgeMeta,
  mergeKnowledgeMeta,
  type KnowledgeEntityMetaSchema,
} from '../../utils/knowledgeMeta';
import {
  acceptKnowledgeDraft,
  createAnnotation,
  createKnowledgeEntity,
  createKnowledgeRelation,
  deleteKnowledgeEntity,
  deleteKnowledgeRelation,
  exportKnowledge,
  getKnowledgeEntity,
  getKnowledgeGraph,
  getKnowledgeStats,
  importKnowledge,
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
} from '../../api/client';
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
} from '../../api/types';
import { useAuth } from '../../auth';
import StickyContextBar from '../StickyContextBar';
import { PrimaryButton, SecondaryButton, StatusBadge } from '../ui';

export default function KnowledgeWorkbench() {
  const { canWrite, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedEntityId = searchParams.get('entity_id') || '';

  const [entities, setEntities] = useState<KnowledgeEntity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<KnowledgeEntity | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationListItem[]>([]);
  const [evidenceRows, setEvidenceRows] = useState<KnowledgeEvidence[]>([]);
  const [relations, setRelations] = useState<{
    outgoing: KnowledgeRelation[];
    incoming: KnowledgeRelation[];
  }>({
    outgoing: [],
    incoming: [],
  });
  const [loading, setLoading] = useState(false);
  const [annotationLoading, setAnnotationLoading] = useState(false);
  const [relationLoading, setRelationLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newEntity, setNewEntity] = useState<NewEntityForm>({
    entity_type: DEFAULT_ENTITY_TYPE,
    canonical_name: '',
    aliases: '',
    summary: '',
    description: '',
  });
  const [annotationBody, setAnnotationBody] = useState('');
  const [relationForm, setRelationForm] = useState<RelationForm>({
    relation_type: 'related_to',
    target_entity_id: '',
    description: '',
  });
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
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
  // PLAN-31001 Phase 5：实体列表分页 + fulltext 模式
  const [entityTotal, setEntityTotal] = useState(0);
  const [entityPage, setEntityPage] = useState(1);
  const [entitySearchMode, setEntitySearchMode] = useState<'simple' | 'fulltext'>('simple');
  const ENTITY_PAGE_SIZE = 50;
  const [draftSaving, setDraftSaving] = useState(false);
  const [relationDrafts, setRelationDrafts] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedThread, setSelectedThread] = useState<ThreadFocus | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const sectionLinks = [
    ['#knowledge-overview', 'Overview'],
    ['#knowledge-timeline', 'Timeline'],
    ['#knowledge-explanation', 'Explanation'],
    ['#knowledge-relations-panel', 'Relations'],
    ['#knowledge-evidence', 'Evidence'],
    ['#knowledge-notes', 'Notes'],
    ['#knowledge-history', 'History'],
  ];

  const loadEntities = useCallback(async (opts?: { append?: boolean; page?: number }) => {
    const targetPage = opts?.page ?? 1;
    setLoading(true);
    try {
      const res = await listKnowledgeEntities({
        q: query || undefined,
        page: targetPage,
        page_size: ENTITY_PAGE_SIZE,
        search_mode: entitySearchMode,
      });
      setEntities((prev) => (opts?.append ? [...prev, ...res.entities] : res.entities));
      setEntityTotal(res.total);
      setEntityPage(targetPage);
      if (!opts?.append && !selectedEntityId && res.entities.length > 0) {
        setSearchParams({ entity_id: res.entities[0].entity_id }, { replace: true });
      }
      if (selectedEntityId) {
        const existing = res.entities.find((item) => item.entity_id === selectedEntityId);
        if (existing) {
          setSelectedEntity(existing);
        }
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load knowledge items', 'error');
    } finally {
      setLoading(false);
    }
  }, [query, selectedEntityId, setSearchParams, entitySearchMode]);

  const loadMoreEntities = useCallback(async () => {
    if (loading) return;
    if (entities.length >= entityTotal) return;
    await loadEntities({ append: true, page: entityPage + 1 });
  }, [loading, entities.length, entityTotal, entityPage, loadEntities]);

  const handleExportKnowledge = useCallback(async () => {
    try {
      const payload = await exportKnowledge();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.download = `knowledge-export-${ts}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(
        `Exported ${payload.entity_count ?? 0} entities and ${
          payload.relation_count ?? 0
        } relations.`,
        'success',
      );
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to export knowledge', 'error');
    }
  }, []);

  const handleImportKnowledge = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const summary = await importKnowledge(data, 'upsert');
        showToast(
          `Import done: ${summary.entities_created} created, ${summary.entities_updated} updated, ${summary.entities_skipped} skipped, ${summary.relations_created} relations.`,
          summary.errors.length > 0 ? 'info' : 'success',
        );
        if (summary.errors.length > 0) {
          console.warn('Knowledge import errors:', summary.errors);
        }
        await loadEntities();
      } catch (e: unknown) {
        showToast(e instanceof Error ? e.message : 'Failed to import knowledge', 'error');
      }
    },
    [loadEntities],
  );

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
      showToast(e instanceof Error ? e.message : 'Failed to load knowledge item', 'error');
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
      const opts: { status?: string; source_type?: string; page_size: number } = {
        page_size: 20,
      };
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
  useEffect(() => {
    loadEvidence();
  }, [loadEvidence]);
  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

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

  const loadGraph = useCallback(
    async (depth: number) => {
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
    },
    [selectedEntityId],
  );

  useEffect(() => {
    if (viewMode === 'graph') {
      loadGraph(graphDepth);
    }
  }, [viewMode, graphDepth, loadGraph, relations.outgoing.length, relations.incoming.length]);

  const selectedAliases = useMemo(
    () => (selectedEntity?.aliases || []).join(', '),
    [selectedEntity],
  );
  const selectedMetaSchema = useMemo<KnowledgeEntityMetaSchema>(
    () => extractKnowledgeMeta(selectedEntity?.meta),
    [selectedEntity],
  );
  const evidence = useMemo(
    () => extractKnowledgeEvidence(selectedEntity),
    [selectedEntity],
  );
  const selectedEvidenceCount = selectedEntity
    ? evidenceRows.length || evidence.sources.length || evidence.threadIds.length
    : 0;
  const timelineCount = selectedMetaSchema.timeline.length;
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
    [entities, selectedEntityId],
  );
  const activeDraftCounts = activeDraftPayload
    ? activeDraftPayload.knowledge_drafts.length +
      activeDraftPayload.annotation_drafts.length +
      activeDraftPayload.tag_assignment_drafts.length
    : 0;

  const handleCreateEntity = async () => {
    if (!newEntity.canonical_name.trim()) return;
    setSaving(true);
    try {
      const result = await createKnowledgeEntity({
        entity_type: newEntity.entity_type.trim() || DEFAULT_ENTITY_TYPE,
        canonical_name: newEntity.canonical_name.trim(),
        aliases: newEntity.aliases
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
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
        const names = result.suggestions.duplicates.map((d) => d.canonical_name).join(', ');
        showToast(
          `Created. Possible duplicates found: ${names}. Consider reviewing to avoid fragmentation.`,
          'info',
        );
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to create knowledge item', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEntity = async () => {
    if (!selectedEntity || !canWrite) return;
    setSaving(true);
    try {
      const updated = await updateKnowledgeEntity(selectedEntity.entity_id, {
        canonical_name: selectedEntity.canonical_name,
        aliases: selectedAliases
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        summary: selectedEntity.summary,
        description: selectedEntity.description,
        status: selectedEntity.status,
        meta: selectedEntity.meta,
      });
      setSelectedEntity(updated);
      await loadEntities();
      await loadEvidence();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to update knowledge item', 'error');
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
    try {
      const result = await mergeKnowledgeEntities(selectedEntity.entity_id, mergeTargetId);
      setMergeTargetId('');
      await loadEntities();
      setSearchParams({ entity_id: result.target.entity_id });
      showToast(
        `Merged into ${result.target.canonical_name}. Moved ${Object.values(result.moved).reduce(
          (sum, value) => sum + value,
          0,
        )} linked records.`,
        'success',
      );
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to merge entity', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAnnotation = async () => {
    if (!selectedEntity || !annotationBody.trim()) return;
    setSaving(true);
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
      showToast(e instanceof Error ? e.message : 'Failed to create note', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRelation = async () => {
    if (!selectedEntity || !relationForm.target_entity_id || !canWrite) return;
    setSaving(true);
    try {
      const direction = relationForm.direction ?? 'outgoing';
      const sourceId =
        direction === 'incoming' ? relationForm.target_entity_id : selectedEntity.entity_id;
      const targetId =
        direction === 'incoming' ? selectedEntity.entity_id : relationForm.target_entity_id;
      await createKnowledgeRelation({
        source_entity_id: sourceId,
        target_entity_id: targetId,
        relation_type: relationForm.relation_type,
        description: relationForm.description.trim(),
      });
      setRelationForm({
        relation_type: 'related_to',
        target_entity_id: '',
        description: '',
        direction: 'outgoing',
      });
      await loadRelations();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to create relation', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRelationDescription = async (relation: KnowledgeRelation) => {
    if (!canWrite) return;
    setSaving(true);
    try {
      await updateKnowledgeRelation(relation.relation_id, {
        description: relationDrafts[relation.relation_id] ?? relation.description,
      });
      await loadRelations();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to update relation', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRelation = async (relationId: string) => {
    if (!canWrite) return;
    setSaving(true);
    try {
      await deleteKnowledgeRelation(relationId);
      await loadRelations();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to delete relation', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntity = async (forceDelete: boolean) => {
    if (!selectedEntity || !canWrite) return;
    setSaving(true);
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
          showToast(
            `Cannot delete: ${blocked.length} relation(s) exist. Force delete will also remove them.`,
            'error',
          );
        } else {
          showToast(msg, 'error');
        }
      } catch {
        showToast(msg, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSelectEntity = (entityId: string) => {
    setSearchParams({ entity_id: entityId });
  };

  const handleOpenThread = (threadId: string, focusMessageId?: string) => {
    setSelectedThread({ threadId, focusMessageId });
  };

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-slate-50 xl:flex xl:h-screen">
      <EntityListPanel
        entities={entities}
        selectedEntityId={selectedEntityId}
        loading={loading}
        stats={stats}
        query={query}
        canWrite={canWrite}
        showCreate={showCreate}
        newEntity={newEntity}
        saving={saving}
        total={entityTotal}
        searchMode={entitySearchMode}
        isAdmin={isAdmin}
        onExport={isAdmin ? handleExportKnowledge : undefined}
        onImport={isAdmin ? handleImportKnowledge : undefined}
        onSearchModeChange={(mode) => {
          setEntitySearchMode(mode);
          setEntityPage(1);
          // 用 setTimeout 延后到 state 更新后再触发，否则 loadEntities 拿到的还是旧值
          setTimeout(() => loadEntities(), 0);
        }}
        onLoadMore={loadMoreEntities}
        onQueryChange={setQuery}
        onSearch={() => loadEntities()}
        onToggleCreate={() => setShowCreate((value) => !value)}
        onNewEntityChange={setNewEntity}
        onCreateEntity={handleCreateEntity}
        onSelectEntity={handleSelectEntity}
      />

      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        {!selectedEntity ? (
          <div className="mx-auto flex h-full max-w-3xl items-center px-4 md:px-8">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Knowledge workflow
              </div>
              <h2 className="mt-2 text-3xl font-semibold text-slate-950">
                Turn useful email history into reusable kernel knowledge.
              </h2>
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
          <div className="relative mx-auto max-w-6xl min-w-0 space-y-5 overflow-x-hidden p-4 md:p-6">
            <StickyContextBar
              title={selectedEntity.canonical_name}
              subtitle={`${readableType(selectedEntity.entity_type)} · ${selectedEvidenceCount} evidence · ${timelineCount} timeline events · ${relationCount} relations`}
              meta={
                <>
                  <StatusBadge
                    tone={
                      selectedEntity.status === 'active'
                        ? 'success'
                        : selectedEntity.status === 'deprecated'
                        ? 'warning'
                        : 'muted'
                    }
                  >
                    {selectedEntity.status}
                  </StatusBadge>
                  {saving && <StatusBadge tone="info">Saving</StatusBadge>}
                </>
              }
              actions={
                <>
                  <SecondaryButton
                    onClick={() => {
                      setViewMode('graph');
                      document.getElementById('knowledge-relations-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    View graph
                  </SecondaryButton>
                  {canWrite && (
                    <>
                      <SecondaryButton onClick={() => setShowDeleteConfirm(true)} disabled={saving}>
                        Delete
                      </SecondaryButton>
                      <PrimaryButton onClick={handleSaveEntity} disabled={saving}>
                        Save
                      </PrimaryButton>
                    </>
                  )}
                </>
              }
            />

            <KnowledgeInspectorDock
              entity={selectedEntity}
              annotations={annotations}
              annotationBody={annotationBody}
              canWrite={canWrite}
              saving={saving}
              onAnnotationBodyChange={setAnnotationBody}
              onCreateAnnotation={handleCreateAnnotation}
            />

            <div className="sticky top-[73px] z-10 flex max-w-full gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50/95 py-2 backdrop-blur">
              {sectionLinks.map(([href, label]) => (
                <a key={href} href={href} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-950">
                  {label}
                </a>
              ))}
            </div>

            {activeDraft && activeDraftPayload ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-950">
                      Review draft from {activeDraft.source_type}
                    </div>
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
            ) : (
              <DraftInboxPanel
                drafts={drafts}
                draftLoading={draftLoading}
                draftFilter={draftFilter}
                draftError={draftError}
                draftSaving={draftSaving}
                onRefresh={loadDrafts}
                onFilterChange={setDraftFilter}
                onOpenDraft={handleOpenDraft}
                onRejectDraft={handleRejectDraft}
                className="rounded-xl border border-amber-200"
              />
            )}

            <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden">
                <section id="knowledge-overview" className="scroll-mt-24 space-y-5">
                  <EntityDetailHeader
                    selectedEntity={selectedEntity}
                    selectedAliases={selectedAliases}
                    canWrite={canWrite}
                    saving={saving}
                    relationTargets={relationTargets}
                    mergeTargetId={mergeTargetId}
                    onMergeTargetChange={setMergeTargetId}
                    onMerge={handleMergeEntity}
                    onShowDelete={() => setShowDeleteConfirm(true)}
                    onUpdateName={(value) =>
                      setSelectedEntity((prev) => (prev ? { ...prev, canonical_name: value } : prev))
                    }
                    onUpdateAliases={(value) =>
                      setSelectedEntity((prev) =>
                        prev
                          ? {
                              ...prev,
                              aliases: value
                                .split(',')
                                .map((item) => item.trim())
                                .filter(Boolean),
                            }
                          : prev,
                      )
                    }
                  />

                  {showDeleteConfirm && (
                    <DeleteConfirmModal
                      entityName={selectedEntity.canonical_name}
                      relationCount={relationCount}
                      saving={saving}
                      onCancel={() => setShowDeleteConfirm(false)}
                      onDelete={handleDeleteEntity}
                    />
                  )}

                  <EntityMetricsCards
                    selectedEntity={selectedEntity}
                    evidenceCount={selectedEvidenceCount}
                    annotationCount={annotations.length}
                    relationCount={relationCount}
                    timelineCount={timelineCount}
                    canWrite={canWrite}
                    onStatusChange={(value) =>
                      setSelectedEntity((prev) => (prev ? { ...prev, status: value } : prev))
                    }
                  />
                </section>

                <section id="knowledge-timeline" className="scroll-mt-24">
                  <KnowledgeTimelinePanel
                    timeline={selectedMetaSchema.timeline}
                    canWrite={canWrite}
                    onOpenThread={handleOpenThread}
                    onChange={(timeline) =>
                      setSelectedEntity((prev) =>
                        prev
                          ? {
                              ...prev,
                              meta: mergeKnowledgeMeta(prev.meta, {
                                ...extractKnowledgeMeta(prev.meta),
                                timeline,
                              }),
                            }
                          : prev,
                      )
                    }
                  />
                </section>

                <section id="knowledge-explanation" className="scroll-mt-24 space-y-5">
                  <EntityExplanationEditor
                    selectedEntity={selectedEntity}
                    canWrite={canWrite}
                    saving={saving}
                    onSave={handleSaveEntity}
                    onUpdateSummary={(value) =>
                      setSelectedEntity((prev) => (prev ? { ...prev, summary: value } : prev))
                    }
                    onUpdateDescription={(value) =>
                      setSelectedEntity((prev) => (prev ? { ...prev, description: value } : prev))
                    }
                  />

                  <KnowledgeEntityMetaPanel
                    meta={selectedMetaSchema}
                    canEdit={canWrite}
                    onChange={(next) =>
                      setSelectedEntity((prev) =>
                        prev ? { ...prev, meta: mergeKnowledgeMeta(prev.meta, next) } : prev,
                      )
                    }
                  />
                </section>

                <section id="knowledge-relations-panel" className="scroll-mt-24">
                  <EntityRelationsPanel
                    selectedEntity={selectedEntity}
                    relations={relations}
                    relationLoading={relationLoading}
                    relationCount={relationCount}
                    relationTargets={relationTargets}
                    relationDrafts={relationDrafts}
                    relationForm={relationForm}
                    viewMode={viewMode}
                    graphDepth={graphDepth}
                    graphData={graphData}
                    graphLoading={graphLoading}
                    canWrite={canWrite}
                    saving={saving}
                    onSetViewMode={setViewMode}
                    onSetGraphDepth={setGraphDepth}
                    onSelectEntity={handleSelectEntity}
                    onRelationFormChange={setRelationForm}
                    onCreateRelation={handleCreateRelation}
                    onRelationDraftChange={(relationId, value) =>
                      setRelationDrafts((prev) => ({ ...prev, [relationId]: value }))
                    }
                    onSaveRelationDescription={handleSaveRelationDescription}
                    onDeleteRelation={handleDeleteRelation}
                  />
                </section>

                <section id="knowledge-evidence" className="scroll-mt-24">
                  <EvidencePanel
                    selectedEntity={selectedEntity}
                    evidence={evidence}
                    evidenceRows={evidenceRows}
                    directEvidenceCount={directEvidenceCount}
                    generatedEvidenceCount={generatedEvidenceCount}
                    lastEvidenceAt={lastEvidenceAt}
                    onOpenThread={handleOpenThread}
                  />
                </section>

                <section id="knowledge-notes" className="scroll-mt-24">
                  <HumanNotesPanel
                    annotations={annotations}
                    annotationLoading={annotationLoading}
                    annotationBody={annotationBody}
                    canWrite={canWrite}
                    saving={saving}
                    onAnnotationBodyChange={setAnnotationBody}
                    onCreateAnnotation={handleCreateAnnotation}
                  />
                </section>

                <section id="knowledge-history" className="scroll-mt-24">
                  <EntityHistoryPanel entityId={selectedEntityId} />
                </section>
            </div>
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
