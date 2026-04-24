import { useState } from 'react';
import AnnotationMarkdown from './AnnotationMarkdown';
import AnnotationActions from './AnnotationActions';
import EmailTagEditor from './EmailTagEditor';

interface AnnotationCardProps {
  annotationId: string;
  annotationType: string;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  targetLabel: string;
  targetSubtitle: string;
  anchorLabel?: string;
  onEdit: (body: string) => void;
  onDelete: () => void;
  onReply: () => void;
  onJump?: () => void;
}

const TYPE_THEME: Record<string, { chip: string; panel: string; text: string }> = {
  email: {
    chip: 'bg-sky-100 text-sky-700 border border-sky-200',
    panel: 'bg-white/80 border border-sky-100',
    text: 'text-slate-700',
  },
  code: {
    chip: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
    panel: 'bg-white/80 border border-indigo-100',
    text: 'text-slate-700',
  },
};

export default function AnnotationCard({
  annotationId,
  annotationType,
  author,
  body,
  createdAt,
  updatedAt,
  targetLabel,
  targetSubtitle,
  anchorLabel,
  onEdit,
  onDelete,
  onReply,
  onJump,
}: AnnotationCardProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(body);
  const theme = TYPE_THEME[annotationType] || {
    chip: 'bg-amber-100 text-amber-700 border border-amber-200',
    panel: 'bg-white/80 border border-amber-100',
    text: 'text-slate-700',
  };

  return (
    <div className={`rounded-2xl ${theme.panel} p-4 shadow-sm backdrop-blur-sm`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${theme.chip}`}>
          {annotationType}
        </span>
        <span className="text-sm font-semibold text-slate-900">{targetLabel || 'Untitled target'}</span>
        {targetSubtitle && <span className="text-xs text-slate-500">{targetSubtitle}</span>}
        {anchorLabel && <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{anchorLabel}</span>}
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <span>{author}</span>
        <span>·</span>
        <span>{new Date(createdAt).toLocaleString('zh-CN')}</span>
        {updatedAt !== createdAt && (
          <>
            <span>·</span>
            <span>已编辑</span>
          </>
        )}
      </div>

      {editing ? (
        <div className="mt-4">
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="min-h-[96px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                const next = editBody.trim();
                if (!next) return;
                onEdit(next);
                setEditing(false);
              }}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            >
              保存
            </button>
            <button
              onClick={() => {
                setEditBody(body);
                setEditing(false);
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <AnnotationMarkdown body={body} className={`mt-4 text-sm leading-7 ${theme.text}`} />
          <div className="mt-3">
            <EmailTagEditor
              targetType="annotation"
              targetRef={annotationId}
              compact
            />
          </div>
          <AnnotationActions
            onEdit={() => setEditing(true)}
            onDelete={onDelete}
            onReply={onReply}
            onPreview={onJump ? (() => onJump()) : undefined}
            showReply
            showPreview={!!onJump}
            variant={annotationType === 'code' ? 'code' : 'email'}
          />
        </>
      )}
    </div>
  );
}
