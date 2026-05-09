import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink } from 'lucide-react';
import { getKernelFile } from '../../api/client';
import type { KernelSymbolCandidateResponse } from '../../api/types';
import { showToast } from '../Toast';
import { localKernelCodeUrl } from '../../utils/externalLinks';
import { detectNearestSymbol } from '../../utils/kernelSymbols';

interface KernelSymbolQuickPreviewPopoverProps {
  isOpen: boolean;
  candidate: KernelSymbolCandidateResponse | null;
  symbol?: string;
  anchorRect: DOMRect | null;
  avoidRect: DOMRect | null;
  onClose: () => void;
  onOpenPage: () => void;
}

type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Interaction =
  | { kind: 'drag'; startX: number; startY: number; startFrame: Frame }
  | { kind: 'resize'; startX: number; startY: number; startFrame: Frame };

const C_KEYWORDS = new Set([
  'asm', 'auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else', 'enum',
  'extern', 'for', 'goto', 'if', 'inline', 'register', 'restrict', 'return', 'sizeof',
  'static', 'struct', 'switch', 'typedef', 'union', 'volatile', 'while',
]);

const C_TYPES = new Set([
  'bool', 'char', 'double', 'float', 'int', 'long', 'short', 'signed', 'unsigned', 'void',
  'u8', 'u16', 'u32', 'u64', 's8', 's16', 's32', 's64', 'size_t', 'ssize_t',
]);

const DEFAULT_SIZE = { width: 720, height: 540 };
const MIN_SIZE = { width: 560, height: 380 };
const GAP = 14;
const VIEWPORT_MARGIN = 12;
const STORAGE_PREFIX = 'kernel-symbol-preview-window';

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
  return Math.min(2.4, Math.max(0.85, value));
}

