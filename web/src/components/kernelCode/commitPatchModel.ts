import type {
  KernelCommitJumpTarget,
  KernelCommitPatchFile,
  KernelCommitPatchHunk,
  KernelHistoryCommit,
} from '../../api/types';

export type CommitPatchTargetMode = 'current-version' | 'nearest-tag';

export interface CommitPatchTargetView extends KernelCommitJumpTarget {}

export interface CommitPatchHunkView extends Omit<KernelCommitPatchHunk, 'current_version_target' | 'nearest_tag_target'> {
  currentVersionTarget: CommitPatchTargetView;
  nearestTagTarget: CommitPatchTargetView;
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

function normalizeHunk(hunk: KernelCommitPatchHunk): CommitPatchHunkView {
  return {
    ...hunk,
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
