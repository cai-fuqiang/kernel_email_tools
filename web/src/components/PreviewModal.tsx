import { useEffect, useState, useCallback } from 'react';
import type { AnnotationListItem, CodeAnnotation } from '../api/types';
import { getKernelFile } from '../api/client';
import { showToast } from './Toast';
import KernelCodePreviewPane from './kernelCode/KernelCodePreviewPane';
import AnnotationPreviewContent from './kernelCode/AnnotationPreviewContent';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  annotation: CodeAnnotation | AnnotationListItem | null;
  onOpenAnnotation?: (annotationId: string) => void;
}

function hasCodePreviewData(
  annotation: CodeAnnotation | AnnotationListItem | null,
): annotation is CodeAnnotation | (AnnotationListItem & {
  version: string;
  file_path: string;
  start_line: number;
  end_line: number;
}) {
  return !!(
    annotation &&
    annotation.version &&
    annotation.file_path &&
    typeof annotation.start_line === 'number' &&
    typeof annotation.end_line === 'number'
  );
}

function toCodeAnnotation(ann: CodeAnnotation | AnnotationListItem): CodeAnnotation {
  return ann as CodeAnnotation;
}

export default function PreviewModal({ isOpen, onClose, annotation, onOpenAnnotation }: PreviewModalProps) {
  const [fileLines, setFileLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentAnnotation, setCurrentAnnotation] = useState<CodeAnnotation | AnnotationListItem | null>(null);

  const loadCode = useCallback(async (ann: CodeAnnotation | AnnotationListItem) => {
    if (!hasCodePreviewData(ann)) {
      setFileLines([]);
      return;
    }

    setLoading(true);
    try {
      const file = await getKernelFile(ann.version, ann.file_path);
      setFileLines(file.content.split('\n'));
    } catch {
      showToast('代码加载失败', 'error');
      setFileLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && annotation) {
      setCurrentAnnotation(annotation);
      loadCode(annotation);
    }
  }, [isOpen, annotation, loadCode]);

  useEffect(() => {
    if (!isOpen) {
      setFileLines([]);
      setCurrentAnnotation(null);
    }
  }, [isOpen]);

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
  if (!hasCodePreviewData(currentAnnotation)) return null;

  const ann = currentAnnotation;
  const highlightRange = { start: ann.start_line, end: ann.end_line };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col m-4 overflow-hidden">
        {/* 头部 */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
          <div className="truncate font-mono text-xs text-slate-500">{ann.file_path}</div>
          <button
            onClick={onClose}
            className="ml-3 shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"
          >
            ✕
          </button>
        </div>

        {/* 内容区：左代码 / 右批注 */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="w-1/2 border-r border-slate-200 overflow-hidden flex flex-col">
            <KernelCodePreviewPane
              lines={fileLines}
              loading={loading}
              highlightRange={highlightRange}
              initialLine={ann.start_line}
              theme="light"
              className="flex-1"
            />
          </div>
          <div className="w-1/2 overflow-hidden flex flex-col">
            <AnnotationPreviewContent
              annotation={toCodeAnnotation(ann)}
              onOpenAnnotation={onOpenAnnotation}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
