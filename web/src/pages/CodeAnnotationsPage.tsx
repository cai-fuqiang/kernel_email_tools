import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, MessageSquareReply } from 'lucide-react';
import PreviewModal from '../components/PreviewModal';
import { listCodeAnnotations, getKernelVersions } from '../api/client';
import type { CodeAnnotation, KernelVersionInfo } from '../api/types';

// 树节点类型
interface AnnotationNode {
  annotation: CodeAnnotation;
  children: AnnotationNode[];
}

// 构建批注树形结构
function buildAnnotationTree(annotations: CodeAnnotation[]): AnnotationNode[] {
  const nodeMap = new Map<string, AnnotationNode>();
  const roots: AnnotationNode[] = [];

  // 第一遍：创建所有节点
  for (const ann of annotations) {
    nodeMap.set(ann.annotation_id, { annotation: ann, children: [] });
  }

  // 第二遍：建立父子关系
  for (const ann of annotations) {
    const node = nodeMap.get(ann.annotation_id)!;
    if (ann.in_reply_to && nodeMap.has(ann.in_reply_to)) {
      // 有父节点（回复）
      const parent = nodeMap.get(ann.in_reply_to)!;
      parent.children.push(node);
    } else {
      // 根节点
      roots.push(node);
    }
  }

  return roots;
}

export default function CodeAnnotationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [annotations, setAnnotations] = useState<CodeAnnotation[]>([]);
  const [versions, setVersions] = useState<KernelVersionInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [previewAnnotation, setPreviewAnnotation] = useState<CodeAnnotation | null>(null);
  // 展开/折叠状态
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

      // 默认展开有回复的批注
      const idsToExpand = new Set<string>();
      for (const ann of res.annotations) {
        if (ann.in_reply_to) {
          idsToExpand.add(ann.in_reply_to);
        }
      }
      setExpandedIds(idsToExpand);
    } catch {
      setAnnotations([]);
    } finally {
      setLoading(false);
    }
  }, [q, versionFilter, page]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  // 构建树形结构
  const tree = buildAnnotationTree(annotations);

  // 切换展开/折叠
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 跳转
  const handleJump = (a: CodeAnnotation) => {
    navigate(`/kernel-code?v=${encodeURIComponent(a.version)}&path=${encodeURIComponent(a.file_path)}&line=${a.start_line}`);
  };

  // 预览
  const handlePreview = (a: CodeAnnotation) => {
    setPreviewAnnotation(a);
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

  // 渲染单个批注节点
  const renderNode = (node: AnnotationNode, isReply = false) => {
    const { annotation: ann, children } = node;
    const isExpanded = expandedIds.has(ann.annotation_id);
    const hasReplies = children.length > 0;

    return (
      <div key={ann.annotation_id} className="space-y-2">
        <div
          className={`bg-white border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col ${
            isReply ? 'border-l-4 border-l-green-500' : 'border-gray-200'
          }`}
          onClick={() => handleJump(ann)}
        >
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 shrink-0">
            <div className="flex items-center gap-2 mb-1">
              {/* 展开/折叠按钮 */}
              {hasReplies && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(ann.annotation_id);
                  }}
                  className="text-gray-400 hover:text-gray-600 flex items-center gap-1"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <span className="text-[10px] font-medium">{children.length} replies</span>
                </button>
              )}
              {!hasReplies && <span className="w-16" />}
              <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded">
                {ann.version}
              </span>
              <span className="text-xs font-mono text-gray-500">
                {ann.file_path}
              </span>
              <span className="text-xs text-gray-400">
                L{ann.start_line}{ann.end_line !== ann.start_line ? `-${ann.end_line}` : ''}
              </span>
              {ann.in_reply_to && (
                <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                  <MessageSquareReply className="w-3 h-3" />
                  Reply
                </span>
              )}
            </div>
          </div>
          <div className="px-4 py-2 flex-1 overflow-hidden">
            <div className="markdown-content line-clamp-4 overflow-hidden">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{ann.body}</ReactMarkdown>
            </div>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-[10px] text-gray-400">
                <span>by {ann.author}</span>
                <span>·</span>
                <span>{new Date(ann.created_at).toLocaleDateString()}</span>
                {ann.updated_at !== ann.created_at && (
                  <>
                    <span>·</span>
                    <span>edited {new Date(ann.updated_at).toLocaleDateString()}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="shrink-0 px-2 py-1 text-xs font-medium text-indigo-600 border border-indigo-300 rounded hover:bg-indigo-50"
                  onClick={(e) => { e.stopPropagation(); handlePreview(ann); }}
                >
                  Preview
                </button>
                <button
                  className="shrink-0 px-2 py-1 text-xs font-medium text-white bg-indigo-500 rounded hover:bg-indigo-600"
                  onClick={(e) => { e.stopPropagation(); handleJump(ann); }}
                >
                  Jump
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 渲染回复 */}
        {hasReplies && isExpanded && (
          <div className="ml-6 pl-4 border-l-2 border-green-200 space-y-3">
            {children.map((child) => renderNode(child, true))}
          </div>
        )}
      </div>
    );
  };

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
            {tree.map((node) => renderNode(node))}
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

      {/* 预览弹窗 */}
      <PreviewModal
        isOpen={!!previewAnnotation}
        onClose={() => setPreviewAnnotation(null)}
        annotation={previewAnnotation}
      />
    </div>
  );
}