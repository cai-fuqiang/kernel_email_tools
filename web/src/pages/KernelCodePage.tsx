import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import PreviewModal from '../components/PreviewModal';
import EmailTagEditor from '../components/EmailTagEditor';
import {
  getKernelVersions,
  getKernelTree,
  getKernelFile,
  getKernelSymbolDefinition,
  getCodeAnnotations,
  createCodeAnnotation,
  updateCodeAnnotation,
  deleteCodeAnnotation,
} from '../api/client';
import type {
  KernelVersionInfo,
  KernelTreeEntry,
  KernelFileResponse,
  CodeAnnotation,
  KernelSymbol,
} from '../api/types';
import { useAuth } from '../auth';

// ============================================================
// 子组件：版本选择器
// ============================================================
function VersionSelector({
  versions,
  selected,
  onSelect,
  loading,
}: {
  versions: KernelVersionInfo[];
  selected: string;
  onSelect: (tag: string) => void;
  loading: boolean;
}) {
  const [search, setSearch] = useState('');
  const [showRc, setShowRc] = useState(false);

  const filtered = versions.filter((v) => {
    if (!showRc && !v.is_release) return false;
    if (search && !v.tag.includes(search)) return false;
    return true;
  });

  const latest = filtered.filter((v) => v.major >= 6);
  const lts = filtered.filter((v) => v.major >= 4 && v.major < 6);
  const history = filtered.filter((v) => v.major < 4);

  return (
    <div className="space-y-2">
      <input
        type="text"
        placeholder="Search version..."
        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
        <input
          type="checkbox"
          checked={showRc}
          onChange={(e) => setShowRc(e.target.checked)}
          className="rounded text-indigo-500"
        />
        Show RC versions
      </label>
      {loading && <p className="text-xs text-gray-400">Loading versions...</p>}
      <div className="max-h-64 overflow-y-auto space-y-2">
        {[
          { label: 'Latest', items: latest },
          { label: 'LTS', items: lts },
          { label: 'History', items: history },
        ].map(
          (group) =>
            group.items.length > 0 && (
              <div key={group.label}>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1 mb-1">
                  {group.label}
                </div>
                {group.items.map((v) => (
                  <button
                    key={v.tag}
                    onClick={() => onSelect(v.tag)}
                    className={`block w-full text-left px-2 py-1 text-xs rounded transition-colors ${
                      v.tag === selected
                        ? 'bg-indigo-100 text-indigo-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {v.tag}
                  </button>
                ))}
              </div>
            )
        )}
      </div>
    </div>
  );
}

// ============================================================
// 子组件：文件树
// ============================================================
interface TreeNode {
  entry: KernelTreeEntry;
  children?: TreeNode[];
  expanded?: boolean;
  loading?: boolean;
}

function FileTreeItem({
  node,
  depth,
  onToggle,
  onFileClick,
  currentPath,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onFileClick: (path: string) => void;
  currentPath: string;
}) {
  const isDir = node.entry.type === 'dir';
  const isActive = node.entry.path === currentPath;

  return (
    <div>
      <button
        onClick={() => (isDir ? onToggle(node.entry.path) : onFileClick(node.entry.path))}
        className={`flex items-center w-full text-left px-2 py-0.5 text-xs hover:bg-gray-100 rounded transition-colors ${
          isActive ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir ? (
          <span className="mr-1 text-gray-400 w-3 text-center">
            {node.expanded ? '▼' : '▶'}
          </span>
        ) : (
          <span className="mr-1 w-3" />
        )}
        <span className={isDir ? 'text-blue-600' : ''}>
          {isDir ? '📁' : '📄'} {node.entry.name}
        </span>
        {!isDir && node.entry.size > 0 && (
          <span className="ml-auto text-[10px] text-gray-400">
            {node.entry.size > 1024
              ? `${(node.entry.size / 1024).toFixed(1)}K`
              : `${node.entry.size}B`}
          </span>
        )}
      </button>
      {isDir && node.expanded && node.children && (
        <div>
          {node.loading ? (
            <div
              className="text-[10px] text-gray-400 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              Loading...
            </div>
          ) : (
            node.children.map((child) => (
              <FileTreeItem
                key={child.entry.path}
                node={child}
                depth={depth + 1}
                onToggle={onToggle}
                onFileClick={onFileClick}
                currentPath={currentPath}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 子组件：代码视图
// ============================================================
function CodeView({
  file,
  annotations,
  highlightLine,
  onLineClick,
  onLineRangeSelect,
  onSymbolSelect,
  selectedLines,
  selectedRange,
}: {
  file: KernelFileResponse | null;
  annotations: CodeAnnotation[];
  highlightLine: number | null;
  onLineClick: (line: number, event?: MouseEvent) => void;
  onLineRangeSelect: (start: number, end: number) => void;
  onSymbolSelect: (symbol: string | null) => void;
  selectedLines: Set<number>;
  selectedRange: [number, number] | null;
}) {
  const codeRef = useRef<HTMLPreElement>(null);
  const [selStart, setSelStart] = useState<number | null>(null);

  useEffect(() => {
    if (highlightLine && codeRef.current) {
      const lineEl = codeRef.current.querySelector(`[data-line="${highlightLine}"]`);
      if (lineEl) {
        lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightLine, file]);

  // 当 selectedLines 变化且只有一行时，自动滚动到该行
  useEffect(() => {
    if (selectedLines.size === 1) {
      const lineNum = Array.from(selectedLines)[0];
      const scrollToLine = () => {
        const lineEl = document.querySelector(`[data-line="${lineNum}"]`);
        if (lineEl) {
          lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          // 重试几次直到元素出现
          setTimeout(scrollToLine, 50);
        }
      };
      scrollToLine();
    }
  }, [selectedLines]);

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-4">📂</div>
          <p className="text-sm">Select a file from the tree to view its content</p>
        </div>
      </div>
    );
  }

  const annotatedLines = new Set<number>();
  annotations.forEach((a) => {
    for (let i = a.start_line; i <= a.end_line; i++) {
      annotatedLines.add(i);
    }
  });

  const lines = file.content.split('\n');

  const handleMouseDown = (lineNum: number, e: React.MouseEvent) => {
    e.preventDefault();
    setSelStart(lineNum);
  };

  const handleMouseUp = (lineNum: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (selStart !== null) {
      const start = Math.min(selStart, lineNum);
      const end = Math.max(selStart, lineNum);
      if (start === end) {
        onLineClick(start, e.nativeEvent as MouseEvent);
      } else {
        onLineRangeSelect(start, end);
      }
      setSelStart(null);
    }
  };

  const handleCodeMouseUp = () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || '';
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(selectedText)) {
      onSymbolSelect(selectedText);
      return;
    }
    onSymbolSelect(null);
  };

  // 计算高亮行
  const getIsHighlighted = (lineNum: number): boolean => {
    if (selectedRange && lineNum >= selectedRange[0] && lineNum <= selectedRange[1]) {
      return true;
    }
    return selectedLines.has(lineNum);
  };

  // 根据文件扩展名获取语言
  const getLanguage = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
      py: 'python', rs: 'rust', go: 'go', js: 'javascript',
      ts: 'typescript', sh: 'bash', makefile: 'makefile',
      kt: 'kotlin', swift: 'swift', rb: 'ruby', yml: 'yaml',
      yaml: 'yaml', json: 'json', xml: 'xml', html: 'html',
      css: 'css', md: 'markdown',
    };
    return langMap[ext] || 'plaintext';
  };

  // 对代码行进行语法高亮
  const highlightCode = useCallback((code: string, lang: string) => {
    try {
      if (hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return code;
    }
  }, []);

  const language = getLanguage(file.path);
  const highlightedLines = lines.map(line => highlightCode(line, language));

  return (
    <div className="flex-1 overflow-auto bg-white">
      <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center gap-2">
        <span className="text-xs font-mono text-gray-600">{file.path}</span>
        <span className="text-[10px] text-gray-400">
          {file.line_count} lines | {file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}
        </span>
        {file.truncated && (
          <span className="text-[10px] text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded">
            truncated
          </span>
        )}
        <span className="ml-auto text-[10px] text-gray-400">
          Click: select | Ctrl+Click: multi-select | Esc: clear
        </span>
      </div>
      <pre ref={codeRef} className="text-xs font-mono leading-5 select-text">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((_, idx) => {
              const lineNum = idx + 1;
              const isHighlighted = getIsHighlighted(lineNum);
              const isAnnotated = annotatedLines.has(lineNum);
              return (
                <tr
                  key={lineNum}
                  data-line={lineNum}
                  className={`${
                    isHighlighted
                      ? 'bg-yellow-100'
                      : isAnnotated
                      ? 'bg-blue-50'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <td
                    className={`w-12 text-right pr-3 select-none cursor-pointer border-r border-gray-200 sticky left-0 bg-inherit transition-colors ${
                      isHighlighted
                        ? 'text-indigo-600 bg-yellow-50 font-bold'
                        : isAnnotated
                        ? 'text-blue-600 bg-blue-50'
                        : 'text-gray-400 hover:text-indigo-400 hover:bg-gray-100'
                    }`}
                    onMouseDown={(e) => handleMouseDown(lineNum, e)}
                    onMouseUp={(e) => handleMouseUp(lineNum, e)}
                    title={isAnnotated ? 'Click to view/edit annotation' : 'Click to add annotation'}
                  >
                    {lineNum}
                    {isAnnotated && (
                      <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1" />
                    )}
                  </td>
                  <td className="pl-4 whitespace-pre" onMouseUp={handleCodeMouseUp}>
                    <code dangerouslySetInnerHTML={{ __html: highlightedLines[idx] }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </pre>
    </div>
  );
}

// ============================================================
// 子组件：弹窗编辑标注
// ============================================================
function AnnotationModal({
  isOpen,
  onClose,
  mode,
  initialBody,
  lineInfo,
  onSave,
  saving,
  initialVisibility = 'public',
}: {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  initialBody: string;
  lineInfo: string;
  onSave: (body: string, visibility: 'public' | 'private') => void;
  saving: boolean;
  initialVisibility?: 'public' | 'private';
}) {
  const { isAdmin } = useAuth();
  const [body, setBody] = useState(initialBody);
  const [visibility, setVisibility] = useState<'public' | 'private'>(isAdmin ? initialVisibility : 'private');

  useEffect(() => {
    setBody(initialBody);
  }, [initialBody]);

  useEffect(() => {
    setVisibility(isAdmin ? initialVisibility : 'private');
  }, [initialVisibility, isAdmin]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            {mode === 'create' ? 'Add Annotation' : 'Edit Annotation'}
          </h3>
          <span className="text-xs text-gray-400">{lineInfo}</span>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3">
          <div className="flex-1 min-h-0">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write annotation (Markdown supported)..."
              className="w-full h-full min-h-[200px] px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono"
              autoFocus
            />
          </div>
          {mode === 'create' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Visibility</span>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                {isAdmin && <option value="public">Public</option>}
                <option value="private">Private</option>
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onSave(body, visibility)}
              disabled={saving || !body.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 子组件：注释面板
// ============================================================
function AnnotationPanel({
  annotations,
  selectedLines,
  selectedRange,
  version,
  filePath,
  onAnnotationCreated,
  onAnnotationDeleted,
  onGoToLine,
}: {
  annotations: CodeAnnotation[];
  selectedLines: Set<number>;
  selectedRange: [number, number] | null;
  version: string;
  filePath: string;
  onAnnotationCreated: () => void;
  onAnnotationDeleted: () => void;
  onGoToLine?: (line: number) => void;
}) {
  const { canWrite, currentUser, isAdmin } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAnnotation, setEditingAnnotation] = useState<CodeAnnotation | null>(null);
  const [saving, setSaving] = useState(false);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  // 展开/折叠状态
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 计算每个标注的回复数量
  const replyCounts = annotations.reduce((acc, a) => {
    if (a.in_reply_to) {
      acc[a.in_reply_to] = (acc[a.in_reply_to] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  // 获取顶级标注（没有 in_reply_to）
  const rootAnnotations = annotations.filter(a => !a.in_reply_to);
  const canManageAnnotation = (annotation: CodeAnnotation) =>
    !!currentUser &&
    (isAdmin ||
      (canWrite &&
        annotation.visibility === 'private' &&
        annotation.author_user_id === currentUser.user_id));

  // 切换展开/折叠
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 默认展开所有顶级标注
  useEffect(() => {
    const newExpanded = new Set<string>();
    rootAnnotations.forEach(a => newExpanded.add(a.annotation_id));
    setExpandedIds(newExpanded);
  }, [annotations]);

  const handleCreate = async (body: string, visibility: 'public' | 'private') => {
    setSaving(true);
    try {
      let start: number, end: number;
      if (selectedRange) {
        start = selectedRange[0];
        end = selectedRange[1];
      } else if (selectedLines.size > 0) {
        // 使用第一个选中的行作为范围起点
        const sorted = Array.from(selectedLines).sort((a, b) => a - b);
        start = sorted[0];
        end = sorted[sorted.length - 1];
      } else {
        start = 1;
        end = 1;
      }
      await createCodeAnnotation({
        version,
        file_path: filePath,
        start_line: start,
        end_line: end,
        body: body.trim(),
        visibility,
        in_reply_to: replyToId || undefined,
      });
      setShowCreateModal(false);
      setReplyToId(null);
      onAnnotationCreated();
    } catch (e: unknown) {
      alert(`Failed to create annotation: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (body: string) => {
    if (!editingAnnotation) return;
    setSaving(true);
    try {
      await updateCodeAnnotation(editingAnnotation.annotation_id, body.trim());
      setEditingAnnotation(null);
      onAnnotationCreated();
    } catch (e: unknown) {
      alert(`Failed to update: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this annotation?')) return;
    try {
      await deleteCodeAnnotation(id);
      onAnnotationDeleted();
    } catch (e: unknown) {
      alert(`Failed to delete: ${e instanceof Error ? e.message : e}`);
    }
  };

  const lineInfo = selectedRange
    ? `Lines ${selectedRange[0]}-${selectedRange[1]}`
    : selectedLines.size > 0
    ? `Lines ${Array.from(selectedLines).sort((a, b) => a - b).join(', ')}`
    : '';

  const relevantAnnotations = annotations.filter((a) => {
    // 回复标注始终显示
    if (a.in_reply_to) return true;
    
    if (selectedRange) {
      return a.start_line <= selectedRange[1] && a.end_line >= selectedRange[0];
    }
    if (selectedLines.size > 0) {
      // 检查标注是否与任何选中的行重叠
      return Array.from(selectedLines).some(
        (line) => a.start_line <= line && a.end_line >= line
      );
    }
    return true;
  });

  return (
    <>
      <div className="w-80 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-gray-200 bg-white flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Annotations</h3>
            {lineInfo && <p className="text-[10px] text-gray-400 mt-0.5">{lineInfo}</p>}
          </div>
          {canWrite && (selectedLines.size > 0 || selectedRange) && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 flex items-center gap-1"
            >
              <span>+</span> Add
            </button>
          )}
        </div>

        {(selectedLines.size > 0 || selectedRange) && (
          <div className="px-3 py-2 bg-white border-b border-gray-100">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Range Tags</div>
            <EmailTagEditor
              targetType="kernel_line_range"
              targetRef={`${version}:${filePath}`}
              anchor={{
                start_line: selectedRange ? selectedRange[0] : Math.min(...Array.from(selectedLines)),
                end_line: selectedRange ? selectedRange[1] : Math.max(...Array.from(selectedLines)),
              }}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {relevantAnnotations.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">
              {selectedLines.size > 0 || selectedRange
                ? 'No annotations for this selection'
                : 'Click a line number to add annotation'}
            </p>
          ) : (
            <div className="space-y-2">
              {rootAnnotations.map((rootAnn) => {
                const isExpanded = expandedIds.has(rootAnn.annotation_id);
                const replyCount = replyCounts[rootAnn.annotation_id] || 0;
                const replies = annotations.filter(a => a.in_reply_to === rootAnn.annotation_id);
                
                return (
                  <div key={rootAnn.annotation_id} className="space-y-1">
                    {/* 顶级标注 */}
                    <div
                      className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm flex flex-col"
                    >
                      <div className="px-3 py-2 bg-gray-50 flex items-center justify-between border-b border-gray-200 shrink-0">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleExpand(rootAnn.annotation_id)}
                            className="text-[10px] text-gray-400 hover:text-gray-600 w-4"
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                          <span className="text-xs text-gray-400">
                            L{rootAnn.start_line}
                            {rootAnn.end_line !== rootAnn.start_line && `-${rootAnn.end_line}`}
                          </span>
                          {replyCount > 0 && (
                            <span className="text-[10px] text-gray-400">
                              ({replyCount} {replyCount === 1 ? 'reply' : 'replies'})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onGoToLine?.(rootAnn.start_line)}
                            className="text-[10px] text-blue-500 hover:text-blue-700 font-medium"
                          >
                            Goto
                          </button>
                          {canWrite && (
                            <>
                              <button
                                onClick={() => {
                                  setReplyToId(rootAnn.annotation_id);
                                  setShowCreateModal(true);
                                }}
                                className="text-[10px] text-gray-400 hover:text-green-500"
                              >
                                Reply
                              </button>
                              {canManageAnnotation(rootAnn) && (
                                <>
                                  <button
                                    onClick={() => setEditingAnnotation(rootAnn)}
                                    className="text-[10px] text-gray-400 hover:text-blue-500"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDelete(rootAnn.annotation_id)}
                                    className="text-[10px] text-gray-400 hover:text-red-500"
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="px-3 py-2 overflow-hidden">
                        <div className="markdown-content line-clamp-3 overflow-hidden">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{rootAnn.body}</ReactMarkdown>
                        </div>
                        <div className="mt-2">
                          <EmailTagEditor targetType="annotation" targetRef={rootAnn.annotation_id} compact />
                        </div>
                      </div>
                    </div>
                    
                    {/* 展开的回复 */}
                    {isExpanded && replies.map((reply) => (
                      <div
                        key={reply.annotation_id}
                        className="ml-4 bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm flex flex-col border-l-4 border-l-green-500"
                      >
                        <div className="px-3 py-2 bg-gray-50 flex items-center justify-between border-b border-gray-200 shrink-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-green-500 bg-green-50 px-1.5 py-0.5 rounded">
                              Reply
                            </span>
                            <span className="text-xs text-gray-400">
                              L{reply.start_line}
                              {reply.end_line !== reply.start_line && `-${reply.end_line}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onGoToLine?.(reply.start_line)}
                              className="text-[10px] text-blue-500 hover:text-blue-700 font-medium"
                            >
                              Goto
                            </button>
                            {canManageAnnotation(reply) && (
                              <button
                                onClick={() => handleDelete(reply.annotation_id)}
                                className="text-[10px] text-gray-400 hover:text-red-500"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="px-3 py-2 overflow-hidden">
                          <div className="markdown-content line-clamp-3 overflow-hidden">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply.body}</ReactMarkdown>
                          </div>
                          <div className="mt-2">
                            <EmailTagEditor targetType="annotation" targetRef={reply.annotation_id} compact />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <AnnotationModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        mode="create"
        initialBody=""
        lineInfo={lineInfo}
        onSave={handleCreate}
        saving={saving}
      />

      <AnnotationModal
        isOpen={!!editingAnnotation}
        onClose={() => setEditingAnnotation(null)}
        mode="edit"
        initialBody={editingAnnotation?.body || ''}
        lineInfo={editingAnnotation ? `L${editingAnnotation.start_line}${editingAnnotation.end_line !== editingAnnotation.start_line ? `-${editingAnnotation.end_line}` : ''}` : ''}
        onSave={(body, _visibility) => handleUpdate(body)}
        saving={saving}
      />
    </>
  );
}

function SymbolCandidatesModal({
  symbol,
  candidates,
  onClose,
  onSelect,
}: {
  symbol: string;
  candidates: KernelSymbol[];
  onClose: () => void;
  onSelect: (candidate: KernelSymbol) => void;
}) {
  if (!symbol || candidates.length === 0) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Definition Candidates</h3>
            <p className="text-xs text-gray-400 mt-0.5">{symbol}</p>
          </div>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">
            Close
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {candidates.map((candidate) => (
            <button
              key={`${candidate.file_path}:${candidate.line}:${candidate.column}:${candidate.kind}`}
              onClick={() => onSelect(candidate)}
              className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600 font-medium">
                  {candidate.kind}
                </span>
                <span className="font-mono text-gray-700">{candidate.file_path}</span>
                <span className="text-gray-400">:{candidate.line}</span>
              </div>
              {candidate.signature && (
                <div className="mt-1 text-[11px] text-gray-500 font-mono">
                  {candidate.symbol}
                  {candidate.signature}
                </div>
              )}
              {candidate.scope && (
                <div className="mt-1 text-[11px] text-gray-400">
                  scope: {candidate.scope}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 主页面
// ============================================================
export default function KernelCodePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlVersion = searchParams.get('v') || '';
  const urlPath = searchParams.get('path') || '';
  const urlLine = parseInt(searchParams.get('line') || '0', 10) || null;

  const [versions, setVersions] = useState<KernelVersionInfo[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState(urlVersion);
  const [rootTree, setRootTree] = useState<TreeNode[]>([]);
  const [currentFile, setCurrentFile] = useState<KernelFileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(urlPath);
  const [annotations, setAnnotations] = useState<CodeAnnotation[]>([]);
  const [selectedLines, setSelectedLines] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    if (urlLine) initial.add(urlLine);
    return initial;
  });
  const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewAnnotation, setPreviewAnnotation] = useState<CodeAnnotation | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [symbolLoading, setSymbolLoading] = useState(false);
  const [symbolCandidates, setSymbolCandidates] = useState<KernelSymbol[]>([]);

  // Keyboard handler for Escape to clear selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedLines(new Set());
        setSelectedRange(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    setVersionsLoading(true);
    getKernelVersions('all')
      .then((res) => {
        setVersions(res.versions);
        if (!selectedVersion && res.versions.length > 0) {
          setSelectedVersion(res.versions[0].tag);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setVersionsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedVersion) return;
    setError(null);
    getKernelTree(selectedVersion, '')
      .then((res) => {
        const nodes: TreeNode[] = res.entries.map((e) => ({
          entry: e,
          children: undefined,
          expanded: false,
          loading: false,
        }));
        setRootTree(nodes);
      })
      .catch((e) => setError(e.message));
  }, [selectedVersion]);

  useEffect(() => {
    if (urlPath && selectedVersion) {
      loadFile(urlPath);
    }
  }, [selectedVersion]);

  const updateUrl = useCallback(
    (v: string, path: string, line?: number) => {
      const params: Record<string, string> = {};
      if (v) params.v = v;
      if (path) params.path = path;
      if (line) params.line = String(line);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  const toggleDir = useCallback(
    async (dirPath: string) => {
      const updateNodes = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) => {
          if (n.entry.path === dirPath) {
            if (n.expanded) {
              return { ...n, expanded: false };
            }
            if (!n.children) {
              const loading = { ...n, expanded: true, loading: true, children: [] };
              getKernelTree(selectedVersion, dirPath)
                .then((res) => {
                  const children: TreeNode[] = res.entries.map((e) => ({
                    entry: e,
                    children: undefined,
                    expanded: false,
                    loading: false,
                  }));
                  setRootTree((prev) => updateChildrenInTree(prev, dirPath, children));
                })
                .catch(console.error);
              return loading;
            }
            return { ...n, expanded: true };
          }
          if (n.children) {
            return { ...n, children: updateNodes(n.children) };
          }
          return n;
        });

      setRootTree((prev) => updateNodes(prev));
    },
    [selectedVersion]
  );

  const updateChildrenInTree = (
    nodes: TreeNode[],
    targetPath: string,
    children: TreeNode[]
  ): TreeNode[] =>
    nodes.map((n) => {
      if (n.entry.path === targetPath) {
        return { ...n, children, loading: false };
      }
      if (n.children) {
        return { ...n, children: updateChildrenInTree(n.children, targetPath, children) };
      }
      return n;
    });

  const loadFile = useCallback(
    async (path: string, options?: { targetLine?: number | null }) => {
      if (!selectedVersion) return;
      setFileLoading(true);
      setCurrentPath(path);
      setSelectedRange(null);
      setError(null);
      try {
        const [fileRes, annotRes] = await Promise.all([
          getKernelFile(selectedVersion, path),
          getCodeAnnotations(selectedVersion, path).catch(() => [] as CodeAnnotation[]),
        ]);
        setCurrentFile(fileRes);
        setAnnotations(annotRes);
        setShowAnnotations(annotRes.length > 0);
        const nextLine = options?.targetLine ?? urlLine;
        updateUrl(selectedVersion, path, nextLine || undefined);

        if (nextLine) {
          setSelectedLines(new Set([nextLine]));
        } else {
          setSelectedLines(new Set());
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        setCurrentFile(null);
      } finally {
        setFileLoading(false);
      }
    },
    [selectedVersion, updateUrl, urlLine]
  );

  const handleVersionSelect = (tag: string) => {
    setSelectedVersion(tag);
    setCurrentFile(null);
    setCurrentPath('');
    setAnnotations([]);
    updateUrl(tag, '');
  };

  const handleLineClick = (line: number, event?: MouseEvent) => {
    // Ctrl/Cmd + 点击: 多选
    if (event?.ctrlKey || event?.metaKey) {
      setSelectedLines(prev => {
        const next = new Set(prev);
        if (next.has(line)) {
          next.delete(line);
        } else {
          next.add(line);
        }
        return next;
      });
      setSelectedRange(null);
    } else if (event?.shiftKey && selectedLines.size === 1) {
      // Shift + 点击: 范围选择
      const firstLine = Array.from(selectedLines)[0];
      const start = Math.min(firstLine, line);
      const end = Math.max(firstLine, line);
      setSelectedRange([start, end]);
      setSelectedLines(new Set());
    } else {
      // 普通点击: 取消选中已选行 或 选中单行
      if (selectedLines.has(line)) {
        setSelectedLines(new Set());
        setSelectedRange(null);
      } else {
        setSelectedLines(new Set([line]));
        setSelectedRange(null);
      }
    }
    setShowAnnotations(true);
    updateUrl(selectedVersion, currentPath, line);
  };

  const handleLineRangeSelect = (start: number, end: number) => {
    setSelectedRange([start, end]);
    setSelectedLines(new Set());
    setShowAnnotations(true);
  };

  const handleGoToLine = (line: number) => {
    setSelectedLines(new Set([line]));
    setSelectedRange(null);
    setShowAnnotations(true);
  };

  const jumpToSymbol = useCallback(
    async (symbol: string) => {
      if (!selectedVersion || !currentPath) return;
      setSymbolLoading(true);
      setError(null);
      try {
        const res = await getKernelSymbolDefinition(selectedVersion, symbol, currentPath);
        setSelectedSymbol(res.symbol);
        if (res.total === 0) {
          setError(`No definition found for symbol "${symbol}" in ${selectedVersion}`);
          setSymbolCandidates([]);
          return;
        }
        if (res.total === 1) {
          setSymbolCandidates([]);
          const candidate = res.candidates[0];
          await loadFile(candidate.file_path, { targetLine: candidate.line });
          return;
        }
        setSymbolCandidates(res.candidates);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSymbolLoading(false);
      }
    },
    [currentPath, loadFile, selectedVersion]
  );

  const refreshAnnotations = useCallback(async () => {
    if (!selectedVersion || !currentPath) return;
    try {
      const res = await getCodeAnnotations(selectedVersion, currentPath);
      setAnnotations(res);
    } catch {
      // ignore
    }
  }, [selectedVersion, currentPath]);

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 text-xs shrink-0">
        <span className="font-semibold text-gray-700">Kernel Code</span>
        {selectedVersion && (
          <>
            <span className="text-gray-400">/</span>
            <span className="text-indigo-600 font-medium">{selectedVersion}</span>
          </>
        )}
        {currentPath && (
          <>
            <span className="text-gray-400">/</span>
            <span className="text-gray-600 font-mono">{currentPath}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {selectedSymbol && (
            <div className="flex items-center gap-2 rounded-full bg-amber-50 px-2 py-1">
              <span className="text-[10px] text-amber-700 font-mono">{selectedSymbol}</span>
              <button
                onClick={() => jumpToSymbol(selectedSymbol)}
                disabled={symbolLoading || !currentPath}
                className="text-[10px] font-medium text-amber-800 hover:text-amber-900 disabled:opacity-50"
              >
                {symbolLoading ? 'Resolving...' : 'Go to Definition'}
              </button>
              <button
                onClick={() => {
                  setSelectedSymbol(null);
                  setSymbolCandidates([]);
                }}
                className="text-[10px] text-amber-600 hover:text-amber-800"
              >
                Clear
              </button>
            </div>
          )}
          {annotations.length > 0 && (
            <button
              onClick={() => setShowAnnotations(!showAnnotations)}
              className={`px-2 py-1 rounded text-[10px] font-medium ${
                showAnnotations
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {annotations.length} annotations
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-64 border-r border-gray-200 bg-white flex flex-col overflow-hidden shrink-0">
          <div className="p-3 border-b border-gray-200">
            <VersionSelector
              versions={versions}
              selected={selectedVersion}
              onSelect={handleVersionSelect}
              loading={versionsLoading}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {rootTree.map((node) => (
              <FileTreeItem
                key={node.entry.path}
                node={node}
                depth={0}
                onToggle={toggleDir}
                onFileClick={loadFile}
                currentPath={currentPath}
              />
            ))}
          </div>
        </div>

        {fileLoading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Loading file...
          </div>
        ) : (
          <CodeView
            file={currentFile}
            annotations={annotations}
            highlightLine={selectedLines.size === 1 ? Array.from(selectedLines)[0] : null}
            onLineClick={handleLineClick}
            onLineRangeSelect={handleLineRangeSelect}
            onSymbolSelect={setSelectedSymbol}
            selectedLines={selectedLines}
            selectedRange={selectedRange}
          />
        )}

        {showAnnotations && currentFile && (
          <AnnotationPanel
            annotations={annotations}
            selectedLines={selectedLines}
            selectedRange={selectedRange}
            version={selectedVersion}
            filePath={currentPath}
            onAnnotationCreated={refreshAnnotations}
            onAnnotationDeleted={refreshAnnotations}
            onGoToLine={handleGoToLine}
          />
        )}
      </div>

      {/* 预览弹窗 */}
      <PreviewModal
        isOpen={!!previewAnnotation}
        onClose={() => setPreviewAnnotation(null)}
        annotation={previewAnnotation}
      />

      <SymbolCandidatesModal
        symbol={selectedSymbol || ''}
        candidates={symbolCandidates}
        onClose={() => setSymbolCandidates([])}
        onSelect={async (candidate) => {
          setSymbolCandidates([]);
          await loadFile(candidate.file_path, { targetLine: candidate.line });
        }}
      />
    </div>
  );
}
