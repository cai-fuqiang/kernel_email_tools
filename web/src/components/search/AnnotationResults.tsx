import type { AnnotationListItem } from '../../api/types';
import AnnotationIdBadge from '../AnnotationIdBadge';
import { showToast } from '../Toast';

interface AnnotationResultsProps {
  annotationResults: AnnotationListItem[];
  annotationTotal: number;
  onOpenAnnotation: (threadId: string, annotationId: string) => void;
}

export default function AnnotationResults({
  annotationResults,
  annotationTotal,
  onOpenAnnotation,
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
            className="block w-full rounded-lg border border-purple-200 bg-purple-50/50 p-4 text-left transition hover:bg-purple-50 focus:outline-none focus:ring-2 focus:ring-purple-300"
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
