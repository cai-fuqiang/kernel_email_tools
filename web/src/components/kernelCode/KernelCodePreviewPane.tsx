import { useEffect, useMemo, useRef, type ReactNode } from 'react';

const C_KEYWORDS = new Set([
  'asm', 'auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else', 'enum',
  'extern', 'for', 'goto', 'if', 'inline', 'register', 'restrict', 'return', 'sizeof',
  'static', 'struct', 'switch', 'typedef', 'union', 'volatile', 'while',
]);

const C_TYPES = new Set([
  'bool', 'char', 'double', 'float', 'int', 'long', 'short', 'signed', 'unsigned', 'void',
  'u8', 'u16', 'u32', 'u64', 's8', 's16', 's32', 's64', 'size_t', 'ssize_t',
]);

export interface CodeHighlightRange {
  start: number;
  end: number;
}

interface KernelCodePreviewPaneProps {
  lines: string[];
  loading?: boolean;
  error?: string | null;
  highlightRange?: CodeHighlightRange | null;
  initialLine?: number | null;
  zoom?: number;
  theme?: 'light' | 'dark';
  className?: string;
  emptyMessage?: string;
}

function highlightedTokenClass(token: string, theme: 'light' | 'dark'): string {
  const dark = theme === 'dark';
  if (token.startsWith('//') || token.startsWith('/*')) return dark ? 'text-emerald-300' : 'text-emerald-700';
  if (token.startsWith('"') || token.startsWith("'")) return dark ? 'text-amber-300' : 'text-amber-700';
  if (/^(?:0x[\da-fA-F]+|\d)/.test(token)) return dark ? 'text-violet-300' : 'text-violet-700';
  if (C_KEYWORDS.has(token)) return dark ? 'font-medium text-sky-300' : 'font-medium text-sky-700';
  if (C_TYPES.has(token)) return dark ? 'font-medium text-indigo-300' : 'font-medium text-indigo-700';
  if (/^[A-Z][A-Z0-9_]+$/.test(token) && token.length > 1) return dark ? 'text-fuchsia-300' : 'text-fuchsia-700';
  return '';
}

function renderHighlightedLine(line: string, theme: 'light' | 'dark'): ReactNode {
  if (!line) return '\u00a0';
  if (line.trimStart().startsWith('#')) {
    return <span className={theme === 'dark' ? 'text-fuchsia-300' : 'text-fuchsia-700'}>{line}</span>;
  }
  const tokenPattern = /(\/\/.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b0x[\da-fA-F]+[uUlL]*\b|\b\d+(?:\.\d+)?[uUlLfF]*\b|\b[A-Za-z_]\w*\b)/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(line.slice(lastIndex, index));
    const className = highlightedTokenClass(token, theme);
    parts.push(className ? <span key={`${index}-${token}`} className={className}>{token}</span> : token);
    lastIndex = index + token.length;
  }
  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  return parts;
}

export default function KernelCodePreviewPane({
  lines,
  loading = false,
  error = null,
  highlightRange = null,
  initialLine = null,
  zoom = 1,
  theme = 'light',
  className = '',
  emptyMessage = 'No code loaded.',
}: KernelCodePreviewPaneProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const targetLine = initialLine || highlightRange?.start || null;
  const zoomStyle = useMemo(
    () => ({ fontSize: `${Math.round(12 * zoom)}px`, lineHeight: 1.5 }),
    [zoom],
  );

  useEffect(() => {
    if (!lines.length || !targetLine) return undefined;
    const lineNum = Math.max(1, targetLine);
    let raf2: number | null = null;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const container = scrollRef.current;
        const target = container?.querySelector<HTMLElement>(`[data-line-num="${lineNum}"]`);
        target?.scrollIntoView({ block: 'center' });
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      if (raf2 !== null) window.cancelAnimationFrame(raf2);
    };
  }, [lines.length, targetLine]);

  const dark = theme === 'dark';
  const containerClass = dark
    ? 'bg-slate-950/95 text-slate-100'
    : 'bg-white text-slate-950';
  const frameClass = dark
    ? 'border-slate-800 bg-slate-900/80'
    : 'border-slate-200 bg-white';
  const rowClass = dark
    ? 'border-slate-800/80 hover:bg-slate-800/60'
    : 'border-slate-200 hover:bg-slate-50';
  const lineClass = dark
    ? 'border-slate-800/80 text-slate-500'
    : 'border-slate-200 text-slate-600';
  const highlightClass = dark ? 'bg-amber-400/20' : 'bg-amber-300/25';

  return (
    <div
      ref={scrollRef}
      className={`h-full min-h-0 overflow-auto overscroll-contain p-3 ${containerClass} ${className}`}
      style={{ scrollbarGutter: 'stable' }}
    >
      {loading ? (
        <div className={dark ? 'text-sm text-slate-300' : 'text-sm text-slate-700'}>
          Loading preview...
        </div>
      ) : error ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          dark
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
            : 'border-rose-300 bg-rose-50 text-rose-800'
        }`}
        >
          {error}
        </div>
      ) : lines.length > 0 ? (
        <div className={`inline-block min-w-max rounded-xl border shadow-lg ${frameClass}`}>
          {lines.map((lineText, index) => {
            const lineNum = index + 1;
            const isHighlighted =
              !!highlightRange &&
              highlightRange.start > 0 &&
              lineNum >= highlightRange.start &&
              lineNum <= Math.max(highlightRange.start, highlightRange.end);
            return (
              <div
                key={lineNum}
                data-line-num={lineNum}
                data-highlighted={isHighlighted ? 'true' : undefined}
                className={`grid min-w-max grid-cols-[4.75rem_minmax(0,1fr)] border-b ${isHighlighted ? highlightClass : rowClass}`}
                style={zoomStyle}
              >
                <div className={`select-none border-r px-3 py-1.5 text-right font-mono ${lineClass}`}>
                  {lineNum}
                </div>
                <pre className="overflow-x-auto px-3 py-1.5 font-mono">
                  {renderHighlightedLine(lineText, theme)}
                </pre>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={dark ? 'text-sm text-slate-300' : 'text-sm text-slate-700'}>
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