function clampFrame(frame: Frame): Frame {
  const maxWidth = Math.max(240, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(200, window.innerHeight - VIEWPORT_MARGIN * 2);
  const width = Math.min(Math.max(frame.width, MIN_SIZE.width), maxWidth);
  const height = Math.min(Math.max(frame.height, MIN_SIZE.height), maxHeight);
  const x = Math.min(Math.max(frame.x, VIEWPORT_MARGIN), window.innerWidth - VIEWPORT_MARGIN - width);
  const y = Math.min(Math.max(frame.y, VIEWPORT_MARGIN), window.innerHeight - VIEWPORT_MARGIN - height);
  return { x, y, width, height };
}

function buildInitialFrame(anchorRect: DOMRect | null, avoidRect: DOMRect | null): Frame {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(DEFAULT_SIZE.width, viewportWidth - VIEWPORT_MARGIN * 2);
  const height = Math.min(DEFAULT_SIZE.height, viewportHeight - VIEWPORT_MARGIN * 2);
  const availableRight = avoidRect ? viewportWidth - avoidRect.right - GAP : 0;
  const availableLeft = avoidRect ? avoidRect.left - GAP : 0;
  const availableBelow = avoidRect ? viewportHeight - avoidRect.bottom - GAP : 0;
  const availableAbove = avoidRect ? avoidRect.top - GAP : 0;

  let x = VIEWPORT_MARGIN;
  let y = VIEWPORT_MARGIN;

  if (avoidRect && availableLeft >= width) {
    x = Math.max(VIEWPORT_MARGIN, avoidRect.left - GAP - width);
    y = Math.min(Math.max(VIEWPORT_MARGIN, avoidRect.top), viewportHeight - VIEWPORT_MARGIN - height);
  } else if (avoidRect && availableRight >= width) {
    x = Math.min(avoidRect.right + GAP, viewportWidth - VIEWPORT_MARGIN - width);
    y = Math.min(Math.max(VIEWPORT_MARGIN, avoidRect.top), viewportHeight - VIEWPORT_MARGIN - height);
  } else if (avoidRect && availableBelow >= height) {
    x = Math.min(Math.max(VIEWPORT_MARGIN, avoidRect.left), viewportWidth - VIEWPORT_MARGIN - width);
    y = Math.min(avoidRect.bottom + GAP, viewportHeight - VIEWPORT_MARGIN - height);
  } else if (avoidRect && availableAbove >= height) {
    x = Math.min(Math.max(VIEWPORT_MARGIN, avoidRect.left), viewportWidth - VIEWPORT_MARGIN - width);
    y = Math.max(VIEWPORT_MARGIN, avoidRect.top - GAP - height);
  } else if (anchorRect) {
    x = Math.min(Math.max(VIEWPORT_MARGIN, anchorRect.left + 18), viewportWidth - VIEWPORT_MARGIN - width);
    y = Math.min(Math.max(VIEWPORT_MARGIN, anchorRect.bottom + 12), viewportHeight - VIEWPORT_MARGIN - height);
  }

  return clampFrame({ x, y, width, height });
}

function frameKey(candidate: KernelSymbolCandidateResponse, symbol: string | undefined): string {
  return [STORAGE_PREFIX, candidate.version, candidate.path, candidate.line, symbol || ''].join(':');
}

export default function KernelSymbolQuickPreviewPopover({
  isOpen,
  candidate,
  symbol,
  anchorRect,
  avoidRect,
  onClose,
  onOpenPage,
}: KernelSymbolQuickPreviewPopoverProps) {
  const [fileLines, setFileLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [frame, setFrame] = useState<Frame | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const frameKeyRef = useRef<string>('');
  const codeScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen || !candidate) return;

    setError(null);
    setLoading(false);

    if (!candidate.local_file_available) {
      setFileLines([]);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    getKernelFile(candidate.version, candidate.path)
      .then((file) => {
        if (!cancelled) setFileLines(file.content.split('\n'));
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
    if (!isOpen || !candidate) {
      setFileLines([]);
      setLoading(false);
      setError(null);
      setZoom(1);
      setFrame(null);
      frameKeyRef.current = '';
      return;
    }

    const key = frameKey(candidate, symbol);
    if (frameKeyRef.current === key && frame) return;
    frameKeyRef.current = key;

    let stored: Partial<Frame> & { zoom?: number } | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) stored = JSON.parse(raw) as Partial<Frame> & { zoom?: number };
    } catch {
      stored = null;
    }

    const initial = stored && typeof stored.x === 'number' && typeof stored.y === 'number' && typeof stored.width === 'number' && typeof stored.height === 'number'
      ? clampFrame({
          x: stored.x,
          y: stored.y,
          width: stored.width,
          height: stored.height,
        })
      : buildInitialFrame(anchorRect, avoidRect);

    setFrame(initial);
    setZoom(stored?.zoom ? clampZoom(stored.zoom) : 1);
  }, [anchorRect, avoidRect, candidate, frame, isOpen, symbol]);

  useEffect(() => {
    if (!isOpen || !candidate || !frame) return;
    const key = frameKey(candidate, symbol);
    try {
      window.localStorage.setItem(key, JSON.stringify({ ...frame, zoom }));
    } catch {
      // ignore storage failures
    }
  }, [candidate, frame, isOpen, symbol, zoom]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    function onMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-symbol-quick-preview]')) return;
      if (target?.closest?.('[data-symbol-popover]')) return;
      onClose();
    }

    function onResize() {
      setFrame((current) => (current ? clampFrame(current) : current));
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const interaction = interactionRef.current;
      if (!interaction) return;
      event.preventDefault();
      setFrame((current) => {
        const startFrame = interaction.startFrame;
        if (!current) return current;
        if (interaction.kind === 'drag') {
          return clampFrame({
            ...current,
            x: startFrame.x + (event.clientX - interaction.startX),
            y: startFrame.y + (event.clientY - interaction.startY),
          });
        }
        return clampFrame({
          ...current,
          width: Math.max(MIN_SIZE.width, startFrame.width + (event.clientX - interaction.startX)),
          height: Math.max(MIN_SIZE.height, startFrame.height + (event.clientY - interaction.startY)),
        });
      });
    }

    function onPointerUp() {
      if (!interactionRef.current) return;
      interactionRef.current = null;
      if (candidate && frame) {
        const key = frameKey(candidate, symbol);
        try {
          window.localStorage.setItem(key, JSON.stringify({ ...frame, zoom }));
        } catch {
          // ignore storage failures
        }
      }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [candidate, frame, symbol, zoom]);

  const containingSymbol = useMemo(
    () => detectNearestSymbol(fileLines, candidate?.line ?? null),
    [candidate?.line, fileLines],
  );

  useEffect(() => {
    if (!isOpen || !candidate || !fileLines.length) return;
    const lineNum = Math.max(1, candidate.line);
    const raf = window.requestAnimationFrame(() => {
      const container = codeScrollRef.current;
      const target = container?.querySelector<HTMLElement>(`[data-line-num="${lineNum}"]`);
      target?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [candidate, fileLines.length, isOpen]);

  if (!isOpen || !candidate || !frame) return null;

  const zoomStyle = { fontSize: `${Math.round(12 * zoom)}px`, lineHeight: 1.45 };
  const jumpHref = candidate.local_file_available
    ? localKernelCodeUrl(candidate.version, candidate.path, candidate.line)
    : candidate.external_url;

  return createPortal(
    <div
      data-symbol-quick-preview
      className="fixed z-[70] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
      }}
    >
      <div
        className="flex cursor-move items-start justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-3 py-2"
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.('button,a')) return;
          onClose();
        }}
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.target instanceof HTMLElement && event.target.closest('button,a')) return;
          if (!frame) return;
          interactionRef.current = {
            kind: 'drag',
            startX: event.clientX,
            startY: event.clientY,
            startFrame: frame,
          };
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Symbol Preview
            </div>
            {symbol ? (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                {symbol}
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-xs font-mono text-slate-700">{candidate.path}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
              {candidate.local_file_available ? 'Local file' : 'External only'}
            </span>
            {containingSymbol ? (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
                in {containingSymbol}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
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
            {Math.round(zoom * 100)}%
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
          <button
            type="button"
            onClick={onOpenPage}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Open page
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close preview"
            title="Close preview"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded-full bg-white px-2 py-0.5 text-slate-600">v{candidate.version}</span>
          <span>L{candidate.line}</span>
          <span className="truncate">Full context</span>
          {containingSymbol ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
              in {containingSymbol}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={jumpHref}
            target={candidate.local_file_available ? '_self' : '_blank'}
            rel={candidate.local_file_available ? undefined : 'noopener noreferrer'}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Jump
          </a>
          {!candidate.local_file_available ? (
            <a
              href={candidate.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Upstream
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3 py-2">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Code context
          </div>
          <div className="text-xs text-slate-500">
            {loading
              ? 'Loading...'
              : `L${candidate.line} • full file`}
          </div>
        </div>

        <div
          ref={codeScrollRef}
          className="min-h-0 flex-1 overflow-y-scroll overscroll-contain bg-slate-950/95 p-3"
          style={{ scrollbarGutter: 'stable' }}
        >
          {!candidate.local_file_available ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-lg rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-4 text-sm leading-6 text-slate-200">
                This candidate is external only. The floating window can still jump upstream or open the full page.
              </div>
            </div>
          ) : loading ? (
            <div className="text-sm text-slate-300">Loading preview...</div>
          ) : error ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : fileLines.length > 0 ? (
            <div className="inline-block min-w-max rounded-xl border border-slate-800 bg-slate-900/80 shadow-lg">
              {fileLines.map((lineText, index) => {
                const lineNum = index + 1;
                const isTarget = lineNum === candidate.line;
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

      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize rounded-tl-md bg-slate-300/70"
        onPointerDown={(event) => {
          if (!frame) return;
          interactionRef.current = {
            kind: 'resize',
            startX: event.clientX,
            startY: event.clientY,
            startFrame: frame,
          };
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }}
        title="Resize window"
      />
    </div>,
    document.body,
  );
}
