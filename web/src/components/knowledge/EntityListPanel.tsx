import { Plus } from 'lucide-react';
import type { KnowledgeEntity, KnowledgeStats } from '../../api/types';
import { PrimaryButton, SecondaryButton } from '../ui';
import {
  ENTITY_TYPES,
  evidenceCount,
  formatDate,
  readableType,
  statusTone,
} from './knowledgeUtils';

export interface NewEntityForm {
  entity_type: string;
  canonical_name: string;
  aliases: string;
  summary: string;
  description: string;
}

interface EntityListPanelProps {
  entities: KnowledgeEntity[];
  selectedEntityId: string;
  loading: boolean;
  stats: KnowledgeStats | null;
  query: string;
  canWrite: boolean;
  showCreate: boolean;
  newEntity: NewEntityForm;
  saving: boolean;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onToggleCreate: () => void;
  onNewEntityChange: (value: NewEntityForm) => void;
  onCreateEntity: () => void;
  onSelectEntity: (entityId: string) => void;
}

export default function EntityListPanel({
  entities,
  selectedEntityId,
  loading,
  stats,
  query,
  canWrite,
  showCreate,
  newEntity,
  saving,
  onQueryChange,
  onSearch,
  onToggleCreate,
  onNewEntityChange,
  onCreateEntity,
  onSelectEntity,
}: EntityListPanelProps) {
  return (
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
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="Find concepts, subsystems, bugs..."
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
          />
          <PrimaryButton onClick={onSearch} className="px-3">
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
              onClick={onToggleCreate}
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
              onChange={(e) =>
                onNewEntityChange({ ...newEntity, canonical_name: e.target.value })
              }
              placeholder="Name, for example O(1) scheduler"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={newEntity.entity_type}
              onChange={(e) => onNewEntityChange({ ...newEntity, entity_type: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {readableType(type)}
                </option>
              ))}
            </select>
            <input
              value={newEntity.aliases}
              onChange={(e) => onNewEntityChange({ ...newEntity, aliases: e.target.value })}
              placeholder="Aliases, comma-separated"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
              value={newEntity.summary}
              onChange={(e) => onNewEntityChange({ ...newEntity, summary: e.target.value })}
              placeholder="One or two sentences that explain why this matters"
              className="min-h-[76px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              onClick={onCreateEntity}
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
                onClick={() => onSelectEntity(entity.entity_id)}
                className={`w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${
                  selected ? 'bg-slate-100' : 'bg-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-600">
                    {readableType(entity.entity_type)}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusTone(
                      entity.status,
                    )}`}
                  >
                    {entity.status}
                  </span>
                </div>
                <div className="mt-2 truncate text-sm font-semibold text-gray-950">
                  {entity.canonical_name}
                </div>
                {entity.summary ? (
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">
                    {entity.summary}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-gray-400">No summary yet</div>
                )}
                <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
                  <span>
                    {count ? `${count} source${count > 1 ? 's' : ''}` : 'No source evidence'}
                  </span>
                  <span>Updated {formatDate(entity.updated_at)}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}