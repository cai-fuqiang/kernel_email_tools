import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
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

  // 分组：Latest (v7+v6), LTS (v5.x, v4.x), History (v3-, v2-, v1-, v0-)
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
}: {
  file: KernelFileResponse | null;
  annotations: CodeAnnotation[];
  highlightLine: number | null;
  onLineClick: (line: number) => void;
  onLineRangeSelect: (start: number, end: number) => void;
}) {
  const codeRef = useRef<HTMLPreElement>(null);
  const [selStart, setSelStart] = useState<number | null>(null);

  // 滚动到高亮行
  useEffect(() => {
    if (highlightLine && codeRef.current) {
      const lineEl = codeRef.current.querySelector(`[data-line="${highlightLine}"]`);
      if (lineEl) {
        lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightLine, file]);

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

  // 构建注释行号集合
  const annotatedLines = new Set<number>();
  annotations.forEach((a) => {
    for (let i = a.start_line; i <= a.end_line; i++) {
      annotatedLines.add(i);
    }
  });

  const lines = file.content.split('\n');

  const handleMouseDown = (lineNum: number) => {
    setSelStart(lineNum);
  };

  const handleMouseUp = (lineNum: number) => {
    if (selStart !== null) {
      const start = Math.min(selStart, lineNum);
      const end = Math.max(selStart, lineNum);
      if (start === end) {
        onLineClick(start);
      } else {
        onLineRangeSelect(start, end);
      }
      setSelStart(null);
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-white">
      {/* 文件头 */}
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
      </div>
      {/* 代码区 */}
      <pre ref={codeRef} className="text-xs font-mono leading-5 select-text">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const isHighlighted = lineNum === highlightLine;
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
                    className="w-12 text-right pr-3 text-gray-400 select-none cursor-pointer border-r border-gray-200 sticky left-0 bg-inherit"
                    onMouseDown={() => handleMouseDown(lineNum)}
                    onMouseUp={() => handleMouseUp(lineNum)}
                  >
                    {lineNum}
                    {isAnnotated && (
                      <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1" />
                    )}
                  </td>
                  <td className="pl-4 whitespace-pre">{line}</td>
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
// 子组件：注释面板
// ============================================================
function AnnotationPanel({
  annotations,
  selectedLine,
  selectedRange,
  version,
  filePath,
  onAnnotationCreated,
  onAnnotationDeleted,
}: {
  annotations: CodeAnnotation[];
  selectedLine: number | null;
  selectedRange: [number, number] | null;
  version: string;
  filePath: string;
  onAnnotationCreated: () => void;
  onAnnotationDeleted: () => void;
}) {
  const [newBody, setNewBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const relevantAnnotations = annotations.filter((a) => {
    if (selectedLine) {
      return a.start_line <= selectedLine && a.end_line >= selectedLine;
    }
    if (selectedRange) {
      return a.start_line <= selectedRange[1] && a.end_line >= selectedRange[0];
    }
    return true;
  });

  const handleCreate = async () => {
    if (!newBody.trim()) return;
    const start = selectedRange ? selectedRange[0] : selectedLine || 1;
    const end = selectedRange ? selectedRange[1] : selectedLine || 1;
    setCreating(true);
    try {
      await createCodeAnnotation({
        version,
        file_path: filePath,
        start_line: start,
        end_line: end,
        body: newBody.trim(),
      });
      setNewBody('');
      onAnnotationCreated();
    } catch (e: unknown) {
      alert(`Failed to create annotation: ${e instanceof Error ? e.message : e}`);
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editBody.trim()) return;
    try {
      await updateCodeAnnotation(id, editBody.trim());
      setEditingId(null);
      onAnnotationCreated();
    } catch (e: unknown) {
      alert(`Failed to update: ${e instanceof Error ? e.message : e}`);
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

  return (
    <div className="w-80 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-200 bg-white">
        <h3 className="text-sm font-semibold text-gray-700">Annotations</h3>
        {selectedLine && (
          <p className="text-[10px] text-gray-400 mt-0.5">Line {selectedLine}</p>
        )}
        {selectedRange && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            Lines {selectedRange[0]}-{selectedRange[1]}
          </p>
        )}
      </div>

      {/* 新建注释 */}
      {(selectedLine || selectedRange) && (
        <div className="p-3 border-b border-gray-200 bg-white">
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Write annotation (Markdown)..."
            className="w-full h-20 px-2 py-1.5 text-xs border border-gray-300 rounded resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newBody.trim()}
            className="mt-1.5 w-full px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 rounded hover:bg-indigo-600 disabled:opacity-50"
          >
            {creating ? 'Saving...' : 'Add Annotation'}
          </button>
        </div>
      )}

      {/* 注释列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {relevantAnnotations.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">
            {selectedLine || selectedRange
              ? 'No annotations for this selection'
              : 'Click a line number to add annotation'}
          </p>
        ) : (
          relevantAnnotations.map((a) => (
            <div
              key={a.annotation_id}
              className="bg-white border border-gray-200 rounded-lg p-2.5 shadow-sm"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-indigo-500 font-medium">
                  L{a.start_line}
                  {a.end_line !== a.start_line && `-${a.end_line}`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingId(a.annotation_id);
                      setEditBody(a.body);
                    }}
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
              {editingId === a.annotation_id ? (
                <div>
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="w-full h-16 px-2 py-1 text-xs border border-gray-300 rounded resize-none"
                  />
                  <div className="flex gap-1 mt-1">
                    <button
                      onClick={() => handleUpdate(a.annotation_id)}
                      className="text-[10px] px-2 py-0.5 bg-indigo-500 text-white rounded"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-600 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-700 whitespace-pre-wrap">{a.body}</p>
              )}
              <div className="mt-1 text-[10px] text-gray-400">
                {a.author} · {new Date(a.created_at).toLocaleDateString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================
// 主页面
// ============================================================
export default function KernelCodePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL 参数
  const urlVersion = searchParams.get('v') || '';
  const urlPath = searchParams.get('path') || '';
  const urlLine = parseInt(searchParams.get('line') || '0', 10) || null;

  // 状态
  const [versions, setVersions] = useState<KernelVersionInfo[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState(urlVersion);
  const [treeNodes, setTreeNodes] = useState<Map<string, TreeNode[]>>(new Map());
  const [rootTree, setRootTree] = useState<TreeNode[]>([]);
  const [currentFile, setCurrentFile] = useState<KernelFileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(urlPath);
  const [annotations, setAnnotations] = useState<CodeAnnotation[]>([]);
  const [selectedLine, setSelectedLine] = useState<number | null>(urlLine);
  const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 加载版本列表
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

  // 版本切换时加载根目录
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
        setTreeNodes(new Map());
      })
      .catch((e) => setError(e.message));
  }, [selectedVersion]);

  // 加载 URL 指定的文件
  useEffect(() => {
    if (urlPath && selectedVersion) {
      loadFile(urlPath);
    }
  }, [selectedVersion]);

  // 更新 URL
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

  // 目录展开/折叠
  const toggleDir = useCallback(
    async (dirPath: string) => {
      const updateNodes = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) => {
          if (n.entry.path === dirPath) {
            if (n.expanded) {
              return { ...n, expanded: false };
            }
            // 需要加载子目录
            if (!n.children) {
              // 标记 loading
              const loading = { ...n, expanded: true, loading: true, children: [] };
              // 异步加载
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

  // 递归更新子节点
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

  // 加载文件
  const loadFile = useCallback(
    async (path: string) => {
      if (!selectedVersion) return;
      setFileLoading(true);
      setCurrentPath(path);
      setSelectedLine(null);
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
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        setCurrentFile(null);
      } finally {
        setFileLoading(false);
      }
    },
    [selectedVersion, updateUrl]
  );

  // 版本选择
  const handleVersionSelect = (tag: string) => {
    setSelectedVersion(tag);
    setCurrentFile(null);
    setCurrentPath('');
    setAnnotations([]);
    updateUrl(tag, '');
  };

  // 行点击
  const handleLineClick = (line: number) => {
    setSelectedLine(line);
    setSelectedRange(null);
    setShowAnnotations(true);
    updateUrl(selectedVersion, currentPath, line);
  };

  // 行范围选择
  const handleLineRangeSelect = (start: number, end: number) => {
    setSelectedRange([start, end]);
    setSelectedLine(null);
    setShowAnnotations(true);
  };

  // 注释刷新
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
      {/* 顶部面包屑 */}
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

      {/* 三栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左栏：版本 + 文件树 */}
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

        {/* 中栏：代码视图 */}
        {fileLoading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Loading file...
          </div>
        ) : (
          <CodeView
            file={currentFile}
            annotations={annotations}
            highlightLine={selectedLine}
            onLineClick={handleLineClick}
            onLineRangeSelect={handleLineRangeSelect}
          />
        )}

        {/* 右栏：注释面板 */}
        {showAnnotations && currentFile && (
          <AnnotationPanel
            annotations={annotations}
            selectedLine={selectedLine}
            selectedRange={selectedRange}
            version={selectedVersion}
            filePath={currentPath}
            onAnnotationCreated={refreshAnnotations}
            onAnnotationDeleted={refreshAnnotations}
          />
        )}
      </div>
    </div>
  );
}