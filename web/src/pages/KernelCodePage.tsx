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
} from '../api/client';
import type {
  CodeAnnotation,
  KnowledgeEntity,
  KernelFileResponse,
  KernelTreeEntry,
  KernelVersionInfo,
  TagRead,
} from '../api/types';
import EmailTagEditor from '../components/EmailTagEditor';
import ThreadDrawer from '../components/ThreadDrawer';
import { showToast } from '../components/Toast';
import AnnotationPanel from '../components/kernelCode/AnnotationPanel';
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

  const sortEntries = useCallback(
    (entries: KernelTreeEntry[]) =>
      entries.slice().sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [],
  );

  const loadTree = useCallback(async (path: string = '', options?: { silent?: boolean }) => {
    if (!selectedVersion) return;
    setTreeLoading(true);
    try {
      const res = await getKernelTree(selectedVersion, path);
      const sorted = sortEntries(res.entries);
      setTreeCache((prev) => ({ ...prev, [res.path]: sorted }));
      return { path: res.path, entries: sorted };
    } catch (e: unknown) {
      if (!options?.silent) {
        showToast(e instanceof Error ? e.message : 'Failed to load file tree', 'error');
      }
      return null;
    } finally {
      setTreeLoading(false);
    }
  }, [selectedVersion, sortEntries]);

  const ensureTreeLoaded = useCallback(
    async (path: string = '') => {
      const cached = treeCache[path];
      if (cached) return { path, entries: cached };
      return loadTree(path);
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
      return matchedEntry.type === 'directory' ? 'directory' : 'file';
    },
    [currentFile, currentPath, currentPathKind, treeCache],
  );

  const expandAncestors = useCallback(
    async (path: string, includeSelf: boolean) => {
      const parts = path.split('/').filter(Boolean);
      const dirSegments = includeSelf ? parts : parts.slice(0, -1);
      if (dirSegments.length === 0) {
        setExpandedTreePaths(new Set());
        setTreePath('');
        await ensureTreeLoaded('');
        return;
      }
      const nextExpanded = new Set<string>();
      let prefix = '';
      for (const segment of dirSegments) {
        prefix = prefix ? `${prefix}/${segment}` : segment;
        nextExpanded.add(prefix);
        await ensureTreeLoaded(prefix);
      }
      setExpandedTreePaths(nextExpanded);
      setTreePath(dirSegments[dirSegments.length - 1] ? dirSegments.join('/') : '');
      await ensureTreeLoaded('');
    },
    [ensureTreeLoaded],
  );

  const openDirectory = useCallback(
    async (path: string) => {
      if (!selectedVersion) return;
      setCurrentPath(path);
      setCurrentPathKind('directory');
      setCurrentFile(null);
      setDirectoryEntries([]);
      setAnnotations([]);
      setSelectedLines(new Set());
      setPathInput(path);
      setSearchParams({ v: selectedVersion, path }, { replace: true });
      const tree = await ensureTreeLoaded(path);
      if (!tree) return;
      setDirectoryEntries(tree.entries);
      await expandAncestors(path, true);
    },
    [ensureTreeLoaded, expandAncestors, selectedVersion, setSearchParams],
  );

  const loadFile = useCallback(async (path: string, targetLine?: number | null) => {
    if (!selectedVersion || !path) return;
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
        getKernelFile(selectedVersion, path),
        getCodeAnnotations(selectedVersion, path).catch(() => [] as CodeAnnotation[]),
      ]);
      setCurrentFile(fileRes);
      setAnnotations(annotRes);
      await expandAncestors(path, false);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
      setCurrentFile(null);
      setCurrentPathKind(null);
    } finally {
      setFileLoading(false);
    }
  }, [expandAncestors, selectedVersion, setSearchParams, urlLine]);

  const openPath = useCallback(
    async (path: string, targetLine?: number | null) => {
      if (!selectedVersion || !path) return;
      if (path === currentPath && currentPathKind === 'directory') {
        return;
      }
      if (path === currentPath && currentPathKind === 'file' && currentFile?.path === path) {
        const focusTarget = targetLine ?? urlLine;
        setSelectedLines(focusTarget ? new Set([focusTarget]) : new Set());
        return;
      }
      const knownKind = resolveKnownPathKind(path);
      if (knownKind === 'directory') {
        await openDirectory(path);
        return;
      }
      if (knownKind === 'file') {
        await loadFile(path, targetLine);
        return;
      }
      const tree = await loadTree(path, { silent: true });
      if (tree) {
        await openDirectory(path);
        return;
      }
      await loadFile(path, targetLine);
    },
    [
      currentFile,
      currentPath,
      currentPathKind,
      loadFile,
      loadTree,
      openDirectory,
      resolveKnownPathKind,
      selectedVersion,
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
    setSelectedVersion(tag);
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

  function scrollToLine(line: number) {
    window.requestAnimationFrame(() => {
      const container = codeViewRef.current;
      const target = container?.querySelector<HTMLElement>(`[data-line="${line}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

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

  function handleLineClick(line: number) {
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
          const isDirectory = entry.type === 'directory';
          const isExpanded = expandedTreePaths.has(entry.path);
          const isActive = entry.path === currentPath;
          const entryPicked = entry.type === 'file' ? pickKernelSourceUrl(selectedVersion, entry.path) : null;
          return (
            <div key={entry.path}>
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
                      toggleTreeDirectory(entry.path);
                      void openDirectory(entry.path);
                    } else {
                      void loadFile(entry.path);
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
              {isDirectory && isExpanded && <div className="mt-0.5">{renderTreeEntries(entry.path, depth + 1)}</div>}
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
                  ) : treeCache[treePath]?.length ? (
                    renderTreeEntries(treePath)
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
                    <div className="px-3 py-3">
                      <div className="mb-2 flex items-center justify-between px-3 text-xs text-slate-500">
                        <span>{currentPath || 'root'}</span>
                        <span>{directoryEntries.length.toLocaleString()} entries</span>
                      </div>
                      <div className="overflow-hidden rounded-xl border border-slate-200">
                        {directoryEntries.length > 0 ? (
                          directoryEntries.map((entry) => {
                            const entryPicked = pickKernelSourceUrl(selectedVersion, entry.path);
                            return (
                              <div
                                key={entry.path}
                                className="group grid grid-cols-[24px_minmax(0,1fr)_88px_24px] items-center border-b border-slate-100/80 px-3 py-2 text-sm last:border-b-0 hover:bg-slate-50"
                              >
                                <span className={entry.type === 'directory' ? 'text-sky-600' : 'text-slate-400'}>
                                  {entry.type === 'directory' ? <FolderTree className="h-4 w-4" /> : <FileCode2 className="h-4 w-4" />}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (entry.type === 'directory') {
                                      toggleTreeDirectory(entry.path);
                                      void openDirectory(entry.path);
                                    } else {
                                      void loadFile(entry.path);
                                    }
                                  }}
                                  className="truncate text-left font-medium text-slate-800"
                                >
                                  {entry.type === 'directory' ? `${entry.name}/` : entry.name}
                                </button>
                                <span className="text-right text-xs text-slate-400">
                                  {entry.type === 'directory' ? 'dir' : formatBytes(entry.size)}
                                </span>
                                <a
                                  href={entryPicked.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-center text-slate-300 opacity-0 transition hover:text-sky-700 group-hover:opacity-100"
                                  title={`Open ${entry.name} upstream`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </div>
                            );
                          })
                        ) : (
                          <div className="px-4 py-8 text-center text-sm text-slate-400">
                            This directory is empty.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : currentFile ? (
                    <div className="w-max min-w-full font-mono text-[12px] leading-[18px]">
                      {codeLines.map((line, index) => {
                        const lineNum = index + 1;
                        const isSelected = selectedLines.has(lineNum);
                        const annotationCount = annotationCountByLine.get(lineNum) || 0;
                        const linePicked = pickKernelSourceUrl(selectedVersion, currentPath, lineNum);
                        return (
                          <div
                            key={lineNum}
                            data-line={lineNum}
                            onClick={() => handleLineClick(lineNum)}
                            className={`group grid cursor-pointer grid-cols-[12px_44px_minmax(max-content,1fr)_22px] border-b border-slate-100/70 px-2 ${
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
                            <div className="min-w-0 whitespace-pre py-0.5 text-slate-800">
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

                <aside className="flex min-h-0 flex-col overflow-hidden border-t border-slate-200 bg-slate-50/80 xl:border-l xl:border-t-0">
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

                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Pin className="h-4 w-4 text-slate-500" />
                          Code Target
                        </div>
                        <div className="mt-1 text-xs text-slate-500">Stable target for reading and notes.</div>
                      </div>
                      <StatusBadge tone={relatedAnnotations.length > 0 ? 'success' : 'warning'}>
                        {targetHealthLabel}
                      </StatusBadge>
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
                  </div>

                    {currentFile ? (
                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
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

                    {currentFile && selectedRange && (
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Layers3 className="h-4 w-4 text-slate-500" />
                          Tags
                        </div>
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
                      </div>
                    )}

                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <MessagesSquare className="h-4 w-4 text-slate-500" />
                        Threads
                      </div>
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
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Library className="h-4 w-4 text-slate-500" />
                        Knowledge
                      </div>
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
                    </div>
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
