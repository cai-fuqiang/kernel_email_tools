import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { listCodeAnnotations, getKernelVersions } from '../api/client';
import type { CodeAnnotation, KernelVersionInfo } from '../api/types';

export default function CodeAnnotationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [annotations, setAnnotations] = useState<CodeAnnotation[]>([]);
  const [versions, setVersions] = useState<KernelVersionInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // 过滤条件
  const q = searchParams.get('q') || '';
  const versionFilter = searchParams.get('version') || '';
  const pageSize = 20;

  // 加载版本列表（用于过滤）
  useEffect(() => {
    getKernelVersions('all')
      .then((res) => setVersions(res.versions))
      .catch(() => {});
  }, []);

  // 加载注释列表
  const loadAnnotations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listCodeAnnotations({
        q: q || undefined,
        version: versionFilter || undefined,
        page,
        page_size: pageSize,
      });
      setAnnotations(res.annotations);
      setTotal(res.total);
    } catch {
      setAnnotations([]);
    } finally {
      setLoading(false);
    }
  }, [q, versionFilter, page]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  // 跳转
  const handleJump = (a: CodeAnnotation) => {
    navigate(`/kernel-code?v=${encodeURIComponent(a.version)}&path=${encodeURIComponent(a.file_path)}&line=${a.start_line}`);
  };

  // 过滤条件变化时重置页码
  const handleFilterChange = (key: string, value: string) => {
    setPage(1);
    const params: Record<string, string> = {};
    if (key !== 'q') params.q = q;
    if (key !== 'version') params.version = versionFilter;
    if (value) params[key] = value;
    setSearchParams(params);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* 顶部 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Code Annotations</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {total > 0 ? `${total} annotations total` : 'No annotations yet'}
        </p>
      </div>

      {/* 过滤栏 */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <input
            type="text"
            placeholder="Search annotation content..."
            className="flex-1 max-w-xs px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
            defaultValue={q}
            onChange={(e) => handleFilterChange('q', e.target.value)}
          />
        </div>
        <select
          className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
          value={versionFilter}
          onChange={(e) => handleFilterChange('version', e.target.value)}
        >
          <option value="">All versions</option>
          {versions.map((v) => (
            <option key={v.tag} value={v.tag}>{v.tag}</option>
          ))}
        </select>
        {versionFilter && (
          <button
            onClick={() => handleFilterChange('version', '')}
            className="text-xs text-gray-500 hover:text-red-500"
          >
            Clear
          </button>
        )}
      </div>

      {/* 注释列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading...</div>
        ) : annotations.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <div className="text-4xl mb-3">📝</div>
            <p>No annotations found</p>
          </div>
        ) : (
          <div className="space-y-4 max-w-4xl">
            {annotations.map((a) => (
              <div
                key={a.annotation_id}
                className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col h-40"
                onClick={() => handleJump(a)}
              >
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 shrink-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded">
                      {a.version}
                    </span>
                    <span className="text-xs font-mono text-gray-500">
                      {a.file_path}
                    </span>
                    <span className="text-xs text-gray-400">
                      L{a.start_line}{a.end_line !== a.start_line ? `-${a.end_line}` : ''}
                    </span>
                  </div>
                </div>
                <div className="px-4 py-2 flex-1 overflow-hidden">
                  <div className="prose prose-xs prose-slate max-w-none line-clamp-4 overflow-hidden">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.body}</ReactMarkdown>
                  </div>
                </div>
                <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-[10px] text-gray-400">
                      <span>by {a.author}</span>
                      <span>·</span>
                      <span>{new Date(a.created_at).toLocaleDateString()}</span>
                      {a.updated_at !== a.created_at && (
                        <>
                          <span>·</span>
                          <span>edited {new Date(a.updated_at).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                    <button
                      className="shrink-0 px-2 py-1 text-xs font-medium text-white bg-indigo-500 rounded hover:bg-indigo-600"
                      onClick={(e) => { e.stopPropagation(); handleJump(a); }}
                    >
                      Jump
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
          <p className="text-xs text-gray-500">
            Page {page} of {totalPages} · {total} total
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}