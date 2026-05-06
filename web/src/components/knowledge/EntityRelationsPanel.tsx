import { lazy, Suspense } from 'react';
import type {
  KnowledgeEntity,
  KnowledgeGraphResponse,
  KnowledgeRelation,
} from '../../api/types';
import { RELATION_TYPES, relationEntityName, relationLabel } from './knowledgeUtils';

// Lazy-load the graph view because cytoscape (~6 MB) is the heaviest dep on this page.
// Users only need it when they switch to graph mode.
const KnowledgeGraphView = lazy(() => import('../KnowledgeGraphView'));

export interface RelationForm {
  relation_type: string;
  target_entity_id: string;
  description: string;
}

export type ViewMode = 'list' | 'graph';

interface EntityRelationsPanelProps {
  selectedEntity: KnowledgeEntity;
  relations: { outgoing: KnowledgeRelation[]; incoming: KnowledgeRelation[] };
  relationLoading: boolean;
  relationCount: number;
  relationTargets: KnowledgeEntity[];
  relationDrafts: Record<string, string>;
  relationForm: RelationForm;
  viewMode: ViewMode;
  graphDepth: number;
  graphData: KnowledgeGraphResponse | null;
  graphLoading: boolean;
  canWrite: boolean;
  saving: boolean;
  onSetViewMode: (mode: ViewMode) => void;
  onSetGraphDepth: (depth: number) => void;
  onSelectEntity: (entityId: string) => void;
  onRelationFormChange: (value: RelationForm) => void;
  onCreateRelation: () => void;
  onRelationDraftChange: (relationId: string, value: string) => void;
  onSaveRelationDescription: (relation: KnowledgeRelation) => void;
  onDeleteRelation: (relationId: string) => void;
}

export default function EntityRelationsPanel({
  selectedEntity,
  relations,
  relationLoading,
  relationCount,
  relationTargets,
  relationDrafts,
  relationForm,
  viewMode,
  graphDepth,
  graphData,
  graphLoading,
  canWrite,
  saving,
  onSetViewMode,
  onSetGraphDepth,
  onSelectEntity,
  onRelationFormChange,
  onCreateRelation,
  onRelationDraftChange,
  onSaveRelationDescription,
  onDeleteRelation,
}: EntityRelationsPanelProps) {
  const renderRelationItem = (relation: KnowledgeRelation, isOutgoing: boolean) => {
    const targetId = isOutgoing ? relation.target_entity_id : relation.source_entity_id;
    const targetEntity = isOutgoing ? relation.target_entity : relation.source_entity;
    return (
      <div key={relation.relation_id} className="rounded-xl border border-gray-200 p-3">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => onSelectEntity(targetId)}
            className="min-w-0 text-left"
          >
            <div className="text-xs font-semibold uppercase text-indigo-600">
              {relationLabel(relation.relation_type)}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-gray-950">
              {relationEntityName(targetEntity, targetId)}
            </div>
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={() => onDeleteRelation(relation.relation_id)}
              className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
            >
              Delete
            </button>
          )}
        </div>
        <textarea
          value={relationDrafts[relation.relation_id] ?? relation.description}
          onChange={(e) => onRelationDraftChange(relation.relation_id, e.target.value)}
          disabled={!canWrite}
          placeholder="No relationship note yet."
          className="mt-2 min-h-[64px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
        />
        {canWrite && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => onSaveRelationDescription(relation)}
              disabled={saving}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Save note
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
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
              onClick={() => onSetViewMode('list')}
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
              onClick={() => onSetViewMode('graph')}
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
                onClick={() => onSetGraphDepth(d)}
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
                onClick={() => onSetViewMode('list')}
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
            <Suspense
              fallback={
                <div className="flex h-[520px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-500">
                  Loading graph view...
                </div>
              }
            >
              <KnowledgeGraphView
                nodes={graphData.nodes}
                edges={graphData.edges}
                centerEntityId={selectedEntity.entity_id}
                onNodeClick={(entityId) => onSelectEntity(entityId)}
              />
            </Suspense>
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
                  onChange={(e) =>
                    onRelationFormChange({ ...relationForm, relation_type: e.target.value })
                  }
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {RELATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {relationLabel(type)}
                    </option>
                  ))}
                </select>
                <select
                  value={relationForm.target_entity_id}
                  onChange={(e) =>
                    onRelationFormChange({ ...relationForm, target_entity_id: e.target.value })
                  }
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Choose related knowledge...</option>
                  {relationTargets.map((entity) => (
                    <option key={entity.entity_id} value={entity.entity_id}>
                      {entity.canonical_name} ({entity.entity_type.replace(/_/g, ' ')})
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={relationForm.description}
                onChange={(e) =>
                  onRelationFormChange({ ...relationForm, description: e.target.value })
                }
                placeholder="Explain the relationship, for example: CFS superseded the O(1) scheduler in the 2.6 era."
                className="mt-3 min-h-[72px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
              />
              <div className="mt-3 flex justify-end">
                <button
                  onClick={onCreateRelation}
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
                ) : (
                  relations.outgoing.map((relation) => renderRelationItem(relation, true))
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-gray-900">
                Other items pointing here
              </div>
              <div className="mt-2 space-y-2">
                {relations.incoming.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                    No incoming relations yet.
                  </div>
                ) : (
                  relations.incoming.map((relation) => renderRelationItem(relation, false))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}