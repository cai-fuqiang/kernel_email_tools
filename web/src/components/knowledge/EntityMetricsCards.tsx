import type { KnowledgeEntity } from '../../api/types';
import { readableType } from './knowledgeUtils';

interface EntityMetricsCardsProps {
  selectedEntity: KnowledgeEntity;
  evidenceCount: number;
  annotationCount: number;
  relationCount: number;
  canWrite: boolean;
  onStatusChange: (value: string) => void;
}

export default function EntityMetricsCards({
  selectedEntity,
  evidenceCount,
  annotationCount,
  relationCount,
  canWrite,
  onStatusChange,
}: EntityMetricsCardsProps) {
  return (
    <section className="grid gap-3 md:grid-cols-5">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Sources</div>
        <div className="mt-2 text-2xl font-semibold text-gray-950">{evidenceCount}</div>
        <div className="mt-1 text-xs text-gray-500">linked emails or threads</div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Notes</div>
        <div className="mt-2 text-2xl font-semibold text-gray-950">{annotationCount}</div>
        <div className="mt-1 text-xs text-gray-500">human review comments</div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Relations</div>
        <div className="mt-2 text-2xl font-semibold text-gray-950">{relationCount}</div>
        <div className="mt-1 text-xs text-gray-500">linked knowledge items</div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Type</div>
        <div className="mt-2 text-sm font-semibold capitalize text-gray-950">
          {readableType(selectedEntity.entity_type)}
        </div>
        <div className="mt-1 text-xs text-gray-500">what this item represents</div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Review state
        </div>
        <select
          value={selectedEntity.status}
          onChange={(e) => onStatusChange(e.target.value)}
          disabled={!canWrite}
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="deprecated">deprecated</option>
        </select>
      </div>
    </section>
  );
}