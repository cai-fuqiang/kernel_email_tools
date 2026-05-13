import type { KnowledgeEntity } from '../../api/types';
import { formatDateTime, readableType, statusTone } from './knowledgeUtils';

interface EntityDetailHeaderProps {
  selectedEntity: KnowledgeEntity;
  selectedAliases: string;
  canWrite: boolean;
  saving: boolean;
  relationTargets: KnowledgeEntity[];
  mergeTargetId: string;
  onMergeTargetChange: (value: string) => void;
  onMerge: () => void;
  onShowDelete: () => void;
  onUpdateName: (value: string) => void;
  onUpdateAliases: (value: string) => void;
}

export default function EntityDetailHeader({
  selectedEntity,
  selectedAliases,
  canWrite,
  saving,
  relationTargets,
  mergeTargetId,
  onMergeTargetChange,
  onMerge,
  onShowDelete,
  onUpdateName,
  onUpdateAliases,
}: EntityDetailHeaderProps) {
  const showActionsColumn = canWrite;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-700">
              {readableType(selectedEntity.entity_type)}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(
                selectedEntity.status,
              )}`}
            >
              {selectedEntity.status}
            </span>
            <span className="text-xs font-medium text-slate-600">
              Updated {formatDateTime(selectedEntity.updated_at)}
            </span>
          </div>
          <input
            value={selectedEntity.canonical_name}
            onChange={(e) => onUpdateName(e.target.value)}
            className="mt-3 w-full rounded-lg border border-transparent bg-transparent px-0 py-1 text-3xl font-semibold text-gray-950 outline-none focus:border-gray-300 focus:bg-white focus:px-3"
            disabled={!canWrite}
          />
          <input
            value={selectedAliases}
            onChange={(e) => onUpdateAliases(e.target.value)}
            placeholder="Add aliases that people may search for"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
            disabled={!canWrite}
          />
        </div>
        {showActionsColumn && (
          <div className="w-56 shrink-0">
            {relationTargets.length > 0 && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold text-gray-700">Merge this duplicate into</div>
                <select
                  value={mergeTargetId}
                  onChange={(e) => onMergeTargetChange(e.target.value)}
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
                  onClick={onMerge}
                  disabled={saving || !mergeTargetId}
                  className="mt-2 w-full rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  Merge into target
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onShowDelete}
              className="mt-3 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Delete entity
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

interface DeleteConfirmModalProps {
  entityName: string;
  relationCount: number;
  saving: boolean;
  onCancel: () => void;
  onDelete: (force: boolean) => void;
}

export function DeleteConfirmModal({
  entityName,
  relationCount,
  saving,
  onCancel,
  onDelete,
}: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-950">
          Delete &ldquo;{entityName}&rdquo;?
        </h3>
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
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          {relationCount > 0 && (
            <button
              type="button"
              onClick={() => onDelete(true)}
              disabled={saving}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Force delete (with relations)
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(false)}
            disabled={saving}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {relationCount > 0 ? 'Try delete' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
