import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import {
  getKernelFile,
  getKernelTree,
  getKernelVersions,
  getCodeAnnotations,
} from '../api/client';
import type { KernelVersionInfo, KernelFileResponse, KernelTreeEntry, CodeAnnotation } from '../api/types';
import { showToast } from '../components/Toast';
import { pickKernelSourceUrl, elixirIdentUrl, isLikelyCIdentifier } from '../utils/externalLinks';
import AnnotationPanel from '../components/kernelCode/AnnotationPanel';

// ============================================================
// Helpers
// ============================================================
function isValidFilePath(path: string): boolean {
  return path.trim().length > 0;
}


// ============================================================
// Main Page
// ============================================================
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
    const s = new Set<number>();
    if (urlLine) s.add(urlLine);
    return s;
  });
  const [scriptCopied, setScriptCopied] = useState(false);
  const [treePath, setTreePath] = useState('');
  const [treeEntries, setTreeEntries] = useState<KernelTreeEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

  // 选中标识符浮动符号搜索按钮（PLAN-30002 Phase 2）
  const codeViewRef = useRef<HTMLDivElement | null>(null);
  const [symbolPopover, setSymbolPopover] = useState<
    { symbol: string; x: number; y: number } | null
  >(null);

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
      const line = targetLine ?? urlLine;
      setSelectedLines(line ? new Set([line]) : new Set());
      setSearchParams({ v: selectedVersion, path, ...(line ? { line: String(line) } : {}) }, { replace: true });
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
      setCurrentFile(null);
    } finally { setFileLoading(false); }
  }, [selectedVersion, urlLine, setSearchParams]);

  const loadTree = useCallback(async (path: string = '') => {
    if (!selectedVersion) return;
    setTreeLoading(true);
    try {
      const res = await getKernelTree(selectedVersion, path);
      setTreePath(res.path);
      setTreeEntries(res.entries.slice().sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      }));
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load file tree', 'error');
    } finally {
      setTreeLoading(false);
    }
  }, [selectedVersion]);

  // Load versions
  useEffect(() => {
    setVersionsLoading(true);
    getKernelVersions('all')
      .then(res => {
        setVersions(res.versions);
        setSelectedVersion(current => current || res.versions[0]?.tag || '');
      })
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setVersionsLoading(false));
  }, []);

  // Auto-load file from URL params
  useEffect(() => {
    if (urlPath && selectedVersion) {
      loadFile(urlPath, urlLine);
    }
  }, [loadFile, selectedVersion, urlLine, urlPath]);

  useEffect(() => {
    if (selectedVersion) {
      loadTree(treePath);
    }
  }, [loadTree, selectedVersion, treePath]);

  const handleVersionSelect = (tag: string) => {
    setSelectedVersion(tag);
    setCurrentFile(null);
    setCurrentPath('');
    setPathInput('');
    setTreePath('');
    setTreeEntries([]);
    setAnnotations([]);
    setSelectedLines(new Set());
    setSearchParams({ v: tag }, { replace: true });
  };

  const handleLoadFile = () => {
    if (!isValidFilePath(pathInput)) return;
    loadFile(pathInput.trim());
  };

  const handleLineClick = (line: number) => {
    setSelectedLines(prev => {
      if (prev.has(line)) {
        const next = new Set(prev);
        next.delete(line);
        return next.size === 0 ? prev : next;
      }
      return new Set([line]);
    });
    setSearchParams({ v: selectedVersion, path: currentPath, line: String(line) }, { replace: true });
  };

  // 当用户在代码视图内完成一次文本选择（mouseup）时，若选中为合法 C 标识符，
  // 在鼠标位置附近显示 “在 Elixir 搜索符号” 浮动按钮。
  const handleCodeMouseUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSymbolPopover(null);
      return;
    }
    const text = sel.toString().trim();
    if (!isLikelyCIdentifier(text)) {
      setSymbolPopover(null);
      return;
    }
    // 确认选区仍在代码视图容器内
    const container = codeViewRef.current;
    if (!container) return;
    const anchorNode = sel.anchorNode;
    if (!anchorNode || !container.contains(anchorNode)) {
      setSymbolPopover(null);
      return;
    }
    setSymbolPopover({ symbol: text, x: e.clientX, y: e.clientY });
  };

  // 点击其他区域或按 Esc 关闭 popover
  useEffect(() => {
    if (!symbolPopover) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && (target as HTMLElement).closest?.('[data-symbol-popover]')) {
        return;
      }
      setSymbolPopover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSymbolPopover(null);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [symbolPopover]);

  const handleCopyScript = async () => {
    try {
      const resp = await fetch('/app/userscripts/elixir-annotate.user.js');
      if (!resp.ok) throw new Error('fetch failed');
      let script = await resp.text();
      script = script.replace(/__API_BASE__/g, window.location.origin);
      script = script.replace(/__SESSION_COOKIE__/g, document.cookie);

      // Try Clipboard API first; fallback to execCommand for non-HTTPS
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(script); copied = true; } catch { /* fallback */ }
      }
      if (!copied) {
        const ta = document.createElement('textarea');
        ta.value = script;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 2000);
    } catch {
      showToast('复制失败，请手动从 /app/userscripts/elixir-annotate.user.js 下载', 'error');
    }
  };

  const handleAnnotationCreated = async () => {
    if (!selectedVersion || !currentPath) return;
    try {
      const annotRes = await getCodeAnnotations(selectedVersion, currentPath);
      setAnnotations(annotRes);
    } catch { /* ignore */ }
  };

  // Version filter (release only vs all)
  const [showAllVersions, setShowAllVersions] = useState(false);
  const filteredVersions = useMemo(() => {
    if (showAllVersions) return versions;
    return versions.filter(v => v.kind === 'release' || !v.tag.includes('-rc'));
  }, [versions, showAllVersions]);

  // Code lines
  const codeLines = useMemo(() => {
    if (!currentFile) return [];
    return currentFile.content.split('\n');
  }, [currentFile]);

  return (
    <div className="flex min-h-screen lg:h-[calc(100vh-4rem)]">
      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
          {versionsLoading ? (
            <span className="text-sm text-gray-400">加载版本...</span>
          ) : (
            <>
              <select
                value={selectedVersion}
                onChange={e => handleVersionSelect(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1 outline-none"
              >
                {filteredVersions.map(v => (
                  <option key={v.tag} value={v.tag}>{v.tag}</option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-gray-400">
                <input type="checkbox" checked={showAllVersions} onChange={e => setShowAllVersions(e.target.checked)} />
                全部版本
              </label>
            </>
          )}
          <input
            type="text"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleLoadFile(); }}
            placeholder="文件路径，如 mm/mmap.c"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1 outline-none focus:border-indigo-400"
          />
          <button
            onClick={handleLoadFile}
            disabled={!isValidFilePath(pathInput) || fileLoading}
            className="px-3 py-1 text-sm font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-50"
          >
            {fileLoading ? '加载中...' : '打开文件'}
          </button>
          {currentFile && (() => {
            const focusLine = selectedLines.size === 1 ? Array.from(selectedLines)[0] : undefined;
            const picked = pickKernelSourceUrl(selectedVersion, currentPath, focusLine);
            const label = picked.source === 'elixir' ? '在 Elixir 查看' : '在 git.kernel.org 查看';
            return (
              <a
                href={picked.url}
                target="_blank"
                rel="noopener noreferrer"
                title={picked.url}
                className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 whitespace-nowrap"
              >
                {label}
                <ExternalLink size={12} />
              </a>
            );
          })()}
          <button
            onClick={handleCopyScript}
            className={`ml-auto px-3 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
              scriptCopied
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            {scriptCopied ? '已复制 ✓' : '复制用户脚本 📋'}
          </button>
        </div>

        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setTreePath('')}
              className="rounded border border-gray-200 bg-white px-2 py-1 font-medium text-gray-600 hover:bg-gray-100"
            >
              /
            </button>
            {treePath && (
              <button
                type="button"
                onClick={() => setTreePath(treePath.split('/').slice(0, -1).join('/'))}
                className="rounded border border-gray-200 bg-white px-2 py-1 font-medium text-gray-600 hover:bg-gray-100"
              >
                ..
              </button>
            )}
            <span className="mr-1 text-gray-400">{treePath || 'root'}</span>
            {treeLoading ? (
              <span className="text-gray-400">Loading tree...</span>
            ) : treeEntries.length === 0 ? (
              <span className="text-gray-400">No entries</span>
            ) : (
              treeEntries.slice(0, 16).map((entry) => {
                const entryPicked = entry.type === 'file'
                  ? pickKernelSourceUrl(selectedVersion, entry.path)
                  : null;
                return (
                  <span
                    key={entry.path}
                    className={`group inline-flex items-stretch rounded border overflow-hidden font-medium ${
                      entry.type === 'directory'
                        ? 'border-sky-100 bg-sky-50 text-sky-700 hover:bg-sky-100'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (entry.type === 'directory') {
                          setTreePath(entry.path);
                        } else {
                          setPathInput(entry.path);
                          loadFile(entry.path);
                        }
                      }}
                      className="px-2 py-1"
                    >
                      {entry.type === 'directory' ? `${entry.name}/` : entry.name}
                    </button>
                    {entryPicked && (
                      <a
                        href={entryPicked.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`在 ${entryPicked.source === 'elixir' ? 'Elixir' : 'git.kernel.org'} 打开 ${entry.path}`}
                        onClick={e => e.stopPropagation()}
                        className="hidden group-hover:flex items-center pr-2 text-gray-400 hover:text-indigo-600"
                      >
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </span>
                );
              })
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Code view */}
          <div
            ref={codeViewRef}
            onMouseUp={handleCodeMouseUp}
            className="flex-1 overflow-auto relative"
          >
            {fileLoading ? (
              <div className="p-4 text-gray-400 text-sm">加载文件...</div>
            ) : currentFile ? (
              <div className="font-mono text-sm">
                {codeLines.map((line, i) => {
                  const lineNum = i + 1;
                  const isSelected = selectedLines.has(lineNum);
                  const linePicked = pickKernelSourceUrl(selectedVersion, currentPath, lineNum);
                  return (
                    <div
                      key={lineNum}
                      onClick={() => handleLineClick(lineNum)}
                      className={`group flex hover:bg-gray-50 cursor-pointer ${isSelected ? 'bg-yellow-100' : ''}`}
                    >
                      <span className="w-14 text-right pr-3 text-gray-400 select-none border-r border-gray-200 shrink-0 py-px">
                        {lineNum}
                      </span>
                      <span className="pl-3 py-px whitespace-pre flex-1">{line}</span>
                      <a
                        href={linePicked.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`在 ${linePicked.source === 'elixir' ? 'Elixir' : 'git.kernel.org'} 查看 L${lineNum}`}
                        onClick={e => e.stopPropagation()}
                        className="opacity-0 group-hover:opacity-100 px-2 text-gray-400 hover:text-indigo-600 select-none"
                      >
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-gray-400">
                <p className="text-sm">选择一个版本并输入文件路径来查看代码</p>
                <p className="text-xs mt-2">
                  也可以直接在{' '}
                  <a href="https://elixir.bootlin.com" target="_blank" rel="noopener noreferrer" className="text-indigo-500">
                    elixir.bootlin.com
                  </a>{' '}
                  浏览代码，使用 Tampermonkey 脚本添加注解
                </p>
              </div>
            )}
          </div>

          {/* Annotation side panel */}
          {currentFile && (
            <AnnotationPanel
              annotations={annotations}
              selectedLines={selectedLines}
              version={selectedVersion}
              filePath={currentPath}
              onAnnotationCreated={handleAnnotationCreated}
            />
          )}
        </div>
      </div>

      {/* 浮动符号搜索按钮（PLAN-30002 Phase 2） */}
      {symbolPopover && (
        <div
          data-symbol-popover
          style={{
            position: 'fixed',
            left: Math.min(symbolPopover.x + 8, window.innerWidth - 240),
            top: Math.min(symbolPopover.y + 12, window.innerHeight - 60),
            zIndex: 50,
          }}
          className="rounded-lg border border-gray-200 bg-white shadow-lg px-2 py-1.5 flex items-center gap-2"
        >
          <span className="text-xs text-gray-500">符号</span>
          <code className="text-xs font-mono text-indigo-600 max-w-[140px] truncate">
            {symbolPopover.symbol}
          </code>
          <a
            href={elixirIdentUrl(selectedVersion || 'latest', symbolPopover.symbol)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setSymbolPopover(null)}
            className="inline-flex items-center gap-1 rounded bg-indigo-500 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-600 whitespace-nowrap"
          >
            在 Elixir 搜索
            <ExternalLink size={11} />
          </a>
          <button
            type="button"
            onClick={() => setSymbolPopover(null)}
            className="text-xs text-gray-400 hover:text-gray-600 px-1"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
