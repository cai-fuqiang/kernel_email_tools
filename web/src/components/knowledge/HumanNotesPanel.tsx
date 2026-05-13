import type { AnnotationListItem } from '../../api/types';
import { formatDateTime } from './knowledgeUtils';

interface HumanNotesPanelProps {
  annotations: AnnotationListItem[];
  annotationLoading: boolean;
  annotationBody: string;
  canWrite: boolean;
  saving: boolean;
  onAnnotationBodyChange: (value: string) => void;
  onCreateAnnotation: () => void;
}

export default function HumanNotesPanel({
  annotations,
  annotationLoading,
  annotationBody,
  canWrite,
  saving,
  onAnnotationBodyChange,
  onCreateAnnotation,
}: HumanNotesPanelProps) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-950">Human notes</h2>
          <p className="text-sm text-gray-600">
            Corrections, review decisions, and follow-up questions linked to this item.
          </p>
        </div>
        <div className="text-sm font-medium text-gray-600">{annotations.length} items</div>
      </div>

      {canWrite && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <textarea
            value={annotationBody}
            onChange={(e) => onAnnotationBodyChange(e.target.value)}
            placeholder="Add a reviewer note, correction, or follow-up question..."
            className="min-h-[96px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
          />
          <div className="mt-3 flex justify-end">
            <button
              onClick={onCreateAnnotation}
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
          <div className="text-sm text-gray-600">Loading notes...</div>
        ) : annotations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600">
            No human notes yet.
          </div>
        ) : (
          annotations.map((annotation) => (
            <div
              key={annotation.annotation_id}
              className="rounded-xl border border-gray-200 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-gray-800">{annotation.author}</div>
                <div className="text-xs font-medium text-gray-600">
                  {formatDateTime(annotation.updated_at)}
                </div>
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                {annotation.body}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
