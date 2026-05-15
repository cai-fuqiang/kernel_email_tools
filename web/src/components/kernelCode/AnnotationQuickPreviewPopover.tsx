import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Pin } from 'lucide-react';
import { getKernelFile } from '../../api/client';
import type { CodeAnnotation } from '../../api/types';
import { showToast } from '../Toast';
import AnnotationIdBadge from '../AnnotationIdBadge';
import AnnotationPreviewContent from './AnnotationPreviewContent';
import KernelCodePreviewPane from './KernelCodePreviewPane';
import {
  annotationPreviewStartLine,
  formatAnnotationPreviewLineRange,
} from './annotationPreview';
import { getAnnotationLineRange } from './annotationSync';

interface AnnotationQuickPreviewPopoverProps {
  isOpen: boolean;
  annotation: CodeAnnotation | null;
  replies?: CodeAnnotation[];
  anchorRect: DOMRect | null;
  avoidRect: DOMRect | null;
  onClose: () => void;
  onOpenFullPreview: () => void;
  onOpenInAtlas: () => void;
  onOpenAnnotation?: (annotationId: string) => void;
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

const DEFAULT_SIZE = { width: 860, height: 560 };
const MIN_SIZE = { width: 580, height: 380 };
const GAP = 14;
const VIEWPORT_MARGIN = 32;
const STORAGE_PREFIX = 'kernel-annotation-preview-window';

function clampZoom(value: number): number {
  return Math.min(2.2, Math.max(0.8, value));
}

function clampFrame(frame: Frame): Frame {
  const maxWidth = Math.max(240, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(220, window.innerHeight - VIEWPORT_MARGIN * 2);
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
  const availableLeft = avoidRect ? avoidRect.left - GAP : 0;
  const availableRight = avoidRect ? viewportWidth - avoidRect.right - GAP : 0;

  let x = Math.round((viewportWidth - width) / 2);
  let y = Math.round((viewportHeight - height) / 2);

  if (avoidRect && availableLeft >= width) {
    x = Math.max(VIEWPORT_MARGIN, avoidRect.left - GAP - width);
    y = Math.min(Math.max(VIEWPORT_MARGIN, avoidRect.top), viewportHeight - VIEWPORT_MARGIN - height);
  } else if (avoidRect && availableRight >= width) {
    x = Math.min(avoidRect.right + GAP, viewportWidth - VIEWPORT_MARGIN - width);
    y = Math.min(Math.max(VIEWPORT_MARGIN, avoidRect.top), viewportHeight - VIEWPORT_MARGIN - height);
  } else if (anchorRect) {
    x = Math.min(Math.max(VIEWPORT_MARGIN, anchorRect.left - width + anchorRect.width), viewportWidth - VIEWPORT_MARGIN - width);
    y = Math.min(Math.max(VIEWPORT_MARGIN, anchorRect.bottom + 10), viewportHeight - VIEWPORT_MARGIN - height);
  }

  return clampFrame({ x, y, width, height });
}

function frameKey(annotation: CodeAnnotation): string {
  return [
    STORAGE_PREFIX,
    annotation.version,
    annotation.file_path,
    annotation.annotation_id,
  ].join(':');
}

export default function AnnotationQuickPreviewPopover({
  isOpen,
  annotation,
  replies = [],
  anchorRect,
  avoidRect,
  onClose,
  onOpenFullPreview,
  onOpenInAtlas,
  onOpenAnnotation,
}: AnnotationQuickPreviewPopoverProps) {
  const [fileLines, setFileLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [pinned, setPinned] = useState(false);
  const interactionRef = useRef<Interaction | null>(null);
  const frameKeyRef = useRef('');

  useEffect(() => {
    if (!isOpen || !annotation) {
      setFileLines([]);
      setLoading(false);
      setError(null);
      setPinned(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setFileLines([]);

    getKernelFile(annotation.version, annotation.file_path)
      .then((file) => {
        if (!cancelled) setFileLines(file.content.split('\n'));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load annotation preview';
        setError(message);
        showToast(message, 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [annotation, isOpen]);

  useEffect(() => {
    if (!isOpen || !annotation) {
      setFrame(null);
      setZoom(1);
      frameKeyRef.current = '';
      return;
    }

    const key = frameKey(annotation);
    if (frameKeyRef.current === key && frame) return;
    frameKeyRef.current = key;

    let storedSize: { width: number; height: number; zoom?: number } | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Frame> & { zoom?: number };
        if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
          storedSize = { width: parsed.width, height: parsed.height, zoom: parsed.zoom };
        }
      }
    } catch {
      storedSize = null;
    }

    const baseFrame = buildInitialFrame(anchorRect, avoidRect);
    const initial = storedSize
      ? clampFrame({ x: baseFrame.x, y: baseFrame.y, width: storedSize.width, height: storedSize.height })
      : baseFrame;

    setFrame(initial);
    setZoom(storedSize?.zoom ? clampZoom(storedSize.zoom) : 1);
  }, [anchorRect, annotation, avoidRect, frame, isOpen]);

  useEffect(() => {
    if (!isOpen || !annotation || !frame) return;
    try {
      window.localStorage.setItem(frameKey(annotation), JSON.stringify({ width: frame.width, height: frame.height, zoom }));
    } catch {
      // ignore storage failures
    }
  }, [annotation, frame, isOpen, zoom]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    function onMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-annotation-quick-preview]')) return;
      if (target?.closest?.('[data-no-annotation-select]')) return;
      if (pinned) return;
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
  }, [isOpen, onClose, pinned]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const interaction = interactionRef.current;
      if (!interaction) return;
      event.preventDefault();
      setFrame((current) => {
        if (!current) return current;
        const startFrame = interaction.startFrame;
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
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  if (!isOpen || !annotation || !frame) return null;

  const range = getAnnotationLineRange(annotation);
  const startLine = annotationPreviewStartLine(annotation);
  const rangeLabel = formatAnnotationPreviewLineRange(annotation);

  return createPortal(
    <div
      data-annotation-quick-preview
      className="fixed z-[72] flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
      }}
    >
      <div
        className="flex shrink-0 cursor-move select-none touch-none items-start justify-between gap-3 border-b border-slate-300 bg-white px-3 py-2"
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.('button,a')) return;
          onClose();
        }}
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.target instanceof HTMLElement && event.target.closest('button,a')) return;
          if (!frame) return;
          event.preventDefault();
          event.stopPropagation();
          interactionRef.current = {
            kind: 'drag',
            startX: event.clientX,
            startY: event.clientY,
            startFrame: frame,
          };
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'move';
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              Annotation Preview
            </div>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">
              {rangeLabel}
            </span>
            <AnnotationIdBadge annotationId={annotation.annotation_id} compact showCopyLink />
          </div>
          <div className="mt-1 truncate font-mono text-xs text-slate-900">{annotation.file_path}</div>
          <div className="mt-1 text-[11px] text-slate-600">{annotation.author || 'Unknown author'}</div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((value) => clampZoom(value - 0.1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-400"
            aria-label="Zoom out"
            title="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="inline-flex h-8 min-w-14 items-center justify-center rounded-md px-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-400"
            aria-label="Reset zoom"
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => clampZoom(value + 0.1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-400"
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={onOpenFullPreview}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            Open full preview
          </button>
          <button
            type="button"
            onClick={() => setPinned((v) => !v)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus:ring-2 focus:ring-sky-400 ${pinned ? 'bg-sky-100 text-sky-600' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
            aria-label={pinned ? 'Unpin preview' : 'Pin preview'}
            title={pinned ? '取消固定' : '固定（编辑时保持浮窗）'}
          >
            <Pin className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-400"
            aria-label="Close preview"
            title="Close preview"
          >
            x
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="min-h-0 border-r border-slate-300">
          <div className="flex items-center justify-between border-b border-slate-300 bg-slate-50 px-3 py-2">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-600">
              Code context
            </div>
            <div className="text-xs text-slate-600">
              {loading ? 'Loading...' : `${rangeLabel} • full file`}
            </div>
          </div>
          <KernelCodePreviewPane
            lines={fileLines}
            loading={loading}
            error={error}
            highlightRange={range}
            initialLine={startLine}
            zoom={zoom}
            theme="light"
            className="h-[calc(100%-2.375rem)]"
          />
        </div>
        <aside className="min-h-0">
          <AnnotationPreviewContent
            annotation={annotation}
            replies={replies}
            compact
            onOpenFullPreview={onOpenFullPreview}
            onOpenInAtlas={onOpenInAtlas}
            onOpenAnnotation={onOpenAnnotation}
          />
        </aside>
      </div>

      <div
        className="absolute bottom-0 right-0 h-6 w-6 cursor-se-resize select-none touch-none rounded-tl-xl bg-slate-600/70"
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (!frame) return;
          event.preventDefault();
          event.stopPropagation();
          interactionRef.current = {
            kind: 'resize',
            startX: event.clientX,
            startY: event.clientY,
            startFrame: frame,
          };
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'se-resize';
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        title="Resize window"
      />
    </div>,
    document.body,
  );
}
