import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Clock3,
  ExternalLink,
  GitCommitHorizontal,
  Inbox,
  Link2,
  Loader2,
  Maximize2,
  Search,
  X,
} from 'lucide-react';
import {
  createKnowledgeDraft,
  expandKernelCommitPatchHunk,
  getKernelBlame,
  getKernelCommit,
  getKernelLineHistory,
  listKnowledgeEntities,
} from '../../api/client';
import type { KernelHistoryCommit, KnowledgeEntity } from '../../api/types';
import { useAuth } from '../../auth';
import { showToast } from '../Toast';
import { SecondaryButton, StatusBadge } from '../ui';
import InspectorDetailModal from './InspectorDetailModal';
import {
  buildFilePatchDisplayRows,
  buildCommitPatchModel,
  buildHunkKey,
  mergeExpandedPatchRows,
  normalizePatchExpander,
  normalizePatchRows,
  type CommitPatchDisplayExpanderActionView,
  type CommitPatchDisplayRowView,
  type CommitPatchModel,
  type CommitPatchExpanderRowView,
  type CommitPatchLineRowView,
  type CommitPatchTargetView,
  choosePrimaryTarget,
  type CommitPatchFileView,
  type CommitPatchHunkView,
  type CommitPatchRowView,
  formatChangedFileLabel,
} from './commitPatchModel';

export { buildCommitPatchModel } from './commitPatchModel';

type SelectedRange = {
  startLine: number;
  endLine: number;
};

interface CodeHistoryPanelProps {
  version: string;
  filePath: string;
  selectedRange: SelectedRange | null;
  selectedText: string;
  onOpenCommitTarget?: (target: CommitPatchTargetView) => void;
}

function formatLineRange(range: SelectedRange | null): string {
  if (!range) return 'No selection';
  if (range.startLine === range.endLine) return `L${range.startLine}`;
  return `L${range.startLine}-${range.endLine}`;
}

