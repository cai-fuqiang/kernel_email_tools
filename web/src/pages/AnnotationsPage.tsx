import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import AnnotationTree from '../components/AnnotationTree';
import { listAnnotations } from '../api/client';
import type { AnnotationListItem } from '../api/types';

type FilterType = 'all' | 'email' | 'code' | 'sdm_spec';

export default function AnnotationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 筛选和分页状态
  const [filter, setFilter] = useState<FilterType>('all');
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [searchInput, setSearchInput] = useState(q);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  
  // 数据状态
  const [annotations, setAnnotations] = useState<AnnotationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 分页
  const totalPages = Math.ceil(total / pageSize);

  // 统计
  const emailCount = annotations.filter(a => a.annotation_type === 'email').length;
  const codeCount = annotations.filter(a => a.annotation_type === 'code').length;
  const specCount = annotations.filter(a => a.annotation_type === 'sdm_spec').length;

  // 加载数据
  const loadAnnotations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listAnnotations({ 
        q: q || undefined, 
        type: filter,
        page: page, 
        page_size: pageSize 
      });
      
      setAnnotations(res.annotations);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load annotations');
      setAnnotations([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filter, q, page, pageSize]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  // 搜索
  const handleSearch = () => {
    setPage(1);
    setQ(searchInput.trim());
    setSearchParams(searchInput.trim() ? { q: searchInput.trim() } : {});
  };

  const handleClear = () => {
    setSearchInput('');
    setPage(1);
    setQ('');
    setSearchParams({});
  };

  // 筛选变化
  const handleFilterChange = (newFilter: FilterType) => {
    setPage(1);
    setFilter(newFilter);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <i data-lucide="message-square" className="w-5 h-5 text-white"></i>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">统一标注中心</h1>
              <p className="text-sm text-slate-500">一套标注框架，统一承载邮件、代码和后续 spec 类目标</p>
            </div>
          </div>
          
          {/* 统计卡片 */}
          <div className="flex flex-wrap gap-4 mt-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg border border-blue-100">
              <i data-lucide="mail" className="w-4 h-4 text-blue-500"></i>
              <span className="text-sm text-blue-700 font-medium">{emailCount} 邮件批注</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 rounded-lg border border-indigo-100">
              <i data-lucide="code-2" className="w-4 h-4 text-indigo-500"></i>
              <span className="text-sm text-indigo-700 font-medium">{codeCount} 代码标注</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 rounded-lg border border-amber-100">
              <i data-lucide="scroll-text" className="w-4 h-4 text-amber-500"></i>
              <span className="text-sm text-amber-700 font-medium">{specCount} Spec 标注</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* 搜索栏 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <i data-lucide="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索标注内容、文件路径或讨论主题..."
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none transition-all"
              />
            </div>
            <button
              onClick={handleSearch}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <i data-lucide="search" className="w-4 h-4"></i>
              搜索
            </button>
            {q && (
              <button
                onClick={handleClear}
                className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2"
              >
                <i data-lucide="x" className="w-4 h-4"></i>
                清除
              </button>
            )}
          </div>
        </div>

        {/* 筛选标签 */}
        <div className="flex items-center gap-2 mb-6">
          <span className="text-sm text-slate-500 mr-2">类型筛选:</span>
          {(['all', 'email', 'code', 'sdm_spec'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                filter === f
                  ? f === 'all' ? 'bg-slate-800 text-white shadow-md' : f === 'email' ? 'bg-blue-600 text-white shadow-md' : f === 'code' ? 'bg-indigo-600 text-white shadow-md' : 'bg-amber-600 text-white shadow-md'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {f === 'all' && <><i data-lucide="layers" className="w-4 h-4"></i>全部</>}
              {f === 'email' && <><i data-lucide="mail" className="w-4 h-4"></i>邮件批注</>}
              {f === 'code' && <><i data-lucide="code-2" className="w-4 h-4"></i>代码标注</>}
              {f === 'sdm_spec' && <><i data-lucide="scroll-text" className="w-4 h-4"></i>Spec 标注</>}
            </button>
          ))}
        </div>

        {/* Loading/Error state */}
        {loading && (
          <div className="flex justify-center items-center py-16">
            <div className="animate-spin h-10 w-10 border-4 border-blue-600 border-t-transparent rounded-full"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-xl mb-4 flex items-center gap-2">
            <i data-lucide="alert-circle" className="w-5 h-5"></i>
            {error}
          </div>
        )}

        {/* Results count */}
        {!loading && !error && (
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
            <i data-lucide="info" className="w-4 h-4"></i>
            {q ? (
              <span>找到 <strong className="text-slate-700">{total}</strong> 条与 "<span className="text-slate-700">{q}</span>" 相关的批注</span>
            ) : (
              <span>共 <strong className="text-slate-700">{total}</strong> 条批注</span>
            )}
          </div>
        )}

        {/* 列表 */}
        {!loading && !error && annotations.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <i data-lucide="inbox" className="w-8 h-8 text-slate-400"></i>
            </div>
            <h3 className="text-lg font-medium text-slate-700 mb-1">
              {q ? '未找到匹配的批注' : '暂无批注'}
            </h3>
            <p className="text-sm text-slate-500">
              {q ? '尝试更换关键词或切换标注类型' : '可以先从邮件线程、内核代码或后续 spec 目标开始创建标注'}
            </p>
          </div>
        )}

        {/* 统一树形组件 */}
        {!loading && !error && annotations.length > 0 && (
          <AnnotationTree 
            annotations={annotations} 
            onAnnotationsChange={loadAnnotations}
          />
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm disabled:opacity-40 hover:bg-slate-50 transition-colors flex items-center gap-1"
            >
              <i data-lucide="chevron-left" className="w-4 h-4"></i>
              上一页
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (page <= 4) {
                pageNum = i + 1;
              } else if (page >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                    page === pageNum
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm disabled:opacity-40 hover:bg-slate-50 transition-colors flex items-center gap-1"
            >
              下一页
              <i data-lucide="chevron-right" className="w-4 h-4"></i>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
