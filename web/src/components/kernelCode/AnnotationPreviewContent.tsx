import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, Maximize2, MessageSquareText, PanelRightOpen } from 'lucide-react';
import type { CodeAnnotation } from '../../api/types';
import EmailTagEditor from '../EmailTagEditor';
import { formatAnnotationPreviewLineRange } from './annotationPreview';

interface AnnotationPreviewContentProps {
  annotation: CodeAnnotation | null;
  replies?: CodeAnnotation[];
  compact?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onOpenFullPreview?: () => void;
  onOpenInAtlas?: () => void;
  onOpenDetail?: () => void;
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusClass(status: CodeAnnotation['publish_status']): string {
  if (status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'pending') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'rejected') return 'border-rose-200 bg-rose-50 text-rose-800';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-medium text-slate-900">{value}</div>
    </div>
  );
}

export default function AnnotationPreviewContent({
  annotation,
  replies = [],
  compact = false,
  emptyTitle = 'Annotation not found',
  emptyDescription = 'This annotation may have been deleted or moved out of the current file.',
  onOpenFullPreview,
  onOpenInAtlas,
  onOpenDetail,
}: AnnotationPreviewContentProps) {
  if (!annotation) {
    return (
      <div className="flex h-full min-h-[18rem] flex-col justify-center px-4 py-6 text-sm text-slate-600">
        <div className="text-sm font-semibold text-slate-950">{emptyTitle}</div>
        <p className="mt-2 leading-6">{emptyDescription}</p>
        {onOpenInAtlas ? (
          <button
            type="button"
            onClick={onOpenInAtlas}
            className="mt-4 inline-flex w-fit items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            Open in Atlas
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    );
  }

  const lineRange = formatAnnotationPreviewLineRange(annotation);
  const recentReplies = compact ? replies.slice(0, 3) : replies;

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                {lineRange}
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(annotation.publish_status)}`}>
                {annotation.publish_status}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                {annotation.visibility}
              </span>
            </div>
            <div className="mt-2 truncate text-sm font-semibold text-slate-950">
              {annotation.target_label || `${annotation.file_path}:${lineRange}`}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-slate-500">
              {annotation.file_path}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1" data-no-annotation-select>
            {onOpenFullPreview ? (
              <button
                type="button"
                onClick={onOpenFullPreview}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-400"
                aria-label="Open full annotation preview"
                title="Open full annotation preview"
              >
                <PanelRightOpen className="h-4 w-4" />
              </button>
            ) : null}
            {onOpenInAtlas ? (
              <button
                type="button"
                onClick={onOpenInAtlas}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-400"
                aria-label="Open annotation in Atlas"
                title="Open annotation in Atlas"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            ) : null}
            {onOpenDetail ? (
              <button
                type="button"
                onClick={onOpenDetail}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-400"
                aria-label="Open annotation detail"
                title="Open annotation detail"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-3 border-b border-slate-200 pb-4">
          <MetaItem label="Author" value={annotation.author || 'Unknown'} />
          <MetaItem label="Updated" value={formatDateTime(annotation.updated_at || annotation.created_at)} />
          <MetaItem label="Created" value={formatDateTime(annotation.created_at)} />
          <MetaItem label="Replies" value={String(replies.length)} />
        </div>

        <section className="border-b border-slate-200 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Annotation
          </div>
          <div className="markdown-content mt-3 text-sm leading-6 text-slate-900">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{annotation.body}</ReactMarkdown>
          </div>
          {annotation.publish_review_comment ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700">
              Review note: {annotation.publish_review_comment}
            </div>
          ) : null}
        </section>

        <section className="border-b border-slate-200 py-4" data-no-annotation-select>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Tags
          </div>
          <div className="mt-2">
            <EmailTagEditor targetType="annotation" targetRef={annotation.annotation_id} compact />
          </div>
        </section>

        <section className="py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Recent replies
            </div>
            <div className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <MessageSquareText className="h-3.5 w-3.5" />
              {replies.length}
            </div>
          </div>
          {recentReplies.length > 0 ? (
            <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
              {recentReplies.map((reply) => (
                <div key={reply.annotation_id} className="py-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-700">{reply.author || 'Unknown'}</span>
                    <span>{formatAnnotationPreviewLineRange(reply)}</span>
                    <span>{formatDateTime(reply.updated_at || reply.created_at)}</span>
                  </div>
                  <div className="markdown-content text-xs leading-5 text-slate-800">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply.body}</ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-xs text-slate-500">
              No replies yet.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
