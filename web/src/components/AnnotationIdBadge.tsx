import { Copy, Link2 } from 'lucide-react';

import { showToast } from './Toast';
import { localAnnotationSearchUrl } from '../utils/externalLinks';

interface AnnotationIdBadgeProps {
  annotationId: string;
  compact?: boolean;
  className?: string;
  copyable?: boolean;
  showCopyLink?: boolean;
}

export default function AnnotationIdBadge({
  annotationId,
  compact = false,
  className = '',
  copyable = true,
  showCopyLink = false,
}: AnnotationIdBadgeProps) {
  async function copyValue(value: string, successText: string, errorText: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement('input');
        input.value = value;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      showToast(successText, 'success');
    } catch {
      showToast(errorText, 'error');
    }
  }

  async function handleCopyId() {
    await copyValue(
      annotationId,
      'Annotation ID copied',
      'Failed to copy annotation ID',
    );
  }

  async function handleCopyLink() {
    const url = `${window.location.origin}${localAnnotationSearchUrl(annotationId)}`;
    await copyValue(
      url,
      'Annotation link copied',
      'Failed to copy annotation link',
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 shadow-sm ${className}`.trim()}
    >
      <span className="uppercase tracking-[0.14em] text-slate-400">ID</span>
      <code className={`font-mono ${compact ? 'text-[11px]' : 'text-xs'} font-medium text-slate-900`}>
        {annotationId}
      </code>
      {copyable ? (
        <button
          type="button"
          onClick={() => void handleCopyId()}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          aria-label={`Copy annotation ID ${annotationId}`}
          title="Copy annotation ID"
        >
          <Copy size={12} />
        </button>
      ) : null}
      {showCopyLink ? (
        <button
          type="button"
          onClick={() => void handleCopyLink()}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          aria-label={`Copy annotation link ${annotationId}`}
          title="Copy annotation link"
        >
          <Link2 size={12} />
        </button>
      ) : null}
    </div>
  );
}
