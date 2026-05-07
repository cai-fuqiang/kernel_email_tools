import { useState } from 'react';
import { extractPatchHeaderPath } from '../utils/kernelPathRefs';
import KernelSourceLink from './KernelSourceLink';

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

/**
 * PATCH diff 折叠展示组件
 *
 * - 默认折叠，标题栏显示文件数和增删行统计
 * - 展开后按行着色：`+` 绿、`-` 红、`@@` 蓝、`diff --git` 黄、上下文灰
 * - `--- a/path` / `+++ b/path` / `diff --git a/X b/Y` 渲染为 local-first 代码链接
 */
export default function PatchDiffBlock({ content, version }: PatchDiffBlockProps) {
  const [open, setOpen] = useState(false);
  const lines = content.split('\n');
  const fileCount = lines.filter(l => l.trimStart().startsWith('diff ')).length;
  const addCount = lines.filter(l => {
    const t = l.trimStart();
    return t.startsWith('+') && !t.startsWith('+++');
  }).length;
  const delCount = lines.filter(l => {
    const t = l.trimStart();
    return t.startsWith('-') && !t.startsWith('---');
  }).length;

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
          {lines.map((line, i) => (
            <div key={i} className={getDiffLineClass(line)}>
              <span className="diff-line-no">{i + 1}</span>
              <span className="diff-line-text">{renderDiffLineContent(line)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
