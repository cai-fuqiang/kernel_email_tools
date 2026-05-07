import { useMemo, useState } from 'react';

export default function QuotedTextBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => text.split('\n').filter((line) => line.trim()), [text]);
  const preview = lines.slice(0, 2).join('\n').replace(/^\s*>+\s?/gm, '').trim();

  return (
    <div className="email-paragraph">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:bg-slate-100"
      >
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">
            {open ? 'Hide quoted text' : `Show quoted text (${lines.length} lines)`}
          </div>
          {!open && preview && (
            <div className="mt-1 truncate text-xs text-slate-400">{preview}</div>
          )}
        </div>
        <span className="shrink-0 text-sm text-slate-400">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <pre className="mt-2 whitespace-pre-wrap break-words border-l-4 border-slate-300 bg-white py-2 pl-3 text-sm italic leading-relaxed text-slate-500">
          {text}
        </pre>
      )}
    </div>
  );
}
