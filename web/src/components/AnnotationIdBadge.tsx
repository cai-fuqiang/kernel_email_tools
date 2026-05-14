import { Copy } from 'lucide-react';

import { showToast } from './Toast';

interface AnnotationIdBadgeProps {
  annotationId: string;
  compact?: boolean;
  className?: string;
}

export default function AnnotationIdBadge({
  annotationId,
  compact = false,
  className = '',
}: AnnotationIdBadgeProps) {
  async function handleCopy() {
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
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 shadow-sm ${className}`.trim()}
    >
      <span className="uppercase tracking-[0.14em] text-slate-400">ID</span>
      <code className={`font-mono ${compact ? 'text-[11px]' : 'text-xs'} font-medium text-slate-900`}>
        {annotationId}
      </code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        aria-label={`Copy annotation ID ${annotationId}`}
        title="Copy annotation ID"
      >
        <Copy size={12} />
      </button>
    </div>
  );
}
