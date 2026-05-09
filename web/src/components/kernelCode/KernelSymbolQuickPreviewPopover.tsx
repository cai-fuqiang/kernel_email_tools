import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { getKernelFile } from '../../api/client';
import type { KernelSymbolCandidateResponse } from '../../api/types';
import { showToast } from '../Toast';
import { localKernelCodeUrl } from '../../utils/externalLinks';

interface KernelSymbolQuickPreviewPopoverProps {
  isOpen: boolean;
  candidate: KernelSymbolCandidateResponse | null;
  symbol?: string;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onOpenLarge: () => void;
}

const C_KEYWORDS = new Set([
  'asm', 'auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else', 'enum',
  'extern', 'for', 'goto', 'if', 'inline', 'register', 'restrict', 'return', 'sizeof',
  'static', 'struct', 'switch', 'typedef', 'union', 'volatile', 'while',
]);

const C_TYPES = new Set([
  'bool', 'char', 'double', 'float', 'int', 'long', 'short', 'signed', 'unsigned', 'void',
  'u8', 'u16', 'u32', 'u64', 's8', 's16', 's32', 's64', 'size_t', 'ssize_t',
]);

function highlightedTokenClass(token: string): string {
  if (token.startsWith('//') || token.startsWith('/*')) return 'text-emerald-300';
  if (token.startsWith('"') || token.startsWith("'")) return 'text-amber-300';
  if (/^(?:0x[\da-fA-F]+|\d)/.test(token)) return 'text-violet-300';
  if (C_KEYWORDS.has(token)) return 'font-medium text-sky-300';
  if (C_TYPES.has(token)) return 'font-medium text-indigo-300';
  if (/^[A-Z][A-Z0-9_]+$/.test(token) && token.length > 1) return 'text-fuchsia-300';
  return '';
}

function renderHighlightedLine(line: string): ReactNode {
  if (!line) return '\u00a0';
  if (line.trimStart().startsWith('#')) {
    return <span className="text-fuchsia-300">{line}</span>;
  }
  const tokenPattern = /(\/\/.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b0x[\da-fA-F]+[uUlL]*\b|\b\d+(?:\.\d+)?[uUlLfF]*\b|\b[A-Za-z_]\w*\b)/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(line.slice(lastIndex, index));
    const className = highlightedTokenClass(token);
    parts.push(className ? <span key={`${index}-${token}`} className={className}>{token}</span> : token);
    lastIndex = index + token.length;
  }
  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  return parts;
}

function clampZoom(value: number): number {
  return Math.min(1.8, Math.max(0.9, value));
}

export default function KernelSymbolQuickPreviewPopover({
  isOpen,
  candidate,
  symbol,
  anchorRect,
  onClose,
  onOpenLarge,
}: KernelSymbolQuickPreviewPopoverProps) {
  const [fileLines, setFileLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!isOpen || !candidate) return;

    setZoom(1);
    setError(null);

    if (!candidate.local_file_available) {
      setFileLines([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    getKernelFile(candidate.version, candidate.path)
      .then((file) => {
        if (cancelled) return;
        setFileLines(file.content.split('\n'));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load preview';
        setError(message);
        setFileLines([]);
        showToast(message, 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [candidate, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setFileLines([]);
      setLoading(false);
      setError(null);
      setZoom(1);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    function onMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-symbol-quick-preview]')) return;
      onClose();
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [isOpen, onClose]);

  const previewWindow = useMemo(() => {
    if (!candidate || fileLines.length === 0) return null;
    const focusLine = Math.max(1, candidate.line);
    const context = 8;
    return {
      focusLine,
      startLine: Math.max(1, focusLine - context),
      endLine: Math.min(fileLines.length, focusLine + context),
    };
  }, [candidate, fileLines.length]);

  if (!isOpen || !candidate || !anchorRect) return null;

  const left = Math.min(
    Math.max(12, anchorRect.right + 12),
    window.innerWidth - 420,
  );
  const top = Math.min(
    Math.max(12, anchorRect.top - 12),
    window.innerHeight - 320,
  );
  const zoomStyle = { fontSize: `${Math.round(12 * zoom)}px`, lineHeight: 1.45 };

  return (
    <div
      data-symbol-quick-preview
      className="fixed z-50 w-[390px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15"
      style={{ left, top }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Quick Preview
          </div>
          <div className="mt-1 truncate text-xs font-mono text-slate-700">
            {candidate.path}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close preview"
          title="Close preview"
        >
          ×
        </button>
      </div>

      <div className="border-b border-slate-200 px-3 py-2 text-[11px] text-slate-500">
        {symbol ? <span className="mr-2 rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">{symbol}</span> : null}
        <span className="mr-2">v{candidate.version}</span>
        <span>L{candidate.line}</span>
      </div>

      <div className="max-h-[260px] overflow-auto bg-slate-950/95 p-3">
        {!candidate.local_file_available ? (
          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-3 text-sm leading-6 text-slate-200">
            <div>This candidate is external only, so the preview falls back to upstream.</div>
            <a
              href={candidate.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
            >
              Open upstream source
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : loading ? (
          <div className="text-sm text-slate-300">Loading preview...</div>
        ) : error ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : previewWindow ? (
          <div className="inline-block min-w-max rounded-lg border border-slate-800 bg-slate-900/80">
            {fileLines
              .slice(previewWindow.startLine - 1, previewWindow.endLine)
              .map((lineText, index) => {
                const lineNum = previewWindow.startLine + index;
                const isTarget = lineNum === previewWindow.focusLine;
                return (
                  <div
                    key={lineNum}
                    className={`grid min-w-max grid-cols-[3.75rem_minmax(0,1fr)] border-b border-slate-800/80 ${
                      isTarget ? 'bg-amber-400/15' : 'hover:bg-slate-800/60'
                    }`}
                    style={zoomStyle}
                  >
                    <div className="select-none border-r border-slate-800/80 px-2 py-1.5 text-right font-mono text-slate-500">
                      {lineNum}
                    </div>
                    <pre className="overflow-x-auto px-2 py-1.5 font-mono text-slate-100">
                      {renderHighlightedLine(lineText)}
                    </pre>
                  </div>
                );
              })}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setZoom((value) => clampZoom(value - 0.1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="inline-flex h-7 min-w-12 items-center justify-center rounded-md px-2 text-[11px] font-medium text-slate-600 transition hover:bg-white hover:text-slate-900"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => clampZoom(value + 0.1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900"
          >
            +
          </button>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={localKernelCodeUrl(candidate.version, candidate.path, candidate.line)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Jump
          </a>
          <button
            type="button"
            onClick={onOpenLarge}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-800"
          >
            Open big preview
          </button>
        </div>
      </div>
    </div>
  );
}
