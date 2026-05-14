import type { AnnotationListItem } from '../../api/types';
import AnnotationIdBadge from '../AnnotationIdBadge';
import { showToast } from '../Toast';

interface AnnotationResultsProps {
  annotationResults: AnnotationListItem[];
  annotationTotal: number;
  onOpenAnnotation: (threadId: string, annotationId: string) => void;
  exactIdCandidate?: string;
  exactIdHit?: string | null;
}

export default function AnnotationResults({
  annotationResults,
  annotationTotal,
  onOpenAnnotation,
  exactIdCandidate,
  exactIdHit,
}: AnnotationResultsProps) {
  if (annotationResults.length === 0) return null;

  async function copyAnnotationId(
    event: React.MouseEvent<HTMLButtonElement>,
    annotationId: string,
  ) {
    event.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(annotationId);
      } else {
        const input = document.createElement('input');
        input.value = annotationId;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      showToast('Annotation ID copied', 'success');
    } catch {
      showToast('Failed to copy annotation ID', 'error');
    }
  }

  return (
    <div className="mt-6 pt-4 border-t border-slate-200">
      <p className="text-sm text-slate-500 mb-3">
        批注匹配 <span className="font-semibold text-slate-900">{annotationTotal}</span> 条
      </p>
      {exactIdCandidate ? (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
          exactIdHit
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}>
          Exact ID mode: <span className="font-mono font-semibold">{exactIdCandidate}</span>
          {' · '}
          {exactIdHit ? 'exact match promoted to top' : 'no exact match in current annotation result page'}
        </div>
      ) : null}
      <div className="space-y-2">
        {annotationResults.map((ann) => (
          <div
            key={ann.annotation_id}
            role="button"
            tabIndex={ann.thread_id ? 0 : -1}
            onClick={() => ann.thread_id && onOpenAnnotation(ann.thread_id, ann.annotation_id)}
            onKeyDown={(event) => {
              if (!ann.thread_id) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpenAnnotation(ann.thread_id, ann.annotation_id);
              }
            }}
            className={`block w-full rounded-lg p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-purple-300 ${
              ann.annotation_id === exactIdHit
                ? 'border border-emerald-300 bg-emerald-50/80 hover:bg-emerald-50'
                : 'border border-purple-200 bg-purple-50/50 hover:bg-purple-50'
            }`}
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                  批注
                </span>
                <span className="text-xs text-slate-500">{ann.author}</span>
                <span className="text-xs text-slate-400">
                  {ann.created_at ? new Date(ann.created_at).toLocaleDateString() : ''}
                </span>
                <AnnotationIdBadge
                  annotationId={ann.annotation_id}
                  compact
                  copyable={false}
                  className="bg-white/80"
                />
              </div>
              <button
                type="button"
                onClick={(event) => void copyAnnotationId(event, ann.annotation_id)}
                className="shrink-0 rounded-md border border-purple-200 bg-white px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-50"
              >
                Copy ID
              </button>
            </div>
            <div className="text-sm text-slate-700 line-clamp-3">{ann.body}</div>
            {ann.email_subject && (
              <div className="mt-1 text-[11px] text-slate-400 truncate">
                在: {ann.email_subject}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
