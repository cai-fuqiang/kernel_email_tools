import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Code2, ChevronDown, ChevronRight } from 'lucide-react';
import AnnotationCard from './AnnotationCard';
import type { AnnotationListItem } from '../api/types';
import { updateAnnotation, deleteAnnotation, createAnnotation } from '../api/client';
import ThreadDrawer from './ThreadDrawer';

interface AnnotationTreeProps {
  annotations: AnnotationListItem[];
  onAnnotationsChange?: () => void;
}

interface TreeNode {
  annotation: AnnotationListItem;
  children: TreeNode[];
  level: number;
}

/**
 * 构建批注树形结构
 * - 根批注：in_reply_to 为空，或指向邮件 message_id（不是 annotation_id 格式）
 * - 回复：in_reply_to 指向另一个 annotation_id
 */
function buildTree(annotations: AnnotationListItem[]): TreeNode[] {
  const annotationMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  
  // 判断是否为批注回复（in_reply_to 指向 annotation_id）
  const isAnnotationReply = (inReplyTo: string): boolean => {
    if (!inReplyTo || inReplyTo === '') return false;
    return inReplyTo.startsWith('annotation-') || inReplyTo.startsWith('code-annot-');
  };
  
  // 第一遍：创建所有节点
  for (const ann of annotations) {
    annotationMap.set(ann.annotation_id, {
      annotation: ann,
      children: [],
      level: 0,
    });
  }
  
  // 第二遍：建立父子关系
  for (const ann of annotations) {
    const node = annotationMap.get(ann.annotation_id)!;
    
    if (isAnnotationReply(ann.in_reply_to || '')) {
      // 有父节点（批注回复）
      const parent = annotationMap.get(ann.in_reply_to || '');
      if (parent) {
        node.level = parent.level + 1;
        parent.children.push(node);
      } else {
        // 父节点不在当前列表中，当作根节点
        roots.push(node);
      }
    } else {
      // 根节点
      roots.push(node);
    }
  }
  
  return roots;
}

/**
 * 统一批注树组件
 * 统一处理 email 和 code 批注的层级关系
 */
