import { Fragment, useMemo, useState } from 'react';
import { createCodeAnnotation } from '../api/client';
import { useAuth } from '../auth';
import { extractPatchHeaderPath } from '../utils/kernelPathRefs';
import { AnnotationInput } from './ThreadAnnotationCard';
import EmailTagEditor from './EmailTagEditor';
import KernelSourceLink from './KernelSourceLink';
import { showToast } from './Toast';

function getDiffLineClass(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('+++') || trimmed.startsWith('---')) return 'diff-line diff-meta';
  if (trimmed.startsWith('+')) return 'diff-line diff-add';
  if (trimmed.startsWith('-')) return 'diff-line diff-del';
  if (trimmed.startsWith('@@')) return 'diff-line diff-hunk';
  if (trimmed.startsWith('diff ')) return 'diff-line diff-header';
  if (trimmed.startsWith('index ')) return 'diff-line diff-meta';
  return 'diff-line diff-ctx';
}

interface PatchDiffBlockProps {
  content: string;
  version: string;
}

interface DiffLineTarget {
  path?: string;
  line?: number;
  hunk?: {
    path: string;
    startLine: number;
    endLine: number;
  };
}

function getPrimaryPatchPath(oldPath: string | null, newPath: string | null): string {
  return newPath || oldPath || '';
}

function parseHunkStart(header: string): { oldStart: number; newStart: number; oldCount: number; newCount: number } | null {
  const match = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] || 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] || 1),
  };
}

function buildDiffTargets(lines: string[]): DiffLineTarget[] {
  const targets: DiffLineTarget[] = [];
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    let target: DiffLineTarget = {};
    const trimmed = line.trimStart();

    if (trimmed.startsWith('diff --git ')) {
      const match = trimmed.match(/^diff --git\s+a\/(\S+)\s+b\/(\S+)/);
      if (match) {
        oldPath = match[1];
        newPath = match[2];
      }
      targets.push(target);
      continue;
    }

    if (trimmed.startsWith('--- ')) {
      const path = extractPatchHeaderPath(trimmed);
      oldPath = path;
      targets.push(target);
      continue;
    }

    if (trimmed.startsWith('+++ ')) {
      const path = extractPatchHeaderPath(trimmed);
      newPath = path;
      targets.push(target);
      continue;
    }

    if (trimmed.startsWith('@@')) {
      const hunk = parseHunkStart(trimmed);
      if (hunk) {
        oldLine = hunk.oldStart;
        newLine = hunk.newStart;
        const hunkPath = getPrimaryPatchPath(oldPath, newPath);
        target = {
          path: hunkPath || undefined,
          line: hunk.newStart > 0 ? hunk.newStart : hunk.oldStart,
          hunk:
            hunkPath && hunk.newStart > 0 && hunk.newCount > 0
              ? {
                  path: hunkPath,
                  startLine: hunk.newStart,
                  endLine: hunk.newStart + hunk.newCount - 1,
                }
              : undefined,
        };
      }
      targets.push(target);
      continue;
    }

    if (trimmed.startsWith('+') && !trimmed.startsWith('+++')) {
      target = {
        path: getPrimaryPatchPath(oldPath, newPath) || undefined,
        line: newLine > 0 ? newLine : undefined,
      };
      newLine += 1;
      targets.push(target);
      continue;
    }

    if (trimmed.startsWith('-') && !trimmed.startsWith('---')) {
      target = {
        path: getPrimaryPatchPath(oldPath, newPath) || undefined,
        line: oldLine > 0 ? oldLine : undefined,
      };
      oldLine += 1;
      targets.push(target);
      continue;
    }

    if (line.startsWith(' ')) {
      target = {
        path: getPrimaryPatchPath(oldPath, newPath) || undefined,
        line: newLine > 0 ? newLine : oldLine || undefined,
      };
      oldLine += 1;
      newLine += 1;
      targets.push(target);
      continue;
    }

    targets.push(target);
  }

  return targets;
}

/**
 * PATCH diff 折叠展示组件
 *
 * - 默认折叠，标题栏显示文件数和增删行统计
 * - 展开后按行着色：`+` 绿、`-` 红、`@@` 蓝、`diff --git` 黄、上下文灰
 * - `--- a/path` / `+++ b/path` / `diff --git a/X b/Y` 渲染为 local-first 代码链接
 */
