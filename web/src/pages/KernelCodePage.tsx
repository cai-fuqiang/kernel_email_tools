import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import PreviewModal from '../components/PreviewModal';
import {
  getKernelVersions,
  getKernelTree,
  getKernelFile,
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
} from '../api/types';

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
  selectedLines,
  selectedRange,
}: {
  file: KernelFileResponse | null;
  annotations: CodeAnnotation[];
  highlightLine: number | null;
  onLineClick: (line: number, event?: MouseEvent) => void;
  onLineRangeSelect: (start: number, end: number) => void;
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
                  <td className="pl-4 whitespace-pre"><code dangerouslySetInnerHTML={{ __html: highlightedLines[idx] }} /></td>
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
}: {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  initialBody: string;
  lineInfo: string;
  onSave: (body: string) => void;
  saving: boolean;
}) {
  const [body, setBody] = useState(initialBody);

  useEffect(() => {
    setBody(initialBody);
  }, [initialBody]);

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
          <div className="flex gap-2">
            <button
              onClick={() => onSave(body)}
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
  onPreview,
  onGoToLine,
}: {
  annotations: CodeAnnotation[];
  selectedLines: Set<number>;
  selectedRange: [number, number] | null;
  version: string;
  filePath: string;
  onAnnotationCreated: () => void;
  onAnnotationDeleted: () => void;
  onPreview: (a: CodeAnnotation) => void;
  onGoToLine?: (line: number) => void;
}) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAnnotation, setEditingAnnotation] = useState<CodeAnnotation | null>(null);
  const [saving, setSaving] = useState(false);

  const handleCreate = async (body: string) => {
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
      });
      setShowCreateModal(false);
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
          {(selectedLines.size > 0 || selectedRange) && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 flex items-center gap-1"
            >
              <span>+</span> Add
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {relevantAnnotations.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">
              {selectedLines.size > 0 || selectedRange
                ? 'No annotations for this selection'
                : 'Click a line number to add annotation'}
            </p>
          ) : (
            <div className="space-y-2">
              {relevantAnnotations.map((a) => (
                <div
                  key={a.annotation_id}
                  className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm flex flex-col h-40"
                >
                  <div className="px-3 py-2 bg-gray-50 flex items-center justify-between border-b border-gray-200 shrink-0">
                    <span 
                      className="text-xs text-indigo-500 font-medium cursor-pointer hover:underline"
                      onClick={() => onGoToLine?.(a.start_line)}
                    >
                      L{a.start_line}
                      {a.end_line !== a.start_line && `-${a.end_line}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingAnnotation(a)}
                        className="text-[10px] text-gray-400 hover:text-blue-500"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(a.annotation_id)}
                        className="text-[10px] text-gray-400 hover:text-red-500"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="px-3 py-2 flex-1 overflow-hidden">
                    <div className="markdown-content line-clamp-5 overflow-hidden">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.body}</ReactMarkdown>
                    </div>
                  </div>
                  <div className="px-3 py-1.5 flex items-center justify-between bg-gray-50 border-t border-gray-100 shrink-0">
                    <span className="text-[10px] text-gray-400">
                      {a.author} · {new Date(a.created_at).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => onPreview(a)}
                      className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium"
                    >
                      Preview
                    </button>
                  </div>
                </div>
              ))}
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
        onSave={handleUpdate}
        saving={saving}
      />
    </>
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
    async (path: string) => {
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
        updateUrl(selectedVersion, path);
        
        // 如果 URL 中有 line 参数，加载后保持该行选中状态
        if (urlLine) {
          setSelectedLines(new Set([urlLine]));
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
            onPreview={setPreviewAnnotation}
          />
        )}
      </div>

      {/* 预览弹窗 */}
      <PreviewModal
        isOpen={!!previewAnnotation}
        onClose={() => setPreviewAnnotation(null)}
        annotation={previewAnnotation}
      />
    </div>
  );
}