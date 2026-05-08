import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpenText,
  Clock3,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode2,
  FolderTree,
  GitBranch,
  Library,
  Layers3,
  Link2,
  MessagesSquare,
  Pin,
  Route,
  ScrollText,
  ShieldCheck,
  Waypoints,
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

function AtlasChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function EvidenceCard({
  icon,
  title,
  subtitle,
  body,
  tone = 'slate',
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  body: string;
  tone?: 'slate' | 'sky' | 'emerald' | 'amber';
}) {
  const toneMap = {
    slate: 'border-slate-200 bg-white',
    sky: 'border-sky-200 bg-sky-50/60',
    emerald: 'border-emerald-200 bg-emerald-50/60',
    amber: 'border-amber-200 bg-amber-50/70',
  } as const;
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneMap[tone]}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-slate-500">{icon}</div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
          <div className="mt-2 text-xs leading-5 text-slate-600">{body}</div>
        </div>
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

  const currentExternal = currentFile
    ? pickKernelSourceUrl(selectedVersion, currentPath, focusLine || undefined)
    : null;

  const selectedVersionIndex = useMemo(
    () => filteredVersions.findIndex((version) => version.tag === selectedVersion),
    [filteredVersions, selectedVersion],
  );

  const nearbyVersions = useMemo(() => {
    if (selectedVersionIndex < 0) return filteredVersions.slice(0, 5);
    const start = Math.max(0, selectedVersionIndex - 2);
    return filteredVersions.slice(start, start + 5);
  }, [filteredVersions, selectedVersionIndex]);

  const currentLinePreview = useMemo(() => {
    if (!focusLine || focusLine < 1 || focusLine > codeLines.length) return '';
    return codeLines[focusLine - 1]?.trim() || '';
  }, [codeLines, focusLine]);
  const fileFacts = currentFile
    ? `${currentFile.line_count.toLocaleString()} lines · ${formatBytes(currentFile.size)}`
    : 'Open a file to inspect source';

  const annotationSnippet = useMemo(
    () => relatedAnnotations[0]?.body?.replace(/\s+/g, ' ').trim() || '',
    [relatedAnnotations],
  );

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
    if (!currentFile) return 'No target loaded';
    if (relatedAnnotations.length > 0 && selectedSymbol) return 'Anchored with notes';
    if (relatedAnnotations.length > 0) return 'Anchored, symbol pending';
    if (selectedLines.size > 0) return 'Ready for annotation';
    return 'Reading context only';
  }, [currentFile, relatedAnnotations.length, selectedLines.size, selectedSymbol]);

  const targetNarrative = useMemo(() => {
    if (!currentFile) {
      return 'Load a file and pin a code range to gather annotations, tags, and related evidence around one stable code target.';
    }
    if (relatedAnnotations.length > 0) {
      return `This range already carries ${relatedAnnotations.length} linked annotation${relatedAnnotations.length === 1 ? '' : 's'}, so Atlas can use it as a stable evidence anchor.`;
    }
    if (selectedLines.size > 0) {
      return 'The selection is ready to become a shared code target. Add an annotation or tag to persist the reading context.';
    }
    return 'Browse the file first, then pin a line or range so Atlas can attach notes, tags, and related threads to one exact location.';
  }, [currentFile, relatedAnnotations.length, selectedLines.size]);

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
    setAnnotations([]);
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
    setTreeEntries([]);
    setSelectedLines(new Set());
    setSearchParams({ v: tag }, { replace: true });
  }

  function handleLoadFile() {
    if (!isValidFilePath(pathInput)) return;
    void loadFile(pathInput.trim());
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
        description="Versioned code reading with annotations, tags, and backlinks."
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

        <div className="grid gap-0 xl:grid-cols-[14rem_minmax(0,1fr)] 2xl:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 bg-slate-50/70 xl:border-b-0 xl:border-r">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FolderTree className="h-4 w-4 text-slate-500" />
                Atlas Home
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">Version, path, target.</p>
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
                <div className="max-h-[30rem] overflow-y-auto px-3 py-3">
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

          <div className="min-w-0 bg-slate-50/60">
            <div className="border-b border-slate-200 px-4 py-4 2xl:px-5">
              <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_19rem]">
                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-4 py-3">
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
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <h2 className="truncate text-base font-semibold text-slate-950">
                          {currentPath || 'Select a file to start reading'}
                        </h2>
                        <StatusBadge tone="muted">{selectedVersion || 'No version'}</StatusBadge>
                        <StatusBadge tone="info">{selectedRangeLabel}</StatusBadge>
                        {selectedSymbol && <StatusBadge tone="success">{selectedSymbol}</StatusBadge>}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {fileFacts}
                        {selectedSymbol ? ` · symbol ${selectedSymbol}` : ''}
                      </div>
                    </div>

                    {currentExternal && (
                      <a
                        href={currentExternal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
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
                    className="relative max-h-[74vh] overflow-auto bg-white"
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
                            data-line={lineNum}
                            onClick={() => handleLineClick(lineNum)}
                            className={`group grid cursor-pointer grid-cols-[18px_56px_minmax(0,1fr)_24px] border-b border-slate-100/80 px-3 ${
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
                </div>

                <aside className="self-start overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 shadow-sm 2xl:sticky 2xl:top-4">
                  <div className="border-b border-slate-200 px-5 py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <BookOpenText className="h-4 w-4 text-slate-500" />
                    Inspector
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Target metadata and annotation actions.</p>
                </div>

                  <div className="space-y-4 px-4 py-4">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
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
                          className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <ScrollText className="h-3.5 w-3.5" />
                          Search symbol
                        </a>
                      )}
                    </div>
                  </div>

                    {currentFile ? (
                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
            </div>

            {currentFile && (
              <div className="bg-slate-50/80 px-4 py-4 2xl:px-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Link2 className="h-4 w-4 text-slate-500" />
                  Evidence Stack
                </div>
                <div className="grid gap-4 2xl:grid-cols-2">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Target Brief
                          </div>
                          <div className="mt-2 text-base font-semibold text-slate-950">
                            {currentPath || 'No file selected'}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">{targetNarrative}</div>
                        </div>
                        <div className="grid min-w-[220px] gap-2 sm:grid-cols-2">
                          <AtlasChip label="Range" value={selectedRangeLabel} />
                          <AtlasChip label="Health" value={targetHealthLabel} />
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 xl:grid-cols-2">
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
                          title="Annotation layer"
                          subtitle={`${relatedAnnotations.length} linked note${relatedAnnotations.length === 1 ? '' : 's'}`}
                          detail={
                            annotationSnippet
                              ? annotationSnippet.slice(0, 140)
                              : 'No note attached to this range yet. Create one from the inspector.'
                          }
                        />
                        <RelatedCard
                          title="Resolver status"
                          subtitle={currentExternal ? currentExternal.source : 'pending'}
                          detail={
                            currentExternal
                              ? `Primary reading link currently resolves through ${currentExternal.source}. Atlas still keeps the local code target stable for notes and tags.`
                              : 'External source links appear once a file is loaded.'
                          }
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <EvidenceCard
                        icon={<MessagesSquare className="h-4 w-4" />}
                        title="Patch / Thread Bridge"
                        subtitle="Mail discussions connect here"
                        tone="sky"
                        body={
                          focusLine
                            ? `Patch hunk links can now land on ${selectedVersion}:${currentPath}:L${focusLine}. The next closure step is surfacing matching threads directly in this panel.`
                            : 'Select a line to anchor patch and thread evidence to one exact code target.'
                        }
                      />
                      <EvidenceCard
                        icon={<ShieldCheck className="h-4 w-4" />}
                        title="Knowledge Evidence"
                        subtitle="Shared interpretation layer"
                        tone="emerald"
                        body={
                          relatedAnnotations.length > 0
                            ? `This range already has ${relatedAnnotations.length} note${relatedAnnotations.length === 1 ? '' : 's'} and ${selectedTargetTags.length} visible tag${selectedTargetTags.length === 1 ? '' : 's'}, so it is ready to accumulate downstream review context.`
                            : 'Once a note or tag exists here, Atlas can treat this location as a reusable evidence handle across code, mail, and knowledge views.'
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Waypoints className="h-4 w-4 text-slate-500" />
                        Version Trail
                      </div>
                      <div className="mt-3 space-y-2">
                        {nearbyVersions.map((version) => {
                          const active = version.tag === selectedVersion;
                          return (
                            <button
                              key={version.tag}
                              type="button"
                              onClick={() => handleVersionSelect(version.tag)}
                              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                                active
                                  ? 'border-sky-200 bg-sky-50 text-sky-800'
                                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                              }`}
                            >
                              <span className="font-medium">{version.tag}</span>
                              <span className="text-xs text-slate-400">
                                {version.kind === 'release' ? 'release' : 'rc'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Clock3 className="h-4 w-4 text-slate-500" />
                        Selection Feed
                      </div>
                      <div className="mt-3 space-y-3">
                        <EvidenceCard
                          icon={<Pin className="h-4 w-4" />}
                          title={focusLine ? `Pinned at L${focusLine}` : 'No pinned line yet'}
                          subtitle={selectedSymbol || 'Symbol inference pending'}
                          body={
                            currentLinePreview
                              ? currentLinePreview
                              : 'Pick a line to expose the exact code slice that Atlas will use as the evidence handle.'
                          }
                          tone="amber"
                        />
                        <EvidenceCard
                          icon={<Route className="h-4 w-4" />}
                          title="Atlas Workflow"
                          subtitle="Read -> pin -> tag / annotate -> bridge"
                          body={
                            selectedTargetTags.length > 0
                              ? `This target already carries ${selectedTargetTags.length} visible tag${selectedTargetTags.length === 1 ? '' : 's'}, so the next useful step is surfacing matching threads and knowledge backlinks in the same stack.`
                              : 'The current shell now supports stable code targets, patch hunk entry points, and code annotations. The next UI step is bringing related threads and tags into this same evidence stack.'
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {currentFile && selectedRange && (
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Layers3 className="h-4 w-4 text-slate-500" />
                          Target Tags
                        </div>
                        <div className="space-y-3">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              Direct tags
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {targetTagsLoading ? (
                                <span className="text-xs text-slate-500">Loading tags...</span>
                              ) : targetDirectTags.length > 0 ? (
                                targetDirectTags.map((tag) => (
                                  <span
                                    key={`direct-${tag.slug}`}
                                    className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800"
                                  >
                                    {tag.name}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-slate-400">No direct tags on this exact range yet.</span>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              Visible coverage
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {targetAggregatedTags.length > 0 ? (
                                targetAggregatedTags.map((tag) => (
                                  <span
                                    key={`agg-${tag.slug}`}
                                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800"
                                  >
                                    {tag.name}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-slate-400">No inherited or aggregated tags surfaced yet.</span>
                              )}
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                            <div className="mb-2 text-xs text-slate-500">
                              Add a tag directly to {selectedRangeLabel} so mail, patch, and code readers can converge on the same target.
                            </div>
                            <EmailTagEditor
                              targetType="kernel_line_range"
                              targetRef={selectedTargetRef}
                              anchor={selectedTargetAnchorExpanded ?? undefined}
                              compact
                              placeholder="Tag this code target"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <MessagesSquare className="h-4 w-4 text-slate-500" />
                        Annotation Stack
                      </div>
                      <div className="space-y-3">
                        {relatedAnnotations.length > 0 ? (
                          relatedAnnotations.slice(0, 3).map((annotation) => (
                            <button
                              key={annotation.annotation_id}
                              type="button"
                              onClick={() => handleSelectRange(annotation.start_line, annotation.end_line)}
                              className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-sky-200 hover:bg-sky-50/50"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-slate-900">
                                    L{annotation.start_line}
                                    {annotation.end_line !== annotation.start_line ? `-${annotation.end_line}` : ''}
                                  </div>
                                  <div className="mt-1 text-xs leading-5 text-slate-600">
                                    {annotation.body.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Empty note'}
                                  </div>
                                </div>
                                <StatusBadge
                                  tone={
                                    annotation.publish_status === 'approved'
                                      ? 'success'
                                      : annotation.publish_status === 'pending'
                                        ? 'warning'
                                        : 'muted'
                                  }
                                >
                                  {annotation.publish_status}
                                </StatusBadge>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs leading-5 text-slate-500">
                            No saved annotations overlap the current selection yet. Pin a line or range, then use the panel below to create the first shared note.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <MessagesSquare className="h-4 w-4 text-slate-500" />
                        Related Threads
                      </div>
                      <div className="space-y-3">
                        {relatedThreadsLoading ? (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                            Loading thread context...
                          </div>
                        ) : relatedThreadPreviews.length > 0 ? (
                          relatedThreadPreviews.slice(0, 3).map((thread) => (
                            <div
                              key={thread.threadId}
                              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setThreadOpen({
                                    threadId: thread.threadId,
                                    focusMessageId: thread.focusMessageId,
                                  })
                                }
                                className="block w-full text-left"
                              >
                                <div className="text-sm font-semibold text-slate-900">{thread.subject}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {thread.emailCount} mails · {thread.annotationCount} notes · {thread.patchCount} patches
                                </div>
                              </button>
                              {(thread.matchedPatchCount > 0 || thread.leadPatch?.matchedHunks.length) && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {thread.matchedPatchCount > 0 && (
                                    <StatusBadge tone="info">
                                      {thread.matchedPatchCount} file hit{thread.matchedPatchCount === 1 ? '' : 's'}
                                    </StatusBadge>
                                  )}
                                  {(thread.leadPatch?.matchedHunks || []).slice(0, 3).map((hunk) => (
                                    <button
                                      key={`${thread.threadId}-${hunk.startLine}-${hunk.endLine}`}
                                      type="button"
                                      onClick={() => handleSelectRange(hunk.startLine, hunk.endLine)}
                                      className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
                                    >
                                      L{hunk.startLine}
                                      {hunk.endLine !== hunk.startLine ? `-${hunk.endLine}` : ''}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs leading-5 text-slate-500">
                            No thread backlinks surfaced for this selection yet. Patch-driven annotations will start to make this column denser.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Library className="h-4 w-4 text-slate-500" />
                        Knowledge Backlinks
                      </div>
                      <div className="space-y-3">
                        {relatedKnowledgeLoading ? (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                            Loading linked knowledge...
                          </div>
                        ) : relatedKnowledgeEntities.length > 0 ? (
                          relatedKnowledgeEntities.slice(0, 4).map((entity) => (
                            <div
                              key={entity.entity_id}
                              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900">
                                    {entity.canonical_name || entity.entity_id}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {entity.entity_type} · {entity.status || 'linked evidence'}
                                  </div>
                                </div>
                                <StatusBadge tone="muted">{entity.status || 'active'}</StatusBadge>
                              </div>
                              {entity.summary && (
                                <div className="mt-2 text-xs leading-5 text-slate-600">
                                  {entity.summary.slice(0, 180)}
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs leading-5 text-slate-500">
                            No knowledge entities point back to the messages behind this target yet.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Layers3 className="h-4 w-4 text-slate-500" />
                        Atlas Signals
                      </div>
                      <div className="space-y-3">
                        <EvidenceCard
                          icon={<Route className="h-4 w-4" />}
                          title="Selection payload"
                          subtitle={selectedLines.size > 0 ? 'Live target update enabled' : 'Browse-only state'}
                          body="Selection changes the target payload immediately, while the annotation panel below still owns creation and review."
                        />
                        <EvidenceCard
                          icon={<MessagesSquare className="h-4 w-4" />}
                          title="Annotation density"
                          subtitle={`${annotations.length} note${annotations.length === 1 ? '' : 's'} in file`}
                          body={
                            relatedAnnotations.length > 0
                              ? 'The current selection already overlaps saved notes, which means this target is ready for thread and knowledge back-links.'
                              : 'No saved note overlaps the current selection yet. This is still a clean target waiting for its first shared interpretation.'
                          }
                          tone={relatedAnnotations.length > 0 ? 'sky' : 'slate'}
                        />
                        <EvidenceCard
                          icon={<ShieldCheck className="h-4 w-4" />}
                          title="Evidence roadmap"
                          subtitle="Mail / patch / knowledge backlinks"
                          body={
                            selectedTargetTags.length > 0
                              ? `This inspector now shows live tag coverage for the selected code target. The next pass is surfacing related threads and knowledge backlinks next to these same tags and notes.`
                              : 'The visual shell now supports code targets, patch-hunk entry points, annotations, and live target tags. The next pass will stack related threads and knowledge evidence directly in this inspector.'
                          }
                          tone="emerald"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
