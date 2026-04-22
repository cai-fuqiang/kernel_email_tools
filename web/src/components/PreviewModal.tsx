import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CodeAnnotation } from '../api/types';
import { getKernelFile } from '../api/client';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  annotation: CodeAnnotation | null;
}

export default function PreviewModal({ isOpen, onClose }: PreviewModalProps) {
  const [codeLines, setCodeLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [annotation, setAnnotation] = useState<CodeAnnotation | null>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    setAnnotation(null);
    setCodeLines([]);
  }, [isOpen]);

  const loadCode = async (ann: CodeAnnotation) => {
    setLoading(true);
    try {
      const file = await getKernelFile(ann.version, ann.file_path);
      setCodeLines(file.content.split('\n'));
      setAnnotation(ann);
    } catch (e) {
      console.error('Failed to load code:', e);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // 如果需要加载新的标注
  const pendingAnnotation = (window as unknown as { _pendingPreviewAnnotation?: CodeAnnotation })._pendingPreviewAnnotation;
  if (pendingAnnotation && annotation?.annotation_id !== pendingAnnotation.annotation_id) {
    loadCode(pendingAnnotation);
    (window as unknown as { _pendingPreviewAnnotation?: CodeAnnotation })._pendingPreviewAnnotation = undefined;
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col m-4">
        {/* 头部 */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-700">Annotation Preview</h3>
            {annotation && (
              <>
                <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded">
                  {annotation.version}
                </span>
                <span className="text-xs font-mono text-gray-500">
                  {annotation.file_path}
                </span>
                <span className="text-xs text-gray-400">
                  L{annotation.start_line}{annotation.end_line !== annotation.start_line && `-${annotation.end_line}`}
                </span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
          >
            ✕
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden flex">
          {/* 左侧：代码 */}
          <div className="w-1/2 border-r border-gray-200 overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
              <span className="text-xs text-gray-500">Code (lines {annotation ? `${annotation.start_line - 5 > 1 ? annotation.start_line - 5 : 1}-${annotation.end_line + 10}` : ''})</span>
            </div>
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="p-4 text-sm text-gray-400">Loading code...</div>
              ) : codeLines.length > 0 && annotation ? (
                <pre className="text-xs font-mono leading-5">
                  <table className="w-full border-collapse">
                    <tbody>
                      {codeLines.slice(
                        Math.max(0, annotation.start_line - 6),
                        annotation.end_line + 11
                      ).map((line, idx) => {
                        const lineNum = Math.max(0, annotation.start_line - 6) + idx + 1;
                        const isAnnotated = lineNum >= annotation.start_line && lineNum <= annotation.end_line;
                        return (
                          <tr
                            key={lineNum}
                            className={isAnnotated ? 'bg-yellow-50' : ''}
                          >
                            <td className="w-12 text-right pr-3 text-gray-400 select-none border-r border-gray-200 sticky left-0 bg-inherit">
                              {lineNum}
                            </td>
                            <td className="pl-4 whitespace-pre">{line || ' '}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </pre>
              ) : (
                <div className="p-4 text-sm text-gray-400">No code available</div>
              )}
            </div>
          </div>

          {/* 右侧：标注 */}
          <div className="w-1/2 overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
              <span className="text-xs text-gray-500">Annotation (Markdown)</span>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {loading ? (
                <div className="text-sm text-gray-400">Loading...</div>
              ) : annotation ? (
                <div className="prose prose-sm prose-slate max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {annotation.body}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="text-sm text-gray-400">No annotation selected</div>
              )}
            </div>
            {annotation && (
              <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 shrink-0">
                <div className="flex items-center justify-between text-[10px] text-gray-400">
                  <span>by {annotation.author}</span>
                  <span>{new Date(annotation.created_at).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 触发预览的辅助函数
export function openPreview(annotation: CodeAnnotation) {
  (window as unknown as { _pendingPreviewAnnotation?: CodeAnnotation })._pendingPreviewAnnotation = annotation;
  // 派发自定义事件通知 PreviewModal
  window.dispatchEvent(new CustomEvent('openPreviewModal'));
}