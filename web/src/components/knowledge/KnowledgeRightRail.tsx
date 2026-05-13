import { useRef } from 'react';
import { Clock3, FileClock, Search, ShieldCheck } from 'lucide-react';
import type { KnowledgeDraft, KnowledgeEntity, KnowledgeStats } from '../../api/types';
import { PrimaryButton } from '../ui';
import type { NewEntityForm } from './EntityListPanel';
import type { SupportPanelId, SupportPanelItem } from './knowledgeLayout';
import {
  ENTITY_TYPES,
  evidenceCount,
  formatDate,
  readableType,
  statusTone,
} from './knowledgeUtils';

interface KnowledgeRightRailProps {
  entities: KnowledgeEntity[];
  selectedEntity: KnowledgeEntity | null;
  selectedEntityId: string;
  stats: KnowledgeStats | null;
  query: string;
  searchMode: 'simple' | 'fulltext';
  loading: boolean;
  total: number;
  canWrite: boolean;
  showCreate: boolean;
  newEntity: NewEntityForm;
  saving: boolean;
  drafts: KnowledgeDraft[];
  draftLoading: boolean;
  supportItems: SupportPanelItem[];
  onQueryChange: (value: string) => void;
  onSearchModeChange: (mode: 'simple' | 'fulltext') => void;
  onSearch: () => void;
  onSelectEntity: (entityId: string) => void;
  onLoadMore: () => void;
  onToggleCreate: () => void;
  onNewEntityChange: (value: NewEntityForm) => void;
  onCreateEntity: () => void;
  onOpenSupportPanel: (panel: SupportPanelId) => void;
  onOpenDraftQueue: () => void;
  isAdmin?: boolean;
  onExport?: () => void;
  onImport?: (file: File) => void;
}

export default function KnowledgeRightRail({
  entities,
  selectedEntity,
  selectedEntityId,
  stats,
  query,
  searchMode,
  loading,
  total,
  canWrite,
  showCreate,
  newEntity,
  saving,
  drafts,
  draftLoading,
  supportItems,
  onQueryChange,
  onSearchModeChange,
  onSearch,
  onSelectEntity,
  onLoadMore,
  onToggleCreate,
  onNewEntityChange,
  onCreateEntity,
  onOpenSupportPanel,
  onOpenDraftQueue,
  isAdmin,
  onExport,
  onImport,
}: KnowledgeRightRailProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-slate-200 bg-white xl:w-[340px]">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && onSearch()}
            placeholder="Find knowledge..."
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus-visible:ring-2 focus-visible:ring-slate-200"
          />
          <PrimaryButton type="button" onClick={onSearch} className="px-3">
            Search
          </PrimaryButton>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
          <button
            type="button"
            onClick={() => onSearchModeChange('simple')}
            className={`rounded-full border px-2 py-0.5 transition ${
              searchMode !== 'fulltext'
                ? 'border-slate-400 bg-slate-100 text-slate-800'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Simple
          </button>
          <button
            type="button"
            onClick={() => onSearchModeChange('fulltext')}
            className={`rounded-full border px-2 py-0.5 transition ${
              searchMode === 'fulltext'
                ? 'border-sky-400 bg-sky-50 text-sky-700'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Full-text
          </button>
          <span className="ml-auto text-[10px] font-medium text-slate-600">
            {entities.length} / {total}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase text-slate-700">Entities</h2>
            {stats && (
              <span className="text-[11px] font-medium text-slate-600">{stats.total_entities} total</span>
            )}
          </div>
          <div className="space-y-2">
            {loading && <div className="text-sm text-slate-500">Loading knowledge...</div>}
            {!loading &&
              entities.map((entity) => {
                const selected = selectedEntityId === entity.entity_id;
                const count = evidenceCount(entity);
                return (
                  <button
                    key={entity.entity_id}
                    type="button"
                    onClick={() => onSelectEntity(entity.entity_id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                      selected
                        ? 'border-sky-300 bg-sky-50 text-slate-950 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="truncate text-sm font-semibold">{entity.canonical_name}</div>
                    <div
                      className={`mt-1 line-clamp-2 text-xs leading-5 ${
                        selected ? 'text-slate-700' : 'text-slate-600'
                      }`}
                    >
                      {entity.summary || 'No summary yet'}
                    </div>
                    <div
                      className={`mt-2 flex items-center justify-between text-[11px] ${
                        selected ? 'text-slate-600' : 'text-slate-600'
                      }`}
                    >
                      <span>{readableType(entity.entity_type)}</span>
                      <span>{count ? `${count} evidence` : formatDate(entity.updated_at)}</span>
                    </div>
                  </button>
                );
              })}
          </div>
          {entities.length < total && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loading}
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Load more
            </button>
          )}
        </section>

        {canWrite && (
          <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
            <button
              type="button"
              onClick={onToggleCreate}
              className="w-full text-left text-sm font-semibold text-slate-800"
            >
              {showCreate ? 'Hide quick capture' : 'Capture a new topic'}
            </button>
            {showCreate && (
              <div className="mt-3 space-y-2">
                <input
                  value={newEntity.canonical_name}
                  onChange={(event) =>
                    onNewEntityChange({ ...newEntity, canonical_name: event.target.value })
                  }
                  placeholder="Name"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
                <select
                  value={newEntity.entity_type}
                  onChange={(event) =>
                    onNewEntityChange({ ...newEntity, entity_type: event.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  {ENTITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {readableType(type)}
                    </option>
                  ))}
                </select>
                <textarea
                  value={newEntity.summary}
                  onChange={(event) =>
                    onNewEntityChange({ ...newEntity, summary: event.target.value })
                  }
                  placeholder="Short answer"
                  className="min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
                <PrimaryButton
                  type="button"
                  onClick={onCreateEntity}
                  disabled={saving || !newEntity.canonical_name.trim()}
                  className="w-full"
                >
                  Create draft
                </PrimaryButton>
              </div>
            )}
          </section>
        )}

        {isAdmin && (onExport || onImport) && (
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-semibold text-slate-950">Admin transfer</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {onExport && (
                <button
                  type="button"
                  onClick={onExport}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Export
                </button>
              )}
              {onImport && (
                <>
                  <button
                    type="button"
                    onClick={() => importInputRef.current?.click()}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Import
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onImport(file);
                      if (importInputRef.current) importInputRef.current.value = '';
                    }}
                  />
                </>
              )}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-amber-950">Draft queue</h2>
              <p className="mt-1 text-xs leading-5 text-amber-700">
                {draftLoading
                  ? 'Loading drafts...'
                  : `${drafts.length} item${drafts.length === 1 ? '' : 's'} awaiting review`}
              </p>
            </div>
            <FileClock className="h-4 w-4 text-amber-700" />
          </div>
          <button
            type="button"
            onClick={onOpenDraftQueue}
            className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            Review queue
          </button>
        </section>

        {selectedEntity && (
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-950">Entity meta</h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(
                  selectedEntity.status,
                )}`}
              >
                {selectedEntity.status}
              </span>
            </div>
            <div className="mt-3 space-y-2 text-xs font-medium text-slate-600">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>{readableType(selectedEntity.entity_type)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock3 className="h-3.5 w-3.5" />
                <span>Updated {formatDate(selectedEntity.updated_at)}</span>
              </div>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase text-slate-700">
            Support panels
          </h2>
          <div className="grid gap-2">
            {supportItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenSupportPanel(item.id)}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{item.label}</span>
                  <span className="block truncate text-xs text-slate-600">{item.description}</span>
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  {item.countLabel}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
