import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getKernelFile } from '../api/client';
import type { KernelFileResponse } from '../api/types';
import { PageShell, SectionPanel, SecondaryButton, StatusBadge } from '../components/ui';
import {
  kernelCodePath,
  localKernelCodeUrl,
  pickKernelSourceUrl,
  elixirIdentUrl,
} from '../utils/externalLinks';
import { detectNearestSymbol } from '../utils/kernelSymbols';

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

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function clampZoom(value: number): number {
  return Math.min(2.25, Math.max(0.75, value));
}

export default function KernelSymbolPreviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const version = searchParams.get('v') || '';
  const path = searchParams.get('path') || '';
  const line = parseInt(searchParams.get('line') || '0', 10) || 1;
  const symbol = searchParams.get('symbol') || '';

  const [file, setFile] = useState<KernelFileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const codeScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!version || !path) {
      setFile(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getKernelFile(version, path)
      .then((res) => {
        if (!cancelled) setFile(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load code';
        setFile(null);
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const codeLines = useMemo(() => (file ? file.content.split('\n') : []), [file]);

  const containingSymbol = useMemo(
    () => detectNearestSymbol(codeLines, line),
    [codeLines, line],
  );

  useEffect(() => {
    if (!codeLines.length) return;
    const lineNum = Math.max(1, line);
    const raf = window.requestAnimationFrame(() => {
      const container = codeScrollRef.current;
      const target = container?.querySelector<HTMLElement>(`[data-line-num="${lineNum}"]`);
      target?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [codeLines.length, line]);

  const sourceLink = useMemo(
    () => pickKernelSourceUrl(version || 'latest', path, line),
    [line, path, version],
  );
  const symbolSearchUrl = symbol ? elixirIdentUrl(version || 'latest', symbol) : sourceLink.url;

  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const zoomStyle = { fontSize: `${Math.round(12 * zoom)}px`, lineHeight: 1.55 };

  const openAtlasPath = kernelCodePath(version || 'latest', path, line);
  const openAtlasHref = localKernelCodeUrl(version || 'latest', path, line);

  return (
    <PageShell wide className="bg-slate-100 px-3 py-3 md:px-4">
      <SectionPanel className="overflow-hidden border-slate-200/90 bg-white p-0 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(openAtlasPath)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Atlas
                </button>
                <div className="text-sm font-semibold text-slate-950">Symbol Preview</div>
                <StatusBadge tone="muted">{version || 'No version'}</StatusBadge>
                <StatusBadge tone="info">{`L${line}`}</StatusBadge>
                {symbol ? <StatusBadge tone="success">{symbol}</StatusBadge> : null}
                {containingSymbol ? <StatusBadge tone="warning">{`in ${containingSymbol}`}</StatusBadge> : null}
              </div>
              <div className="mt-2 truncate text-xs text-slate-500">{path || 'No path selected'}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setZoom((value) => clampZoom(value - 0.1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Zoom out"
                  title="Zoom out"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  className="inline-flex h-8 min-w-14 items-center justify-center rounded-md px-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Reset zoom"
                  title="Reset zoom"
                >
                  {zoomLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((value) => clampZoom(value + 0.1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  +
                </button>
              </div>
              <SecondaryButton
                className="px-3 py-2"
                onClick={() => navigate(openAtlasPath)}
              >
                Open in Atlas
              </SecondaryButton>
            </div>
          </div>
        </div>

        <div className="grid min-h-[calc(100vh-10.5rem)] gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-h-0 border-b border-slate-200 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                Code context
              </div>
              <div className="text-xs text-slate-500">
                {loading ? 'Loading...' : `L${line} • full file`}
              </div>
            </div>

            <div ref={codeScrollRef} className="h-full min-h-0 overflow-auto overscroll-contain bg-slate-950/95 p-4">
              {!version || !path ? (
                <div className="flex h-full items-center justify-center">
                  <div className="max-w-md rounded-xl border border-slate-700 bg-slate-900/80 px-5 py-4 text-sm leading-6 text-slate-200">
                    Missing version or file path. Open a symbol from the code browser to get a shareable preview link.
                  </div>
                </div>
              ) : loading ? (
                <div className="text-sm text-slate-300">Loading preview...</div>
              ) : error ? (
                <div className="flex h-full items-center justify-center">
                  <div className="max-w-lg space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm leading-6 text-rose-200">
                    <div>{error}</div>
                    <div className="text-rose-100/80">
                      The preview page can still open the external source:
                    </div>
                    <a
                      href={sourceLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-200/30 bg-white/5 px-3 py-2 text-sm font-medium text-rose-100 transition hover:bg-white/10"
                    >
                      Open upstream source
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              ) : codeLines.length ? (
                <div className="inline-block min-w-max rounded-xl border border-slate-800 bg-slate-900/80 shadow-lg">
                  {codeLines.map((lineText, index) => {
                    const lineNum = index + 1;
                    const isTarget = lineNum === line;
                    return (
                      <div
                        key={lineNum}
                        data-line-num={lineNum}
                        className={`grid min-w-max grid-cols-[4.75rem_minmax(0,1fr)] border-b border-slate-800/80 ${
                          isTarget ? 'bg-amber-400/15' : 'hover:bg-slate-800/60'
                        }`}
                        style={zoomStyle}
                      >
                        <div className="select-none border-r border-slate-800/80 px-3 py-1.5 text-right font-mono text-slate-500">
                          {lineNum}
                        </div>
                        <pre className="overflow-x-auto px-3 py-1.5 font-mono text-slate-100">
                          {renderHighlightedLine(lineText)}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <aside className="min-h-0 overflow-y-auto bg-slate-50/80 px-4 py-4">
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Jump target
                </div>
                <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <div className="break-words text-sm font-semibold text-slate-950">
                    {path}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    line {line}
                  </div>
                  {containingSymbol ? (
                    <div className="mt-2 text-xs text-slate-600">
                      Containing symbol: <span className="font-semibold text-slate-900">{containingSymbol}</span>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-slate-500">
                      Containing symbol could not be inferred.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Actions
                </div>
                <div className="mt-2 space-y-2">
                  <a
                    href={openAtlasHref}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    Open jump location
                  </a>
                  <a
                    href={sourceLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Open upstream source
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  {symbol ? (
                    <a
                      href={symbolSearchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Open symbol search
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  File info
                </div>
                <div className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                  <div>Version: {version || '—'}</div>
                  <div>Path: {path || '—'}</div>
                  <div>{file ? `${file.line_count.toLocaleString()} lines` : 'No file loaded'}</div>
                  {file ? <div>{formatBytes(file.size)}</div> : null}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </SectionPanel>
    </PageShell>
  );
}
