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

export interface CommitPatchDisplayLineRowView extends CommitPatchLineRowView {
  key: string;
}

export interface CommitPatchDisplayHunkHeaderRowView {
  type: 'hunk-header';
  key: string;
  header: string;
  currentVersionTarget: CommitPatchTargetView;
  nearestTagTarget: CommitPatchTargetView;
}

export interface CommitPatchDisplayExpanderActionView {
  key: string;
  direction: 'up' | 'down';
  hunk: CommitPatchHunkView;
  hunkKey: string;
  row: CommitPatchExpanderRowView;
}

export interface CommitPatchDisplayExpanderRowView {
  type: 'expander';
  key: string;
  actions: CommitPatchDisplayExpanderActionView[];
}

export type CommitPatchDisplayRowView =
  | CommitPatchDisplayLineRowView
  | CommitPatchDisplayHunkHeaderRowView
  | CommitPatchDisplayExpanderRowView;

export interface CommitPatchFileView extends Omit<KernelCommitPatchFile, 'current_version_target' | 'nearest_tag_target' | 'hunks'> {
  displayLabel: string;
  currentVersionTarget: CommitPatchTargetView;
  nearestTagTarget: CommitPatchTargetView;
  hunks: CommitPatchHunkView[];
}

export interface CommitPatchModel {
  nearestTagVersion: string | null;
  files: CommitPatchFileView[];
}

export function buildHunkKey(filePath: string, hunk: Pick<CommitPatchHunkView, 'header'>, index: number): string {
  return `${filePath}::${hunk.header}::${index}`;
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

export function normalizePatchExpander(
  row: KernelCommitPatchRowExpander | null | undefined,
): CommitPatchExpanderRowView | null {
  if (!row) return null;
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

function normalizeRow(row: KernelCommitPatchRow): CommitPatchRowView {
  if (row.type === 'expander') {
    return normalizePatchExpander(row)!;
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

export function mergeExpandedPatchRows({
  sourceRows,
  expanderId,
  direction,
  insertedRows,
  remainingExpander,
}: {
  sourceRows: CommitPatchRowView[];
  expanderId: string;
  direction: 'up' | 'down';
  insertedRows: CommitPatchRowView[];
  remainingExpander: CommitPatchExpanderRowView | null;
}): CommitPatchRowView[] {
  const rowIndex = sourceRows.findIndex((row) => row.type === 'expander' && row.id === expanderId);
  if (rowIndex < 0) return sourceRows;
  const replacementRows =
    direction === 'up'
      ? [...(remainingExpander ? [remainingExpander] : []), ...insertedRows]
      : [...insertedRows, ...(remainingExpander ? [remainingExpander] : [])];
  return [
    ...sourceRows.slice(0, rowIndex),
    ...replacementRows,
    ...sourceRows.slice(rowIndex + 1),
  ];
}

function buildDisplayExpanderAction(
  hunk: CommitPatchHunkView,
  hunkKey: string,
  row: CommitPatchExpanderRowView,
  direction: 'up' | 'down',
): CommitPatchDisplayExpanderActionView {
  return {
    key: `${hunkKey}::${row.id}::${direction}`,
    direction,
    hunk,
    hunkKey,
    row,
  };
}

export function buildFilePatchDisplayRows(
  file: CommitPatchFileView,
  rowsByHunk: Record<string, CommitPatchRowView[]>,
): CommitPatchDisplayRowView[] {
  const displayRows: CommitPatchDisplayRowView[] = [];

  file.hunks.forEach((hunk, index) => {
    const hunkKey = buildHunkKey(file.path, hunk, index);
    const sourceRows = rowsByHunk[hunkKey] || hunk.rows;
    let startIndex = 0;

    if (index > 0 && sourceRows[0]?.type === 'expander' && sourceRows[0].direction === 'up') {
      const leadingRow = sourceRows[0];
      const upAction = buildDisplayExpanderAction(hunk, hunkKey, leadingRow, 'up');
      const previousRow = displayRows[displayRows.length - 1];
      if (
        previousRow?.type === 'expander' &&
        previousRow.actions.some((action) => action.direction === 'down') &&
        !previousRow.actions.some((action) => action.direction === 'up')
      ) {
        previousRow.actions.push(upAction);
      } else {
        displayRows.push({
          type: 'expander',
          key: `${hunkKey}::leading-expander`,
          actions: [upAction],
        });
      }
      startIndex = 1;
    }

    displayRows.push({
      type: 'hunk-header',
      key: `${hunkKey}::header`,
      header: hunk.header,
      currentVersionTarget: hunk.currentVersionTarget,
      nearestTagTarget: hunk.nearestTagTarget,
    });

    sourceRows.slice(startIndex).forEach((row, rowIndex) => {
      if (row.type === 'line') {
        displayRows.push({
          ...row,
          key: `${hunkKey}::line::${startIndex + rowIndex}`,
        });
        return;
      }

      const directions = row.direction === 'both' ? (['up', 'down'] as const) : ([row.direction] as const);
      displayRows.push({
        type: 'expander',
        key: `${hunkKey}::expander::${startIndex + rowIndex}`,
        actions: directions.map((direction) => buildDisplayExpanderAction(hunk, hunkKey, row, direction)),
      });
    });
  });

  return displayRows;
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
    currentVersionTarget: normalizeTarget(file.current_version_target),
    nearestTagTarget: normalizeTarget(file.nearest_tag_target),
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
