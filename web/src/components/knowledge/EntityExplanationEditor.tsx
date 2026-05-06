import type { KnowledgeEntity } from '../../api/types';

interface EntityExplanationEditorProps {
  selectedEntity: KnowledgeEntity;
  canWrite: boolean;
  saving: boolean;
  onSave: () => void;
  onUpdateSummary: (value: string) => void;
  onUpdateDescription: (value: string) => void;
}

export default function EntityExplanationEditor({
  selectedEntity,
  canWrite,
  saving,
  onSave,
  onUpdateSummary,
  onUpdateDescription,
}: EntityExplanationEditorProps) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-950">Explanation</h2>
          <p className="text-sm text-gray-500">
            Keep this concise enough to reuse in future Ask answers.
          </p>
        </div>
        <button
          onClick={onSave}
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
          onChange={(e) => onUpdateSummary(e.target.value)}
          placeholder="A reusable one-paragraph explanation."
          className="mt-2 min-h-[96px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
          disabled={!canWrite}
        />
      </div>
      <div className="mt-4">
        <label className="text-sm font-medium text-gray-700">Detailed note</label>
        <textarea
          value={selectedEntity.description}
          onChange={(e) => onUpdateDescription(e.target.value)}
          placeholder="Add background, tradeoffs, timelines, and caveats that should survive beyond one Ask session."
          className="mt-2 min-h-[210px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
          disabled={!canWrite}
        />
      </div>
    </section>
  );
}