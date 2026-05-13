import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  KernelSymbolCandidateResponse,
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
import KernelSymbolQuickPreviewPopover from '../components/kernelCode/KernelSymbolQuickPreviewPopover';
import { pickActiveAnnotation, type SyncSource } from '../components/kernelCode/annotationSync';
import {
  EmptyState,
  IconButton,
  InspectorSection,
  PageShell,
  SecondaryButton,
  SectionPanel,
  StatusBadge,
} from '../components/ui';
import {
  elixirIdentUrl,
  isLikelyCIdentifier,
  pickKernelSourceUrl,
  kernelSymbolPreviewPath,
} from '../utils/externalLinks';
import { detectNearestSymbol } from '../utils/kernelSymbols';

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

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 text-xs">
      <dt className="font-medium uppercase tracking-[0.16em] text-slate-600">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">{value}</dd>
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
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
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
  if (token.startsWith('//') || token.startsWith('/*')) return 'text-emerald-700';
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
type InspectorView = 'overview' | 'history' | 'annotations' | 'links';

const INSPECTOR_VIEW_LABELS: Record<InspectorView, string> = {
  overview: 'Overview',
  history: 'History',
  annotations: 'Notes',
  links: 'Links',
};

function inspectorViewCount(
  view: InspectorView,
  data: { annotations: number; threads: number; knowledge: number },
): number | null {
  if (view === 'annotations') return data.annotations;
  if (view === 'links') return data.threads + data.knowledge;
  return null;
}

