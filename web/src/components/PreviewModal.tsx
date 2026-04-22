import { useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CodeAnnotation } from '../api/types';
import { getKernelFile } from '../api/client';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  annotation: CodeAnnotation | null;
}

export default function PreviewModal({ isOpen, onClose, annotation }: PreviewModalProps) {
  const [codeLines, setCodeLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentAnnotation, setCurrentAnnotation] = useState<CodeAnnotation | null>(null);

  const loadCode = useCallback(async (ann: CodeAnnotation) => {
    setLoading(true);
    try {
      const file = await getKernelFile(ann.version, ann.file_path);
      setCodeLines(file.content.split('\n'));
    } catch (e) {
      console.error('Failed to load code:', e);
      setCodeLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 当 annotation prop 变化时加载代码
  useEffect(() => {
    if (isOpen && annotation) {
      setCurrentAnnotation(annotation);
      loadCode(annotation);
    }
  }, [isOpen, annotation, loadCode]);

  // 清理状态
  useEffect(() => {
    if (!isOpen) {
      setCodeLines([]);
      setCurrentAnnotation(null);
    }
  }, [isOpen]);

  // 管理 body overflow
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

  if (!isOpen || !currentAnnotation) return null;

  const ann = currentAnnotation;
  const startLine = Math.max(0, ann.start_line - 6);
  const endLine = ann.end_line + 10;
  const displayLines = codeLines.slice(startLine, endLine);

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
            <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded">
              {ann.version}
            </span>
            <span className="text-xs font-mono text-gray-500">
              {ann.file_path}
            </span>
            <span className="text-xs text-gray-400">
              L{ann.start_line}{ann.end_line !== ann.start_line && `-${ann.end_line}`}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-lg"
          >
            ✕
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden flex">
          {/* 左侧：代码 */}
          <div className="w-1/2 border-r border-gray-200 overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
              <span className="text-xs text-gray-500">
                Code (lines {startLine + 1}-{endLine})
              </span>
            </div>
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="p-4 text-sm text-gray-400">Loading code...</div>
              ) : displayLines.length > 0 ? (
                <pre className="text-xs font-mono leading-5">
                  <table className="w-full border-collapse">
                    <tbody>
                      {displayLines.map((line, idx) => {
                        const lineNum = startLine + idx + 1;
                        const isAnnotated = lineNum >= ann.start_line && lineNum <= ann.end_line;
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
              <div className="prose prose-sm prose-slate max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {ann.body}
                </ReactMarkdown>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 shrink-0">
              <div className="flex items-center justify-between text-[10px] text-gray-400">
                <span>by {ann.author}</span>
                <span>{new Date(ann.created_at).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}