function formatCommitTime(value: string): string {
  if (!value) return 'unknown date';
  if (/^\d+$/.test(value)) {
    const date = new Date(Number(value) * 1000);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

function commitTone(commit: KernelHistoryCommit): 'muted' | 'info' | 'success' | 'warning' {
  if (commit.trailers?.Fixes?.length) return 'warning';
  if (commit.has_lore_link) return 'info';
  if (/fix|regression|bug|revert/i.test(commit.subject)) return 'warning';
  if (/introduce|add|implement|change|switch|convert/i.test(commit.subject)) return 'success';
  return 'muted';
}

function commitLabel(commit: KernelHistoryCommit): string {
  if (commit.trailers?.Fixes?.length) return 'Fixes';
  if (/revert/i.test(commit.subject)) return 'Revert';
  if (/fix|regression|bug/i.test(commit.subject)) return 'Bug fix';
  if (/refactor|cleanup|rename/i.test(commit.subject)) return 'Refactor';
  if (/introduce|add|implement|change|switch|convert/i.test(commit.subject)) return 'Behavior';
  return 'History';
}

function uniqueCommits(commits: KernelHistoryCommit[]): KernelHistoryCommit[] {
  const seen = new Set<string>();
  return commits.filter((commit) => {
    if (seen.has(commit.commit_hash)) return false;
    seen.add(commit.commit_hash);
    return true;
  });
}

function buildDefaultClaim(filePath: string, range: SelectedRange | null, commits: KernelHistoryCommit[]): string {
  const lead = commits[0];
  const suffix = lead ? `, especially around ${lead.short_hash} (${lead.subject})` : '';
  return `This code range in ${filePath}:${formatLineRange(range)} is relevant evidence for the implementation history${suffix}.`;
}

function diffLineClass(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('diff ') || trimmed.startsWith('commit ')) return 'bg-amber-50 text-amber-800';
  if (trimmed.startsWith('@@')) return 'bg-sky-50 text-sky-800';
  if (trimmed.startsWith('+++') || trimmed.startsWith('---') || trimmed.startsWith('index ')) {
    return 'bg-slate-100 text-slate-600';
  }
  if (trimmed.startsWith('+')) return 'bg-emerald-50 text-emerald-800';
  if (trimmed.startsWith('-')) return 'bg-rose-50 text-rose-800';
  return 'text-slate-900';
}

function patchRowClass(kind: 'context' | 'add' | 'del' | 'meta'): string {
  if (kind === 'add') return 'bg-[#e6ffec] text-[#1a7f37] hover:bg-[#d8f5dd]';
  if (kind === 'del') return 'bg-[#ffebe9] text-[#cf222e] hover:bg-[#ffd8d3]';
  if (kind === 'meta') return 'bg-slate-100 text-slate-600 hover:bg-slate-100';
  return 'bg-white text-slate-900 hover:bg-slate-50';
}

function patchGutterClass(kind: 'context' | 'add' | 'del' | 'meta'): string {
  if (kind === 'add') return 'bg-[#dafbe1] text-[#1f883d]';
  if (kind === 'del') return 'bg-[#ffcecb] text-[#cf222e]';
  if (kind === 'meta') return 'bg-slate-100 text-slate-500';
  return 'bg-[#f6f8fa] text-slate-500';
}

function patchCodeCellClass(kind: 'context' | 'add' | 'del' | 'meta'): string {
  if (kind === 'meta') return 'text-slate-600';
  if (kind === 'add') return 'text-[#1a7f37]';
  if (kind === 'del') return 'text-[#cf222e]';
  return 'text-slate-900';
}

function buildExpanderKey(hunkKey: string, rowId: string, direction: 'up' | 'down'): string {
  return `${hunkKey}::${rowId}::${direction}`;
}

export function buildPatchRowAnchor(row: Pick<CommitPatchLineRowView, 'oldLine' | 'newLine'>): string {
  return `${row.oldLine ?? 'n'}:${row.newLine ?? 'n'}`;
}

export function findExpansionViewportAnchor(
  rows: CommitPatchRowView[],
  expanderId: string,
  direction: 'up' | 'down',
): string | null {
  const rowIndex = rows.findIndex((row) => row.type === 'expander' && row.id === expanderId);
  if (rowIndex < 0) return null;
  const candidates =
    direction === 'up'
      ? rows.slice(rowIndex + 1)
      : rows
          .slice(0, rowIndex)
          .reverse();
  const anchorRow = candidates.find((row): row is CommitPatchLineRowView => row.type === 'line');
  return anchorRow ? buildPatchRowAnchor(anchorRow) : null;
}

function expanderLabel(direction: 'up' | 'down', hiddenCount: number): string {
  const lineCount = hiddenCount > 0 ? hiddenCount : 20;
  return direction === 'up'
    ? `Expand ${lineCount} lines above`
    : `Expand ${lineCount} lines below`;
}

export default function CodeHistoryPanel({
  version,
  filePath,
  selectedRange,
  selectedText,
  onOpenCommitTarget,
}: CodeHistoryPanelProps) {
  const { canWrite } = useAuth();
  const [blameLoading, setBlameLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [detailLoadingHash, setDetailLoadingHash] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [blame, setBlame] = useState<KernelHistoryCommit | null>(null);
  const [history, setHistory] = useState<KernelHistoryCommit[]>([]);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const [expandedHash, setExpandedHash] = useState('');
  const [detailModalHash, setDetailModalHash] = useState('');
  const [details, setDetails] = useState<Record<string, KernelHistoryCommit>>({});
  const [selectedPatchFilePath, setSelectedPatchFilePath] = useState('');
  const [claim, setClaim] = useState('');
  const [note, setNote] = useState('');
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  const [topicTitle, setTopicTitle] = useState('');
  const [entityQuery, setEntityQuery] = useState('');
  const [entityResults, setEntityResults] = useState<KnowledgeEntity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<KnowledgeEntity | null>(null);

  const rangeKey = selectedRange
    ? `${version}:${filePath}:${selectedRange.startLine}-${selectedRange.endLine}`
    : '';

  const commits = useMemo(
    () => uniqueCommits([...(blame ? [blame] : []), ...history]),
    [blame, history],
  );

  const selectedCommits = useMemo(
    () => commits.filter((commit) => selectedHashes.has(commit.commit_hash)),
    [commits, selectedHashes],
  );

  const selectedLinks = useMemo(() => {
    const links = new Set<string>();
    selectedCommits.forEach((commit) => {
      commit.lore_links.forEach((link) => links.add(link));
      commit.trailers?.Link?.forEach((link) => links.add(link));
    });
    return Array.from(links);
  }, [selectedCommits]);

  useEffect(() => {
    if (!version || !filePath || !selectedRange) {
      setBlame(null);
      setHistory([]);
      setHistoryLoaded(false);
      setError('');
      return;
    }

    let cancelled = false;
    setBlameLoading(true);
    setError('');
    setHistory([]);
    setHistoryLoaded(false);
    setExpandedHash('');
    getKernelBlame(version, filePath, selectedRange.startLine)
      .then((nextBlame) => {
        if (cancelled) return;
        setBlame(nextBlame);
        setSelectedHashes(nextBlame ? new Set([nextBlame.commit_hash]) : new Set());
        const defaultTitle = `${filePath}:${formatLineRange(selectedRange)} history`;
        setTopicTitle(defaultTitle);
        setClaim(buildDefaultClaim(filePath, selectedRange, nextBlame ? [nextBlame] : []));
      })
      .catch((e) => {
        if (!cancelled) {
          setBlame(null);
          setSelectedHashes(new Set());
          setError(e instanceof Error ? e.message : 'Blame unavailable');
        }
      })
      .finally(() => {
        if (!cancelled) setBlameLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, rangeKey, selectedRange, version]);

  async function loadLineHistory() {
    if (!selectedRange || historyLoading) return;
    setHistoryLoading(true);
    setError('');
    try {
      const result = await getKernelLineHistory(
        version,
        filePath,
        selectedRange.startLine,
        selectedRange.endLine,
        12,
      );
      setHistory(result.commits);
      setHistoryLoaded(true);
      const lead = uniqueCommits([...(blame ? [blame] : []), ...result.commits])[0];
      if (lead) {
        setSelectedHashes((current) => (current.size > 0 ? current : new Set([lead.commit_hash])));
        setClaim((current) => current || buildDefaultClaim(filePath, selectedRange, [lead]));
      }
    } catch (e) {
      setHistoryLoaded(true);
      setError(e instanceof Error ? e.message : 'Line history unavailable');
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!entityQuery.trim() || targetMode !== 'existing') {
      setEntityResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      listKnowledgeEntities({ q: entityQuery.trim(), page_size: 6, search_mode: 'simple' })
        .then((res) => {
          if (!cancelled) setEntityResults(res.entities);
        })
        .catch(() => {
          if (!cancelled) setEntityResults([]);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [entityQuery, targetMode]);

  function toggleCommit(hash: string) {
    setSelectedHashes((current) => {
      const next = new Set(current);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }

  async function ensureCommitDetail(commit: KernelHistoryCommit) {
    if (details[commit.commit_hash]) return;
    setDetailLoadingHash(commit.commit_hash);
    setDetailErrors((current) => ({ ...current, [commit.commit_hash]: '' }));
    try {
      const detail = await getKernelCommit(version, commit.commit_hash);
      setDetails((current) => ({ ...current, [commit.commit_hash]: detail }));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load commit detail';
      setDetailErrors((current) => ({ ...current, [commit.commit_hash]: message }));
      showToast(message, 'error');
    } finally {
      setDetailLoadingHash('');
    }
  }

  async function toggleDetail(commit: KernelHistoryCommit) {
    if (expandedHash === commit.commit_hash) {
      setExpandedHash('');
      return;
    }
    setExpandedHash(commit.commit_hash);
    await ensureCommitDetail(commit);
  }

  async function openCommitDetail(commit: KernelHistoryCommit) {
    setDetailModalHash(commit.commit_hash);
    setSelectedPatchFilePath('');
    await ensureCommitDetail(commit);
  }

  async function handleSaveDraft() {
    if (!selectedRange) return;
    if (!claim.trim()) {
      showToast('Claim is required before saving a draft.', 'error');
      return;
    }
    if (targetMode === 'existing' && !selectedEntity) {
      showToast('Choose an existing Knowledge topic, or switch to New topic.', 'error');
      return;
    }

    const title =
      targetMode === 'existing'
        ? selectedEntity?.canonical_name || topicTitle
        : topicTitle.trim() || `${filePath}:${formatLineRange(selectedRange)} history`;
    const codeRange = {
      version,
      path: filePath,
      start_line: selectedRange.startLine,
      end_line: selectedRange.endLine,
      selected_text_snapshot: selectedText,
    };
    const commitEvidence = selectedCommits.map((commit) => ({
      commit_hash: commit.commit_hash,
      short_hash: commit.short_hash,
      subject: commit.subject,
      author_name: commit.author_name,
      author_time: commit.author_time,
      trailers: commit.trailers,
      lore_links: commit.lore_links,
    }));
    const payload = {
      knowledge_drafts: [
        {
          selected: true,
          entity_type: 'feature_topic',
          canonical_name: title,
          entity_id: targetMode === 'existing' ? selectedEntity?.entity_id : undefined,
          aliases: [],
          summary: claim.trim(),
          description: [
            claim.trim(),
            note.trim() ? `\nHuman note:\n${note.trim()}` : '',
            selectedCommits.length
              ? `\nSelected commits:\n${selectedCommits.map((commit) => `- ${commit.short_hash} ${commit.subject}`).join('\n')}`
              : '',
          ].join('\n'),
          status: 'draft',
          meta: {
            source: 'code_history_capture',
            target_mode: targetMode,
            target_entity_id: selectedEntity?.entity_id || '',
            related_code_ranges: [codeRange],
            related_commits: commitEvidence,
            related_links: selectedLinks,
            evidence_bundle: {
              code_range: codeRange,
              commits: commitEvidence,
              links: selectedLinks,
              note: note.trim(),
            },
          },
          tags: [],
        },
      ],
      annotation_drafts: [],
      tag_assignment_drafts: [],
      warnings: selectedCommits.length ? [] : ['No commit evidence selected; draft only contains code range evidence.'],
    };

    setSaving(true);
    try {
      const draft = await createKnowledgeDraft({
        source_type: 'code_history',
        source_ref: `${version}:${filePath}:${selectedRange.startLine}-${selectedRange.endLine}`,
        question: `Capture code history evidence for ${filePath}:${formatLineRange(selectedRange)}`,
        payload,
        status: 'new',
      });
      showToast(`Knowledge draft created: ${draft.draft_id}`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create Knowledge draft', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!selectedRange) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-600">
        Select a line or Shift-select a range to inspect commit history and capture evidence.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950">
              {filePath}:{formatLineRange(selectedRange)}
            </div>
            <div className="mt-1 text-xs text-slate-700">
              {selectedText ? `${selectedText.split('\n').length} selected lines` : 'Code range selected'}
            </div>
          </div>
          <StatusBadge tone="success">History</StatusBadge>
        </div>
      </div>

      {blameLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading last touched commit…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
          {error}
          <div className="mt-1 text-amber-700">You can still save the code range and a human note.</div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
            Last touched
          </div>
          {blame && <StatusBadge tone="muted">{blame.short_hash}</StatusBadge>}
        </div>
        {blame ? (
          <CommitRow
            commit={blame}
            selected={selectedHashes.has(blame.commit_hash)}
            expanded={expandedHash === blame.commit_hash}
            detail={details[blame.commit_hash]}
            detailError={detailErrors[blame.commit_hash]}
            loadingDetail={detailLoadingHash === blame.commit_hash}
            onToggle={() => toggleCommit(blame.commit_hash)}
            onExpand={() => void toggleDetail(blame)}
            onOpenDetail={() => void openCommitDetail(blame)}
          />
        ) : !blameLoading ? (
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-3 text-xs text-slate-600">
            No blame result for this line.
          </div>
        ) : null}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
            Line history
          </div>
          <div className="flex items-center gap-2">
            {historyLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-600" />}
            <StatusBadge tone={historyLoaded ? 'info' : 'muted'}>
              {historyLoaded ? `${history.length} commits` : 'on demand'}
            </StatusBadge>
          </div>
        </div>
        <div className="space-y-2">
          {!historyLoaded && (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-3">
              <div className="text-xs leading-5 text-slate-600">
                Full line history uses <code className="rounded bg-slate-200 px-1">git log -L</code> and can be slow on kernel files.
              </div>
              <SecondaryButton
                onClick={() => void loadLineHistory()}
                disabled={historyLoading}
                className="mt-2 w-full justify-center px-3 py-2 text-xs"
              >
                {historyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Load line history
              </SecondaryButton>
            </div>
          )}
          {history.map((commit) => (
            <CommitRow
              key={commit.commit_hash}
              commit={commit}
              selected={selectedHashes.has(commit.commit_hash)}
              expanded={expandedHash === commit.commit_hash}
              detail={details[commit.commit_hash]}
              detailError={detailErrors[commit.commit_hash]}
              loadingDetail={detailLoadingHash === commit.commit_hash}
              onToggle={() => toggleCommit(commit.commit_hash)}
              onExpand={() => void toggleDetail(commit)}
              onOpenDetail={() => void openCommitDetail(commit)}
            />
          ))}
          {historyLoaded && !historyLoading && history.length === 0 && (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-3 text-xs text-slate-600">
              No line history returned for this selection.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-300 bg-white p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Inbox className="h-4 w-4 text-slate-600" />
            Evidence basket
          </div>
          <StatusBadge tone={selectedCommits.length ? 'success' : 'warning'}>
            {selectedCommits.length} commits
          </StatusBadge>
        </div>

        <div className="space-y-2 text-xs">
          <EvidencePill label="Code range" value={`${filePath}:${formatLineRange(selectedRange)}`} />
          {selectedCommits.map((commit) => (
            <EvidencePill
              key={commit.commit_hash}
              label="Commit"
              value={`${commit.short_hash} ${commit.subject}`}
              onRemove={() => toggleCommit(commit.commit_hash)}
            />
          ))}
          {selectedLinks.map((link) => (
            <EvidencePill key={link} label="Link" value={link} />
          ))}
        </div>

        <div className="mt-3 grid gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
            Save target
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTargetMode('new')}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium ${
                targetMode === 'new'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              New topic
            </button>
            <button
              type="button"
              onClick={() => setTargetMode('existing')}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium ${
                targetMode === 'existing'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              Existing
            </button>
          </div>

          {targetMode === 'new' ? (
            <input
              value={topicTitle}
              onChange={(e) => setTopicTitle(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-400"
              placeholder="Knowledge topic title"
            />
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-600" />
                <input
                  value={entityQuery}
                  onChange={(e) => setEntityQuery(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-emerald-400"
                  placeholder="Search Knowledge topic"
                />
              </div>
              {selectedEntity && (
                <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
                  <span className="truncate">{selectedEntity.canonical_name}</span>
                  <button type="button" onClick={() => setSelectedEntity(null)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="space-y-1">
                {entityResults.map((entity) => (
                  <button
                    key={entity.entity_id}
                    type="button"
                    onClick={() => {
                      setSelectedEntity(entity);
                      setEntityQuery(entity.canonical_name);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-left text-xs text-slate-900 hover:border-emerald-200 hover:bg-emerald-50"
                  >
                    <span className="truncate">{entity.canonical_name}</span>
                    <Plus className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <textarea
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            className="min-h-[72px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-400"
            placeholder="Claim this evidence supports"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-[64px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-400"
            placeholder="Human note (optional)"
          />
          <SecondaryButton
            onClick={() => void handleSaveDraft()}
            disabled={!canWrite || saving}
            className="justify-center border-emerald-200 bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {canWrite ? 'Save Knowledge draft' : 'Sign in as editor to save'}
          </SecondaryButton>
        </div>
      </div>
      <CommitDetailModal
        commit={commits.find((commit) => commit.commit_hash === detailModalHash) || null}
        detail={detailModalHash ? details[detailModalHash] : undefined}
        detailError={detailModalHash ? detailErrors[detailModalHash] : undefined}
        loading={detailLoadingHash === detailModalHash}
        selectedFilePath={selectedPatchFilePath}
        onSelectFile={setSelectedPatchFilePath}
        onOpenTarget={onOpenCommitTarget}
        onClose={() => setDetailModalHash('')}
      />
    </div>
  );
}

function CommitRow({
  commit,
  selected,
  expanded,
  detail,
  detailError,
  loadingDetail,
  onToggle,
  onExpand,
  onOpenDetail,
}: {
  commit: KernelHistoryCommit;
  selected: boolean;
  expanded: boolean;
  detail?: KernelHistoryCommit;
  detailError?: string;
  loadingDetail: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onOpenDetail: () => void;
}) {
  const shown = detail || commit;
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-2.5">
      <div className="grid grid-cols-[20px_minmax(0,1fr)_24px] gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1 rounded border-slate-300"
          aria-label={`Select ${commit.short_hash}`}
        />
        <div className="min-w-0">
          <div className="text-xs font-semibold leading-5 text-slate-950">
            <span className="font-mono text-sky-800">{commit.short_hash}</span> {commit.subject}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
            <Clock3 className="h-3 w-3" />
            <span>{formatCommitTime(commit.author_time)}</span>
            {commit.author_name && <span>· {commit.author_name}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StatusBadge tone={commitTone(commit)}>{commitLabel(commit)}</StatusBadge>
            {commit.has_lore_link && <StatusBadge tone="info">lore</StatusBadge>}
            {commit.trailers?.Fixes?.length ? <StatusBadge tone="warning">Fixes</StatusBadge> : null}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onOpenDetail}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
            aria-label="Open commit detail"
            title="Open commit detail"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onExpand}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
            aria-label="Toggle commit detail"
            title="Toggle commit detail"
          >
            {loadingDetail ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`} />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-slate-300 pt-3 text-xs">
          {detailError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-amber-800">
              {detailError}
            </div>
          ) : shown.message ? (
            <p className="line-clamp-5 whitespace-pre-line text-slate-700">{shown.message}</p>
          ) : (
            <div className="text-slate-600">
              {loadingDetail ? 'Loading commit message…' : 'No commit message loaded.'}
            </div>
          )}
          <div className="space-y-1">
            {Object.entries(shown.trailers || {}).slice(0, 6).map(([key, values]) => (
              <div key={key} className="grid grid-cols-[70px_minmax(0,1fr)] gap-2">
                <span className="font-semibold text-slate-600">{key}</span>
                <span className="min-w-0 break-words text-slate-900">{values.join(', ')}</span>
              </div>
            ))}
          </div>
          {shown.lore_links.length > 0 && (
            <div className="space-y-1">
              {shown.lore_links.map((link) => (
                <a
                  key={link}
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-1.5 text-sky-800 hover:text-sky-900"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{link}</span>
                </a>
              ))}
            </div>
          )}
          {shown.changed_files.length > 0 && (
            <div className="space-y-1">
              {shown.changed_files.slice(0, 5).map((file) => (
                <div key={`${file.path}-${file.added}-${file.deleted}`} className="flex items-center gap-2 text-slate-700">
                  <GitCommitHorizontal className="h-3.5 w-3.5 text-slate-600" />
                  <span className="truncate">{file.path}</span>
                  <span className="ml-auto shrink-0 text-slate-600">+{file.added} -{file.deleted}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CommitDetailModal({
  commit,
  detail,
  detailError,
  loading,
  selectedFilePath,
  onSelectFile,
  onOpenTarget,
  onClose,
}: {
  commit: KernelHistoryCommit | null;
  detail?: KernelHistoryCommit;
  detailError?: string;
  loading: boolean;
  selectedFilePath: string;
  onSelectFile: (filePath: string) => void;
  onOpenTarget?: (target: CommitPatchTargetView) => void;
  onClose: () => void;
}) {
  const shown = detail || commit;
  const structuredModel: CommitPatchModel | null = shown ? buildCommitPatchModel(shown) : null;
  return (
    <InspectorDetailModal
      isOpen={!!commit}
      onClose={onClose}
      title={shown ? `${shown.short_hash} ${shown.subject}` : 'Commit detail'}
      subtitle={
        shown ? (
          <span>
            {formatCommitTime(shown.author_time)}
            {shown.author_name ? ` · ${shown.author_name}` : ''}
          </span>
        ) : null
      }
    >
      {detailError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          {detailError}
        </div>
      ) : loading && !detail ? (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading commit detail...
        </div>
      ) : shown ? (
        <div className="space-y-4">
          <div className="grid min-h-0 gap-4">
            <section className="min-w-0 space-y-4">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  Commit Message
                </div>
                <pre className="max-h-[24vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-300 bg-slate-100 p-3 font-mono text-xs leading-5 text-slate-950">
                  {shown.message || 'No commit message available.'}
                </pre>
              </div>
              {Object.keys(shown.trailers || {}).length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                    Trailers
                  </div>
                  <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-slate-300 bg-white p-3 text-xs">
                    {Object.entries(shown.trailers || {}).map(([key, values]) => (
                      <div key={key} className="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
                        <span className="font-semibold text-slate-600">{key}</span>
                        <span className="min-w-0 break-words text-slate-900">{values.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {shown.changed_files.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                    Changed Files
                  </div>
                  <div className="max-h-40 overflow-auto rounded-lg border border-slate-300 bg-white">
                    {shown.changed_files.map((file) => (
                      <div
                        key={`${file.path}-${file.added}-${file.deleted}`}
                        className="grid grid-cols-[minmax(0,1fr)_80px] gap-3 border-b border-slate-300 px-3 py-2 text-xs last:border-b-0"
                      >
                        <span className="truncate font-mono text-slate-900">{file.path}</span>
                        <span className="text-right text-slate-600">+{file.added} -{file.deleted}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
            <section className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  Patch browser
                </div>
                {shown.patch_truncated && <StatusBadge tone="warning">Truncated</StatusBadge>}
              </div>
              {structuredModel ? (
                <CommitPatchBrowser
                  model={structuredModel}
                  commitHash={shown.commit_hash}
                  commitVersion={shown.version || ''}
                  selectedFilePath={selectedFilePath}
                  onSelectFile={onSelectFile}
                  onOpenTarget={(target) => onOpenTarget?.(target)}
                />
              ) : shown.patch ? (
                <pre className="max-h-[72vh] overflow-auto rounded-lg border border-slate-300 bg-white font-mono text-xs leading-5">
                  {shown.patch.split('\n').map((line, index) => (
                    <div key={`${index}-${line.slice(0, 16)}`} className={`px-3 ${diffLineClass(line)}`}>
                      {line || '\u00a0'}
                    </div>
                  ))}
                </pre>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 px-4 py-8 text-sm text-slate-600">
                  No diff loaded for this commit.
                </div>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </InspectorDetailModal>
  );
}

export function CommitPatchBrowser({
  model,
  commitHash,
  commitVersion,
  selectedFilePath,
  onSelectFile,
  onOpenTarget,
}: {
  model: CommitPatchModel;
  commitHash: string;
  commitVersion: string;
  selectedFilePath: string;
  onSelectFile: (filePath: string) => void;
  onOpenTarget?: (target: CommitPatchTargetView) => void;
}) {
  const fileContainerRef = useRef<HTMLDivElement | null>(null);
  const initialRowsByHunk = useMemo(() => {
    return Object.fromEntries(
      model.files.flatMap((file) =>
        file.hunks.map((hunk, index) => [buildHunkKey(file.path, hunk, index), hunk.rows] as const),
      ),
    ) as Record<string, CommitPatchRowView[]>;
  }, [model]);
  const [rowsByHunk, setRowsByHunk] = useState<Record<string, CommitPatchRowView[]>>(initialRowsByHunk);
  const [loadingExpanders, setLoadingExpanders] = useState<Record<string, boolean>>({});
  const [expanderErrors, setExpanderErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setRowsByHunk(initialRowsByHunk);
    setLoadingExpanders({});
    setExpanderErrors({});
  }, [initialRowsByHunk]);

  async function handleExpand(
    file: CommitPatchFileView,
    action: CommitPatchDisplayExpanderActionView,
  ) {
    const expanderKey = buildExpanderKey(action.hunkKey, action.row.id, action.direction);
    const sourceRows = rowsByHunk[action.hunkKey] || action.hunk.rows;
    const viewportAnchor = findExpansionViewportAnchor(sourceRows, action.row.id, action.direction);
    const container = fileContainerRef.current;
    const anchorTopBefore =
      viewportAnchor
        ? container?.querySelector<HTMLElement>(`[data-patch-row-anchor="${viewportAnchor}"]`)?.getBoundingClientRect().top ?? null
        : null;
    setLoadingExpanders((current) => ({ ...current, [expanderKey]: true }));
    setExpanderErrors((current) => {
      const next = { ...current };
      delete next[expanderKey];
      return next;
    });
    try {
      const response = await expandKernelCommitPatchHunk({
        version: commitVersion,
        commit_hash: commitHash,
        file_path: file.path,
        hunk_header: action.hunk.header,
        expander_id: action.row.id,
        direction: action.direction,
      });
      const insertedRows = normalizePatchRows(response.inserted_rows);
      const remainingExpander = normalizePatchExpander(response.remaining_expander);
      setRowsByHunk((current) => {
        const liveRows = current[action.hunkKey] || action.hunk.rows;
        const mergedRows = mergeExpandedPatchRows({
          sourceRows: liveRows,
          expanderId: action.row.id,
          direction: action.direction,
          insertedRows,
          remainingExpander,
        });
        if (mergedRows === liveRows) return current;
        return {
          ...current,
          [action.hunkKey]: mergedRows,
        };
      });
      if (viewportAnchor && anchorTopBefore !== null) {
        requestAnimationFrame(() => {
          const container = fileContainerRef.current;
          const anchorTopAfter =
            container?.querySelector<HTMLElement>(`[data-patch-row-anchor="${viewportAnchor}"]`)?.getBoundingClientRect().top ?? null;
          if (!container || anchorTopAfter === null) return;
          container.scrollTop += anchorTopAfter - anchorTopBefore;
        });
      }
    } catch (error) {
      setExpanderErrors((current) => ({
        ...current,
        [expanderKey]: error instanceof Error ? error.message : 'Unable to expand context',
      }));
    } finally {
      setLoadingExpanders((current) => ({
        ...current,
        [expanderKey]: false,
      }));
    }
  }

  return (
    <CommitPatchBrowserView
      model={model}
      selectedFilePath={selectedFilePath}
      onSelectFile={onSelectFile}
      onOpenTarget={onOpenTarget}
      fileContainerRef={fileContainerRef}
      rowsByHunk={rowsByHunk}
      loadingExpanders={loadingExpanders}
      expanderErrors={expanderErrors}
      onExpand={(file, action) =>
        void handleExpand(file, action)}
    />
  );
}

export function CommitPatchBrowserView({
  model,
  selectedFilePath,
  onSelectFile,
  onOpenTarget,
  hunkContainerRefs,
  rowsByHunk,
  loadingExpanders,
  expanderErrors,
  onExpand,
}: {
  model: CommitPatchModel;
  selectedFilePath: string;
  onSelectFile: (filePath: string) => void;
  onOpenTarget?: (target: CommitPatchTargetView) => void;
  fileContainerRef?: React.MutableRefObject<HTMLDivElement | null>;
  rowsByHunk: Record<string, CommitPatchRowView[]>;
  loadingExpanders: Record<string, boolean>;
  expanderErrors: Record<string, string>;
  onExpand: (
    file: CommitPatchFileView,
    action: CommitPatchDisplayExpanderActionView,
  ) => void;
}) {
  const selectedFile =
    model.files.find((file) => file.path === selectedFilePath || file.new_path === selectedFilePath || file.old_path === selectedFilePath) ||
    model.files[0];

  if (!selectedFile) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 px-4 py-8 text-sm text-slate-600">
        No structured patch data available.
      </div>
    );
  }

  function handleOpenTarget(target: CommitPatchTargetView) {
    if (!target.available) {
      showToast(target.reason || 'Navigation target unavailable', 'info');
      return;
    }
    onOpenTarget?.(target);
  }

  function renderExpanderAction(
    file: CommitPatchFileView,
    action: CommitPatchDisplayExpanderActionView,
  ) {
    const expanderKey = buildExpanderKey(action.hunkKey, action.row.id, action.direction);
    const isLoading = Boolean(loadingExpanders[expanderKey]);
    const Icon = action.direction === 'up' ? ChevronUp : ChevronDown;
    const label = expanderLabel(action.direction, action.row.hiddenCount);

    return (
      <button
        key={expanderKey}
        type="button"
        onClick={() => onExpand(file, action)}
        disabled={isLoading}
        className="inline-flex items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2.5 py-1 font-medium text-[#0969da] hover:bg-[#f3f4f6] disabled:cursor-wait disabled:opacity-60"
      >
        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
        {label}
      </button>
    );
  }

  return (
    <div className="grid min-h-0 gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
      <div className="max-h-52 overflow-auto rounded-lg border border-slate-300 bg-[#f6f8fa] p-2 xl:max-h-[68vh]">
        <div className="space-y-1">
          {model.files.map((file) => {
            const active = file.path === selectedFile.path;
            return (
              <button
                key={`${file.path}-${file.status}`}
                type="button"
                onClick={() => onSelectFile(file.path)}
                className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs ${
                  active
                    ? 'border-[#0969da] bg-white shadow-sm'
                    : 'border-transparent bg-transparent hover:border-slate-300 hover:bg-white'
                }`}
              >
                <span className="truncate font-mono text-slate-900">{formatChangedFileLabel(file)}</span>
                <span className="shrink-0 text-slate-600">+{file.added} -{file.deleted}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        <CommitPatchFileSummary file={selectedFile} nearestTagVersion={model.nearestTagVersion} />
        {selectedFile.hunks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No hunk data returned for this file.
          </div>
        ) : (
          (() => {
            const rows = buildFilePatchDisplayRows(selectedFile, rowsByHunk);
            return (
              <div className="overflow-hidden rounded-lg border border-slate-300 bg-white">
                <div
                  ref={(node) => {
                    if (fileContainerRef) {
                      fileContainerRef.current = node;
                    }
                  }}
                  className="max-h-[48vh] overflow-auto"
                  style={{ overflowAnchor: 'none' }}
                >
                  <table className="w-full border-collapse font-mono text-xs leading-5">
                    <tbody>
                      {rows.map((row) => {
                        if (row.type === 'hunk-header') {
                          return (
                            <tr key={row.key} className="border-y border-slate-300 bg-[#ddf4ff]">
                              <td colSpan={3} className="px-3 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-mono text-[11px] text-[#0969da]">{row.header}</span>
                                  <div className="flex flex-wrap gap-2 text-[11px]">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenTarget(row.currentVersionTarget)}
                                      disabled={!row.currentVersionTarget.available}
                                      className="rounded-md border border-[#b6e3ff] bg-white px-2 py-1 text-[#0969da] hover:bg-[#eff8ff] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Open in current version
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenTarget(row.nearestTagTarget)}
                                      disabled={!row.nearestTagTarget.available}
                                      className="rounded-md border border-[#b6e3ff] bg-white px-2 py-1 text-[#0969da] hover:bg-[#eff8ff] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Jump to nearest tag
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        if (row.type === 'expander') {
                          const maxHiddenCount = Math.max(...row.actions.map((action) => action.row.hiddenCount));
                          return (
                            <tr key={row.key} className="border-y border-[#d8dee4] bg-[#f6f8fa]">
                              <td colSpan={3} className="px-3 py-2">
                                <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-[#57606a]">
                                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#d0d7de] bg-white text-[#57606a]">
                                    {row.actions.length > 1 ? (
                                      <ChevronsUpDown className="h-3.5 w-3.5" />
                                    ) : row.actions[0]?.direction === 'up' ? (
                                      <ChevronUp className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    )}
                                  </span>
                                  {row.actions.length > 1 && (
                                    <span className="font-medium">{maxHiddenCount} unmodified lines</span>
                                  )}
                                  <div className="flex flex-wrap items-center justify-center gap-2">
                                    {row.actions.map((action) => renderExpanderAction(selectedFile, action))}
                                  </div>
                                </div>
                                {row.actions.map((action) => {
                                  const expanderKey = buildExpanderKey(action.hunkKey, action.row.id, action.direction);
                                  const errorMessage = expanderErrors[expanderKey];
                                  return errorMessage ? (
                                    <div key={`${expanderKey}-error`} className="mt-2 text-center text-[11px] text-[#cf222e]">
                                      {errorMessage}
                                    </div>
                                  ) : null;
                                })}
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr
                            key={row.key}
                            data-patch-row-anchor={buildPatchRowAnchor(row)}
                            className={`border-b border-[#d8dee4] ${patchRowClass(row.kind)}`}
                          >
                            <td className={`w-[56px] border-r border-[#d8dee4] px-2 text-right align-top ${patchGutterClass(row.kind)}`}>
                              {row.oldLine ?? ''}
                            </td>
                            <td className={`w-[56px] border-r border-[#d8dee4] px-2 text-right align-top ${patchGutterClass(row.kind)}`}>
                              {row.newLine ?? ''}
                            </td>
                            <td className={`px-3 align-top ${patchCodeCellClass(row.kind)}`}>
                              <span className="whitespace-pre">{row.text || '\u00a0'}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}

function CommitPatchFileSummary({
  file,
  nearestTagVersion,
}: {
  file: CommitPatchFileView;
  nearestTagVersion: string | null;
}) {
  return (
    <div className="rounded-lg border border-slate-300 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">{formatChangedFileLabel(file)}</div>
          <div className="mt-1 text-xs text-slate-600">
            {file.status} · +{file.added} -{file.deleted}
            {file.is_binary ? ' · binary' : ''}
            {file.truncated ? ' · truncated' : ''}
            {nearestTagVersion ? ` · nearest ${nearestTagVersion}` : ''}
          </div>
        </div>
        <StatusBadge tone={file.is_binary ? 'warning' : 'info'}>{file.status}</StatusBadge>
      </div>
    </div>
  );
}

function EvidencePill({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1.5">
      <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-slate-900">{value}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} className="shrink-0 text-slate-600 hover:text-rose-600">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Link2 className="h-3.5 w-3.5 shrink-0 text-slate-700" />
      )}
    </div>
  );
}
