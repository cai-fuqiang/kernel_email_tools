import type { KnowledgeEntity } from '../../api/types';

interface EntityExplanationEditorProps {
  selectedEntity: KnowledgeEntity;
  canWrite: boolean;
  saving: boolean;
  onSave: () => void;
  onUpdateSummary: (value: string) => void;
  onUpdateDescription: (value: string) => void;
  variant?: 'panel' | 'document';
}

export default function EntityExplanationEditor({
  selectedEntity,
  canWrite,
  saving,
  onSave,
  onUpdateSummary,
  onUpdateDescription,
  variant = 'panel',
}: EntityExplanationEditorProps) {
  if (variant === 'document') {
    return (
      <section className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Summary</h2>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                The reusable short answer for future Ask responses.
              </p>
            </div>
            <button
              type="button"
              onClick={onSave}
              disabled={!canWrite || saving}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <textarea
            value={selectedEntity.summary}
            onChange={(event) => onUpdateSummary(event.target.value)}
            placeholder="A reusable one-paragraph explanation."
            className="mt-4 min-h-[132px] w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-base leading-7 text-slate-900 outline-none transition focus:border-slate-500 focus:bg-white focus-visible:ring-2 focus-visible:ring-slate-200"
            disabled={!canWrite}
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Explanation</h2>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Background, tradeoffs, timelines, and caveats that should survive one Ask session.
            </p>
          </div>
          <textarea
            value={selectedEntity.description}
            onChange={(event) => onUpdateDescription(event.target.value)}
            placeholder="Add background, tradeoffs, timelines, and caveats."
            className="mt-4 min-h-[360px] w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-base leading-7 text-slate-900 outline-none transition focus:border-slate-500 focus:bg-white focus-visible:ring-2 focus-visible:ring-slate-200"
            disabled={!canWrite}
          />
        </div>
      </section>
    );
  }

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
