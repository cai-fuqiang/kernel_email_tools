import type { AnnotationListItem } from '../../api/types';

interface AnnotationResultsProps {
  annotationResults: AnnotationListItem[];
  annotationTotal: number;
  onOpenThread: (threadId: string) => void;
}

export default function AnnotationResults({
  annotationResults,
  annotationTotal,
  onOpenThread,
}: AnnotationResultsProps) {
  if (annotationResults.length === 0) return null;

  return (
    <div className="mt-6 pt-4 border-t border-slate-200">
      <p className="text-sm text-slate-500 mb-3">
        批注匹配 <span className="font-semibold text-slate-900">{annotationTotal}</span> 条
      </p>
      <div className="space-y-2">
        {annotationResults.map((ann) => (
          <button
            key={ann.annotation_id}
            type="button"
            onClick={() => ann.thread_id && onOpenThread(ann.thread_id)}
            className="block w-full rounded-lg border border-purple-200 bg-purple-50/50 p-4 text-left hover:bg-purple-50 transition"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">
                批注
              </span>
              <span className="text-xs text-slate-500">{ann.author}</span>
              <span className="text-xs text-slate-400">
                {ann.created_at ? new Date(ann.created_at).toLocaleDateString() : ''}
              </span>
            </div>
            <div className="text-sm text-slate-700 line-clamp-3">{ann.body}</div>
            {ann.email_subject && (
              <div className="mt-1 text-[11px] text-slate-400 truncate">
                在: {ann.email_subject}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}