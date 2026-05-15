import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getCodeAnnotations, getKernelFile } from '../api/client';
import type { CodeAnnotation, KernelFileResponse } from '../api/types';
import AnnotationPreviewContent from '../components/kernelCode/AnnotationPreviewContent';
import KernelCodePreviewPane from '../components/kernelCode/KernelCodePreviewPane';
import {
  annotationPreviewStartLine,
  formatAnnotationPreviewLineRange,
  resolveAnnotationPreviewState,
} from '../components/kernelCode/annotationPreview';
import { getAnnotationLineRange } from '../components/kernelCode/annotationSync';
import { PageShell, SectionPanel, SecondaryButton, StatusBadge } from '../components/ui';
import { annotationSearchPath, kernelAnnotationPreviewPath, kernelCodePath, pickKernelSourceUrl } from '../utils/externalLinks';

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KernelAnnotationPreviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const version = searchParams.get('v') || '';
  const path = searchParams.get('path') || '';
  const annotationId = searchParams.get('annotation') || '';

  const [file, setFile] = useState<KernelFileResponse | null>(null);
  const [annotations, setAnnotations] = useState<CodeAnnotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [annotationError, setAnnotationError] = useState<string | null>(null);

  useEffect(() => {
    if (!version || !path) {
      setFile(null);
      setAnnotations([]);
      setFileError(null);
      setAnnotationError(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setFileError(null);
    setAnnotationError(null);
    setFile(null);
    setAnnotations([]);

    Promise.allSettled([
      getKernelFile(version, path),
      getCodeAnnotations(version, path),
    ])
      .then(([fileResult, annotationResult]) => {
        if (cancelled) return;
        if (fileResult.status === 'fulfilled') {
          setFile(fileResult.value);
        } else {
          setFileError(fileResult.reason instanceof Error ? fileResult.reason.message : 'Failed to load file');
        }

        if (annotationResult.status === 'fulfilled') {
          setAnnotations(annotationResult.value);
        } else {
          setAnnotationError(
            annotationResult.reason instanceof Error
              ? annotationResult.reason.message
              : 'Failed to load annotations',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [annotationId, path, version]);

  const codeLines = useMemo(() => (file ? file.content.split('\n') : []), [file]);
  const previewState = useMemo(
    () => resolveAnnotationPreviewState(annotations, annotationId),
    [annotationId, annotations],
  );
  const target = previewState.target;
  const range = target ? getAnnotationLineRange(target) : null;
  const startLine = annotationPreviewStartLine(target);
  const atlasPath = kernelCodePath(version || 'latest', path, startLine || undefined);
  const sourceLink = pickKernelSourceUrl(version || 'latest', path, startLine || undefined);

  const openInAtlas = () => navigate(atlasPath);
  const openAnnotationReference = (targetAnnotationId: string) => {
    const linkedAnnotation = annotations.find((annotation) => annotation.annotation_id === targetAnnotationId);
    if (linkedAnnotation) {
      navigate(kernelAnnotationPreviewPath(
        linkedAnnotation.version || version,
        linkedAnnotation.file_path || path,
        linkedAnnotation.annotation_id,
      ));
      return;
    }
    navigate(annotationSearchPath(targetAnnotationId));
  };
  const rangeLabel = target ? formatAnnotationPreviewLineRange(target) : 'No annotation';

  return (
    <PageShell wide className="bg-slate-100 px-3 py-3 md:px-4">
      <SectionPanel className="overflow-hidden border-slate-200/90 bg-white p-0 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openInAtlas}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Atlas
                </button>
                <div className="text-sm font-semibold text-slate-950">Annotation Preview</div>
                <StatusBadge tone="muted">{version || 'No version'}</StatusBadge>
                <StatusBadge tone={target ? 'info' : 'warning'}>{rangeLabel}</StatusBadge>
                {annotationError ? <StatusBadge tone="warning">Annotations partial</StatusBadge> : null}
              </div>
              <div className="mt-2 truncate text-xs text-slate-500">{path || 'No path selected'}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SecondaryButton
                className="px-3 py-2"
                onClick={openInAtlas}
              >
                Open in Atlas
              </SecondaryButton>
              <a
                href={sourceLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                Open upstream
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="grid min-h-[calc(100vh-10.5rem)] gap-0 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-h-0 border-b border-slate-200 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                Code context
              </div>
              <div className="text-xs text-slate-500">
                {loading ? 'Loading...' : file ? `${file.line_count.toLocaleString()} lines` : 'No file'}
              </div>
            </div>
            <KernelCodePreviewPane
              lines={codeLines}
              loading={loading}
              error={
                !version || !path
                  ? 'Missing version or file path. Open an annotation preview from the code browser to get a shareable link.'
                  : fileError
              }
              highlightRange={range}
              initialLine={startLine}
              theme="dark"
              className="h-[calc(100%-2.375rem)]"
            />
          </div>

          <aside className="min-h-0 overflow-hidden bg-slate-50/80">
            {annotationError ? (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                Annotation metadata could not be fully loaded: {annotationError}
              </div>
            ) : null}
            <AnnotationPreviewContent
              annotation={target}
              replies={previewState.replies}
              emptyTitle={annotationId ? 'Annotation not found' : 'No annotation selected'}
              emptyDescription={
                annotationId
                  ? 'The file is available, but this annotation id is no longer present for the selected version and path.'
                  : 'Open an annotation preview from the code browser to select an annotation here.'
              }
              onOpenInAtlas={path ? openInAtlas : undefined}
              onOpenAnnotation={openAnnotationReference}
            />
            {file ? (
              <div className="border-t border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600">
                {file.version} · {file.path} · {formatBytes(file.size)}
              </div>
            ) : null}
          </aside>
        </div>
      </SectionPanel>
    </PageShell>
  );
}
