import type {
  KernelCommitJumpTarget,
  KernelCommitPatchFile,
  KernelCommitPatchHunk,
  KernelCommitPatchRow,
  KernelCommitPatchRowExpander,
  KernelCommitPatchRowLine,
  KernelHistoryCommit,
} from '../../api/types';

export type CommitPatchTargetMode = 'current-version' | 'nearest-tag';

export interface CommitPatchTargetView extends KernelCommitJumpTarget {}

export interface CommitPatchLineRowView {
  type: 'line';
  kind: KernelCommitPatchRowLine['kind'];
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface CommitPatchExpanderRowView {
  type: 'expander';
  id: string;
  direction: KernelCommitPatchRowExpander['direction'];
  hiddenCount: number;
  stepSize: number;
  oldStart: number | null;
  oldEnd: number | null;
  newStart: number | null;
  newEnd: number | null;
  expandKey: string;
}

export type CommitPatchRowView = CommitPatchLineRowView | CommitPatchExpanderRowView;

export interface CommitPatchHunkView extends Omit<KernelCommitPatchHunk, 'current_version_target' | 'nearest_tag_target' | 'rows'> {
  currentVersionTarget: CommitPatchTargetView;
  nearestTagTarget: CommitPatchTargetView;
  rows: CommitPatchRowView[];
}

export interface CommitPatchFileView extends Omit<KernelCommitPatchFile, 'hunks'> {
  displayLabel: string;
  hunks: CommitPatchHunkView[];
}

export interface CommitPatchModel {
  nearestTagVersion: string | null;
  files: CommitPatchFileView[];
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function normalizeTarget(target: KernelCommitJumpTarget | null | undefined): CommitPatchTargetView {
  return {
    available: Boolean(target?.available),
    version: toText(target?.version),
    path: toText(target?.path),
    line: Number(target?.line || 0),
    reason: target?.reason ?? null,
  };
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function normalizeRow(row: KernelCommitPatchRow): CommitPatchRowView {
  if (row.type === 'expander') {
    return {
      type: 'expander',
      id: toText(row.id),
      direction: row.direction,
      hiddenCount: Number(row.hidden_count || 0),
      stepSize: Number(row.step_size || 0),
      oldStart: toNullableNumber(row.old_start),
      oldEnd: toNullableNumber(row.old_end),
      newStart: toNullableNumber(row.new_start),
      newEnd: toNullableNumber(row.new_end),
      expandKey: toText(row.expand_key),
    };
  }

  return {
    type: 'line',
    kind: row.kind,
    text: toText(row.text),
    oldLine: toNullableNumber(row.old_line),
    newLine: toNullableNumber(row.new_line),
  };
}

export function normalizePatchRows(rows: KernelCommitPatchRow[]): CommitPatchRowView[] {
  return Array.isArray(rows) ? rows.map(normalizeRow) : [];
}

function normalizeHunk(hunk: KernelCommitPatchHunk): CommitPatchHunkView {
  return {
    ...hunk,
    rows: normalizePatchRows(hunk.rows),
    currentVersionTarget: normalizeTarget(hunk.current_version_target),
    nearestTagTarget: normalizeTarget(hunk.nearest_tag_target),
  };
}

function normalizeFile(file: KernelCommitPatchFile): CommitPatchFileView {
  return {
    ...file,
    displayLabel: formatChangedFileLabel(file),
    hunks: Array.isArray(file.hunks) ? file.hunks.map(normalizeHunk) : [],
  };
}

export function formatChangedFileLabel(file: {
  status: string;
  old_path?: string | null;
  new_path?: string | null;
  path: string;
}): string {
  if (
    file.status === 'renamed' &&
    file.old_path &&
    file.new_path &&
    file.old_path !== file.new_path
  ) {
    return `${file.old_path} -> ${file.new_path}`;
  }
  if (file.new_path && file.new_path !== '/dev/null') {
    return file.new_path;
  }
  return file.path || file.old_path || file.new_path || '';
}

export function choosePrimaryTarget(
  hunk: Pick<CommitPatchHunkView, 'currentVersionTarget' | 'nearestTagTarget'>,
  mode: CommitPatchTargetMode,
): CommitPatchTargetView {
  return mode === 'nearest-tag' ? hunk.nearestTagTarget : hunk.currentVersionTarget;
}

export function buildCommitPatchModel(commit: Partial<KernelHistoryCommit>): CommitPatchModel | null {
  if (!Array.isArray(commit.files) || commit.files.length === 0) return null;
  return {
    nearestTagVersion: commit.nearest_tag_version ?? null,
    files: commit.files.map(normalizeFile),
  };
}
