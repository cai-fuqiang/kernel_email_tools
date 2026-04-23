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

  // 计算每个标注的回复数量（包括所有类型）
  const replyCounts = annotations.reduce((acc, a) => {
    if (a.in_reply_to && a.in_reply_to !== '') {
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

  // 判断是否为批注回复（in_reply_to 指向另一个 annotation_id）
  const isAnnotationReply = (inReplyTo: string): boolean => {
    if (!inReplyTo || inReplyTo === '') return false;
    // annotation_id 格式: annotation-xxx 或 code-annot-xxx
    return inReplyTo.startsWith('annotation-') || inReplyTo.startsWith('code-annot-');
  };

  // 获取顶级标注
  // 对于 email 类型：所有都是顶级（in_reply_to 指向邮件 message_id，不是批注回复）
  // 对于 code 类型：in_reply_to 为空或不是 annotation_id 格式的才是顶级
  const getRootAnnotations = (type?: 'email' | 'code') => {
    return annotations.filter(a => {
      if (a.in_reply_to && a.in_reply_to !== '' && isAnnotationReply(a.in_reply_to)) {
        return false; // 是批注回复，不是根
      }
      if (type) return a.annotation_type === type;
      return true;
    });
  };

  // 获取回复标注（只返回批注回复，排除指向邮件的）
  const getReplies = (parentId: string) => {
    return annotations.filter(a => 
      a.in_reply_to === parentId && isAnnotationReply(a.in_reply_to)
    );
  };

  // 分页
  const totalPages = Math.ceil(total / pageSize);

  // 统计
  const emailCount = annotations.filter(a => a.annotation_type === 'email').length;
  const codeCount = annotations.filter(a => a.annotation_type === 'code').length;

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
    if (ann.annotation_type === 'email' && ann.thread_id && ann.thread_id !== '') {
      setDrawerThreadId(ann.thread_id);
    } else if (ann.annotation_type === 'code') {
      navigate(`/kernel-code?v=${encodeURIComponent(ann.version || '')}&path=${encodeURIComponent(ann.file_path || '')}&line=${ann.start_line}`);
    }
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
              <h1 className="text-2xl font-bold text-slate-800">批注管理</h1>
              <p className="text-sm text-slate-500">统一管理邮件批注和代码标注</p>
            </div>
          </div>
          
          {/* 统计卡片 */}
          <div className="flex gap-4 mt-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg border border-blue-100">
              <i data-lucide="mail" className="w-4 h-4 text-blue-500"></i>
              <span className="text-sm text-blue-700 font-medium">{emailCount} 邮件批注</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 rounded-lg border border-indigo-100">
              <i data-lucide="code-2" className="w-4 h-4 text-indigo-500"></i>
              <span className="text-sm text-indigo-700 font-medium">{codeCount} 代码标注</span>
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
                placeholder="搜索批注内容..."
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
          {(['all', 'email', 'code'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                filter === f
                  ? f === 'all' ? 'bg-slate-800 text-white shadow-md' : f === 'email' ? 'bg-blue-600 text-white shadow-md' : 'bg-indigo-600 text-white shadow-md'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {f === 'all' && <><i data-lucide="layers" className="w-4 h-4"></i>全部</>}
              {f === 'email' && <><i data-lucide="mail" className="w-4 h-4"></i>邮件批注</>}
              {f === 'code' && <><i data-lucide="code-2" className="w-4 h-4"></i>代码标注</>}
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
              {q ? '尝试使用其他关键词搜索' : '在邮件或代码中添加批注开始使用'}
            </p>
          </div>
        )}

        {!loading && !error && annotations.length > 0 && (
          <div className="space-y-6">
            {/* Email 类型标注 */}
            {filter !== 'code' && (() => {
              const emailRoots = getRootAnnotations('email');
              return emailRoots.map(root => {
                const isExpanded = expandedIds.has(root.annotation_id);
                const replies = getReplies(root.annotation_id);
                const replyCount = replyCounts[root.annotation_id] || 0;
                
                return (
                  <div key={root.annotation_id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* 卡片头部 */}
                    <div 
                      className="px-4 py-3 bg-blue-50 border-b border-blue-100 cursor-pointer hover:bg-blue-100/50 transition-colors"
                      onClick={() => handleCardClick(root)}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(root.annotation_id);
                          }}
                          className="text-blue-400 hover:text-blue-600 transition-colors"
                        >
                          <i data-lucide={isExpanded ? "chevron-down" : "chevron-right"} className="w-4 h-4"></i>
                        </button>
                        <i data-lucide="mail" className="w-4 h-4 text-blue-500"></i>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">
                            {root.email_subject || root.thread_id?.slice(0, 30) || '无标题'}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2">
                            <span>{root.email_sender || '未知发件人'}</span>
                            <span>•</span>
                            <span>{new Date(root.created_at).toLocaleDateString('zh-CN')}</span>
                          </div>
                        </div>
                        {replyCount > 0 && (
                          <span className="px-2 py-1 text-xs bg-blue-100 text-blue-600 rounded-full">
                            {replyCount} 条回复
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* 卡片内容 */}
                    <div className="p-4">
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
                      
                      {/* 回复列表 */}
                      {isExpanded && replies.length > 0 && (
                        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                          <div className="text-xs text-slate-500 font-medium flex items-center gap-1">
                            <i data-lucide="corner-down-right" className="w-3 h-3"></i>
                            回复列表
                          </div>
                          {replies.map(reply => (
                            <div key={reply.annotation_id} className="pl-4 border-l-2 border-green-200">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="px-2 py-0.5 text-xs bg-green-100 text-green-600 rounded">
                                  回复
                                </span>
                                <span className="text-xs text-slate-500">
                                  {reply.email_sender || reply.author}
                                </span>
                              </div>
                              <div
                                className="cursor-pointer"
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
                      )}
                    </div>
                  </div>
                );
              });
            })()}
            
            {/* Code 类型标注 */}
            {filter !== 'email' && (() => {
              const codeAnnotations = annotations.filter(a => 
                a.annotation_type === 'code' && (!a.in_reply_to || a.in_reply_to === '')
              );
              return codeAnnotations.map(ann => {
                const isExpanded = expandedIds.has(ann.annotation_id);
                const replies = getReplies(ann.annotation_id);
                const replyCount = replyCounts[ann.annotation_id] || 0;
                
                return (
                  <div key={ann.annotation_id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* 卡片头部 */}
                    <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(ann.annotation_id);
                          }}
                          className="text-indigo-400 hover:text-indigo-600 transition-colors"
                        >
                          <i data-lucide={isExpanded ? "chevron-down" : "chevron-right"} className="w-4 h-4"></i>
                        </button>
                        <i data-lucide="code-2" className="w-4 h-4 text-indigo-500"></i>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono text-slate-700 truncate">
                            {ann.file_path}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2">
                            <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded text-xs">
                              {ann.version}
                            </span>
                            <span>行 {ann.start_line}{ann.end_line !== ann.start_line && `-${ann.end_line}`}</span>
                            <span>•</span>
                            <span>{new Date(ann.created_at).toLocaleDateString('zh-CN')}</span>
                          </div>
                        </div>
                        {replyCount > 0 && (
                          <span className="px-2 py-1 text-xs bg-indigo-100 text-indigo-600 rounded-full">
                            {replyCount} 条回复
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* 卡片内容 */}
                    <div className="p-4">
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
                      
                      {/* 回复列表 */}
                      {isExpanded && replies.length > 0 && (
                        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                          <div className="text-xs text-slate-500 font-medium flex items-center gap-1">
                            <i data-lucide="corner-down-right" className="w-3 h-3"></i>
                            回复列表
                          </div>
                          {replies.map(reply => (
                            <div key={reply.annotation_id} className="pl-4 border-l-2 border-green-200">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="px-2 py-0.5 text-xs bg-green-100 text-green-600 rounded">
                                  回复
                                </span>
                                <span className="text-xs text-slate-500">
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
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
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