export default function KernelCodePage() {
  const navigate = useNavigate();
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
  const [activeCenterLine, setActiveCenterLine] = useState<number | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [pinnedAnnotationId, setPinnedAnnotationId] = useState<string | null>(null);
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
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(() => {
    try { return localStorage.getItem('kernel-code-nav-collapsed') === '1'; } catch { return false; }
  });
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => {
    try { return localStorage.getItem('kernel-code-insp-collapsed') === '1'; } catch { return false; }
  });
  const [inspectorView, setInspectorView] = useState<InspectorView>('overview');
  useEffect(() => {
    try { localStorage.setItem('kernel-code-nav-collapsed', navigatorCollapsed ? '1' : '0'); } catch { /* noop */ }
  }, [navigatorCollapsed]);
  useEffect(() => {
    try { localStorage.setItem('kernel-code-insp-collapsed', inspectorCollapsed ? '1' : '0'); } catch { /* noop */ }
  }, [inspectorCollapsed]);

  const NAV_MIN = 140;
  const NAV_MAX = 440;
  const INSP_MIN = 240;
  const INSP_MAX = 720;
  const [navigatorWidth, setNavigatorWidth] = useState(() => {
    try {
      const v = localStorage.getItem('kernel-code-nav-width');
      return v ? Math.max(NAV_MIN, Math.min(NAV_MAX, Number(v))) : 200;
    } catch { return 200; }
  });
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const v = localStorage.getItem('kernel-code-insp-width');
      return v ? Math.max(INSP_MIN, Math.min(INSP_MAX, Number(v))) : 360;
    } catch { return 360; }
  });
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
  const [symbolCandidateLabels, setSymbolCandidateLabels] = useState<Record<string, string | null>>({});
  const [symbolQuickPreview, setSymbolQuickPreview] = useState<{
    candidate: KernelSymbolCandidateResponse;
    symbol: string;
    anchorRect: DOMRect;
    avoidRect: DOMRect | null;
  } | null>(null);

  const codeViewRef = useRef<HTMLDivElement | null>(null);
  const annotationPanelRef = useRef<HTMLDivElement | null>(null);
  const codeScrollRafRef = useRef<number | null>(null);
  const syncLockRef = useRef<{ source: SyncSource; until: number }>({ source: null, until: 0 });
  const activeFileIdentityRef = useRef<string | null>(null);
  const popoverDragRef = useRef<{ startX: number; startY: number; popoverX: number; popoverY: number } | null>(null);
  const pathRequestIdRef = useRef(0);
  const navResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const inspResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const currentNavWidthRef = useRef(navigatorWidth);
  currentNavWidthRef.current = navigatorWidth;
  const currentInspWidthRef = useRef(inspectorWidth);
  currentInspWidthRef.current = inspectorWidth;
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

  useEffect(() => () => {
    if (codeScrollRafRef.current !== null) {
      window.cancelAnimationFrame(codeScrollRafRef.current);
      codeScrollRafRef.current = null;
    }
  }, []);

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

  const openPathRef = useRef(openPath);

  useEffect(() => {
    openPathRef.current = openPath;
  }, [openPath]);

  useEffect(() => {
    if (urlPath && selectedVersion) {
      void openPathRef.current(urlPath, urlLine);
    }
  }, [selectedVersion, urlPath, urlLine]);

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

  const activeAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.annotation_id === activeAnnotationId) || null,
    [activeAnnotationId, annotations],
  );

  const pinnedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.annotation_id === pinnedAnnotationId) || null,
    [pinnedAnnotationId, annotations],
  );

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

  function computeCenterLineFromScroll(): number | null {
    const container = codeViewRef.current;
    if (!container || !currentFile) return null;
    const firstLine = container.querySelector<HTMLElement>('[data-line="1"]');
    if (!firstLine) return null;
    const rowHeight = firstLine.offsetHeight || 20;
    const rawLine = Math.round((container.scrollTop + container.clientHeight / 2) / rowHeight);
    return Math.max(1, Math.min(codeLines.length, rawLine));
  }

  function handleCodeScroll() {
    if (codeScrollRafRef.current !== null) return;
    codeScrollRafRef.current = window.requestAnimationFrame(() => {
      codeScrollRafRef.current = null;
      const centerLine = computeCenterLineFromScroll();
      setActiveCenterLine(centerLine);
      const now = Date.now();
      const lock = syncLockRef.current;
      if (lock.source && lock.source !== 'code' && now < lock.until) return;
      const nextActive = pickActiveAnnotation(annotations, centerLine);
      setActiveAnnotationId(nextActive?.annotation_id || null);
      syncLockRef.current = { source: 'code', until: now + 350 };
    });
  }

  useEffect(() => {
    const fileIdentity = currentFile ? `${currentFile.version}:${currentFile.path}` : null;
    if (activeFileIdentityRef.current === fileIdentity) return;
    activeFileIdentityRef.current = fileIdentity;
    setActiveCenterLine(fileIdentity ? focusLine || 1 : null);
    setActiveAnnotationId(null);
    setPinnedAnnotationId(null);
    syncLockRef.current = { source: null, until: 0 };
  }, [currentFile, focusLine]);

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

  function handleLineClick(line: number, event?: ReactMouseEvent<HTMLElement>) {
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
                className={`group flex items-center justify-between rounded-md border px-1.5 py-1.5 text-xs transition ${
                  isActive
                    ? 'border-sky-300 bg-sky-50 text-sky-800'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-100'
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
                  <span className="text-slate-600">
                    {isDirectory ? (
                      <ChevronRight className={`h-3 w-3 transition ${isExpanded ? 'rotate-90 text-sky-700' : ''}`} />
                    ) : (
                      <FileCode2 className="h-3 w-3" />
                    )}
                  </span>
                  <span className={isDirectory ? 'text-sky-700' : 'text-slate-600'}>
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
                    className="text-slate-600 opacity-0 transition hover:text-sky-800 group-hover:opacity-100"
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
    setSymbolPopover({ symbol: text, x: e.clientX + 8, y: e.clientY + 12 });
  }

  useEffect(() => {
    if (!symbolPopover) return;
    function onDocDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-symbol-popover]')) return;
      if (target?.closest?.('[data-symbol-quick-preview]')) return;
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

  useEffect(() => {
    if (!symbolPopover) return undefined;

    function onPointerMove(e: PointerEvent) {
      const drag = popoverDragRef.current;
      if (!drag) return;
      e.preventDefault();
      setSymbolPopover((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          x: Math.max(0, Math.min(drag.popoverX + (e.clientX - drag.startX), window.innerWidth - 420)),
          y: Math.max(0, Math.min(drag.popoverY + (e.clientY - drag.startY), window.innerHeight - 48)),
        };
      });
    }

    function onPointerUp() {
      popoverDragRef.current = null;
    }

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [symbolPopover]);

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      if (navResizeRef.current) {
        e.preventDefault();
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const delta = e.clientX - navResizeRef.current.startX;
        const newWidth = Math.max(NAV_MIN, Math.min(NAV_MAX, navResizeRef.current.startWidth + delta));
        setNavigatorWidth(newWidth);
      }
      if (inspResizeRef.current) {
        e.preventDefault();
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const delta = inspResizeRef.current.startX - e.clientX;
        const newWidth = Math.max(INSP_MIN, Math.min(INSP_MAX, inspResizeRef.current.startWidth + delta));
        setInspectorWidth(newWidth);
      }
    }

    function onPointerUp() {
      if (navResizeRef.current) {
        try { localStorage.setItem('kernel-code-nav-width', String(currentNavWidthRef.current)); } catch { /* noop */ }
        navResizeRef.current = null;
      }
      if (inspResizeRef.current) {
        try { localStorage.setItem('kernel-code-insp-width', String(currentInspWidthRef.current)); } catch { /* noop */ }
        inspResizeRef.current = null;
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
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

  useEffect(() => {
    const candidates = symbolResolve?.result?.candidates || [];
    if (candidates.length === 0) {
      setSymbolCandidateLabels({});
      return undefined;
    }

    let cancelled = false;
    setSymbolCandidateLabels({});

    async function loadCandidateSymbols() {
      const entries = await Promise.all(
        candidates.map(async (candidate) => {
          const key = `${candidate.version}:${candidate.path}:${candidate.line}`;
          if (!candidate.local_file_available) return [key, null] as const;

          try {
            const file = await getKernelFile(candidate.version, candidate.path);
            const lines = file.content.split('\n');
            return [key, detectNearestSymbol(lines, candidate.line)] as const;
          } catch {
            return [key, null] as const;
          }
        }),
      );

      if (cancelled) return;
      setSymbolCandidateLabels(Object.fromEntries(entries));
    }

    void loadCandidateSymbols();

    return () => {
      cancelled = true;
    };
  }, [symbolResolve?.result]);

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

  function handleSymbolCandidateClick(
    candidate: KernelSymbolCandidateResponse,
    symbol: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    if (event.detail !== 1) return;
    const anchorRect = event.currentTarget.getBoundingClientRect();
    const avoidRect = event.currentTarget.closest('[data-symbol-popover]')?.getBoundingClientRect() || null;
    setSymbolQuickPreview({
      candidate,
      symbol,
      anchorRect,
      avoidRect,
    });
  }

  function handlePreviewOpenPage() {
    if (!symbolQuickPreview) return;
    navigate(
      kernelSymbolPreviewPath(
        symbolQuickPreview.candidate.version,
        symbolQuickPreview.candidate.path,
        symbolQuickPreview.candidate.line,
        symbolQuickPreview.symbol || undefined,
      ),
    );
  }

  return (
    <PageShell wide className="px-3 py-3 md:px-4">
      <SectionPanel
        className="overflow-hidden border-slate-200 bg-white p-0"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-950">
                <FileCode2 className="h-4 w-4 text-sky-700" />
                Code Atlas
              </div>
              <div className="hidden items-center gap-1 rounded-lg border border-slate-300 bg-slate-100 p-1 xl:flex">
                <button
                  type="button"
                  onClick={() => setNavigatorCollapsed((value) => !value)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
                  aria-label={navigatorCollapsed ? 'Expand navigator' : 'Collapse navigator'}
                  title={navigatorCollapsed ? 'Expand navigator' : 'Collapse navigator'}
                >
                  {navigatorCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorCollapsed((value) => !value)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
                  aria-label={inspectorCollapsed ? 'Expand inspector' : 'Collapse inspector'}
                  title={inspectorCollapsed ? 'Expand inspector' : 'Collapse inspector'}
                >
                  {inspectorCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
                </button>
              </div>
              {versionsLoading ? (
                <div className="text-sm text-slate-600">Loading versions...</div>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <GitBranch className="h-4 w-4 text-slate-600" />
                    <select
                      value={selectedVersion}
                      onChange={(e) => handleVersionSelect(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-950 outline-none transition focus:border-sky-500"
                    >
                      {filteredVersions.map((version) => (
                        <option key={version.tag} value={version.tag}>
                          {version.tag}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={showAllVersions}
                      onChange={(e) => setShowAllVersions(e.target.checked)}
                      className="rounded border-slate-300 bg-slate-100"
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
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-500 focus:border-sky-500"
              />
              <SecondaryButton className="px-3 py-2" onClick={handleLoadFile} disabled={!isValidFilePath(pathInput) || fileLoading}>
                {fileLoading ? 'Opening...' : 'Open file'}
              </SecondaryButton>
              {currentExternal && (
                <a
                  href={currentExternal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-300 hover:bg-slate-200"
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
          style={{ '--nav-width': `${navigatorWidth}px`, '--insp-width': `${inspectorWidth}px` } as React.CSSProperties}
          className={`grid min-h-[calc(100vh-8rem)] gap-0 transition-[grid-template-columns] duration-300 ease-in-out xl:h-[calc(100vh-8rem)] ${
            navigatorCollapsed
              ? 'xl:grid-cols-[3rem_minmax(0,1fr)]'
              : 'xl:grid-cols-[var(--nav-width)_4px_minmax(0,1fr)]'
          }`}
        >
          <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-white xl:border-b-0 xl:border-r">
            {navigatorCollapsed ? (
              <div className="hidden min-h-0 flex-1 flex-col items-center gap-3 px-2 py-4 xl:flex">
                <button
                  type="button"
                  onClick={() => setNavigatorCollapsed(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                  aria-label="Expand navigator"
                  title="Expand navigator"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
                <FolderTree className="h-4 w-4 text-slate-600" />
                <div className="h-px w-5 bg-slate-200" />
                <div className="[writing-mode:vertical-rl] text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                  Navigator
                </div>
              </div>
            ) : (
              <>
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <FolderTree className="h-4 w-4 text-slate-600" />
                Navigator
                </div>
                <button
                  type="button"
                  onClick={() => setNavigatorCollapsed(true)}
                  className="hidden h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-600 transition hover:border-slate-300 hover:text-slate-900 xl:inline-flex"
                  aria-label="Collapse navigator"
                  title="Collapse navigator"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 truncate text-xs text-slate-600">{treePath || 'root'}</p>
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
                  <div className="text-sm font-semibold text-slate-950">Path Browser</div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-scroll px-2 py-2">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTreePath('');
                        void ensureTreeLoaded('');
                      }}
                      className="rounded-lg border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-200"
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
                        className="rounded-lg border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-200"
                      >
                        ..
                      </button>
                    )}
                  </div>

                  {treeLoading && Object.keys(treeCache).length === 0 ? (
                    <div className="text-xs text-slate-600">Loading tree...</div>
                  ) : treeCache['']?.length ? (
                    renderTreeEntries('')
                  ) : (
                    <div className="text-xs text-slate-600">No entries here.</div>
                  )}
                </div>
              </div>
            </div>
              </>
            )}
          </aside>

          {!navigatorCollapsed && (
            <div
              className="hidden cursor-col-resize bg-slate-100 transition-colors hover:bg-sky-100 xl:block"
              onPointerDown={(e) => {
                navResizeRef.current = { startX: e.clientX, startWidth: navigatorWidth };
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
            />
          )}

          <div className="flex min-h-0 min-w-0 flex-col bg-white">
            <div className="min-h-0 flex-1">
              <div
                className={`grid h-full min-h-0 gap-0 transition-[grid-template-columns] duration-300 ease-in-out ${
                  inspectorCollapsed
                    ? 'xl:grid-cols-[minmax(0,1fr)_3rem]'
                    : 'xl:grid-cols-[minmax(0,1fr)_4px_var(--insp-width)]'
                }`}
              >
                <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
                  <div className="border-b border-slate-200 px-4 py-3">
                  <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                        <span className="font-medium uppercase tracking-[0.16em] text-slate-600">Code Target</span>
                        {pathSegments.length > 0 && <ChevronRight className="h-3.5 w-3.5" />}
                        {pathSegments.map((segment, index) => (
                          <div key={`${segment}-${index}`} className="flex items-center gap-1">
                            <span className={index === pathSegments.length - 1 ? 'font-medium text-slate-900' : ''}>
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
                      <div className="mt-0.5 text-xs text-slate-600">
                        {fileFacts}
                        {selectedSymbol ? ` · symbol ${selectedSymbol}` : ''}
                      </div>
                    </div>

                    {currentExternal && (
                      <a
                        href={currentExternal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-900 transition hover:border-slate-300 hover:bg-slate-200"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open source
                      </a>
                    )}
                  </div>
                </div>

                  <div
                    ref={codeViewRef}
                    onScroll={handleCodeScroll}
                    onMouseUp={handleCodeMouseUp}
                    data-active-center-line={activeCenterLine ?? undefined}
                    data-active-annotation-id={activeAnnotation?.annotation_id ?? undefined}
                    data-pinned-annotation-id={pinnedAnnotation?.annotation_id ?? undefined}
                    className="relative min-h-0 flex-1 overflow-y-scroll bg-white"
                  >
                  {fileLoading ? (
                    <div className="px-6 py-12 text-sm text-slate-600">Opening file...</div>
                  ) : isDirectoryView ? (
                    <EmptyState
                      title="Directory expanded in navigator"
                      description="Use the left tree to browse directories, then choose a file to open it here."
                    />
                  ) : currentFile ? (
                    <div className="inline-block min-w-max font-mono text-[13px] leading-[20px]">
                      {codeLines.map((line, index) => {
                        const lineNum = index + 1;
                        const isSelected = selectedLines.has(lineNum);
                        const annotationCount = annotationCountByLine.get(lineNum) || 0;
                        const linePicked = pickKernelSourceUrl(selectedVersion, currentPath, lineNum);
                        return (
                          <div
                            key={lineNum}
                            data-line={lineNum}
                            className={`group grid w-max grid-cols-[14px_52px_max-content_24px] border-b border-slate-200 px-3 ${
                              isSelected ? 'bg-sky-50 border-l-2 border-l-sky-500' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center justify-center">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  annotationCount > 0 ? 'bg-sky-400' : isSelected ? 'bg-sky-400' : 'bg-transparent'
                                }`}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={(e) => handleLineClick(lineNum, e)}
                              className="select-none border-0 bg-transparent py-0.5 pr-3 text-right text-[11px] text-slate-600 transition hover:text-slate-700 focus:outline-none"
                              title={`Select line ${lineNum}`}
                            >
                              {lineNum}
                            </button>
                            <div className="whitespace-pre py-0.5 pr-8 text-slate-900">
                              {renderHighlightedLine(line)}
                            </div>
                            <a
                              href={linePicked.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center justify-center text-slate-600 opacity-0 transition hover:text-sky-800 group-hover:opacity-100"
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

                {!inspectorCollapsed && (
                  <div
                    className="hidden cursor-col-resize bg-slate-100 transition-colors hover:bg-sky-100 xl:block"
                    onPointerDown={(e) => {
                      inspResizeRef.current = { startX: e.clientX, startWidth: inspectorWidth };
                      document.body.style.cursor = 'col-resize';
                      document.body.style.userSelect = 'none';
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    }}
                  />
                )}

                <aside className="flex min-h-0 max-h-[calc(100vh-8rem)] flex-col overflow-y-auto border-t border-slate-200 bg-white xl:overflow-hidden xl:border-l xl:border-t-0">
                  {inspectorCollapsed ? (
                    <div className="hidden min-h-0 flex-1 flex-col items-center gap-3 px-2 py-4 xl:flex">
                      <button
                        type="button"
                        onClick={() => setInspectorCollapsed(false)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                        aria-label="Expand inspector"
                        title="Expand inspector"
                      >
                        <PanelRightOpen className="h-4 w-4" />
                      </button>
                      <BookOpenText className="h-4 w-4 text-slate-600" />
                      <div className="h-px w-5 bg-slate-200" />
                      <div className="[writing-mode:vertical-rl] text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                        Inspector
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="border-b border-slate-200 px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                            <BookOpenText className="h-4 w-4 text-slate-600" />
                            Inspector
                          </div>
                          <button
                            type="button"
                            onClick={() => setInspectorCollapsed(true)}
                            className="hidden h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-600 transition hover:border-slate-300 hover:text-slate-900 xl:inline-flex"
                            aria-label="Collapse inspector"
                            title="Collapse inspector"
                          >
                            <PanelRightClose className="h-4 w-4" />
                          </button>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-600">Target, notes, evidence.</p>
                      </div>

                      <div className="border-b border-slate-200 px-4 py-2">
                        <div className="flex flex-wrap gap-2">
                          {(Object.keys(INSPECTOR_VIEW_LABELS) as InspectorView[]).map((view) => {
                            const active = inspectorView === view;
                            const count = inspectorViewCount(view, {
                              annotations: annotations.length,
                              threads: relatedThreadPreviews.length,
                              knowledge: relatedKnowledgeEntities.length,
                            });
                            return (
                              <button
                                key={view}
                                type="button"
                                onClick={() => setInspectorView(view)}
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                  active
                                    ? 'border-sky-300 bg-sky-50 text-sky-800'
                                    : 'border-slate-300 bg-slate-100 text-slate-600 hover:border-slate-300 hover:text-slate-900'
                                }`}
                              >
                                <span>{INSPECTOR_VIEW_LABELS[view]}</span>
                                {count !== null && (
                                  <span
                                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                                      active ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-600'
                                    }`}
                                  >
                                    {count}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 space-y-3 overflow-y-scroll overscroll-contain px-4 py-4">
                        {inspectorView === 'overview' && (
                          <div className="space-y-3">
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                                    <Pin className="h-4 w-4 text-slate-600" />
                                    Code Target
                                  </div>
                                  <div className="mt-1 text-xs text-slate-600">Stable target for reading and notes.</div>
                                </div>
                                <StatusBadge tone={relatedAnnotations.length > 0 ? 'success' : 'warning'}>
                                  {targetHealthLabel}
                                </StatusBadge>
                              </div>
                              <dl className="mt-4 space-y-2">
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

                              <div className="mt-4 grid gap-2">
                                {selectedSymbol && (
                                  <a
                                    href={elixirIdentUrl(selectedVersion || 'latest', selectedSymbol)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:border-slate-300 hover:bg-slate-200"
                                  >
                                    <ScrollText className="h-3.5 w-3.5" />
                                    Search symbol
                                  </a>
                                )}
                              </div>
                            </div>

                            {currentFile && selectedRange && (
                              <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                                      <Layers3 className="h-4 w-4 text-slate-600" />
                                      Tags
                                    </div>
                                    <div className="mt-1 text-xs text-slate-600">Labels attached to the selected range.</div>
                                  </div>
                                  <span className="text-[10px] font-medium text-slate-600">{selectedTargetTags.length}</span>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {targetTagsLoading ? (
                                    <span className="text-xs text-slate-600">Loading tags...</span>
                                  ) : selectedTargetTags.length > 0 ? (
                                    selectedTargetTags.map((tag) => (
                                      <span
                                        key={tag.slug}
                                        className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800"
                                      >
                                        {tag.name}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-xs text-slate-600">No tags on this range.</span>
                                  )}
                                </div>
                                <div className="mt-3 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2">
                                  <EmailTagEditor
                                    targetType="kernel_line_range"
                                    targetRef={selectedTargetRef}
                                    anchor={selectedTargetAnchorExpanded ?? undefined}
                                    compact
                                    placeholder="Tag this code target"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {inspectorView === 'history' && (
                          currentFile ? (
                            <InspectorSection
                              title="History"
                              icon={<GitCommitHorizontal className="h-4 w-4" />}
                              collapsed={collapsedInspectorSections.has('history')}
                              onToggle={() => toggleInspectorSection('history')}
                              headerExtra={
                                selectedRange ? (
                                  <span className="text-[10px] font-medium text-slate-600">{selectedRangeLabel}</span>
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
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                              Load a file to inspect history.
                            </div>
                          )
                        )}

                        {inspectorView === 'annotations' && (
                          currentFile ? (
                            <InspectorSection
                              title="Annotations"
                              icon={<MessagesSquare className="h-4 w-4" />}
                              collapsed={collapsedInspectorSections.has('annotations')}
                              onToggle={() => toggleInspectorSection('annotations')}
                              headerExtra={
                                selectedLines.size > 0 ? (
                                  <span className="text-[10px] font-medium text-slate-600">{selectedRangeLabel}</span>
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
                                activeAnnotationId={activeAnnotation?.annotation_id || null}
                                pinnedAnnotationId={pinnedAnnotation?.annotation_id || null}
                                rollerContainerRef={annotationPanelRef}
                              />
                            </InspectorSection>
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                              Load a file to inspect annotations.
                            </div>
                          )
                        )}

                        {inspectorView === 'links' && (
                          <div className="space-y-3">
                            <InspectorSection
                              title="Threads"
                              icon={<MessagesSquare className="h-4 w-4" />}
                              collapsed={collapsedInspectorSections.has('threads')}
                              onToggle={() => toggleInspectorSection('threads')}
                              headerExtra={
                                relatedThreadPreviews.length > 0 ? (
                                  <span className="text-[10px] font-medium text-slate-600">{relatedThreadPreviews.length}</span>
                                ) : null
                              }
                            >
                              <div className="space-y-2">
                                {relatedThreadsLoading ? (
                                  <div className="text-xs text-slate-600">Loading thread context...</div>
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
                                      className="block w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-left transition hover:border-sky-400 hover:bg-sky-100"
                                    >
                                      <div className="truncate text-xs font-semibold text-slate-950">{thread.subject}</div>
                                      <div className="mt-1 text-[11px] text-slate-600">
                                        {thread.emailCount} mails · {thread.annotationCount} notes · {thread.patchCount} patches
                                      </div>
                                    </button>
                                  ))
                                ) : (
                                  <div className="text-xs leading-5 text-slate-600">No thread backlinks for this selection yet.</div>
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
                                  <span className="text-[10px] font-medium text-slate-600">{relatedKnowledgeEntities.length}</span>
                                ) : null
                              }
                            >
                              <div className="space-y-2">
                                {relatedKnowledgeLoading ? (
                                  <div className="text-xs text-slate-600">Loading linked knowledge...</div>
                                ) : relatedKnowledgeEntities.length > 0 ? (
                                  relatedKnowledgeEntities.slice(0, 4).map((entity) => (
                                    <div
                                      key={entity.entity_id}
                                      className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2"
                                    >
                                      <div className="truncate text-xs font-semibold text-slate-950">
                                        {entity.canonical_name || entity.entity_id}
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-600">
                                        {entity.entity_type} · {entity.status || 'linked evidence'}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-xs leading-5 text-slate-600">No knowledge backlinks surfaced yet.</div>
                                )}
                              </div>
                            </InspectorSection>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </aside>
              </div>
            </div>
          </div>
        </div>
      </SectionPanel>

      {symbolPopover && (() => {
        const popoverTop = Math.min(symbolPopover.y, window.innerHeight - 48);
        const popoverLeft = Math.min(symbolPopover.x, window.innerWidth - 420);
        const maxCandidateHeight = Math.max(120, window.innerHeight - popoverTop - 160);

        return (
        <div
          data-symbol-popover
          style={{
            position: 'fixed',
            left: popoverLeft,
            top: popoverTop,
            zIndex: 50,
          }}
          className="w-[380px] select-none rounded-lg border border-slate-300 bg-white shadow-2xl shadow-slate-900/15"
        >
          <div
            className="flex cursor-move items-start justify-between gap-3 rounded-t-lg bg-gradient-to-r from-slate-50 to-white px-4 pt-4"
            onPointerDown={(e) => {
              if (!symbolPopover) return;
              popoverDragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                popoverX: symbolPopover.x,
                popoverY: symbolPopover.y,
              };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
          >
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                Symbol
              </div>
              <code className="mt-1 block truncate text-sm font-mono text-sky-700">
                {symbolPopover.symbol}
              </code>
              {selectedSymbol && selectedSymbol !== symbolPopover.symbol && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                    from <code className="font-medium">{selectedSymbol}</code>
                  </span>
                </div>
              )}
            </div>
            <IconButton
              label="Close symbol search"
              onClick={() => setSymbolPopover(null)}
              className="h-7 w-7 border-none"
            >
              <span className="text-sm">×</span>
            </IconButton>
          </div>

          <div className="px-3 pb-3 pt-2">
            {symbolResolve?.loading ? (
              <div className="text-xs text-slate-600">Querying Elixir for matching definitions...</div>
            ) : symbolResolve?.error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
                {symbolResolve.error}
              </div>
            ) : null}

            {symbolResolve?.result?.fallback_reason ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                {symbolResolve.result.fallback_reason}
              </div>
            ) : null}

            {!symbolResolve?.loading && symbolResolve?.result && symbolResolve.result.candidates.length === 0 ? (
              <div className="text-xs leading-5 text-slate-600">
                No Elixir candidates found for this symbol.
              </div>
            ) : null}

            <div
              className="space-y-1.5"
              style={{ maxHeight: maxCandidateHeight, overflowY: 'auto' }}
            >
              {symbolResolve?.result?.candidates.map((candidate) => (
                <div
                  key={`${candidate.path}:${candidate.line}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-300 px-3 py-2 transition hover:border-sky-400 hover:bg-sky-100"
                >
                  <button
                    type="button"
                    onClick={(event) =>
                      handleSymbolCandidateClick(
                        candidate,
                        symbolPopover?.symbol || '',
                        event,
                      )
                    }
                    className="min-w-0 flex-1 text-left"
                    title="Single click for floating preview"
                  >
                    <div className="truncate text-xs font-medium text-slate-950">
                      {candidate.path}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-600">
                      L{candidate.line}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-600">
                      {symbolCandidateLabels[`${candidate.version}:${candidate.path}:${candidate.line}`]
                        ? `in ${symbolCandidateLabels[`${candidate.version}:${candidate.path}:${candidate.line}`]}`
                        : candidate.local_file_available
                          ? 'symbol pending'
                          : 'symbol unavailable'}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        candidate.local_file_available
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {candidate.local_file_available ? 'Local' : 'Elixir'}
                    </span>
                    <a
                      href={candidate.local_file_available ? candidate.local_url : candidate.external_url}
                      target={candidate.local_file_available ? '_self' : '_blank'}
                      rel={candidate.local_file_available ? undefined : 'noopener noreferrer'}
                      onClick={() => setSymbolPopover(null)}
                      className="rounded-md border border-slate-300 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:border-sky-400 hover:text-sky-800"
                    >
                      跳转
                    </a>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <a
                href={symbolResolve?.result?.query_url || elixirIdentUrl(selectedVersion || 'latest', symbolPopover.symbol)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSymbolPopover(null)}
                className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 transition hover:text-sky-800"
              >
                Open Elixir search
                <ExternalLink className="h-3 w-3" />
              </a>
              <span className="text-[11px] text-slate-600">
                {symbolResolve?.loading
                  ? 'Searching'
                  : symbolResolve?.result
                    ? symbolResolve.result.resolved
                      ? `${symbolResolve.result.candidates.length} matches`
                      : 'No matches'
                  : 'Ready'}
              </span>
            </div>
            <div className="pt-1 text-[11px] leading-5 text-slate-600">
              Single click opens the floating preview. Click outside the preview or double click its title bar to close it.
            </div>
          </div>
        </div>
        );
      })()}

      <KernelSymbolQuickPreviewPopover
        isOpen={!!symbolQuickPreview}
        candidate={symbolQuickPreview?.candidate || null}
        symbol={symbolQuickPreview?.symbol}
        anchorRect={symbolQuickPreview?.anchorRect || null}
        avoidRect={symbolQuickPreview?.avoidRect || null}
        onClose={() => setSymbolQuickPreview(null)}
        onOpenPage={handlePreviewOpenPage}
      />

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
