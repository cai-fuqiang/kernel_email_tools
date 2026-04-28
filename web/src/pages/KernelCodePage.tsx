import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  getKernelFile,
  getKernelVersions,
  createCodeAnnotation,
  deleteCodeAnnotation,
  getCodeAnnotations,
} from '../api/client';
import {
  requestAnnotationPublication,
  withdrawAnnotationPublication,
  approveAnnotationPublication,
  rejectAnnotationPublication,
} from '../api/client';
import type { KernelVersionInfo, KernelFileResponse, CodeAnnotation } from '../api/types';
import EmailTagEditor from '../components/EmailTagEditor';
import { useAuth } from '../auth';

// ============================================================
// Helpers
// ============================================================
function isValidFilePath(path: string): boolean {
  return path.trim().length > 0;
}

function elixirUrl(version: string, filePath: string, line?: number): string {
  let url = `https://elixir.bootlin.com/linux/${version}/source/${filePath}`;
  if (line) url += `#L${line}`;
  return url;
}

// ============================================================
// Annotation Panel
// ============================================================
function AnnotationPanel({
  annotations,
  selectedLines,
  version,
  filePath,
  onAnnotationCreated,
}: {
  annotations: CodeAnnotation[];
  selectedLines: Set<number>;
  version: string;
  filePath: string;
  onAnnotationCreated: () => void;
}) {
  const { canWrite, currentUser, isAdmin } = useAuth();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const rootAnnotations = annotations.filter(a => !a.in_reply_to);
  const replyCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    annotations.forEach(a => {
      if (a.in_reply_to) acc[a.in_reply_to] = (acc[a.in_reply_to] || 0) + 1;
    });
    return acc;
  }, [annotations]);

  const canManage = (a: CodeAnnotation) =>
    !!currentUser && (isAdmin || (a.visibility === 'private' && a.publish_status !== 'pending' && a.author_user_id === currentUser.user_id));

  const toggleExpand = (id: string) =>
    setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  useEffect(() => {
    setExpandedIds(new Set(rootAnnotations.map(a => a.annotation_id)));
  }, [annotations]);

  const handleCreate = async () => {
    if (!body.trim() || selectedLines.size === 0) return;
    setSaving(true);
    try {
      const sorted = Array.from(selectedLines).sort((a, b) => a - b);
      await createCodeAnnotation({
        version, file_path: filePath,
        start_line: sorted[0], end_line: sorted[sorted.length - 1],
        body: body.trim(), visibility: isAdmin ? 'public' : 'private',
      });
      setBody('');
      onAnnotationCreated();
    } catch (e: unknown) {
      alert(`创建失败: ${e instanceof Error ? e.message : e}`);
    } finally { setSaving(false); }
  };

  const lineInfo = selectedLines.size > 0
    ? `L${Array.from(selectedLines).sort((a, b) => a - b).join(', ')}` : '';

  const relevant = annotations.filter(a => {
    if (a.in_reply_to) return true;
    if (selectedLines.size === 0) return true;
    return Array.from(selectedLines).some(l => a.start_line <= l && a.end_line >= l);
  });

  const PublishButton = ({ a }: { a: CodeAnnotation }) => {
    if (isAdmin && a.publish_status === 'pending') return (
      <span className="flex gap-1">
        <button onClick={async () => {
          const c = window.prompt('审核备注（可选）', '') || '';
          await approveAnnotationPublication(a.annotation_id, c);
          onAnnotationCreated();
        }} className="text-[10px] text-emerald-600">通过</button>
        <button onClick={async () => {
          const c = window.prompt('驳回原因（可选）', '') || '';
          await rejectAnnotationPublication(a.annotation_id, c);
          onAnnotationCreated();
        }} className="text-[10px] text-rose-600">驳回</button>
      </span>
    );
    if (!isAdmin && a.visibility === 'private' && a.author_user_id === currentUser?.user_id && a.publish_status !== 'pending')
      return <button onClick={async () => { await requestAnnotationPublication(a.annotation_id); onAnnotationCreated(); }} className="text-[10px] text-amber-600">申请公开</button>;
    if (a.publish_status === 'pending' && (isAdmin || a.author_user_id === currentUser?.user_id))
      return <button onClick={async () => { await withdrawAnnotationPublication(a.annotation_id); onAnnotationCreated(); }} className="text-[10px] text-slate-500">撤回</button>;
    return null;
  };

  return (
    <div className="w-80 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-200 bg-white flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">注解</h3>
        {canWrite && selectedLines.size > 0 && (
          <span className="text-[10px] text-gray-400">{lineInfo}</span>
        )}
      </div>

      {canWrite && selectedLines.size > 0 && (
        <div className="px-3 py-2 bg-white border-b border-gray-100">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="注解内容（Markdown）..."
            className="w-full min-h-[60px] text-xs border border-gray-200 rounded-lg p-2 outline-none focus:border-indigo-400 resize-y"
          />
          <div className="flex gap-2 mt-2">
            <button onClick={handleCreate} disabled={!body.trim() || saving}
              className="px-3 py-1 text-xs font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-50">
              {saving ? '保存中...' : '新增注解'}
            </button>
          </div>
          <div className="mt-2">
            <EmailTagEditor
              targetType="kernel_line_range"
              targetRef={`${version}:${filePath}`}
              anchor={{ start_line: Math.min(...selectedLines), end_line: Math.max(...selectedLines) }}
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {relevant.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">
            {selectedLines.size > 0 ? '所选行没有注解' : '点击行号添加注解'}
          </p>
        ) : (
          <div className="space-y-2">
            {rootAnnotations.filter(a => relevant.includes(a)).map(root => {
              const isExpanded = expandedIds.has(root.annotation_id);
              const replies = annotations.filter(a => a.in_reply_to === root.annotation_id);
              const replyCount = replyCounts[root.annotation_id] || 0;
              const statusColors: Record<string, string> = {
                pending: 'bg-amber-100 text-amber-800',
                approved: 'bg-emerald-100 text-emerald-800',
                rejected: 'bg-rose-100 text-rose-800',
              };
              const sc = statusColors[root.publish_status] || 'bg-slate-100 text-slate-700';

              return (
                <div key={root.annotation_id} className="space-y-1">
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                    <div className="px-3 py-2 bg-gray-50 flex items-center justify-between border-b border-gray-200">
                      <div className="flex items-center gap-2">
                        {replyCount > 0 && (
                          <button onClick={() => toggleExpand(root.annotation_id)} className="text-[10px] text-gray-400 w-4">
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        )}
                        <span className="text-xs text-gray-400">L{root.start_line}{root.end_line !== root.start_line ? `-${root.end_line}` : ''}</span>
                        {replyCount > 0 && <span className="text-[10px] text-gray-400">({replyCount})</span>}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sc}`}>{root.publish_status}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <PublishButton a={root} />
                        {canManage(root) && (
                          <button onClick={async () => { if (!confirm('删除此注解?')) return; await deleteCodeAnnotation(root.annotation_id); onAnnotationCreated(); }}
                            className="text-[10px] text-gray-400 hover:text-red-500">删除</button>
                        )}
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <div className="markdown-content text-xs">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{root.body}</ReactMarkdown>
                      </div>
                      {root.publish_review_comment && (
                        <div className="mt-2 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] text-gray-600">
                          审核备注：{root.publish_review_comment}
                        </div>
                      )}
                      <div className="mt-2">
                        <EmailTagEditor targetType="annotation" targetRef={root.annotation_id} compact />
                      </div>
                    </div>
                  </div>

                  {isExpanded && replies.map(reply => (
                    <div key={reply.annotation_id} className="ml-4 bg-white border border-gray-200 border-l-4 border-l-green-500 rounded-lg overflow-hidden shadow-sm">
                      <div className="px-3 py-2 bg-gray-50 flex items-center justify-between border-b border-gray-200">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-green-500 bg-green-50 px-1.5 py-0.5 rounded">回复</span>
                          <span className="text-xs text-gray-400">L{reply.start_line}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColors[reply.publish_status] || 'bg-slate-100 text-slate-700'}`}>{reply.publish_status}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <PublishButton a={reply} />
                          {canManage(reply) && (
                            <button onClick={async () => { if (!confirm('删除此回复?')) return; await deleteCodeAnnotation(reply.annotation_id); onAnnotationCreated(); }}
                              className="text-[10px] text-gray-400 hover:text-red-500">删除</button>
                          )}
                        </div>
                      </div>
                      <div className="px-3 py-2">
                        <div className="markdown-content text-xs">
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
  );
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
  const [error, setError] = useState<string | null>(null);
  const [scriptCopied, setScriptCopied] = useState(false);

  // Load versions
  useEffect(() => {
    setVersionsLoading(true);
    getKernelVersions('all')
      .then(res => {
        setVersions(res.versions);
        if (!selectedVersion && res.versions.length > 0) {
          setSelectedVersion(res.versions[0].tag);
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setVersionsLoading(false));
  }, []);

  // Auto-load file from URL params
  useEffect(() => {
    if (urlPath && selectedVersion) {
      loadFile(urlPath, urlLine);
    }
  }, [selectedVersion]);

  const loadFile = useCallback(async (path: string, targetLine?: number | null) => {
    if (!selectedVersion || !path) return;
    setFileLoading(true);
    setCurrentPath(path);
    setError(null);
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
      setError(e instanceof Error ? e.message : String(e));
      setCurrentFile(null);
    } finally { setFileLoading(false); }
  }, [selectedVersion, urlLine, setSearchParams]);

  const handleVersionSelect = (tag: string) => {
    setSelectedVersion(tag);
    setCurrentFile(null);
    setCurrentPath('');
    setPathInput('');
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
      alert('复制失败，请手动从 /app/userscripts/elixir-annotate.user.js 下载');
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
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white">
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
          {currentFile && (
            <a
              href={elixirUrl(selectedVersion, currentPath, selectedLines.size === 1 ? Array.from(selectedLines)[0] : undefined)}
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-indigo-500 hover:text-indigo-700 whitespace-nowrap"
            >
              在 elixir 打开 ↗
            </a>
          )}
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

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Code view */}
          <div className="flex-1 overflow-auto">
            {error && (
              <div className="p-4 text-red-600 text-sm">{error}</div>
            )}
            {fileLoading ? (
              <div className="p-4 text-gray-400 text-sm">加载文件...</div>
            ) : currentFile ? (
              <div className="font-mono text-sm">
                {codeLines.map((line, i) => {
                  const lineNum = i + 1;
                  const isSelected = selectedLines.has(lineNum);
                  return (
                    <div
                      key={lineNum}
                      onClick={() => handleLineClick(lineNum)}
                      className={`flex hover:bg-gray-50 cursor-pointer ${isSelected ? 'bg-yellow-100' : ''}`}
                    >
                      <span className="w-14 text-right pr-3 text-gray-400 select-none border-r border-gray-200 shrink-0 py-px">
                        {lineNum}
                      </span>
                      <span className="pl-3 py-px whitespace-pre">{line}</span>
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
    </div>
  );
}
