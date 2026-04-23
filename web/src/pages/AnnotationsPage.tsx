import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AnnotationCard from '../components/AnnotationCard';
import { listAnnotations, updateAnnotation, deleteAnnotation } from '../api/client';
import type { AnnotationListItem } from '../api/types';
import ThreadDrawer from '../components/ThreadDrawer';
import PreviewModal from '../components/PreviewModal';

type FilterType = 'all' | 'email' | 'code';

export default function AnnotationsPage() {
  const navigate = useNavigate();
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

  // ThreadDrawer 状态
  const [drawerThreadId, setDrawerThreadId] = useState<string | null>(null);
  // PreviewModal 状态
  const [previewAnnotation, setPreviewAnnotation] = useState<AnnotationListItem | null>(null);

  // 分页
  const totalPages = Math.ceil(total / pageSize);
  const paginatedAnnotations = annotations.slice((page - 1) * pageSize, page * pageSize);

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

  // 删除批注
  const handleDeleteAnnotation = async (annotationId: string) => {
    if (!confirm('确定要删除这个批注吗？')) return;
    try {
      await deleteAnnotation(annotationId);
      setAnnotations((prev) => prev.filter((a) => a.annotation_id !== annotationId));
      setTotal((prev) => prev - 1);
    } catch (e) {
      alert('删除失败: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
  };

  // 点击处理
  const handleCardClick = (ann: AnnotationListItem) => {
    // 邮件批注点击打开线程抽屉
    if (ann.annotation_type === 'email' && ann.thread_id) {
      console.log('Opening thread drawer for:', ann.thread_id); // 调试日志
      setDrawerThreadId(ann.thread_id);
    }
    // 代码标注点击跳转内核浏览器
    else if (ann.annotation_type === 'code') {
      navigate(`/kernel-code?v=${encodeURIComponent(ann.version || '')}&path=${encodeURIComponent(ann.file_path || '')}&line=${ann.start_line}`);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Annotations</h1>
        <p className="text-sm text-gray-500">
          Browse and search all your annotations across email threads and code
        </p>
      </div>

      {/* 筛选栏 */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search annotations..."
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none"
        />
        <button
          onClick={handleSearch}
          className="px-4 py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Search
        </button>
        {q && (
          <button
            onClick={handleClear}
            className="px-4 py-2.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition-colors"
          >
            Clear
          </button>
        )}
        {/* 筛选下拉 */}
        <select
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value as FilterType)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none"
        >
          <option value="all">全部</option>
          <option value="email">邮件批注</option>
          <option value="code">代码标注</option>
        </select>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 mb-4 text-sm text-gray-500">
        <span>
          {total} annotation{total !== 1 ? 's' : ''}
          {q && <span> matching "{q}"</span>}
        </span>
        {totalPages > 1 && (
          <span>
            Page {page} of {totalPages}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-indigo-400 border-t-transparent rounded-full" />
          <span className="ml-3 text-gray-500">Loading...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && paginatedAnnotations.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          {q ? 'No annotations match your search' : 'No annotations yet'}
        </div>
      )}

      {/* Annotation cards */}
      {!loading && paginatedAnnotations.length > 0 && (
        <div className="space-y-3">
          {paginatedAnnotations.map((ann) => (
            <div
              key={ann.annotation_id}
              onClick={() => handleCardClick(ann)}
              className="cursor-pointer hover:opacity-90 transition-opacity"
            >
              <AnnotationCard
                author={ann.author}
                body={ann.body}
                created_at={ann.created_at}
                updated_at={ann.updated_at}
                variant={ann.annotation_type}
                version={ann.version}
                file_path={ann.file_path}
                start_line={ann.start_line}
                end_line={ann.end_line}
                email_subject={ann.email_subject}
                email_sender={ann.email_sender}
                thread_id={ann.thread_id}
                onEdit={(body) => {
                  updateAnnotation(ann.annotation_id, body).then(() => {
                    setAnnotations((prev) =>
                      prev.map((a) =>
                        a.annotation_id === ann.annotation_id ? { ...a, body, updated_at: new Date().toISOString() } : a
                      )
                    );
                  });
                }}
                onDelete={() => handleDeleteAnnotation(ann.annotation_id)}
                onPreview={ann.annotation_type === 'code' ? (e: React.MouseEvent) => {
                  e.stopPropagation();
                  setPreviewAnnotation(ann);
                } : undefined}
              />
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-40 hover:bg-gray-100"
          >
            Previous
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
                className={`px-3 py-1.5 rounded text-sm ${
                  page === pageNum
                    ? 'bg-indigo-600 text-white'
                    : 'border border-gray-300 hover:bg-gray-100'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-40 hover:bg-gray-100"
          >
            Next
          </button>
        </div>
      )}

      {/* Thread Drawer */}
      {drawerThreadId && (
        <ThreadDrawer
          threadId={drawerThreadId}
          onClose={() => setDrawerThreadId(null)}
        />
      )}

      {/* Preview Modal */}
      {previewAnnotation && previewAnnotation.annotation_type === 'code' && previewAnnotation.version && previewAnnotation.file_path && (
        <PreviewModal
          isOpen={true}
          onClose={() => setPreviewAnnotation(null)}
          annotation={previewAnnotation as any}
        />
      )}
    </div>
  );
}