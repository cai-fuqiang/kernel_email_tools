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
  // 展开/折叠状态
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 计算每个标注的回复数量
  const replyCounts = annotations.reduce((acc, a) => {
    if (a.annotation_type === 'email' && a.in_reply_to && a.in_reply_to !== '') {
      acc[a.in_reply_to] = (acc[a.in_reply_to] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

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

  // 获取顶级标注（email 类型，没有 in_reply_to 或 in_reply_to 为空）
  // 注意：只有 email 类型支持嵌套回复，code 类型不支持
  const getRootAnnotations = () => {
    return annotations.filter(a => 
      a.annotation_type === 'email' && (!a.in_reply_to || a.in_reply_to === '')
    );
  };

  // 获取回复标注
  const getReplies = (parentId: string) => {
    return annotations.filter(a => a.in_reply_to === parentId);
  };

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
    if (ann.annotation_type === 'email' && ann.thread_id && ann.thread_id !== '') {
      console.log('Opening thread drawer for:', ann.thread_id);
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
          className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          Search
        </button>
        {q && (
          <button
            onClick={handleClear}
            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* 筛选标签 */}
      <div className="flex gap-2 mb-4">
        {(['all', 'email', 'code'] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => handleFilterChange(f)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              filter === f
                ? f === 'all' ? 'bg-gray-800 text-white' : f === 'email' ? 'bg-blue-600 text-white' : 'bg-green-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'All' : f === 'email' ? 'Email Annotations' : 'Code Annotations'}
          </button>
        ))}
      </div>

      {/* Loading/Error state */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full"></div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Results count */}
      {!loading && !error && (
        <div className="text-sm text-gray-500 mb-4">
          {q ? `Found ${total} result${total !== 1 ? 's' : ''} for "${q}"` : `${total} annotations`}
        </div>
      )}

      {/* 列表 */}
      {!loading && !error && paginatedAnnotations.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          {q ? 'No annotations found matching your search.' : 'No annotations yet.'}
        </div>
      )}

      {!loading && !error && paginatedAnnotations.length > 0 && (
        <div className="space-y-4">
          {/* Email 类型标注支持展开/折叠 */}
          {filter !== 'code' && (() => {
            const emailRoots = getRootAnnotations();
            return emailRoots.map(root => {
              const isExpanded = expandedIds.has(root.annotation_id);
              const replies = getReplies(root.annotation_id);
              const replyCount = replyCounts[root.annotation_id] || 0;
              
              return (
                <div key={root.annotation_id} className="space-y-2">
                  <div
                    className="cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => handleCardClick(root)}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(root.annotation_id);
                        }}
                        className="text-xs text-gray-400 hover:text-gray-600 w-5"
                      >
                        {isExpanded ? '▼' : '▶'}
                      </button>
                      <span className="text-xs text-gray-500">
                        {root.email_subject || root.thread_id?.slice(0, 20) || 'Untitled'}
                      </span>
                      {replyCount > 0 && (
                        <span className="text-[10px] text-gray-400">
                          ({replyCount} {replyCount === 1 ? 'reply' : 'replies'})
                        </span>
                      )}
                    </div>
                    <AnnotationCard
                      author={root.author}
                      body={root.body}
                      created_at={root.created_at}
                      updated_at={root.updated_at}
                      variant={root.annotation_type}
                      thread_id={root.thread_id}
                      email_subject={root.email_subject}
                      email_sender={root.email_sender}
                      onEdit={(body) => {
                        updateAnnotation(root.annotation_id, body).then(() => {
                          setAnnotations(prev =>
                            prev.map(a =>
                              a.annotation_id === root.annotation_id ? { ...a, body, updated_at: new Date().toISOString() } : a
                            )
                          );
                        });
                      }}
                      onDelete={() => handleDeleteAnnotation(root.annotation_id)}
                    />
                  </div>
                  
                  {isExpanded && replies.map(reply => (
                    <div key={reply.annotation_id} className="ml-6 border-l-4 border-l-green-500 pl-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] text-green-500 bg-green-50 px-1.5 py-0.5 rounded">
                          Reply
                        </span>
                        <span className="text-xs text-gray-400">
                          {reply.email_sender || 'Anonymous'}
                        </span>
                      </div>
                      <div
                        className="cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => handleCardClick(reply)}
                      >
                        <AnnotationCard
                          author={reply.author}
                          body={reply.body}
                          created_at={reply.created_at}
                          updated_at={reply.updated_at}
                          variant={reply.annotation_type}
                          thread_id={reply.thread_id}
                          email_subject={reply.email_subject}
                          email_sender={reply.email_sender}
                          onEdit={(body) => {
                            updateAnnotation(reply.annotation_id, body).then(() => {
                              setAnnotations(prev =>
                                prev.map(a =>
                                  a.annotation_id === reply.annotation_id ? { ...a, body, updated_at: new Date().toISOString() } : a
                                )
                              );
                            });
                          }}
                          onDelete={() => handleDeleteAnnotation(reply.annotation_id)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              );
            });
          })()}
          
          {/* Code 类型标注（支持展开/折叠） */}
          {filter !== 'email' && (() => {
            // 只显示 code 类型根标注
            const codeAnnotations = annotations.filter(a => 
              a.annotation_type === 'code' && (!a.in_reply_to || a.in_reply_to === '')
            );
            return codeAnnotations.map(ann => {
              const isExpanded = expandedIds.has(ann.annotation_id);
              const replies = getReplies(ann.annotation_id);
              const replyCount = replyCounts[ann.annotation_id] || 0;
              
              return (
                <div key={ann.annotation_id} className="space-y-2">
                  {/* 顶级标注 - 点击卡片展开/折叠，点击 Goto 跳转 */}
                  <div className="flex items-start gap-2 mb-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(ann.annotation_id);
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600 w-5 mt-0.5"
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>
                    <div className="flex-1 cursor-pointer hover:opacity-90 transition-opacity">
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
                        showGoto={true}
                        onGoto={() => {
                          // Goto 按钮跳转到 KernelCodePage
                          navigate(`/kernel-code?v=${encodeURIComponent(ann.version || '')}&path=${encodeURIComponent(ann.file_path || '')}&line=${ann.start_line}`);
                        }}
                        onEdit={(body) => {
                          updateAnnotation(ann.annotation_id, body).then(() => {
                            setAnnotations(prev =>
                              prev.map(a =>
                                a.annotation_id === ann.annotation_id ? { ...a, body, updated_at: new Date().toISOString() } : a
                              )
                            );
                          });
                        }}
                        onDelete={() => handleDeleteAnnotation(ann.annotation_id)}
                        onPreview={(e) => {
                          e.stopPropagation();
                          setPreviewAnnotation(ann);
                        }}
                      />
                    </div>
                  </div>
                  {replyCount > 0 && (
                    <span className="text-[10px] text-gray-400 ml-7">
                      {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                    </span>
                  )}
                  
                  {/* 展开的回复 */}
                  {isExpanded && replies.map(reply => (
                    <div key={reply.annotation_id} className="ml-7 border-l-4 border-l-green-500 pl-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] text-green-500 bg-green-50 px-1.5 py-0.5 rounded">
                          Reply
                        </span>
                        <span className="text-xs text-gray-400">
                          {reply.author}
                        </span>
                      </div>
                      <AnnotationCard
                        author={reply.author}
                        body={reply.body}
                        created_at={reply.created_at}
                        updated_at={reply.updated_at}
                        variant={reply.annotation_type}
                        version={reply.version}
                        file_path={reply.file_path}
                        start_line={reply.start_line}
                        end_line={reply.end_line}
                        showGoto={true}
                        onGoto={() => {
                          navigate(`/kernel-code?v=${encodeURIComponent(reply.version || '')}&path=${encodeURIComponent(reply.file_path || '')}&line=${reply.start_line}`);
                        }}
                        onEdit={(body) => {
                          updateAnnotation(reply.annotation_id, body).then(() => {
                            setAnnotations(prev =>
                              prev.map(a =>
                                a.annotation_id === reply.annotation_id ? { ...a, body, updated_at: new Date().toISOString() } : a
                              )
                            );
                          });
                        }}
                        onDelete={() => handleDeleteAnnotation(reply.annotation_id)}
                        onPreview={(e) => {
                          e.stopPropagation();
                          setPreviewAnnotation(reply);
                        }}
                      />
                    </div>
                  ))}
                </div>
              );
            });
          })()}
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
