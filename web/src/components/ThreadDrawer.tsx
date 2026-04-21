import { useEffect, useState, useCallback, useMemo } from 'react';
import { getThread, translateBatch, clearTranslationCache } from '../api/client';
import type { ThreadResponse, ThreadEmail } from '../api/types';
import EmailTagEditor from './EmailTagEditor';

// 线程节点类型
interface ThreadNode {
  email: ThreadEmail;
  children: ThreadNode[];
  depth: number;
}

// 构建线程树
function buildThreadTree(emails: ThreadEmail[]): ThreadNode[] {
  const nodes: Map<string, ThreadNode> = new Map();
  const roots: ThreadNode[] = [];
  
  emails.forEach(email => {
    nodes.set(email.message_id, { email, children: [], depth: 0 });
  });
  
  emails.forEach(email => {
    const node = nodes.get(email.message_id)!;
    if (email.in_reply_to) {
      const parent = nodes.get(email.in_reply_to);
      if (parent) {
        parent.children.push(node);
        node.depth = parent.depth + 1;
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  });
  
  const sortByDate = (nodes: ThreadNode[]) => {
    nodes.sort((a, b) => {
      const dateA = a.email.date ? new Date(a.email.date).getTime() : 0;
      const dateB = b.email.date ? new Date(b.email.date).getTime() : 0;
      return dateA - dateB;
    });
    nodes.forEach(node => sortByDate(node.children));
  };
  sortByDate(roots);
  
  const recalcDepth = (nodes: ThreadNode[], depth: number) => {
    nodes.forEach(node => {
      node.depth = depth;
      recalcDepth(node.children, depth + 1);
    });
  };
  recalcDepth(roots, 0);
  
  return roots;
}

// 提取作者名
function getAuthorName(sender: string): string {
  const match = sender.match(/^([^<]+)/);
  return match ? match[1].trim() : sender;
}

// 解析邮件正文为段落（用于双语对照）
function parseParagraphs(body: string): string[] {
  if (!body) return [];
  return body.split(/\n\n+/).filter(p => p.trim());
}

// 判断段落是否需要翻译（排除代码和补丁内容）
function shouldTranslate(text: string): boolean {
  if (!text || /[\u4e00-\u9fff]/.test(text)) return false;
  const lines = text.split('\n');
  if (lines.length === 0) return false;
  const codeLines = lines.filter(l => 
    l.trim().startsWith('>') || 
    l.trim().startsWith('diff ') ||
    l.trim().startsWith('@@') ||
    l.trim().startsWith('---') ||
    l.trim().startsWith('+++') ||
    l.trim().startsWith('Signed-off-by:') ||
    l.trim().startsWith('Reviewed-by:') ||
    l.trim().startsWith('Acked-by:') ||
    l.trim().startsWith('Tested-by:') ||
    /^[+-]/.test(l.trim())
  );
  return codeLines.length < lines.length * 0.5 && lines.filter(l => l.trim()).length > 0;
}

// 翻译状态映射类型
type TranslationMap = Map<string, { translation: string; loading: boolean; error?: string }>;

// 折叠级别类型（用于 tree 模式）
type FoldLevel = 'expanded' | 'body_only' | 'collapsed';

// 视图模式类型
type ViewMode = 'tree' | 'layered';

// 邮件卡片组件
function EmailCard({ 
  node, 
  expandedIds,
  toggleExpand,
  translations,
  onTranslationUpdate,
  onClearParagraphCache,
  foldLevel,
  viewMode,
  layeredExpandedIds,
  toggleLayeredExpand,
}: { 
  node: ThreadNode;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
  translations: TranslationMap;
  onTranslationUpdate: (para: string, translation: string) => void;
  onClearParagraphCache: (paragraph: string) => void;
  foldLevel: FoldLevel;
  viewMode: ViewMode;
  layeredExpandedIds: Set<number>;
  toggleLayeredExpand: (id: number) => void;
}) {
  const { email, children, depth } = node;
  const isExpanded = expandedIds.has(email.id);
  const isLayeredExpanded = layeredExpandedIds.has(email.id);
  const paragraphs = parseParagraphs(email.body);

  // 编辑状态
  const [editingPara, setEditingPara] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // 开始编辑
  const handleStartEdit = (para: string, currentTrans: string) => {
    setEditingPara(para);
    setEditText(currentTrans || para);
  };

  // 保存编辑
  const handleSaveEdit = () => {
    if (!editingPara) return;
    // 通过回调更新父组件的 translations
    onTranslationUpdate(editingPara, editText);
    setEditingPara(null);
    setEditText('');
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingPara(null);
    setEditText('');
  };

  // 格式化时间显示
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}月前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  // 折叠模式下显示的一行摘要
  const renderCollapsedSummary = () => (
    <div className="flex items-center gap-2 py-2 px-4 text-sm">
      <div 
        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
        style={{ backgroundColor: `hsl(${getAuthorName(email.sender).charCodeAt(0) * 15 % 360}, 65%, 50%)` }}
      >
        {getAuthorName(email.sender).charAt(0).toUpperCase()}
      </div>
      <span className="font-medium text-gray-900 truncate max-w-[150px]">
        {getAuthorName(email.sender)}
      </span>
      <span className="text-gray-400 text-xs">
        {formatDate(email.date)}
      </span>
      <span className="text-gray-600 truncate flex-1">
        {email.subject}
      </span>
      {email.has_patch && (
        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded font-medium">
          PATCH
        </span>
      )}
      {children.length > 0 && (
        <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded-full">
          {children.length} 回复
        </span>
      )}
      <span className="text-gray-400 ml-auto">▶</span>
    </div>
  );

  // 展开模式下显示的完整标题
  const renderFullHeader = () => (
    <div className="flex items-center gap-3 py-3 px-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border-l-4 border-blue-400">
      <div 
        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm"
        style={{ backgroundColor: `hsl(${getAuthorName(email.sender).charCodeAt(0) * 15 % 360}, 65%, 50%)` }}
      >
        {getAuthorName(email.sender).charAt(0).toUpperCase()}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">
            {getAuthorName(email.sender)}
          </span>
          {depth > 0 && (
            <span className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded">
              → {depth} 层回复
            </span>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {email.date ? new Date(email.date).toLocaleDateString('zh-CN', { 
              year: 'numeric', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit'
            }) : ''}
          </span>
        </div>
        <div className="text-sm text-gray-600 truncate mt-1">
          {email.subject}
        </div>
      </div>
      
      {email.has_patch && (
        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded font-medium">
          PATCH
        </span>
      )}
      
      {children.length > 0 && (
        <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded-full">
          {children.length} 回复
        </span>
      )}
      
      <span className="text-gray-400 text-lg">
        {isExpanded ? '▼' : '▶'}
      </span>
    </div>
  );
  
  // 分层模式下：只显示被展开的节点
  if (viewMode === 'layered') {
    // 顶层节点始终显示
    // 子节点始终显示（让用户可以点击展开），但折叠状态由 isLayeredExpanded 决定
    // 注意：如果节点不在 layeredExpandedIds 中，会以折叠状态显示
  }

  // 分层模式下的展开状态切换
  const handleToggleExpand = () => {
    if (viewMode === 'layered') {
      toggleLayeredExpand(email.id);
    } else {
      toggleExpand(email.id);
    }
  };

  // 根据视图模式和展开状态决定显示方式
  // 分层模式：只显示 depth 0 和 depth 1 的邮件
  const isCollapsed = viewMode === 'tree' 
    ? foldLevel === 'collapsed' 
    : (depth > 0 && !isLayeredExpanded);
  
  const shouldShowContent = viewMode === 'tree' 
    ? isExpanded 
    : isLayeredExpanded;

  // 分层模式下：只显示 depth <= 1 的邮件（root 和 child）
  if (viewMode === 'layered' && depth > 1) {
    return null;
  }

  // 折叠视图
  if (isCollapsed) {
    return (
      <div className="email-node" style={{ marginLeft: depth > 0 ? '16px' : 0 }}>
        <div 
          onClick={handleToggleExpand}
          className="cursor-pointer hover:bg-gray-50 rounded-lg border border-gray-200 transition-colors"
        >
          {renderCollapsedSummary()}
        </div>
        
        {/* 折叠/分层模式下显示摘要，点击展开 */}
        <div 
          onClick={handleToggleExpand}
          className="cursor-pointer hover:bg-gray-50 rounded-lg border border-gray-200 transition-colors"
        >
          {renderCollapsedSummary()}
        </div>
        
        {/* 展开后显示内容 */}
        {shouldShowContent && (
          <div className="email-body px-4 pb-4 mt-2">
            <div className="mb-3">
              <EmailTagEditor messageId={email.message_id} />
            </div>
            <div className="email-content rounded-lg overflow-hidden">
              {paragraphs.map((para, idx) => (
                <div key={idx} className="email-paragraph">
                  <pre className="text-sm whitespace-pre-wrap break-words text-gray-700 leading-relaxed">{para}</pre>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* 子回复 */}
        {children.length > 0 && (
          <div className="replies mt-3">
            {children.map(child => (
              <EmailCard 
                key={child.email.id} 
                node={child} 
                expandedIds={expandedIds}
                toggleExpand={toggleExpand}
                translations={translations}
                onTranslationUpdate={onTranslationUpdate}
                onClearParagraphCache={onClearParagraphCache}
                foldLevel={foldLevel}
                viewMode={viewMode}
                layeredExpandedIds={layeredExpandedIds}
                toggleLayeredExpand={toggleLayeredExpand}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // 展开模式：显示完整邮件
  return (
    <div className="email-node" style={{ marginLeft: depth > 0 ? '16px' : 0 }}>
      <details className="email-thread" open={isExpanded}>
        <summary 
          onClick={(e) => { e.preventDefault(); handleToggleExpand(); }}
          className="cursor-pointer"
        >
          {renderFullHeader()}
        </summary>
        
        {/* 邮件内容 */}
        <div className="email-body px-4 pb-4 mt-2">
          <div className="mb-3">
            <EmailTagEditor messageId={email.message_id} />
          </div>
          
          {/* 邮件正文 */}
          <div className="email-content rounded-lg overflow-hidden">
            {paragraphs.map((para, idx) => {
              const needTrans = shouldTranslate(para);
              const transState = translations.get(para);
              const isLoading = transState?.loading;
              const translation = transState?.translation;
              const transError = transState?.error;
              
              if (needTrans) {
                // 双语对照模式
                return (
                  <div key={idx} className="bilingual-block">
                    <div className="bilingual-original">
                      <div className="lang-label">EN</div>
                      <pre className="text-sm whitespace-pre-wrap break-words text-gray-700 leading-relaxed">{para}</pre>
                    </div>
                    <div className="bilingual-translation">
                      <div className="lang-label flex items-center justify-between">
                        <span>中文</span>
                        {translation && editingPara !== para && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleStartEdit(para, translation)}
                              className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200"
                              title="编辑翻译"
                            >
                              ✏️ 编辑
                            </button>
                            <button
                              onClick={() => onClearParagraphCache(para)}
                              className="text-xs px-2 py-1 bg-orange-100 text-orange-600 rounded hover:bg-orange-200"
                              title="清除此段缓存"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>
                      {editingPara === para ? (
                        <div className="mt-2">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full min-h-[80px] p-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                            placeholder="输入人工翻译..."
                          />
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={handleSaveEdit}
                              className="px-3 py-1.5 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600"
                            >
                              保存
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : isLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full"></div>
                          <span className="ml-2 text-sm text-gray-500">翻译中...</span>
                        </div>
                      ) : translation ? (
                        <pre className="text-sm whitespace-pre-wrap break-words text-gray-800 leading-relaxed">{translation}</pre>
                      ) : transError ? (
                        <div className="text-sm text-red-500 py-2">翻译失败: {transError}</div>
                      ) : (
                        <pre className="text-sm whitespace-pre-wrap break-words text-gray-800 leading-relaxed opacity-50">{para}</pre>
                      )}
                    </div>
                  </div>
                );
              } else {
                // 普通模式（代码或补丁内容，不翻译）
                return (
                  <div key={idx} className="email-paragraph">
                    <pre className="text-sm whitespace-pre-wrap break-words text-gray-700 leading-relaxed">{para}</pre>
                  </div>
                );
              }
            })}
          </div>
        </div>
      </details>
      
      {/* 子回复 */}
      {children.length > 0 && (
        <div className="replies mt-3">
          {children.map(child => (
            <EmailCard 
              key={child.email.id} 
              node={child} 
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              translations={translations}
              onTranslationUpdate={onTranslationUpdate}
              onClearParagraphCache={onClearParagraphCache}
              foldLevel={foldLevel}
              viewMode={viewMode}
              layeredExpandedIds={layeredExpandedIds}
              toggleLayeredExpand={toggleLayeredExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 从线程中提取所有需要翻译的段落
function extractTranslatableParagraphs(thread: ThreadResponse | null): string[] {
  if (!thread) return [];
  const paragraphs = new Set<string>();
  
  const collectParagraphs = (emails: ThreadEmail[]) => {
    for (const email of emails) {
      const paras = parseParagraphs(email.body || '');
      for (const para of paras) {
        if (shouldTranslate(para)) {
          paragraphs.add(para);
        }
      }
    }
  };
  
  collectParagraphs(thread.emails);
  return Array.from(paragraphs);
}

// 主组件
interface Props {
  threadId: string;
  onClose: () => void;
}

export default function ThreadDrawer({ threadId, onClose }: Props) {
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [threadTree, setThreadTree] = useState<ThreadNode[]>([]);
  const [translations, setTranslations] = useState<TranslationMap>(new Map());
  const [translating, setTranslating] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [foldLevel, setFoldLevel] = useState<FoldLevel>('expanded');
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  // 分层展开模式：记录哪些邮件被展开了（用于分层展开）
  const [layeredExpandedIds, setLayeredExpandedIds] = useState<Set<number>>(new Set());

  // 清除缓存消息
  const clearCacheMessage = useCallback(() => {
    setCacheMessage(null);
  }, []);

  // 清除单个段落缓存
  const handleClearParagraphCache = useCallback(async (paragraph: string) => {
    try {
      // 计算段落 hash
      const encoder = new TextEncoder();
      const data = encoder.encode(paragraph);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const result = await clearTranslationCache('paragraph', hashHex);
      if (result.success) {
        setCacheMessage({ type: 'success', text: '段落缓存已清除' });
        // 清除本地翻译状态
        setTranslations(prev => {
          const next = new Map(prev);
          next.delete(paragraph);
          return next;
        });
      } else {
        setCacheMessage({ type: 'error', text: result.message });
      }
      setTimeout(clearCacheMessage, 2000);
    } catch (err) {
      setCacheMessage({ type: 'error', text: '清除缓存失败' });
      setTimeout(clearCacheMessage, 2000);
    }
  }, [clearCacheMessage]);

  // 清除全部缓存
  const handleClearAllCache = useCallback(async () => {
    try {
      const result = await clearTranslationCache('all');
      if (result.success) {
        setCacheMessage({ type: 'success', text: `已清除全部缓存 (${result.cleared_count} 条)` });
        // 清除所有本地翻译状态
        setTranslations(new Map());
      } else {
        setCacheMessage({ type: 'error', text: result.message });
      }
      setTimeout(clearCacheMessage, 2000);
    } catch (err) {
      setCacheMessage({ type: 'error', text: '清除缓存失败' });
      setTimeout(clearCacheMessage, 2000);
    }
  }, [clearCacheMessage]);

  // 更新单个翻译（来自 EmailCard 编辑）
  const handleTranslationUpdate = useCallback((para: string, translation: string) => {
    setTranslations(prev => {
      const next = new Map(prev);
      next.set(para, { translation, loading: false });
      return next;
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    getThread(threadId)
      .then(t => {
        setThread(t);
        const tree = buildThreadTree(t.emails);
        setThreadTree(tree);
        if (t.emails.length > 0) {
          setExpandedIds(new Set([t.emails[0].id]));
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [threadId]);
  
  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandAll = () => {
    if (thread) {
      setFoldLevel('expanded');
      setExpandedIds(new Set(thread.emails.map(e => e.id)));
    }
  };
  
  const collapseAll = () => {
    if (thread && thread.emails.length > 0) {
      setFoldLevel('collapsed');
      setExpandedIds(new Set());
    }
  };

  // 分层展开模式：切换单个邮件的展开状态
  const toggleLayeredExpand = useCallback((id: number) => {
    setLayeredExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    // 同时更新 expandedIds，这样视觉效果一致
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // 切换到分层展开模式
  const enterLayeredMode = useCallback(() => {
    setViewMode('layered');
    // 只展开第一层（depth=0 的邮件）
    if (threadTree.length > 0) {
      const firstLayerIds = new Set<number>();
      const allFirstLayerIds = new Set<number>();
      threadTree.forEach(node => {
        firstLayerIds.add(node.email.id);
        // 收集所有顶级邮件的ID（用于展开）
        allFirstLayerIds.add(node.email.id);
      });
      setLayeredExpandedIds(firstLayerIds);
      // 同时更新 expandedIds，这样树形模式下也会显示
      setExpandedIds(allFirstLayerIds);
    }
  }, [threadTree]);

  // 切换到树形模式
  const enterTreeMode = useCallback(() => {
    setViewMode('tree');
    // 展开所有
    if (thread) {
      setExpandedIds(new Set(thread.emails.map(e => e.id)));
    }
  }, [thread]);
  
  // 翻译所有可见段落
  const handleTranslate = useCallback(async () => {
    if (!thread || translating) return;
    
    const paragraphs = extractTranslatableParagraphs(thread);
    if (paragraphs.length === 0) return;
    
    // 检查哪些段落还没有翻译
    const needTrans = paragraphs.filter(p => !translations.has(p) || !translations.get(p)?.translation);
    if (needTrans.length === 0) return;
    
    setTranslating(true);
    
    // 标记所有段落为加载中
    setTranslations(prev => {
      const next = new Map(prev);
      for (const p of needTrans) {
        next.set(p, { translation: '', loading: true });
      }
      return next;
    });
    
    try {
      // 批量翻译（每次最多50条）
      const batchSize = 50;
      const allTranslations: string[] = [];
      
      for (let i = 0; i < needTrans.length; i += batchSize) {
        const batch = needTrans.slice(i, i + batchSize);
        const result = await translateBatch(batch, 'auto', 'zh-CN');
        allTranslations.push(...result.translations);
      }
      
      // 更新翻译结果
      setTranslations(prev => {
        const next = new Map(prev);
        needTrans.forEach((para, idx) => {
          const translation = allTranslations[idx] || para;
          next.set(para, { translation, loading: false });
        });
        return next;
      });
    } catch (err) {
      console.error('Translation failed:', err);
      // 标记翻译失败
      setTranslations(prev => {
        const next = new Map(prev);
        for (const p of needTrans) {
          next.set(p, { translation: '', loading: false, error: '翻译服务暂时不可用' });
        }
        return next;
      });
    } finally {
      setTranslating(false);
    }
  }, [thread, translations, translating]);
  
  // 统计翻译进度
  const translationStats = useMemo(() => {
    const total = extractTranslatableParagraphs(thread).length;
    const translated = Array.from(translations.values()).filter(t => !!t.translation).length;
    return { total, translated };
  }, [thread, translations]);
  
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      
      {/* 抽屉主体 - 90% 宽度 */}
      <div className="relative ml-auto bg-gray-50 flex flex-col"
           style={{ width: '90vw', height: '100vh' }}>
        
        {/* 顶部工具栏 */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <h3 className="text-lg font-bold text-gray-900">
              📧 Thread ({thread?.total ?? '...'})
            </h3>
            {thread?.emails[0] && (
              <span className="text-sm text-gray-500 truncate max-w-md">
                {thread.emails[0].subject}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {/* 翻译按钮 */}
            <button
              onClick={handleTranslate}
              disabled={translating || translationStats.total === 0}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                translating 
                  ? 'bg-blue-300 text-white cursor-not-allowed' 
                  : translationStats.translated > 0
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {translating ? (
                <>
                  <span className="inline-block animate-spin mr-2">⟳</span>
                  翻译中 ({translationStats.translated}/{translationStats.total})
                </>
              ) : translationStats.translated > 0 ? (
                <>✓ 已翻译 ({translationStats.translated}/{translationStats.total})</>
              ) : (
                <>🌐 中英对照</>
              )}
            </button>

            {/* 缓存清除按钮 */}
            <div className="relative">
              <button
                onClick={handleClearAllCache}
                className="px-3 py-2 text-sm text-orange-600 hover:bg-orange-50 rounded-lg transition-colors border border-orange-200"
                title="清除全部翻译缓存"
              >
                🗑️ 清除缓存
              </button>
              {cacheMessage && (
                <div className={`absolute top-full mt-1 right-0 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap z-10 ${
                  cacheMessage.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {cacheMessage.text}
                </div>
              )}
            </div>

            {/* 视图模式切换 */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => { enterTreeMode(); }}
                className={`px-2 py-1.5 text-xs rounded transition-colors ${
                  viewMode === 'tree' 
                    ? 'bg-blue-500 text-white' 
                    : 'text-gray-600 hover:bg-gray-200'
                }`}
                title="树形模式 - 展开全部邮件"
              >
                🌲 树形
              </button>
              <button
                onClick={enterLayeredMode}
                className={`px-2 py-1.5 text-xs rounded transition-colors ${
                  viewMode === 'layered' 
                    ? 'bg-blue-500 text-white' 
                    : 'text-gray-600 hover:bg-gray-200'
                }`}
                title="分层展开 - 折叠只显示顶层，点击展开一层"
              >
                � 分层
              </button>
            </div>

            {viewMode === 'tree' && (
              <>
                {/* 展开/收起 (仅树形模式) */}
                <button
                  onClick={expandAll}
                  className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  全部展开
                </button>
                <button
                  onClick={collapseAll}
                  className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  全部收起
                </button>
              </>
            )}

            <button 
              onClick={onClose} 
              className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-xl"
            >
              ✕
            </button>
          </div>
        </div>
        
        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-gray-400 text-lg">加载中...</div>
            </div>
          )}
          
          {error && (
            <div className="flex items-center justify-center py-20">
              <div className="text-red-600 text-lg">{error}</div>
            </div>
          )}
          
          {thread && (
            <div className="thread">
              {/* 统计 */}
              <div className="bg-white rounded-lg px-4 py-3 mb-6 flex items-center gap-6 text-sm text-gray-600 border border-gray-200">
                <span><strong className="text-gray-900">{thread.emails.length}</strong> 封邮件</span>
                <span><strong className="text-gray-900">{threadTree.length}</strong> 个主题</span>
                {translationStats.total > 0 && (
                  <span><strong className="text-gray-900">{translationStats.total}</strong> 段落可翻译</span>
                )}
              </div>
              
              {/* 线程树 */}
              <div className="space-y-3">
                {threadTree.map((rootNode, idx) => (
                  <EmailCard 
                    key={`${rootNode.email.id}-${idx}`}
                    node={rootNode}
                    expandedIds={expandedIds}
                    toggleExpand={toggleExpand}
                    translations={translations}
                    onTranslationUpdate={handleTranslationUpdate}
                    onClearParagraphCache={handleClearParagraphCache}
                    foldLevel={foldLevel}
                    viewMode={viewMode}
                    layeredExpandedIds={layeredExpandedIds}
                    toggleLayeredExpand={toggleLayeredExpand}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      
      <style>{`
        .email-thread > summary {
          cursor: pointer;
          list-style: none;
        }
        .email-thread > summary::-webkit-details-marker {
          display: none;
        }
        .email-content {
          background: white;
          border: 1px solid #e5e7eb;
        }
        .email-paragraph {
          padding: 12px 16px;
          border-bottom: 1px solid #f3f4f6;
        }
        .email-paragraph:last-child {
          border-bottom: none;
        }
        .bilingual-block {
          display: flex;
          border-bottom: 1px solid #e5e7eb;
        }
        .bilingual-block:last-child {
          border-bottom: none;
        }
        .bilingual-original {
          flex: 0 0 40%;
          padding: 12px 16px;
          background: #fafafa;
          border-right: 1px solid #e5e7eb;
        }
        .bilingual-translation {
          flex: 0 0 60%;
          padding: 12px 16px;
          background: #f0f9ff;
        }
        .lang-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          color: #6b7280;
          margin-bottom: 8px;
          padding-bottom: 4px;
          border-bottom: 1px solid #e5e7eb;
        }
        .bilingual-translation .lang-label {
          color: #3b82f6;
          border-bottom-color: #bfdbfe;
        }
        @media (max-width: 768px) {
          .bilingual-block {
            flex-direction: column;
          }
          .bilingual-original {
            border-right: none;
            border-bottom: 2px dashed #e5e7eb;
          }
        }
      `}</style>
    </div>
  );
}