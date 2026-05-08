import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpenText,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode2,
  FolderTree,
  GitBranch,
  Link2,
  Pin,
  ScrollText,
  Tags,
} from 'lucide-react';
import {
  getCodeAnnotations,
  getKernelFile,
  getKernelTree,
  getKernelVersions,
} from '../api/client';
import type {
  CodeAnnotation,
  KernelFileResponse,
  KernelTreeEntry,
  KernelVersionInfo,
} from '../api/types';
import { showToast } from '../components/Toast';
import AnnotationPanel from '../components/kernelCode/AnnotationPanel';
import {
  EmptyState,
  IconButton,
  PageHeader,
  PageShell,
  SecondaryButton,
  SectionPanel,
  StatusBadge,
} from '../components/ui';
import {
  elixirIdentUrl,
  isLikelyCIdentifier,
  pickKernelSourceUrl,
} from '../utils/externalLinks';

function isValidFilePath(path: string): boolean {
  return path.trim().length > 0;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function detectNearestSymbol(lines: string[], focusLine: number | null): string | null {
  if (!focusLine || focusLine < 1) return null;
  const fnPattern =
    /^\s*(?:[A-Za-z_][\w\s*]*\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{$/;
  for (let idx = Math.min(focusLine - 1, lines.length - 1); idx >= 0; idx -= 1) {
    const line = lines[idx].trim();
    const match = line.match(fnPattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 text-xs">
      <dt className="font-medium uppercase tracking-[0.16em] text-slate-400">{label}</dt>
      <dd className="min-w-0 break-words text-slate-700">{value}</dd>
    </div>
  );
}

function AtlasMetric({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string;
  tone?: 'muted' | 'info' | 'success' | 'warning';
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="text-sm font-semibold text-slate-950">{value}</div>
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </div>
    </div>
  );
}

function RelatedCard({
  title,
  subtitle,
  detail,
}: {
  title: string;
  subtitle: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="text-sm font-medium text-slate-900">{title}</div>
      <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
      <div className="mt-3 text-xs leading-5 text-slate-600">{detail}</div>
    </div>
  );
}

export default function KernelCodePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlVersion = searchParams.get('v') || '';
  const urlPath = searchParams.get('path') || '';
  const urlLine = parseInt(searchParams.get('line') || '0', 10) || null;

  const [versions, setVersions] = useState<KernelVersionInfo[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState(urlVersion);
  const [currentFile, setCurrentFile] = useState<KernelFileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(urlPath);
  const [pathInput, setPathInput] = useState(urlPath);
  const [annotations, setAnnotations] = useState<CodeAnnotation[]>([]);
  const [selectedLines, setSelectedLines] = useState<Set<number>>(() => {
    const set = new Set<number>();
    if (urlLine) set.add(urlLine);
    return set;
  });
  const [scriptCopied, setScriptCopied] = useState(false);
  const [treePath, setTreePath] = useState('');
  const [treeEntries, setTreeEntries] = useState<KernelTreeEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [symbolPopover, setSymbolPopover] = useState<{
    symbol: string;
    x: number;
    y: number;
  } | null>(null);

  const codeViewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVersionsLoading(true);
    getKernelVersions('all')
      .then((res) => {
        setVersions(res.versions);
        setSelectedVersion((current) => current || res.versions[0]?.tag || '');
      })
      .catch((e) => showToast(e.message, 'error'))
      .finally(() => setVersionsLoading(false));
  }, []);

  const loadFile = useCallback(async (path: string, targetLine?: number | null) => {
    if (!selectedVersion || !path) return;
    setFileLoading(true);
    setCurrentPath(path);
    try {
      const [fileRes, annotRes] = await Promise.all([
        getKernelFile(selectedVersion, path),
        getCodeAnnotations(selectedVersion, path).catch(() => [] as CodeAnnotation[]),
      ]);
      setCurrentFile(fileRes);
      setAnnotations(annotRes);
      const focusLine = targetLine ?? urlLine;
      setSelectedLines(focusLine ? new Set([focusLine]) : new Set());
      setSearchParams(
        { v: selectedVersion, path, ...(focusLine ? { line: String(focusLine) } : {}) },
        { replace: true },
      );
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
      setCurrentFile(null);
    } finally {
      setFileLoading(false);
    }
  }, [selectedVersion, setSearchParams, urlLine]);

  const loadTree = useCallback(async (path: string = '') => {
    if (!selectedVersion) return;
    setTreeLoading(true);
    try {
      const res = await getKernelTree(selectedVersion, path);
      setTreePath(res.path);
      setTreeEntries(
        res.entries.slice().sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
      );
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load file tree', 'error');
    } finally {
      setTreeLoading(false);
    }
  }, [selectedVersion]);

  useEffect(() => {
    if (urlPath && selectedVersion) {
      void loadFile(urlPath, urlLine);
    }
  }, [loadFile, selectedVersion, urlPath, urlLine]);

  useEffect(() => {
    if (selectedVersion) {
      void loadTree(treePath);
    }
  }, [loadTree, selectedVersion, treePath]);

  const filteredVersions = useMemo(
    () => (showAllVersions ? versions : versions.filter((v) => v.kind === 'release' || !v.tag.includes('-rc'))),
    [showAllVersions, versions],
  );

  const codeLines = useMemo(
    () => (currentFile ? currentFile.content.split('\n') : []),
    [currentFile],
  );

  const focusLine = useMemo(() => {
    const sorted = Array.from(selectedLines).sort((a, b) => a - b);
    return sorted[0] || null;
  }, [selectedLines]);

  const selectedRangeLabel = useMemo(() => {
    if (selectedLines.size === 0) return 'No line selected';
    const sorted = Array.from(selectedLines).sort((a, b) => a - b);
    if (sorted.length === 1) return `L${sorted[0]}`;
    return `L${sorted[0]}-${sorted[sorted.length - 1]}`;
  }, [selectedLines]);

  const selectedSymbol = useMemo(
    () => detectNearestSymbol(codeLines, focusLine),
    [codeLines, focusLine],
  );

  const annotationCountByLine = useMemo(() => {
    const counts = new Map<number, number>();
    for (const annotation of annotations) {
      for (let line = annotation.start_line; line <= annotation.end_line; line += 1) {
        counts.set(line, (counts.get(line) || 0) + 1);
      }
    }
    return counts;
  }, [annotations]);

  const relatedAnnotations = useMemo(() => {
    if (selectedLines.size === 0) return annotations;
    const lines = Array.from(selectedLines);
    return annotations.filter((annotation) =>
      lines.some((line) => line >= annotation.start_line && line <= annotation.end_line),
    );
  }, [annotations, selectedLines]);

  const pathSegments = useMemo(
    () => (currentPath ? currentPath.split('/').filter(Boolean) : []),
    [currentPath],
  );

  const currentExternal = currentFile
    ? pickKernelSourceUrl(selectedVersion, currentPath, focusLine || undefined)
    : null;

  function handleVersionSelect(tag: string) {
    setSelectedVersion(tag);
    setCurrentFile(null);
    setCurrentPath('');
    setPathInput('');
    setTreePath('');
    setTreeEntries([]);
    setAnnotations([]);
    setSelectedLines(new Set());
    setSearchParams({ v: tag }, { replace: true });
  }

  function handleLoadFile() {
    if (!isValidFilePath(pathInput)) return;
    void loadFile(pathInput.trim());
  }

  function handleLineClick(line: number) {
    setSelectedLines((prev) => (prev.has(line) ? new Set<number>() : new Set([line])));
    setSearchParams(
      { v: selectedVersion, path: currentPath, ...(line ? { line: String(line) } : {}) },
      { replace: true },
    );
  }

  function handleCodeMouseUp(e: ReactMouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSymbolPopover(null);
      return;
    }
    const text = selection.toString().trim();
    if (!isLikelyCIdentifier(text)) {
      setSymbolPopover(null);
      return;
    }
    const container = codeViewRef.current;
    if (!container) return;
    if (!selection.anchorNode || !container.contains(selection.anchorNode)) {
      setSymbolPopover(null);
      return;
    }
    setSymbolPopover({ symbol: text, x: e.clientX, y: e.clientY });
  }

  useEffect(() => {
    if (!symbolPopover) return;
    function onDocDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-symbol-popover]')) return;
      setSymbolPopover(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSymbolPopover(null);
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [symbolPopover]);

  async function handleCopyScript() {
    try {
      const resp = await fetch('/app/userscripts/elixir-annotate.user.js');
      if (!resp.ok) throw new Error('fetch failed');
      let script = await resp.text();
      script = script.replace(/__API_BASE__/g, window.location.origin);
      script = script.replace(/__SESSION_COOKIE__/g, document.cookie);

      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(script);
          copied = true;
        } catch {
          copied = false;
        }
      }
      if (!copied) {
        const ta = document.createElement('textarea');
        ta.value = script;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 2000);
    } catch {
      showToast('复制失败，请手动从 /app/userscripts/elixir-annotate.user.js 下载', 'error');
    }
  }

  async function handleAnnotationCreated() {
    if (!selectedVersion || !currentPath) return;
    try {
      const annotRes = await getCodeAnnotations(selectedVersion, currentPath);
      setAnnotations(annotRes);
    } catch {
      // ignore refresh failure in panel callback
    }
  }

  return (
    <PageShell wide className="bg-[radial-gradient(circle_at_top_left,_rgba(226,232,240,0.75),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef2f7_100%)]">
      <PageHeader
        eyebrow="Code Atlas"
        title="Kernel Code Atlas"
        description="Read kernel source with shared context: keep versions, code ranges, annotations, tags, and linked evidence in one place."
        meta={
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="info">Multi-version reading</StatusBadge>
            <StatusBadge tone="success">Annotation layer</StatusBadge>
            <StatusBadge tone="warning">Local-first resolver</StatusBadge>
          </div>
        }
        actions={
          <>
            {currentExternal && (
              <a
                href={currentExternal.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <ExternalLink className="h-4 w-4" />
                {currentExternal.source === 'elixir' ? 'Open in Elixir' : 'Open upstream'}
              </a>
            )}
            <SecondaryButton onClick={handleCopyScript}>
              <Copy className="h-4 w-4" />
              {scriptCopied ? 'Script copied' : 'Copy userscript'}
            </SecondaryButton>
          </>
        }
      />

      <SectionPanel
        className="overflow-hidden border-slate-200/90 bg-white/80 p-0 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              {versionsLoading ? (
                <div className="text-sm text-slate-500">Loading versions...</div>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <GitBranch className="h-4 w-4 text-slate-400" />
                    <select
                      value={selectedVersion}
                      onChange={(e) => handleVersionSelect(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition focus:border-sky-400"
                    >
                      {filteredVersions.map((version) => (
                        <option key={version.tag} value={version.tag}>
                          {version.tag}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={showAllVersions}
                      onChange={(e) => setShowAllVersions(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Show all versions
                  </label>
                </>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center xl:max-w-3xl">
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLoadFile();
                }}
                placeholder="Open a kernel path, for example mm/mmap.c"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-400"
              />
              <SecondaryButton onClick={handleLoadFile} disabled={!isValidFilePath(pathInput) || fileLoading}>
                {fileLoading ? 'Opening...' : 'Open file'}
              </SecondaryButton>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge tone="muted">{selectedVersion || 'No version selected'}</StatusBadge>
            {currentFile && (
              <>
                <StatusBadge tone="info">{currentFile.line_count.toLocaleString()} lines</StatusBadge>
                <StatusBadge tone="muted">{formatBytes(currentFile.size)}</StatusBadge>
                {currentFile.truncated && <StatusBadge tone="warning">Truncated</StatusBadge>}
                <StatusBadge tone="success">{annotations.length} annotations</StatusBadge>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-0 xl:grid-cols-[18rem_minmax(0,1fr)_24rem]">
          <aside className="border-b border-slate-200 bg-slate-50/70 xl:border-b-0 xl:border-r">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FolderTree className="h-4 w-4 text-slate-500" />
                Atlas Home
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Move by version and path, then keep the selected code range anchored to shared notes.
              </p>
            </div>

            <div className="space-y-4 px-4 py-4">
              <div className="grid gap-2">
                <AtlasMetric label="focus" value={selectedRangeLabel} tone="info" />
                <AtlasMetric
                  label="symbol"
                  value={selectedSymbol || 'Not inferred yet'}
                  tone={selectedSymbol ? 'success' : 'muted'}
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">Path Browser</div>
                  <div className="mt-1 text-xs text-slate-500">{treePath || 'root'}</div>
                </div>
                <div className="max-h-[22rem] overflow-y-auto px-3 py-3">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setTreePath('')}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      /
                    </button>
                    {treePath && (
                      <button
                        type="button"
                        onClick={() => setTreePath(treePath.split('/').slice(0, -1).join('/'))}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        ..
                      </button>
                    )}
                  </div>

                  {treeLoading ? (
                    <div className="text-xs text-slate-500">Loading tree…</div>
                  ) : treeEntries.length === 0 ? (
                    <div className="text-xs text-slate-400">No entries here.</div>
                  ) : (
                    <div className="space-y-1">
                      {treeEntries.slice(0, 36).map((entry) => {
                        const entryPicked =
                          entry.type === 'file'
                            ? pickKernelSourceUrl(selectedVersion, entry.path)
                            : null;
                        const active = entry.path === currentPath;
                        return (
                          <div
                            key={entry.path}
                            className={`group flex items-center justify-between rounded-lg border px-2 py-2 text-xs ${
                              active
                                ? 'border-sky-200 bg-sky-50 text-sky-800'
                                : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (entry.type === 'directory') {
                                  setTreePath(entry.path);
                                } else {
                                  setPathInput(entry.path);
                                  void loadFile(entry.path);
                                }
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <span className={entry.type === 'directory' ? 'text-sky-600' : 'text-slate-400'}>
                                {entry.type === 'directory' ? <FolderTree className="h-3.5 w-3.5" /> : <FileCode2 className="h-3.5 w-3.5" />}
                              </span>
                              <span className="truncate">
                                {entry.type === 'directory' ? `${entry.name}/` : entry.name}
                              </span>
                            </button>
                            {entryPicked && (
                              <a
                                href={entryPicked.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="opacity-0 transition group-hover:opacity-100 hover:text-sky-700"
                                title="Open upstream"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>

          <div className="min-w-0 border-b border-slate-200 bg-white xl:border-b-0 xl:border-r">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                    <span className="font-medium uppercase tracking-[0.16em] text-slate-400">Code Target</span>
                    {pathSegments.length > 0 && <ChevronRight className="h-3.5 w-3.5" />}
                    {pathSegments.map((segment, index) => (
                      <div key={`${segment}-${index}`} className="flex items-center gap-1">
                        <span className={index === pathSegments.length - 1 ? 'font-medium text-slate-800' : ''}>
                          {segment}
                        </span>
                        {index < pathSegments.length - 1 && <ChevronRight className="h-3.5 w-3.5" />}
                      </div>
                    ))}
                  </div>
                  <h2 className="mt-2 truncate text-lg font-semibold text-slate-950">
                    {currentPath || 'Select a file to start reading'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Keep a stable reference to the file, line range, and surrounding evidence instead of treating this as a generic editor.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="muted">{selectedVersion || 'No version'}</StatusBadge>
                  <StatusBadge tone="info">{selectedRangeLabel}</StatusBadge>
                  {selectedSymbol && <StatusBadge tone="success">{selectedSymbol}</StatusBadge>}
                </div>
              </div>
            </div>

            <div
              ref={codeViewRef}
              onMouseUp={handleCodeMouseUp}
              className="relative max-h-[44rem] overflow-auto bg-white"
            >
              {fileLoading ? (
                <div className="px-6 py-12 text-sm text-slate-500">Opening file…</div>
              ) : currentFile ? (
                <div className="font-mono text-sm">
                  {codeLines.map((line, index) => {
                    const lineNum = index + 1;
                    const isSelected = selectedLines.has(lineNum);
                    const annotationCount = annotationCountByLine.get(lineNum) || 0;
                    const linePicked = pickKernelSourceUrl(selectedVersion, currentPath, lineNum);
                    return (
                      <div
                        key={lineNum}
                        onClick={() => handleLineClick(lineNum)}
                        className={`group grid cursor-pointer grid-cols-[18px_64px_minmax(0,1fr)_24px] border-b border-slate-100/80 px-3 ${
                          isSelected ? 'bg-amber-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-center">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              annotationCount > 0 ? 'bg-sky-500' : isSelected ? 'bg-amber-500' : 'bg-transparent'
                            }`}
                          />
                        </div>
                        <span className="select-none py-1.5 pr-3 text-right text-xs text-slate-400">
                          {lineNum}
                        </span>
                        <div className="min-w-0 py-1.5 whitespace-pre text-slate-800">
                          {line}
                        </div>
                        <a
                          href={linePicked.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center justify-center text-slate-300 opacity-0 transition hover:text-sky-700 group-hover:opacity-100"
                          title={`Open line ${lineNum} upstream`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6">
                  <EmptyState
                    title="No code target loaded yet"
                    description="Open a file path to start building an Atlas view around versions, line ranges, annotations, and linked knowledge."
                  />
                </div>
              )}
            </div>

            {currentFile && (
              <div className="border-t border-slate-200 bg-slate-50/70 px-5 py-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Link2 className="h-4 w-4 text-slate-500" />
                  Related Layer
                </div>
                <div className="grid gap-3 lg:grid-cols-3">
                  <RelatedCard
                    title="Code target"
                    subtitle={`${selectedVersion} · ${selectedRangeLabel}`}
                    detail={
                      selectedSymbol
                        ? `Nearest symbol inferred as ${selectedSymbol}.`
                        : 'Select a line to pin symbol-level context.'
                    }
                  />
                  <RelatedCard
                    title="Annotations"
                    subtitle={`${relatedAnnotations.length} linked note${relatedAnnotations.length === 1 ? '' : 's'}`}
                    detail={
                      relatedAnnotations.length > 0
                        ? relatedAnnotations[0].body.slice(0, 120)
                        : 'No note attached to this range yet. Create one from the inspector.'
                    }
                  />
                  <RelatedCard
                    title="Evidence bridge"
                    subtitle="Mail / patch / knowledge"
                    detail={
                      currentExternal
                        ? `Resolver currently prefers ${currentExternal.source} for external context. Mail and knowledge links will accumulate here as code targets normalize.`
                        : 'External source links appear once a file is loaded.'
                    }
                  />
                </div>
              </div>
            )}
          </div>

          <aside className="bg-slate-50/70">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <BookOpenText className="h-4 w-4 text-slate-500" />
                Inspector
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Structured metadata on the current code target, plus the existing annotation workflow.
              </p>
            </div>

            <div className="space-y-4 px-4 py-4">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Pin className="h-4 w-4 text-slate-500" />
                  Code Target
                </div>
                <dl className="space-y-2">
                  <MetaRow label="version" value={selectedVersion || '—'} />
                  <MetaRow label="path" value={currentPath || '—'} />
                  <MetaRow label="range" value={selectedRangeLabel} />
                  <MetaRow label="symbol" value={selectedSymbol || 'Not inferred'} />
                  <MetaRow label="repo" value="linux" />
                  <MetaRow
                    label="related"
                    value={`${relatedAnnotations.length} annotations · 0 linked threads surfaced`}
                  />
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  {currentExternal && (
                    <a
                      href={currentExternal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open source
                    </a>
                  )}
                  {selectedSymbol && (
                    <a
                      href={elixirIdentUrl(selectedVersion || 'latest', selectedSymbol)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <ScrollText className="h-3.5 w-3.5" />
                      Search symbol
                    </a>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Tags className="h-4 w-4 text-slate-500" />
                  Atlas Signals
                </div>
                <div className="space-y-3 text-xs text-slate-600">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Selection changes the target payload immediately; the annotation panel below still owns creation and review.
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Current file has {annotations.length} saved code annotation{annotations.length === 1 ? '' : 's'}.
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Mail / patch / knowledge backlinks are the next normalization step after this visual shell.
                  </div>
                </div>
              </div>

              {currentFile ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <AnnotationPanel
                    annotations={annotations}
                    selectedLines={selectedLines}
                    version={selectedVersion}
                    filePath={currentPath}
                    onAnnotationCreated={handleAnnotationCreated}
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-400">
                  Load a file to inspect annotations and tags.
                </div>
              )}
            </div>
          </aside>
        </div>
      </SectionPanel>

      {symbolPopover && (
        <div
          data-symbol-popover
          style={{
            position: 'fixed',
            left: Math.min(symbolPopover.x + 8, window.innerWidth - 260),
            top: Math.min(symbolPopover.y + 12, window.innerHeight - 60),
            zIndex: 50,
          }}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-lg"
        >
          <span className="text-xs text-slate-500">Symbol</span>
          <code className="max-w-[140px] truncate text-xs font-mono text-sky-700">
            {symbolPopover.symbol}
          </code>
          <a
            href={elixirIdentUrl(selectedVersion || 'latest', symbolPopover.symbol)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setSymbolPopover(null)}
            className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700"
          >
            Search
            <ExternalLink className="h-3 w-3" />
          </a>
          <IconButton
            label="Close symbol search"
            onClick={() => setSymbolPopover(null)}
            className="h-7 w-7 border-none"
          >
            <span className="text-sm">×</span>
          </IconButton>
        </div>
      )}
    </PageShell>
  );
}
