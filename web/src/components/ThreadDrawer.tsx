import { useEffect, useState, useCallback } from 'react';
import { getThread } from '../api/client';
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

// 判断段落是否需要翻译
function shouldTranslate(text: string): boolean {
  if (/[\u4e00-\u9fff]/.test(text)) return false;
  const lines = text.split('\n');
  const codeLines = lines.filter(l => 
    l.trim().startsWith('>') || 
    l.trim().startsWith('diff ') ||
    l.trim().startsWith('@@') ||
    l.trim().startsWith('---') ||
    l.trim().startsWith('+++') ||
    l.trim().startsWith('Signed-off-by:') ||
    l.trim().startsWith('Reviewed-by:')
  );
  return codeLines.length < lines.length * 0.5;
}

// 邮件卡片组件
function EmailCard({ 
  node, 
  expandedIds,
  toggleExpand,
  showTranslation,
}: { 
  node: ThreadNode;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
  showTranslation: boolean;
}) {
  const { email, children, depth } = node;
  const isExpanded = expandedIds.has(email.id);
  const paragraphs = parseParagraphs(email.body);
  
  return (
    <div className="email-node" style={{ marginLeft: depth > 0 ? '16px' : 0 }}>
      <details className="email-thread" open={isExpanded}>
        <summary 
          onClick={(e) => { e.preventDefault(); toggleExpand(email.id); }}
          className="cursor-pointer"
        >
          <div className="flex items-center gap-3 py-3 px-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border-l-4 border-blue-400">
            {/* 头像 */}
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
              
              if (showTranslation && needTrans) {
                // 双语对照模式
                return (
                  <div key={idx} className="bilingual-block">
                    <div className="bilingual-original">
                      <div className="lang-label">EN</div>
                      <pre className="text-sm whitespace-pre-wrap break-words text-gray-700 leading-relaxed">{para}</pre>
                    </div>
                    <div className="bilingual-translation">
                      <div className="lang-label">中文</div>
                      <pre className="text-sm whitespace-pre-wrap break-words text-gray-800 leading-relaxed">{para}</pre>
                    </div>
                  </div>
                );
              } else {
                // 普通模式
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
              showTranslation={showTranslation}
            />
          ))}
        </div>
      )}
    </div>
  );
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
  const [showTranslation, setShowTranslation] = useState(false);
  const [threadTree, setThreadTree] = useState<ThreadNode[]>([]);
  
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
      setExpandedIds(new Set(thread.emails.map(e => e.id)));
    }
  };
  
  const collapseAll = () => {
    if (thread && thread.emails.length > 0) {
      setExpandedIds(new Set([thread.emails[0].id]));
    }
  };
  
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
            {/* 中英对照开关 */}
            <button
              onClick={() => setShowTranslation(!showTranslation)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                showTranslation 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              中英对照 {showTranslation ? '✓' : ''}
            </button>
            
            {/* 展开/收起 */}
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
              </div>
              
              {/* 线程树 */}
              <div className="space-y-3">
                {threadTree.map((rootNode, idx) => (
                  <EmailCard 
                    key={`${rootNode.email.id}-${idx}`}
                    node={rootNode}
                    expandedIds={expandedIds}
                    toggleExpand={toggleExpand}
                    showTranslation={showTranslation}
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
          flex: 1;
          padding: 12px 16px;
          background: #fafafa;
          border-right: 1px solid #e5e7eb;
        }
        .bilingual-translation {
          flex: 1;
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