export default function AnnotationTree({ annotations, onAnnotationsChange }: AnnotationTreeProps) {
  const navigate = useNavigate();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [drawerThreadId, setDrawerThreadId] = useState<string | null>(null);
  
  // 回复状态
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  
  // 构建树形结构
  const tree = buildTree(annotations);
  
  // 默认展开所有有回复的批注
  useEffect(() => {
    const idsToExpand = new Set<string>();
    const collectExpandable = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          idsToExpand.add(node.annotation.annotation_id);
          collectExpandable(node.children);
        }
      }
    };
    collectExpandable(tree);
    setExpandedIds(idsToExpand);
  }, [annotations]);
  
  // 切换展开/折叠
  const toggleExpand = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
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
  
  // 删除批注
  const handleDelete = async (annotationId: string) => {
    if (!confirm('确定要删除这个批注吗？')) return;
    try {
      await deleteAnnotation(annotationId);
      onAnnotationsChange?.();
    } catch (e) {
      alert('删除失败: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
  };
  
  // 回复批注
  const handleReply = (annotationId: string) => {
    setReplyingTo(annotationId);
    setReplyBody('');
  };
  
  const handleCancelReply = () => {
    setReplyingTo(null);
    setReplyBody('');
  };
  
  const handleSubmitReply = async (annotationId: string) => {
    if (!replyBody.trim()) return;
    
    // 找到被回复的批注，获取其 thread_id 和 in_reply_to
    const parentAnnotation = annotations.find(a => a.annotation_id === annotationId);
    if (!parentAnnotation) return;
    
    setReplyLoading(true);
    try {
      await createAnnotation({
        thread_id: parentAnnotation.thread_id || '',
        body: replyBody.trim(),
        in_reply_to: annotationId, // 回复指向批注，而非邮件
      });
      setReplyingTo(null);
      setReplyBody('');
      onAnnotationsChange?.();
    } catch (e) {
      alert('回复失败: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setReplyLoading(false);
    }
  };
  
  // 编辑批注
  const handleEdit = async (annotationId: string, body: string) => {
    await updateAnnotation(annotationId, body);
    onAnnotationsChange?.();
  };
  
  // 点击处理
  const handleCardClick = (ann: AnnotationListItem) => {
    if (ann.annotation_type === 'email' && ann.thread_id) {
      setDrawerThreadId(ann.thread_id);
    } else if (ann.annotation_type === 'code') {
      navigate(`/kernel-code?v=${encodeURIComponent(ann.version || '')}&path=${encodeURIComponent(ann.file_path || '')}&line=${ann.start_line}`);
    }
  };
  
  // 递归渲染节点
  const renderNode = (node: TreeNode) => {
    const { annotation, children } = node;
    const isExpanded = expandedIds.has(annotation.annotation_id);
    const hasChildren = children.length > 0;
    const isReply = node.level > 0;
    
    // 主题/路径显示
    const getHeaderInfo = () => {
      if (annotation.annotation_type === 'email') {
        return {
          Icon: Mail,
          icon: 'mail',
          title: annotation.email_subject || annotation.thread_id?.slice(0, 30) || '无标题',
          subtitle: annotation.email_sender || '未知发件人',
          bgColor: isReply ? 'bg-green-50' : 'bg-blue-50',
          borderColor: isReply ? 'border-green-100' : 'border-blue-100',
          iconColor: isReply ? 'text-green-500' : 'text-blue-500',
        };
      } else {
        return {
          Icon: Code2,
          icon: 'code-2',
          title: annotation.file_path || '未知文件',
          subtitle: `${annotation.version || ''} 行 ${annotation.start_line}${annotation.end_line !== annotation.start_line ? `-${annotation.end_line}` : ''}`,
          bgColor: isReply ? 'bg-green-50' : 'bg-indigo-50',
          borderColor: isReply ? 'border-green-100' : 'border-indigo-100',
          iconColor: isReply ? 'text-green-500' : 'text-indigo-500',
        };
      }
    };
    
    const headerInfo = getHeaderInfo();
    
    return (
      <div key={annotation.annotation_id} className="space-y-2">
        {/* 卡片主体 */}
        <div className={`${headerInfo.bgColor} rounded-xl border ${headerInfo.borderColor} shadow-sm overflow-hidden`}>
          {/* 卡片头部 */}
          <div 
            className="px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => handleCardClick(annotation)}
          >
            <div className="flex items-center gap-3">
              {/* 展开/折叠按钮 */}
              <button
                onClick={(e) => toggleExpand(annotation.annotation_id, e)}
                className={`${headerInfo.iconColor} hover:opacity-70 transition-opacity flex items-center gap-1 px-2 py-1 rounded hover:bg-white/50`}
                title={isExpanded ? '点击收起' : '点击展开'}
              >
                {hasChildren ? (
                  <>
                  <>
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span className="text-xs font-medium">{children.length} 条回复</span>
                  </>
                  </>
                ) : (
                  <span className="w-4"></span>
                )}
              </button>
              {headerInfo.Icon && <headerInfo.Icon className={`w-4 h-4 ${headerInfo.iconColor}`} />}
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium text-slate-800 truncate ${annotation.annotation_type === 'code' ? 'font-mono' : ''}`}>
                  {headerInfo.title}
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <span>{headerInfo.subtitle}</span>
                  <span>•</span>
                  <span>{new Date(annotation.created_at).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* 卡片内容 */}
          <div className="p-4">
            <AnnotationCard
              author={annotation.author}
              body={annotation.body}
              created_at={annotation.created_at}
              updated_at={annotation.updated_at}
              variant={annotation.annotation_type}
              thread_id={annotation.thread_id}
              email_subject={annotation.email_subject}
              email_sender={annotation.email_sender}
              version={annotation.version}
              file_path={annotation.file_path}
              start_line={annotation.start_line}
              end_line={annotation.end_line}
              showGoto={annotation.annotation_type === 'code'}
              onGoto={() => {
                navigate(`/kernel-code?v=${encodeURIComponent(annotation.version || '')}&path=${encodeURIComponent(annotation.file_path || '')}&line=${annotation.start_line}`);
              }}
              onEdit={(body) => handleEdit(annotation.annotation_id, body)}
              onDelete={() => handleDelete(annotation.annotation_id)}
              onReply={() => handleReply(annotation.annotation_id)}
            />
            
            {/* 回复表单 */}
            {replyingTo === annotation.annotation_id && (
              <div className="mt-4 p-4 bg-white rounded-lg border border-slate-200 shadow-sm">
                <div className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                  <span className="text-green-500">↩</span>
                  回复此批注
                </div>
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  className="w-full min-h-[80px] p-3 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-green-400 outline-none resize-none"
                  placeholder="输入回复内容（支持 Markdown）..."
                  autoFocus
                />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleSubmitReply(annotation.annotation_id)}
                    disabled={!replyBody.trim() || replyLoading}
                    className="px-4 py-2 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {replyLoading ? '提交中...' : '提交回复'}
                  </button>
                  <button
                    onClick={handleCancelReply}
                    className="px-4 py-2 bg-gray-100 text-slate-600 text-sm rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* 子节点（回复列表） */}
        {hasChildren && isExpanded && (
          <div className={`ml-${Math.min(node.level * 4 + 6, 10)} pl-4 border-l-2 border-green-200 space-y-3`}>
            {children.map(child => renderNode(child))}
          </div>
        )}
      </div>
    );
  };
  
  if (tree.length === 0) {
    return null;
  }
  
  return (
    <div className="space-y-4">
      {tree.map(node => renderNode(node))}
      
      {/* Thread Drawer */}
      {drawerThreadId && (
        <ThreadDrawer
          threadId={drawerThreadId}
          onClose={() => setDrawerThreadId(null)}
        />
      )}
    </div>
  );
}