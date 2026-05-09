import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpenText,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode2,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  Library,
  Layers3,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  ScrollText,
} from 'lucide-react';
import {
  getEntitiesByMessageId,
  getTargetTags,
  getCodeAnnotations,
  getKernelFile,
  getKernelTree,
  getKernelVersions,
  getThread,
  resolveKernelSymbol,
} from '../api/client';
import type {
  CodeAnnotation,
  KnowledgeEntity,
  KernelFileResponse,
  KernelTreeEntry,
  KernelVersionInfo,
  KernelSymbolResolveResponse,
  TagRead,
} from '../api/types';
import EmailTagEditor from '../components/EmailTagEditor';
import ThreadDrawer from '../components/ThreadDrawer';
import { showToast } from '../components/Toast';
import AnnotationPanel from '../components/kernelCode/AnnotationPanel';
import CodeHistoryPanel from '../components/kernelCode/CodeHistoryPanel';
import {
  EmptyState,
  IconButton,
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

function shouldTryFileBeforeTree(path: string, targetLine?: number | null): boolean {
  if (targetLine && targetLine > 0) return true;
  const parts = path.split('/').filter(Boolean);
  const name = parts[parts.length - 1] || '';
  if (name.includes('.')) return true;
  return new Set(['Kconfig', 'Makefile', 'MAINTAINERS', 'CREDITS', 'COPYING', 'README']).has(name);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function parentKernelPath(path: string): string {
  return path.split('/').slice(0, -1).join('/');
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
  if (token.startsWith('//') || token.startsWith('/*')) return 'text-emerald-600';
  if (token.startsWith('"') || token.startsWith("'")) return 'text-amber-700';
  if (/^(?:0x[\da-fA-F]+|\d)/.test(token)) return 'text-violet-700';
  if (C_KEYWORDS.has(token)) return 'font-medium text-sky-700';
  if (C_TYPES.has(token)) return 'font-medium text-indigo-700';
  if (/^[A-Z][A-Z0-9_]+$/.test(token) && token.length > 1) return 'text-fuchsia-700';
  return '';
}

function renderHighlightedLine(line: string): ReactNode {
  if (!line) return '\u00a0';
  if (line.trimStart().startsWith('#')) {
    return <span className="text-fuchsia-700">{line}</span>;
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

function InspectorSection({
  title,
  icon,
  collapsed,
  onToggle,
  children,
  headerExtra,
}: {
  title: string;
  icon: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-slate-50"
        aria-expanded={!collapsed}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="text-slate-500">{icon}</span>
          <span className="truncate">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {headerExtra}
          <ChevronRight className={`h-4 w-4 text-slate-400 transition ${collapsed ? '' : 'rotate-90'}`} />
        </span>
      </button>
      {!collapsed && <div className="border-t border-slate-100 px-3 py-3">{children}</div>}
    </section>
  );
}

function mergeTags(...groups: TagRead[][]): TagRead[] {
  const seen = new Map<string, TagRead>();
  for (const group of groups) {
    for (const tag of group) {
      if (!seen.has(tag.slug)) seen.set(tag.slug, tag);
    }
  }
  return Array.from(seen.values());
}

function patchTouchesPath(patchContent: string, filePath: string): boolean {
  if (!patchContent || !filePath) return false;
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\b---\\s+a/${escaped}\\b`),
    new RegExp(`\\b\\+\\+\\+\\s+b/${escaped}\\b`),
    new RegExp(`\\bdiff --git\\s+a/${escaped}\\s+b/${escaped}\\b`),
  ];
  return patterns.some((pattern) => pattern.test(patchContent));
}

function parsePatchHunkMatches(
  patchContent: string,
  filePath: string,
  selectedRange: { startLine: number; endLine: number } | null,
): Array<{ startLine: number; endLine: number }> {
  if (!patchContent || !filePath || !selectedRange) return [];
  const lines = patchContent.split('\n');
  const matches: Array<{ startLine: number; endLine: number }> = [];
  let oldPath = '';
  let newPath = '';

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('diff --git ')) {
      const match = trimmed.match(/^diff --git\s+a\/(\S+)\s+b\/(\S+)/);
      oldPath = match?.[1] || '';
      newPath = match?.[2] || '';
      continue;
    }
    if (trimmed.startsWith('--- ')) {
      oldPath = trimmed.replace(/^---\s+/, '').replace(/^[ab]\//, '').trim();
      continue;
    }
    if (trimmed.startsWith('+++ ')) {
      newPath = trimmed.replace(/^\+\+\+\s+/, '').replace(/^[ab]\//, '').trim();
      continue;
    }
    if (!trimmed.startsWith('@@')) continue;

    const activePath = newPath || oldPath;
    if (activePath !== filePath) continue;

    const hunk = trimmed.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!hunk) continue;
    const startLine = Number(hunk[3] || 0);
    const count = Number(hunk[4] || 1);
    const endLine = Math.max(startLine, startLine + Math.max(count, 1) - 1);
    if (startLine <= selectedRange.endLine && endLine >= selectedRange.startLine) {
      matches.push({ startLine, endLine });
    }
  }

  return matches;
}

type ThreadPreview = {
  threadId: string;
  subject: string;
  emailCount: number;
  annotationCount: number;
  patchCount: number;
  matchedPatchCount: number;
  leadPatch?: {
    messageId: string;
    subject: string;
    touchesCurrentPath: boolean;
    matchedHunks: Array<{ startLine: number; endLine: number }>;
  };
  focusMessageId?: string;
};

type AtlasPathKind = 'file' | 'directory' | null;

function isKernelDirectory(entry: KernelTreeEntry): boolean {
  return entry.type === 'directory' || entry.type === 'dir';
}
type InspectorSectionId = 'target' | 'history' | 'annotations' | 'tags' | 'threads' | 'knowledge';

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
  const [currentPathKind, setCurrentPathKind] = useState<AtlasPathKind>(null);
  const [pathInput, setPathInput] = useState(urlPath);
  const [directoryEntries, setDirectoryEntries] = useState<KernelTreeEntry[]>([]);
  const [annotations, setAnnotations] = useState<CodeAnnotation[]>([]);
  const [selectedLines, setSelectedLines] = useState<Set<number>>(() => {
    const set = new Set<number>();
    if (urlLine) set.add(urlLine);
    return set;
  });
  const [scriptCopied, setScriptCopied] = useState(false);
  const [treePath, setTreePath] = useState('');
  const [treeCache, setTreeCache] = useState<Record<string, KernelTreeEntry[]>>({});
  const [expandedTreePaths, setExpandedTreePaths] = useState<Set<string>>(new Set());
  const [treeLoading, setTreeLoading] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [collapsedInspectorSections, setCollapsedInspectorSections] = useState<Set<InspectorSectionId>>(() => new Set());
  const [targetDirectTags, setTargetDirectTags] = useState<TagRead[]>([]);
  const [targetAggregatedTags, setTargetAggregatedTags] = useState<TagRead[]>([]);
  const [targetTagsLoading, setTargetTagsLoading] = useState(false);
  const [relatedThreadPreviews, setRelatedThreadPreviews] = useState<ThreadPreview[]>([]);
  const [relatedThreadsLoading, setRelatedThreadsLoading] = useState(false);
  const [relatedKnowledgeEntities, setRelatedKnowledgeEntities] = useState<KnowledgeEntity[]>([]);
  const [relatedKnowledgeLoading, setRelatedKnowledgeLoading] = useState(false);
  const [threadOpen, setThreadOpen] = useState<{ threadId: string; focusMessageId?: string } | null>(null);
  const [symbolPopover, setSymbolPopover] = useState<{
    symbol: string;
    x: number;
    y: number;
  } | null>(null);
  const [symbolResolve, setSymbolResolve] = useState<{
    symbol: string;
    loading: boolean;
    result: KernelSymbolResolveResponse | null;
    error: string | null;
  } | null>(null);

  const codeViewRef = useRef<HTMLDivElement | null>(null);
  const pathRequestIdRef = useRef(0);
  const fileAbortRef = useRef<AbortController | null>(null);
  const treeAbortRef = useRef<AbortController | null>(null);

  const nextPathRequestId = useCallback(() => {
    pathRequestIdRef.current += 1;
    return pathRequestIdRef.current;
  }, []);

  const abortPathRequests = useCallback(() => {
    fileAbortRef.current?.abort();
    treeAbortRef.current?.abort();
    fileAbortRef.current = null;
    treeAbortRef.current = null;
  }, []);

  useEffect(() => () => abortPathRequests(), [abortPathRequests]);

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

  const sortEntries = useCallback(
    (entries: KernelTreeEntry[]) =>
      entries.slice().sort((a, b) => {
        const aIsDirectory = isKernelDirectory(a);
        const bIsDirectory = isKernelDirectory(b);
        if (aIsDirectory !== bIsDirectory) return aIsDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [],
  );

  const loadTree = useCallback(async (path: string = '', options?: { silent?: boolean; signal?: AbortSignal }) => {
    if (!selectedVersion) return;
    setTreeLoading(true);
    try {
      const res = await getKernelTree(selectedVersion, path, options?.signal);
      const sorted = sortEntries(res.entries);
      setTreeCache((prev) => ({ ...prev, [res.path]: sorted }));
      return { path: res.path, entries: sorted };
    } catch (e: unknown) {
      if (options?.signal?.aborted) return null;
      if (!options?.silent) {
        showToast(e instanceof Error ? e.message : 'Failed to load file tree', 'error');
      }
      return null;
    } finally {
      setTreeLoading(false);
    }
  }, [selectedVersion, sortEntries]);

  const ensureTreeLoaded = useCallback(
    async (path: string = '', signal?: AbortSignal) => {
      const cached = treeCache[path];
      if (cached) return { path, entries: cached };
      return loadTree(path, { signal });
    },
    [loadTree, treeCache],
  );

  const resolveKnownPathKind = useCallback(
    (path: string): AtlasPathKind => {
      if (!path) return 'directory';
      if (currentFile?.path === path) return 'file';
      if (currentPath === path && currentPathKind) return currentPathKind;
      const parentPath = parentKernelPath(path);
      const pathParts = path.split('/').filter(Boolean);
      const entryName = pathParts[pathParts.length - 1];
      const parentEntries = treeCache[parentPath] || [];
      const matchedEntry = parentEntries.find(
        (entry) => entry.path === path || entry.name === entryName,
      );
      if (!matchedEntry) return null;
      return isKernelDirectory(matchedEntry) ? 'directory' : 'file';
    },
    [currentFile, currentPath, currentPathKind, treeCache],
  );

  const expandAncestors = useCallback(
    async (path: string, includeSelf: boolean, requestId?: number, signal?: AbortSignal) => {
      const parts = path.split('/').filter(Boolean);
      const dirSegments = includeSelf ? parts : parts.slice(0, -1);
      if (dirSegments.length === 0) {
        if (requestId && requestId !== pathRequestIdRef.current) return;
        setExpandedTreePaths(new Set());
        setTreePath('');
        await ensureTreeLoaded('', signal);
        return;
      }
      const nextExpanded = new Set<string>();
      let prefix = '';
      for (const segment of dirSegments) {
        prefix = prefix ? `${prefix}/${segment}` : segment;
        if (requestId && requestId !== pathRequestIdRef.current) return;
        nextExpanded.add(prefix);
        await ensureTreeLoaded(prefix, signal);
      }
      if (requestId && requestId !== pathRequestIdRef.current) return;
      setExpandedTreePaths(nextExpanded);
      setTreePath(dirSegments[dirSegments.length - 1] ? dirSegments.join('/') : '');
      await ensureTreeLoaded('', signal);
    },
    [ensureTreeLoaded],
  );

  const openDirectory = useCallback(
    async (path: string, options?: { requestId?: number }) => {
      if (!selectedVersion) return;
      abortPathRequests();
      const requestId = options?.requestId ?? nextPathRequestId();
      const treeAbort = new AbortController();
      treeAbortRef.current = treeAbort;
      setCurrentPath(path);
      setCurrentPathKind('directory');
      setCurrentFile(null);
      setDirectoryEntries([]);
      setAnnotations([]);
      setSelectedLines(new Set());
      setPathInput(path);
      setSearchParams({ v: selectedVersion, path }, { replace: true });
      const tree = await ensureTreeLoaded(path, treeAbort.signal);
      if (!tree || requestId !== pathRequestIdRef.current) return;
      setDirectoryEntries(tree.entries);
      await expandAncestors(path, true, requestId, treeAbort.signal);
    },
    [abortPathRequests, ensureTreeLoaded, expandAncestors, nextPathRequestId, selectedVersion, setSearchParams],
  );

  const loadFile = useCallback(async (
    path: string,
    targetLine?: number | null,
    options?: { silent?: boolean; requestId?: number },
  ): Promise<boolean> => {
    if (!selectedVersion || !path) return false;
    abortPathRequests();
    const requestId = options?.requestId ?? nextPathRequestId();
    const fileAbort = new AbortController();
    fileAbortRef.current = fileAbort;
    setFileLoading(true);
    setCurrentPath(path);
    setCurrentPathKind('file');
    setCurrentFile(null);
    setPathInput(path);
    setDirectoryEntries([]);
    const focusLine = targetLine ?? urlLine;
    setSelectedLines(focusLine ? new Set([focusLine]) : new Set());
    setSearchParams(
      { v: selectedVersion, path, ...(focusLine ? { line: String(focusLine) } : {}) },
      { replace: true },
    );
    try {
      const [fileRes, annotRes] = await Promise.all([
        getKernelFile(selectedVersion, path, fileAbort.signal),
        getCodeAnnotations(selectedVersion, path, fileAbort.signal).catch(() => [] as CodeAnnotation[]),
      ]);
      if (requestId !== pathRequestIdRef.current) return false;
      setCurrentFile(fileRes);
      setAnnotations(annotRes);
      await expandAncestors(path, false, requestId, fileAbort.signal);
      return true;
    } catch (e: unknown) {
      if (fileAbort.signal.aborted) return false;
      if (requestId !== pathRequestIdRef.current) return false;
      if (!options?.silent) {
        showToast(e instanceof Error ? e.message : String(e), 'error');
      }
      setCurrentFile(null);
      setCurrentPathKind(null);
      return false;
    } finally {
      if (requestId === pathRequestIdRef.current) {
        setFileLoading(false);
      }
    }
  }, [abortPathRequests, expandAncestors, nextPathRequestId, selectedVersion, setSearchParams, urlLine]);

  const openPath = useCallback(
    async (path: string, targetLine?: number | null) => {
      if (!selectedVersion || !path) return;
      if (path === currentPath && currentPathKind) {
        const focusTarget = targetLine ?? urlLine;
        setSelectedLines(focusTarget ? new Set([focusTarget]) : new Set());
        return;
      }
      const requestId = nextPathRequestId();
      const knownKind = resolveKnownPathKind(path);
      if (knownKind === 'directory') {
        await openDirectory(path, { requestId });
        return;
      }
      if (knownKind === 'file') {
        await loadFile(path, targetLine, { requestId });
        return;
      }
      if (shouldTryFileBeforeTree(path, targetLine)) {
        const loaded = await loadFile(path, targetLine, { silent: true, requestId });
        if (loaded) return;
        if (requestId !== pathRequestIdRef.current) return;
      }
      const probeAbort = new AbortController();
      treeAbortRef.current = probeAbort;
      const tree = await loadTree(path, { silent: true, signal: probeAbort.signal });
      if (requestId !== pathRequestIdRef.current) return;
      if (tree) {
        await openDirectory(path, { requestId });
        return;
      }
      await loadFile(path, targetLine, { requestId });
    },
    [
      currentPath,
      currentPathKind,
      loadFile,
      loadTree,
      openDirectory,
      resolveKnownPathKind,
      selectedVersion,
      nextPathRequestId,
      urlLine,
    ],
  );

  useEffect(() => {
    if (urlPath && selectedVersion) {
      void openPath(urlPath, urlLine);
    }
  }, [openPath, selectedVersion, urlPath, urlLine]);

  useEffect(() => {
    if (selectedVersion) {
      void ensureTreeLoaded('');
    }
  }, [ensureTreeLoaded, selectedVersion]);

  const filteredVersions = useMemo(
    () => (showAllVersions ? versions : versions.filter((v) => v.kind === 'release' || !v.tag.includes('-rc'))),
    [showAllVersions, versions],
  );

  const codeLines = useMemo(() => (currentFile ? currentFile.content.split('\n') : []), [currentFile]);
  const isDirectoryView = currentPathKind === 'directory';
  const isFileView = currentPathKind === 'file' && !!currentFile;

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

  const selectedRange = useMemo(() => {
    if (selectedLines.size === 0) return null;
    const sorted = Array.from(selectedLines).sort((a, b) => a - b);
    return {
      startLine: sorted[0],
      endLine: sorted[sorted.length - 1],
    };
  }, [selectedLines]);

  const selectedText = useMemo(() => {
    if (!selectedRange || codeLines.length === 0) return '';
    return codeLines
      .slice(selectedRange.startLine - 1, selectedRange.endLine)
      .join('\n');
  }, [codeLines, selectedRange]);

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

  const currentExternal = currentPath
    ? pickKernelSourceUrl(selectedVersion, currentPath, isFileView ? focusLine || undefined : undefined)
    : null;

  const fileFacts = currentFile
    ? `${currentFile.line_count.toLocaleString()} lines · ${formatBytes(currentFile.size)}`
    : isDirectoryView
      ? `${directoryEntries.length.toLocaleString()} entries`
      : 'Open a file to inspect source';

  const selectedTargetRef = useMemo(() => {
    if (!selectedVersion || !currentPath) return '';
    return `${selectedVersion}:${currentPath}`;
  }, [currentPath, selectedVersion]);

  const selectedTargetAnchor = useMemo(() => {
    if (!selectedRange) return null;
    return {
      start_line: selectedRange.startLine,
      end_line: selectedRange.endLine,
    };
  }, [selectedRange]);

  const selectedTargetAnchorExpanded = useMemo(() => {
    if (!selectedRange) return null;
    return {
      start_line: selectedRange.startLine,
      end_line: selectedRange.endLine,
      version: selectedVersion,
      file_path: currentPath,
    };
  }, [currentPath, selectedRange, selectedVersion]);

  const selectedTargetTags = useMemo(
    () => mergeTags(targetDirectTags, targetAggregatedTags),
    [targetAggregatedTags, targetDirectTags],
  );

  const relatedThreadRefs = useMemo(() => {
    const refs = new Map<string, { threadId: string; focusMessageId?: string }>();
    for (const annotation of relatedAnnotations) {
      const threadId =
        (typeof annotation.meta?.thread_id === 'string' ? annotation.meta.thread_id : '').trim();
      if (!threadId) continue;
      const focusMessageId =
        annotation.code_target?.message_id ||
        (typeof annotation.meta?.message_id === 'string' ? annotation.meta.message_id : '') ||
        undefined;
      if (!refs.has(threadId)) refs.set(threadId, { threadId, focusMessageId });
    }
    return Array.from(refs.values()).slice(0, 4);
  }, [relatedAnnotations]);

  const relatedMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const annotation of relatedAnnotations) {
      const candidates = [
        annotation.code_target?.message_id,
        typeof annotation.meta?.message_id === 'string' ? annotation.meta.message_id : '',
      ];
      for (const candidate of candidates) {
        const normalized = String(candidate || '').trim();
        if (normalized) ids.add(normalized);
      }
    }
    return Array.from(ids).slice(0, 6);
  }, [relatedAnnotations]);

  const targetHealthLabel = useMemo(() => {
    if (!currentPathKind) return 'No target loaded';
    if (isDirectoryView) return 'Directory context';
    if (relatedAnnotations.length > 0 && selectedSymbol) return 'Anchored with notes';
    if (relatedAnnotations.length > 0) return 'Anchored, symbol pending';
    if (selectedLines.size > 0) return 'Ready for annotation';
    return 'Reading context only';
  }, [currentPathKind, isDirectoryView, relatedAnnotations.length, selectedLines.size, selectedSymbol]);

  useEffect(() => {
    if (!selectedTargetRef || !selectedTargetAnchor || !selectedTargetAnchorExpanded) {
      setTargetDirectTags([]);
      setTargetAggregatedTags([]);
      return;
    }

    let cancelled = false;
    setTargetTagsLoading(true);
    Promise.allSettled([
        getTargetTags('kernel_line_range', selectedTargetRef, selectedTargetAnchor),
        getTargetTags('kernel_line_range', selectedTargetRef, selectedTargetAnchorExpanded),
    ])
      .then((results) => {
        if (cancelled) return;
        const bundles = results
          .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
        setTargetDirectTags(mergeTags(...bundles.map((bundle) => bundle.direct_tags)));
        setTargetAggregatedTags(mergeTags(...bundles.map((bundle) => bundle.aggregated_tags)));
      })
      .catch(() => {
        if (cancelled) return;
        setTargetDirectTags([]);
        setTargetAggregatedTags([]);
      })
      .finally(() => {
        if (!cancelled) setTargetTagsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTargetAnchor, selectedTargetAnchorExpanded, selectedTargetRef]);

  useEffect(() => {
    if (relatedThreadRefs.length === 0) {
      setRelatedThreadPreviews([]);
      return;
    }

    let cancelled = false;
    setRelatedThreadsLoading(true);
    Promise.allSettled(
      relatedThreadRefs.map(async (ref) => {
        const thread = await getThread(ref.threadId);
        const patchEmails = thread.emails.filter((email) => email.has_patch);
        const matchedPatchEmails = currentPath
          ? patchEmails.filter((email) => patchTouchesPath(email.patch_content || '', currentPath))
          : [];
        const leadPatchEmail = matchedPatchEmails[0] || patchEmails[0];
        const leadPatchMatchedHunks = leadPatchEmail
          ? parsePatchHunkMatches(leadPatchEmail.patch_content || '', currentPath, selectedRange)
          : [];
        return {
          threadId: ref.threadId,
          subject: thread.emails[0]?.subject || ref.threadId,
          emailCount: thread.emails.length,
          annotationCount: thread.annotations.length,
          patchCount: patchEmails.length,
          matchedPatchCount: matchedPatchEmails.length,
          leadPatch: (() => {
            return leadPatchEmail
              ? {
                  messageId: leadPatchEmail.message_id,
                  subject: leadPatchEmail.subject || leadPatchEmail.message_id,
                  touchesCurrentPath:
                    currentPath ? patchTouchesPath(leadPatchEmail.patch_content || '', currentPath) : false,
                  matchedHunks: leadPatchMatchedHunks,
                }
              : undefined;
          })(),
          focusMessageId: ref.focusMessageId,
        } satisfies ThreadPreview;
      }),
    )
      .then((results) => {
        if (cancelled) return;
        setRelatedThreadPreviews(
          results
            .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
            .sort((a, b) => {
              const aOverlap = a.leadPatch?.matchedHunks.length || 0;
              const bOverlap = b.leadPatch?.matchedHunks.length || 0;
              if (bOverlap !== aOverlap) return bOverlap - aOverlap;
              if (b.matchedPatchCount !== a.matchedPatchCount) return b.matchedPatchCount - a.matchedPatchCount;
              return b.patchCount - a.patchCount;
            }),
        );
      })
      .catch(() => {
        if (!cancelled) setRelatedThreadPreviews([]);
      })
      .finally(() => {
        if (!cancelled) setRelatedThreadsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath, relatedThreadRefs, selectedRange]);

  useEffect(() => {
    if (relatedMessageIds.length === 0) {
      setRelatedKnowledgeEntities([]);
      return;
    }

    let cancelled = false;
    setRelatedKnowledgeLoading(true);
    Promise.allSettled(relatedMessageIds.map((messageId) => getEntitiesByMessageId(messageId)))
      .then((results) => {
        if (cancelled) return;
        const entityMap = new Map<string, KnowledgeEntity>();
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          for (const entity of result.value.entities) {
            if (!entityMap.has(entity.entity_id)) entityMap.set(entity.entity_id, entity);
          }
        }
        setRelatedKnowledgeEntities(Array.from(entityMap.values()).slice(0, 6));
      })
      .catch(() => {
        if (!cancelled) setRelatedKnowledgeEntities([]);
      })
      .finally(() => {
        if (!cancelled) setRelatedKnowledgeLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [relatedMessageIds]);

  function handleVersionSelect(tag: string) {
    abortPathRequests();
    nextPathRequestId();
    setSelectedVersion(tag);
    setFileLoading(false);
    setTreeLoading(false);
    setCurrentFile(null);
    setCurrentPathKind(null);
    setDirectoryEntries([]);
    setAnnotations([]);
    setTreeCache({});
    setExpandedTreePaths(new Set());
    if (currentPath) {
      setPathInput(currentPath);
      setSearchParams(
        {
          v: tag,
          path: currentPath,
          ...(selectedRange ? { line: String(selectedRange.startLine) } : {}),
        },
        { replace: true },
      );
      return;
    }
    setCurrentPath('');
    setPathInput('');
    setTreePath('');
    setSelectedLines(new Set());
    setSearchParams({ v: tag }, { replace: true });
  }

  function handleLoadFile() {
    if (!isValidFilePath(pathInput)) return;
    void openPath(pathInput.trim());
  }

  function scrollToLine(line: number, behavior: ScrollBehavior = 'smooth') {
    const applyScroll = () => {
      const container = codeViewRef.current;
      const target = container?.querySelector<HTMLElement>(`[data-line="${line}"]`);
      if (!container || !target) return false;
      const centeredTop = target.offsetTop - (container.clientHeight / 2) + (target.clientHeight / 2);
      container.scrollTo({
        top: Math.max(0, centeredTop),
        left: 0,
        behavior,
      });
      target.scrollIntoView({ block: 'center', behavior });
      return true;
    };
    window.requestAnimationFrame(() => {
      if (!applyScroll()) {
        window.setTimeout(applyScroll, 50);
      }
      window.setTimeout(applyScroll, 250);
      window.setTimeout(applyScroll, 750);
    });
  }

  useEffect(() => {
    if (!currentFile) return;
    window.requestAnimationFrame(() => {
      if (focusLine) {
        scrollToLine(focusLine, 'auto');
        return;
      }
      scrollToLine(1, 'auto');
    });
  }, [currentFile, focusLine]);

  function handleSelectRange(startLine: number, endLine: number = startLine) {
    const normalizedStart = Math.max(1, Math.min(startLine, endLine));
    const normalizedEnd = Math.max(normalizedStart, Math.max(startLine, endLine));
    const next = new Set<number>();
    for (let line = normalizedStart; line <= normalizedEnd; line += 1) next.add(line);
    setSelectedLines(next);
    setSearchParams(
      { v: selectedVersion, path: currentPath, line: String(normalizedStart) },
      { replace: true },
    );
    scrollToLine(normalizedStart);
  }

  function handleLineClick(line: number, event?: ReactMouseEvent<HTMLDivElement>) {
    if (event?.shiftKey && selectedLines.size > 0) {
      handleSelectRange(focusLine || line, line);
      return;
    }
    if (selectedLines.size === 1 && selectedLines.has(line)) {
      setSelectedLines(new Set<number>());
      setSearchParams(
        { v: selectedVersion, path: currentPath },
        { replace: true },
      );
      return;
    }
    handleSelectRange(line);
  }

  function toggleInspectorSection(section: InspectorSectionId) {
    setCollapsedInspectorSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function toggleTreeDirectory(path: string) {
    if (expandedTreePaths.has(path)) {
      const next = new Set<string>();
      for (const item of expandedTreePaths) {
        if (item !== path && !item.startsWith(`${path}/`)) next.add(item);
      }
      setExpandedTreePaths(next);
      setTreePath(path.split('/').slice(0, -1).join('/'));
      return;
    }
    void (async () => {
      await ensureTreeLoaded(path);
      setExpandedTreePaths((prev) => new Set(prev).add(path));
      setTreePath(path);
    })();
  }

  function renderTreeEntries(parentPath: string = '', depth: number = 0): JSX.Element | null {
    const entries = treeCache[parentPath] || [];
    if (entries.length === 0) return null;
    return (
      <div className="space-y-0.5">
        {entries.map((entry) => {
          const isDirectory = isKernelDirectory(entry);
          const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
          const isExpanded = expandedTreePaths.has(entryPath);
          const isActive = entryPath === currentPath;
          const entryPicked = !isDirectory ? pickKernelSourceUrl(selectedVersion, entryPath) : null;
          return (
            <div key={entryPath}>
              <div
                className={`group flex items-center justify-between rounded-md border px-1.5 py-1.5 text-xs ${
                  isActive
                    ? 'border-sky-200 bg-sky-50 text-sky-800'
                    : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50'
                }`}
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isDirectory) {
                      toggleTreeDirectory(entryPath);
                    } else {
                      void loadFile(entryPath);
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <span className="text-slate-400">
                    {isDirectory ? (
                      <ChevronRight className={`h-3 w-3 transition ${isExpanded ? 'rotate-90 text-sky-600' : ''}`} />
                    ) : (
                      <FileCode2 className="h-3 w-3" />
                    )}
                  </span>
                  <span className={isDirectory ? 'text-sky-600' : 'text-slate-400'}>
                    {isDirectory ? <FolderTree className="h-3 w-3" /> : <FileCode2 className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{isDirectory ? `${entry.name}/` : entry.name}</span>
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
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {isDirectory && isExpanded && <div className="mt-0.5">{renderTreeEntries(entryPath, depth + 1)}</div>}
            </div>
          );
        })}
      </div>
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

  const symbolPopoverSymbol = symbolPopover?.symbol || '';

  useEffect(() => {
    if (!symbolPopoverSymbol || !selectedVersion) {
      setSymbolResolve(null);
      return;
    }

    const symbol = symbolPopoverSymbol;
    let cancelled = false;

    setSymbolResolve({
      symbol,
      loading: true,
      result: null,
      error: null,
    });

    resolveKernelSymbol(selectedVersion || 'latest', symbol)
      .then((result) => {
        if (cancelled) return;
        setSymbolResolve({
          symbol,
          loading: false,
          result,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Symbol lookup failed';
        setSymbolResolve({
          symbol,
          loading: false,
          result: null,
          error: message,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedVersion, symbolPopoverSymbol]);

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
      showToast('Copy failed. Download manually from /app/userscripts/elixir-annotate.user.js', 'error');
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
    <PageShell wide className="bg-slate-100 px-3 py-3 md:px-4">
      <SectionPanel
        className="overflow-hidden border-slate-200/90 bg-white p-0 shadow-[0_18px_44px_rgba(15,23,42,0.08)]"
      >
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <FileCode2 className="h-4 w-4 text-slate-500" />
                Code Atlas
              </div>
              <div className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 xl:flex">
                <button
                  type="button"
                  onClick={() => setNavigatorCollapsed((value) => !value)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-900"
                  aria-label={navigatorCollapsed ? 'Expand navigator' : 'Collapse navigator'}
                  title={navigatorCollapsed ? 'Expand navigator' : 'Collapse navigator'}
                >
                  {navigatorCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorCollapsed((value) => !value)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-900"
                  aria-label={inspectorCollapsed ? 'Expand inspector' : 'Collapse inspector'}
                  title={inspectorCollapsed ? 'Expand inspector' : 'Collapse inspector'}
                >
                  {inspectorCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
                </button>
              </div>
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

            <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center xl:max-w-4xl">
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLoadFile();
                }}
                placeholder="Open a kernel path, for example mm/mmap.c"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-400"
              />
              <SecondaryButton className="px-3 py-2" onClick={handleLoadFile} disabled={!isValidFilePath(pathInput) || fileLoading}>
                {fileLoading ? 'Opening...' : 'Open file'}
              </SecondaryButton>
              {currentExternal && (
                <a
                  href={currentExternal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ExternalLink className="h-4 w-4" />
                  Source
                </a>
              )}
              <SecondaryButton className="px-3 py-2" onClick={handleCopyScript}>
                <Copy className="h-4 w-4" />
                {scriptCopied ? 'Copied' : 'Userscript'}
              </SecondaryButton>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
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

        <div
          className={`grid min-h-[calc(100vh-8rem)] gap-0 xl:h-[calc(100vh-8rem)] ${
            navigatorCollapsed
              ? 'xl:grid-cols-[3rem_minmax(0,1fr)] 2xl:grid-cols-[3rem_minmax(0,1fr)]'
              : 'xl:grid-cols-[12.5rem_minmax(0,1fr)] 2xl:grid-cols-[13.5rem_minmax(0,1fr)]'
          }`}
        >
          <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/80 xl:border-b-0 xl:border-r">
            {navigatorCollapsed ? (
              <div className="hidden min-h-0 flex-1 flex-col items-center gap-3 px-2 py-3 xl:flex">
                <button
                  type="button"
                  onClick={() => setNavigatorCollapsed(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900"
                  aria-label="Expand navigator"
                  title="Expand navigator"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
                <FolderTree className="h-4 w-4 text-slate-400" />
                <div className="h-px w-full bg-slate-200" />
                <div className="[writing-mode:vertical-rl] text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Navigator
                </div>
              </div>
            ) : (
              <>
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FolderTree className="h-4 w-4 text-slate-500" />
                Navigator
                </div>
                <button
                  type="button"
                  onClick={() => setNavigatorCollapsed(true)}
                  className="hidden h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 xl:inline-flex"
                  aria-label="Collapse navigator"
                  title="Collapse navigator"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">{treePath || 'root'}</p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
              <div className="grid gap-2">
                <AtlasMetric label="focus" value={selectedRangeLabel} tone="info" />
                <AtlasMetric
                  label="symbol"
                  value={selectedSymbol || 'Not inferred yet'}
                  tone={selectedSymbol ? 'success' : 'muted'}
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-3 py-2">
                  <div className="text-sm font-semibold text-slate-900">Path Browser</div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTreePath('');
                        void ensureTreeLoaded('');
                      }}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      /
                    </button>
                    {treePath && (
                      <button
                        type="button"
                        onClick={() => {
                          const parentPath = treePath.split('/').slice(0, -1).join('/');
                          setTreePath(parentPath);
                          void ensureTreeLoaded(parentPath);
                        }}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        ..
                      </button>
                    )}
                  </div>

                  {treeLoading && Object.keys(treeCache).length === 0 ? (
                    <div className="text-xs text-slate-500">Loading tree…</div>
                  ) : treeCache['']?.length ? (
                    renderTreeEntries('')
                  ) : (
                    <div className="text-xs text-slate-400">No entries here.</div>
                  )}
                </div>
              </div>
            </div>
              </>
            )}
          </aside>

          <div className="min-w-0 bg-slate-50/60">
            <div className="h-full min-h-0">
              <div
                className={`grid h-full min-h-0 gap-0 ${
                  inspectorCollapsed
                    ? 'xl:grid-cols-[minmax(0,1fr)_3rem] 2xl:grid-cols-[minmax(0,1fr)_3rem]'
                    : 'xl:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_19rem]'
                }`}
              >
                <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
                  <div className="border-b border-slate-200 px-3 py-2">
                  <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
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
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-slate-950">
                          {currentPath || 'Select a file to start reading'}
                        </h2>
                        <StatusBadge tone="muted">{selectedVersion || 'No version'}</StatusBadge>
                        <StatusBadge tone="info">{selectedRangeLabel}</StatusBadge>
                        {selectedSymbol && <StatusBadge tone="success">{selectedSymbol}</StatusBadge>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {fileFacts}
                        {selectedSymbol ? ` · symbol ${selectedSymbol}` : ''}
                      </div>
                    </div>

                    {currentExternal && (
                      <a
                        href={currentExternal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open source
                      </a>
                    )}
                  </div>
                </div>

                  <div
                    ref={codeViewRef}
                    onMouseUp={handleCodeMouseUp}
                    className="relative min-h-0 flex-1 overflow-auto bg-white"
                  >
                  {fileLoading ? (
                    <div className="px-6 py-12 text-sm text-slate-500">Opening file…</div>
                  ) : isDirectoryView ? (
                    <EmptyState
                      title="Directory expanded in navigator"
                      description="Use the left tree to browse directories, then choose a file to open it here."
                    />
                  ) : currentFile ? (
                    <div className="inline-block min-w-max font-mono text-[12px] leading-[18px]">
                      {codeLines.map((line, index) => {
                        const lineNum = index + 1;
                        const isSelected = selectedLines.has(lineNum);
                        const annotationCount = annotationCountByLine.get(lineNum) || 0;
                        const linePicked = pickKernelSourceUrl(selectedVersion, currentPath, lineNum);
                        return (
                          <div
                            key={lineNum}
                            data-line={lineNum}
                            onClick={(e) => handleLineClick(lineNum, e)}
                            className={`group grid w-max cursor-pointer grid-cols-[12px_44px_max-content_22px] border-b border-slate-100/70 px-2 ${
                              isSelected ? 'bg-amber-50' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center justify-center">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  annotationCount > 0 ? 'bg-sky-500' : isSelected ? 'bg-amber-500' : 'bg-transparent'
                                }`}
                              />
                            </div>
                            <span className="select-none py-0.5 pr-2 text-right text-[11px] text-slate-400">
                              {lineNum}
                            </span>
                            <div className="whitespace-pre py-0.5 pr-8 text-slate-800">
                              {renderHighlightedLine(line)}
                            </div>
                            <a
                              href={linePicked.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center justify-center text-slate-300 opacity-0 transition hover:text-sky-700 group-hover:opacity-100"
                              title={`Open line ${lineNum} upstream`}
                            >
                              <ExternalLink className="h-3 w-3" />
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
                </div>

                <aside className="flex min-h-0 max-h-[calc(100vh-8rem)] flex-col overflow-y-auto border-t border-slate-200 bg-slate-50/80 xl:overflow-hidden xl:border-l xl:border-t-0">
                  {inspectorCollapsed ? (
                    <div className="hidden min-h-0 flex-1 flex-col items-center gap-3 px-2 py-3 xl:flex">
                      <button
                        type="button"
                        onClick={() => setInspectorCollapsed(false)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900"
                        aria-label="Expand inspector"
                        title="Expand inspector"
                      >
                        <PanelRightOpen className="h-4 w-4" />
                      </button>
                      <BookOpenText className="h-4 w-4 text-slate-400" />
                      <div className="h-px w-full bg-slate-200" />
                      <div className="[writing-mode:vertical-rl] text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Inspector
                      </div>
                    </div>
                  ) : (
                    <>
                  <div className="border-b border-slate-200 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <BookOpenText className="h-4 w-4 text-slate-500" />
                        Inspector
                      </div>
                      <button
                        type="button"
                        onClick={() => setInspectorCollapsed(true)}
                        className="hidden h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 xl:inline-flex"
                        aria-label="Collapse inspector"
                        title="Collapse inspector"
                      >
                        <PanelRightClose className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">Target, notes, evidence.</p>
                  </div>

                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
                  <InspectorSection
                    title="Code Target"
                    icon={<Pin className="h-4 w-4" />}
                    collapsed={collapsedInspectorSections.has('target')}
                    onToggle={() => toggleInspectorSection('target')}
                    headerExtra={
                      <StatusBadge tone={relatedAnnotations.length > 0 ? 'success' : 'warning'}>
                        {targetHealthLabel}
                      </StatusBadge>
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="mt-1 text-xs text-slate-500">Stable target for reading and notes.</div>
                      </div>
                    </div>
                    <dl className="mt-3 space-y-1.5">
                      <MetaRow label="version" value={selectedVersion || '—'} />
                      <MetaRow label="path" value={currentPath || '—'} />
                      <MetaRow label="range" value={selectedRangeLabel} />
                      <MetaRow label="symbol" value={selectedSymbol || 'Not inferred'} />
                      <MetaRow label="repo" value="linux" />
                      <MetaRow
                        label="related"
                        value={`${relatedAnnotations.length} annotations · ${selectedLines.size > 0 ? 'selection pinned' : 'browse mode'}`}
                      />
                    </dl>

                    <div className="mt-3 grid gap-2">
                      {selectedSymbol && (
                        <a
                          href={elixirIdentUrl(selectedVersion || 'latest', selectedSymbol)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <ScrollText className="h-3.5 w-3.5" />
                          Search symbol
                        </a>
                      )}
                    </div>
                  </InspectorSection>

                    {currentFile ? (
                      <InspectorSection
                        title="History"
                        icon={<GitCommitHorizontal className="h-4 w-4" />}
                        collapsed={collapsedInspectorSections.has('history')}
                        onToggle={() => toggleInspectorSection('history')}
                        headerExtra={
                          selectedRange ? (
                            <span className="text-[10px] font-medium text-slate-400">{selectedRangeLabel}</span>
                          ) : null
                        }
                      >
                        <CodeHistoryPanel
                          version={selectedVersion}
                          filePath={currentPath}
                          selectedRange={selectedRange}
                          selectedText={selectedText}
                        />
                      </InspectorSection>
                    ) : null}

                    {currentFile ? (
                      <InspectorSection
                        title="Annotations"
                        icon={<MessagesSquare className="h-4 w-4" />}
                        collapsed={collapsedInspectorSections.has('annotations')}
                        onToggle={() => toggleInspectorSection('annotations')}
                        headerExtra={
                          selectedLines.size > 0 ? (
                            <span className="text-[10px] font-medium text-slate-400">{selectedRangeLabel}</span>
                          ) : null
                        }
                      >
                        <AnnotationPanel
                          annotations={annotations}
                          selectedLines={selectedLines}
                          version={selectedVersion}
                          filePath={currentPath}
                          onAnnotationCreated={handleAnnotationCreated}
                          hideHeader
                        />
                      </InspectorSection>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-400">
                        Load a file to inspect annotations and tags.
                      </div>
                    )}

                    {currentFile && selectedRange && (
                      <InspectorSection
                        title="Tags"
                        icon={<Layers3 className="h-4 w-4" />}
                        collapsed={collapsedInspectorSections.has('tags')}
                        onToggle={() => toggleInspectorSection('tags')}
                        headerExtra={
                          selectedTargetTags.length > 0 ? (
                            <span className="text-[10px] font-medium text-slate-400">{selectedTargetTags.length}</span>
                          ) : null
                        }
                      >
                        <div className="flex flex-wrap gap-1.5">
                          {targetTagsLoading ? (
                            <span className="text-xs text-slate-500">Loading tags...</span>
                          ) : selectedTargetTags.length > 0 ? (
                            selectedTargetTags.map((tag) => (
                              <span
                                key={tag.slug}
                                className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800"
                              >
                                {tag.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">No tags on this range.</span>
                          )}
                        </div>
                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                          <EmailTagEditor
                            targetType="kernel_line_range"
                            targetRef={selectedTargetRef}
                            anchor={selectedTargetAnchorExpanded ?? undefined}
                            compact
                            placeholder="Tag this code target"
                          />
                        </div>
                      </InspectorSection>
                    )}

                    <InspectorSection
                      title="Threads"
                      icon={<MessagesSquare className="h-4 w-4" />}
                      collapsed={collapsedInspectorSections.has('threads')}
                      onToggle={() => toggleInspectorSection('threads')}
                      headerExtra={
                        relatedThreadPreviews.length > 0 ? (
                          <span className="text-[10px] font-medium text-slate-400">{relatedThreadPreviews.length}</span>
                        ) : null
                      }
                    >
                      <div className="space-y-2">
                        {relatedThreadsLoading ? (
                          <div className="text-xs text-slate-500">Loading thread context...</div>
                        ) : relatedThreadPreviews.length > 0 ? (
                          relatedThreadPreviews.slice(0, 3).map((thread) => (
                            <button
                              key={thread.threadId}
                              type="button"
                              onClick={() =>
                                setThreadOpen({
                                  threadId: thread.threadId,
                                  focusMessageId: thread.focusMessageId,
                                })
                              }
                              className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-left hover:border-sky-200 hover:bg-sky-50/60"
                            >
                              <div className="truncate text-xs font-semibold text-slate-900">{thread.subject}</div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                {thread.emailCount} mails · {thread.annotationCount} notes · {thread.patchCount} patches
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="text-xs leading-5 text-slate-400">No thread backlinks for this selection yet.</div>
                        )}
                      </div>
                    </InspectorSection>

                    <InspectorSection
                      title="Knowledge"
                      icon={<Library className="h-4 w-4" />}
                      collapsed={collapsedInspectorSections.has('knowledge')}
                      onToggle={() => toggleInspectorSection('knowledge')}
                      headerExtra={
                        relatedKnowledgeEntities.length > 0 ? (
                          <span className="text-[10px] font-medium text-slate-400">{relatedKnowledgeEntities.length}</span>
                        ) : null
                      }
                    >
                      <div className="space-y-2">
                        {relatedKnowledgeLoading ? (
                          <div className="text-xs text-slate-500">Loading linked knowledge...</div>
                        ) : relatedKnowledgeEntities.length > 0 ? (
                          relatedKnowledgeEntities.slice(0, 4).map((entity) => (
                            <div
                              key={entity.entity_id}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2"
                            >
                              <div className="truncate text-xs font-semibold text-slate-900">
                                {entity.canonical_name || entity.entity_id}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                {entity.entity_type} · {entity.status || 'linked evidence'}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-xs leading-5 text-slate-400">No knowledge backlinks surfaced yet.</div>
                        )}
                      </div>
                    </InspectorSection>
                  </div>
                    </>
                  )}
                </aside>
              </div>
            </div>
          </div>
        </div>
      </SectionPanel>

      {symbolPopover && (
        <div
          data-symbol-popover
          style={{
            position: 'fixed',
            left: Math.min(symbolPopover.x + 8, window.innerWidth - 420),
            top: Math.min(symbolPopover.y + 12, window.innerHeight - 260),
            zIndex: 50,
          }}
          className="w-[380px] rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Symbol
              </div>
              <code className="mt-1 block truncate text-sm font-mono text-sky-700">
                {symbolPopover.symbol}
              </code>
            </div>
            <IconButton
              label="Close symbol search"
              onClick={() => setSymbolPopover(null)}
              className="h-7 w-7 border-none"
            >
              <span className="text-sm">×</span>
            </IconButton>
          </div>

          <div className="mt-3 space-y-2">
            {symbolResolve?.loading ? (
              <div className="text-xs text-slate-500">Querying Elixir for matching definitions...</div>
            ) : symbolResolve?.error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-2 text-xs leading-5 text-rose-700">
                {symbolResolve.error}
              </div>
            ) : null}

            {symbolResolve?.result?.fallback_reason ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-xs leading-5 text-amber-800">
                {symbolResolve.result.fallback_reason}
              </div>
            ) : null}

            {!symbolResolve?.loading && symbolResolve?.result && symbolResolve.result.candidates.length === 0 ? (
              <div className="text-xs leading-5 text-slate-500">
                No Elixir candidates found for this symbol.
              </div>
            ) : null}

            <div className="space-y-1.5">
              {symbolResolve?.result?.candidates.map((candidate) => (
                <a
                  key={`${candidate.path}:${candidate.line}`}
                  href={candidate.local_file_available ? candidate.local_url : candidate.external_url}
                  target={candidate.local_file_available ? '_self' : '_blank'}
                  rel={candidate.local_file_available ? undefined : 'noopener noreferrer'}
                  onClick={() => setSymbolPopover(null)}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-2.5 py-2 transition hover:border-sky-200 hover:bg-sky-50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-slate-900">
                      {candidate.path}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      L{candidate.line}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      candidate.local_file_available
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {candidate.local_file_available ? 'Local' : 'Elixir'}
                  </span>
                </a>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <a
                href={symbolResolve?.result?.query_url || elixirIdentUrl(selectedVersion || 'latest', symbolPopover.symbol)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSymbolPopover(null)}
                className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-800"
              >
                Open Elixir search
                <ExternalLink className="h-3 w-3" />
              </a>
              <span className="text-[11px] text-slate-400">
                {symbolResolve?.loading
                  ? 'Searching'
                  : symbolResolve?.result
                    ? symbolResolve.result.resolved
                      ? `${symbolResolve.result.candidates.length} matches`
                      : 'No matches'
                    : 'Ready'}
              </span>
            </div>
          </div>
        </div>
      )}

      {threadOpen && (
        <ThreadDrawer
          threadId={threadOpen.threadId}
          focusMessageId={threadOpen.focusMessageId}
          onClose={() => setThreadOpen(null)}
        />
      )}
    </PageShell>
  );
}
