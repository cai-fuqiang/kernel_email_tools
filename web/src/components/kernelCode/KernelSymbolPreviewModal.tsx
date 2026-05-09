import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { getKernelFile } from '../../api/client';
import type { KernelSymbolCandidateResponse } from '../../api/types';
import { showToast } from '../Toast';

interface KernelSymbolPreviewModalProps {
  isOpen: boolean;
  candidate: KernelSymbolCandidateResponse | null;
  onClose: () => void;
}

function clampZoom(value: number): number {
  return Math.min(2.25, Math.max(0.75, value));
}

export default function KernelSymbolPreviewModal({
  isOpen,
  candidate,
  onClose,
}: KernelSymbolPreviewModalProps) {
  const [codeLines, setCodeLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!isOpen || !candidate) return;

    setZoom(1);
    setError(null);

    if (!candidate.local_file_available) {
      setCodeLines([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    getKernelFile(candidate.version, candidate.path)
      .then((file) => {
        if (cancelled) return;
        setCodeLines(file.content.split('\n'));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load code preview';
        setError(message);
        setCodeLines([]);
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
      setCodeLines([]);
      setLoading(false);
      setError(null);
      setZoom(1);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const previewWindow = useMemo(() => {
    if (!candidate) return null;
    const totalLines = codeLines.length;
    if (!totalLines) return null;

    const focusLine = Math.max(1, candidate.line);
    const context = 18;
    const startLine = Math.max(1, focusLine - context);
    const endLine = Math.min(totalLines, focusLine + context);
    return { startLine, endLine, focusLine };
  }, [candidate, codeLines.length]);

  if (!isOpen || !candidate) return null;

  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const zoomStyle = { fontSize: `${Math.round(12 * zoom)}px`, lineHeight: 1.55 };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-3 py-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[92vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-slate-950">Symbol Preview</div>
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                {candidate.source === 'local' ? 'Local' : 'Elixir'}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                v{candidate.version}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                L{candidate.line}
              </span>
            </div>
            <div className="mt-1 truncate text-xs text-slate-500">
              {candidate.path}
            </div>
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

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-h-0 border-b border-slate-200 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                Code context
              </div>
              <div className="text-xs text-slate-500">
                {previewWindow
                  ? `L${previewWindow.startLine} - L${previewWindow.endLine}`
                  : loading
                    ? 'Loading...'
                    : 'No preview available'}
              </div>
            </div>

            <div className="h-full min-h-0 overflow-auto bg-slate-950/95 p-4">
              {!candidate.local_file_available ? (
                <div className="flex h-full items-center justify-center">
                  <div className="max-w-lg rounded-xl border border-slate-700 bg-slate-900/80 px-5 py-4 text-sm leading-6 text-slate-200">
                    This symbol only has an external source candidate right now.
                    Use the link on the right to open Elixir, or pick a local candidate if one is available.
                  </div>
                </div>
              ) : loading ? (
                <div className="text-sm text-slate-300">Loading preview...</div>
              ) : error ? (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              ) : previewWindow ? (
                <div className="inline-block min-w-max rounded-xl border border-slate-800 bg-slate-900/80 shadow-lg">
                  {codeLines
                    .slice(previewWindow.startLine - 1, previewWindow.endLine)
                    .map((line, index) => {
                      const lineNum = previewWindow.startLine + index;
                      const isTarget = lineNum === previewWindow.focusLine;
                      return (
                        <div
                          key={lineNum}
                          className={`grid min-w-max grid-cols-[4.75rem_minmax(0,1fr)] border-b border-slate-800/80 ${
                            isTarget ? 'bg-amber-400/15' : 'hover:bg-slate-800/60'
                          }`}
                          style={zoomStyle}
                        >
                          <div className="select-none border-r border-slate-800/80 px-3 py-1.5 text-right font-mono text-slate-500">
                            {lineNum}
                          </div>
                          <pre className="overflow-x-auto px-3 py-1.5 font-mono text-slate-100">
                            {line || ' '}
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
                  <div className="text-sm font-semibold text-slate-950">{candidate.path}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    line {candidate.line} · {candidate.local_file_available ? 'Local file available' : 'External only'}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Actions
                </div>
                <div className="mt-2 space-y-2">
                  <a
                    href={candidate.local_file_available ? candidate.local_url : candidate.external_url}
                    target={candidate.local_file_available ? '_self' : '_blank'}
                    rel={candidate.local_file_available ? undefined : 'noopener noreferrer'}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    Open jump location
                  </a>
                  <a
                    href={candidate.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Open Elixir
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Notes
                </div>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                  <li>Use the +/- controls to zoom the preview text.</li>
                  <li>The highlighted line is the best jump point for this symbol.</li>
                  <li>If the local file is missing, the preview falls back to the external source.</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