export default function PatchDiffBlock({ content, version }: PatchDiffBlockProps) {
  const { canWrite } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeHunkKey, setActiveHunkKey] = useState<string | null>(null);
  const lines = content.split('\n');
  const lineTargets = buildDiffTargets(lines);
  const writableVersion = version && version !== 'latest' ? version : '';
  const fileCount = lines.filter(l => l.trimStart().startsWith('diff ')).length;
  const addCount = lines.filter(l => {
    const t = l.trimStart();
    return t.startsWith('+') && !t.startsWith('+++');
  }).length;
  const delCount = lines.filter(l => {
    const t = l.trimStart();
    return t.startsWith('-') && !t.startsWith('---');
  }).length;
  const hunkKeys = useMemo(
    () =>
      lineTargets.map((target) =>
        target.hunk ? `${target.hunk.path}:${target.hunk.startLine}-${target.hunk.endLine}` : '',
      ),
    [lineTargets],
  );

  // 把 `--- a/path` / `+++ b/path` / `diff --git a/X b/Y` 渲染为带外链的行
  const renderDiffLineContent = (line: string) => {
    const trimmed = line.trimStart();
    // `--- a/x` or `+++ b/x`
    if (trimmed.startsWith('--- ') || trimmed.startsWith('+++ ')) {
      const path = extractPatchHeaderPath(trimmed);
      if (path) {
        const prefix = line.slice(0, line.indexOf(trimmed) + 4); // 包含 `--- ` 或 `+++ `
        const aOrB = trimmed.slice(4).startsWith('a/') ? 'a/' : trimmed.slice(4).startsWith('b/') ? 'b/' : '';
        return (
          <>
            {prefix}
            {aOrB}
            <KernelSourceLink
              version={version}
              path={path}
              className="underline decoration-dotted hover:text-sky-300"
              onClick={(e) => e.stopPropagation()}
            >
              {path}
            </KernelSourceLink>
          </>
        );
      }
    }
    // `diff --git a/X b/Y`
    if (trimmed.startsWith('diff --git ')) {
      const m = trimmed.match(/^diff --git\s+a\/(\S+)\s+b\/(\S+)/);
      if (m) {
        const prefix = line.slice(0, line.indexOf('diff --git'));
        return (
          <>
            {prefix}diff --git a/
            <KernelSourceLink
              version={version}
              path={m[1]}
              className="underline decoration-dotted hover:text-sky-300"
              onClick={(e) => e.stopPropagation()}
            >
              {m[1]}
            </KernelSourceLink>
            {' b/'}
            <KernelSourceLink
              version={version}
              path={m[2]}
              className="underline decoration-dotted hover:text-sky-300"
              onClick={(e) => e.stopPropagation()}
            >
              {m[2]}
            </KernelSourceLink>
          </>
        );
      }
    }
    return line || ' ';
  };

  return (
    <div className="mt-4 border-t border-gray-200 pt-3 patch-diff">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors"
      >
        <span className="text-gray-400 text-sm">{open ? '▼' : '▶'}</span>
        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded font-medium">PATCH</span>
        <span className="text-xs text-gray-500">
          {fileCount > 0 && `${fileCount} file${fileCount > 1 ? 's' : ''}`}
        </span>
        {(addCount > 0 || delCount > 0) && (
          <span className="text-xs font-mono">
            {addCount > 0 && <span className="text-green-600">+{addCount}</span>}
            {addCount > 0 && delCount > 0 && <span className="text-gray-400 mx-0.5">/</span>}
            {delCount > 0 && <span className="text-red-500">-{delCount}</span>}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 bg-gray-900 rounded-lg overflow-x-auto font-mono text-xs leading-relaxed">
          {lines.map((line, i) => {
            const target = lineTargets[i];
            const hunk = target?.hunk;
            const hunkKey = hunkKeys[i];
            const isEditorOpen = !!hunkKey && activeHunkKey === hunkKey;
            return (
              <Fragment key={i}>
                <div className={getDiffLineClass(line)}>
                  <span className="diff-line-no">{i + 1}</span>
                  {target?.path && target?.line ? (
                    <KernelSourceLink
                      version={version}
                      path={target.path}
                      line={target.line}
                      className="diff-target-link"
                      title={`Open ${target.path}:${target.line} in Code Atlas`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      L{target.line}
                    </KernelSourceLink>
                  ) : (
                    <span className="diff-target-placeholder" />
                  )}
                  <span className="diff-line-text">{renderDiffLineContent(line)}</span>
                  {hunk && (
                    <span className="diff-hunk-actions">
                      {writableVersion && (
                        <EmailTagEditor
                          targetType="kernel_line_range"
                          targetRef={`${writableVersion}:${hunk.path}`}
                          anchor={{ start_line: hunk.startLine, end_line: hunk.endLine, version: writableVersion, file_path: hunk.path }}
                          compact
                          placeholder="Tag this hunk"
                        />
                      )}
                      {canWrite && writableVersion && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveHunkKey((current) => (current === hunkKey ? null : hunkKey));
                          }}
                          className="diff-action-button"
                        >
                          批注
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {hunk && isEditorOpen && writableVersion && (
                  <div className="diff-hunk-editor">
                    <div className="diff-hunk-editor-label">
                      {hunk.path}:{hunk.startLine}-{hunk.endLine}
                    </div>
                    <AnnotationInput
                      submitLabel="保存代码批注"
                      onSubmit={async (body, visibility) => {
                        try {
                          await createCodeAnnotation({
                            version: writableVersion,
                            file_path: hunk.path,
                            start_line: hunk.startLine,
                            end_line: hunk.endLine,
                            body,
                            visibility,
                          });
                          setActiveHunkKey(null);
                          showToast('代码批注已创建', 'success');
                        } catch (error) {
                          showToast(error instanceof Error ? error.message : '创建代码批注失败', 'error');
                        }
                      }}
                      onCancel={() => setActiveHunkKey(null)}
                    />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
