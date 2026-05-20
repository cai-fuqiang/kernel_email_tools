import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { getManualDocumentView } from '../api/client';
import type { ManualDocumentTocNode, ManualDocumentView } from '../api/types';
import { PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';

type ManualPdfReaderMode = 'continuous' | 'single';
type ManualPdfZoomPreset = 'fit' | '1.00' | '1.25' | '1.50';
type ManualPdfLoadState = 'idle' | 'loading' | 'ready' | 'error';

const ZOOM_PRESETS: Array<{ label: string; value: ManualPdfZoomPreset }> = [
  { label: 'Fit width', value: 'fit' },
  { label: '100%', value: '1.00' },
  { label: '125%', value: '1.25' },
  { label: '150%', value: '1.50' },
];

function zoomPresetToScale(zoomPreset: ManualPdfZoomPreset): string {
  return zoomPreset === 'fit' ? '1' : zoomPreset;
}

function buildPdfWorkspaceErrorMessage(error: unknown, documentId?: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (documentId) {
    return `Unable to load PDF workspace for ${documentId}.`;
  }
  return 'Unable to load PDF workspace.';
}

function renderToc(nodes: ManualDocumentTocNode[]) {
  if (!nodes.length) {
    return <p className="text-sm text-slate-500">No outline available yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm text-slate-700">
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="font-medium text-slate-900">{node.label}</p>
            <p className="text-xs text-slate-500">Page {node.page}</p>
            {node.children.length > 0 && <div className="mt-2 pl-3">{renderToc(node.children)}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function WorkspaceRailShell({
  collapsed,
  title,
  railLabel,
  actionLabel,
  onToggle,
  children,
}: {
  collapsed: boolean;
  title: string;
  railLabel: string;
  actionLabel: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      className={`shrink-0 rounded-2xl border border-slate-200 bg-white shadow-sm transition-all ${
        collapsed ? 'w-full xl:w-16' : 'w-full xl:w-80'
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        {!collapsed ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{railLabel}</p>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          </div>
        ) : (
          <div aria-hidden="true" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {title}
          </div>
        )}
        <PrimaryButton type="button" onClick={onToggle} className="shrink-0">
          {actionLabel}
        </PrimaryButton>
      </div>
      {!collapsed && <div className="space-y-4 p-4">{children}</div>}
    </aside>
  );
}

function ReaderModeControls({
  readerMode,
  onChange,
}: {
  readerMode: ManualPdfReaderMode;
  onChange: (mode: ManualPdfReaderMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PrimaryButton
        type="button"
        aria-pressed={readerMode === 'continuous'}
        onClick={() => onChange('continuous')}
        className={readerMode === 'continuous' ? 'bg-sky-500 hover:bg-sky-400' : 'bg-slate-700 hover:bg-slate-600'}
      >
        Continuous scroll
      </PrimaryButton>
      <PrimaryButton
        type="button"
        aria-pressed={readerMode === 'single'}
        onClick={() => onChange('single')}
        className={readerMode === 'single' ? 'bg-sky-500 hover:bg-sky-400' : 'bg-slate-700 hover:bg-slate-600'}
      >
        Single-page focus
      </PrimaryButton>
    </div>
  );
}

function ZoomControls({
  zoomPreset,
  onChange,
}: {
  zoomPreset: ManualPdfZoomPreset;
  onChange: (preset: ManualPdfZoomPreset) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ZOOM_PRESETS.map((preset) => (
        <PrimaryButton
          key={preset.value}
          type="button"
          aria-pressed={zoomPreset === preset.value}
          onClick={() => onChange(preset.value)}
          className={zoomPreset === preset.value ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-slate-700 hover:bg-slate-600'}
        >
          {preset.label}
        </PrimaryButton>
      ))}
    </div>
  );
}

function PdfReaderPane({
  documentId,
  document,
  loading,
  errorMessage,
  readerMode,
  zoomPreset,
  focusLayout,
  onReaderModeChange,
  onZoomChange,
}: {
  documentId?: string;
  document: ManualDocumentView | null;
  loading: boolean;
  errorMessage: string | null;
  readerMode: ManualPdfReaderMode;
  zoomPreset: ManualPdfZoomPreset;
  focusLayout: boolean;
  onReaderModeChange: (mode: ManualPdfReaderMode) => void;
  onZoomChange: (preset: ManualPdfZoomPreset) => void;
}) {
  const zoomScale = zoomPresetToScale(zoomPreset);

  return (
    <section
      data-testid="pdf-reader-pane"
      data-focus-layout={String(focusLayout)}
      data-zoom={zoomScale}
      className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-950 text-white shadow-lg"
    >
      <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <ReaderModeControls readerMode={readerMode} onChange={onReaderModeChange} />
          <ZoomControls zoomPreset={zoomPreset} onChange={onZoomChange} />
        </div>

        <div className="flex items-center gap-3 text-sm text-slate-300">
          <span className="rounded-full border border-white/10 px-3 py-1">
            Reader mode: {readerMode === 'continuous' ? 'continuous' : 'single-page focus'}
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1">Zoom: {zoomScale}</span>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <SectionPanel title={document?.title || 'PDF canvas'}>
          {loading ? (
            <p className="text-sm text-slate-300">Loading PDF workspace...</p>
          ) : errorMessage ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-rose-200">Unable to load PDF workspace.</p>
              <p className="text-sm text-rose-100">{errorMessage}</p>
              {documentId && (
                <p className="text-xs text-rose-100/80">Document id: {documentId}</p>
              )}
            </div>
          ) : document ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Center pane ready for PDF reading. The workspace shell is wired to the loaded document and preserves
                reader mode when zoom presets change.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Title</p>
                  <p className="mt-1 text-sm font-medium text-white">{document.title}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Subtitle</p>
                  <p className="mt-1 text-sm font-medium text-white">{document.subtitle}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Document id</p>
                  <p className="mt-1 text-sm font-medium text-white">{document.document_id}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-300">
              {documentId ? 'Waiting for document metadata.' : 'A document id is required for this workspace.'}
            </p>
          )}
        </SectionPanel>
      </div>
    </section>
  );
}

function ManualPdfWorkspace({
  documentId,
  document,
  loading,
  errorMessage,
  isLeftCollapsed,
  isRightCollapsed,
  readerMode,
  zoomPreset,
  onToggleLeft,
  onToggleRight,
  onReaderModeChange,
  onZoomChange,
}: {
  documentId?: string;
  document: ManualDocumentView | null;
  loading: boolean;
  errorMessage: string | null;
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  readerMode: ManualPdfReaderMode;
  zoomPreset: ManualPdfZoomPreset;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onReaderModeChange: (mode: ManualPdfReaderMode) => void;
  onZoomChange: (preset: ManualPdfZoomPreset) => void;
}) {
  const focusLayout = isLeftCollapsed && isRightCollapsed;

  return (
    <div
      data-testid="pdf-workspace-root"
      data-left-collapsed={String(isLeftCollapsed)}
      data-right-collapsed={String(isRightCollapsed)}
      className="mt-6 flex min-h-[calc(100vh-13rem)] flex-col gap-4 xl:flex-row"
    >
      <WorkspaceRailShell
        collapsed={isLeftCollapsed}
        title="Outline"
        railLabel="Document rail"
        actionLabel={isLeftCollapsed ? 'Expand left panel' : 'Collapse left panel'}
        onToggle={onToggleLeft}
      >
        <SectionPanel title={document?.title || 'Document details'}>
          {loading ? (
            <p className="text-sm text-slate-500">Loading document...</p>
          ) : errorMessage ? (
            <p className="text-sm text-rose-600">
              Unable to load document details. {errorMessage}
            </p>
          ) : document ? (
            <dl className="space-y-2 text-sm text-slate-600">
              <div>
                <dt className="font-medium text-slate-900">Manual type</dt>
                <dd>{document.manual_type}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Version</dt>
                <dd>{document.manual_version}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Pages</dt>
                <dd>{document.page_count}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Initial page</dt>
                <dd>{document.initial_page}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              {documentId ? 'Document metadata is unavailable.' : 'A document id is required for this workspace.'}
            </p>
          )}
        </SectionPanel>

        <SectionPanel title="Outline">
          {document ? renderToc(document.toc) : <p className="text-sm text-slate-500">Loading outline...</p>}
        </SectionPanel>
      </WorkspaceRailShell>

      <PdfReaderPane
        documentId={documentId}
        document={document}
        loading={loading}
        errorMessage={errorMessage}
        readerMode={readerMode}
        zoomPreset={zoomPreset}
        focusLayout={focusLayout}
        onReaderModeChange={onReaderModeChange}
        onZoomChange={onZoomChange}
      />

      <WorkspaceRailShell
        collapsed={isRightCollapsed}
        title="References"
        railLabel="Workspace rail"
        actionLabel={isRightCollapsed ? 'Expand right panel' : 'Collapse right panel'}
        onToggle={onToggleRight}
      >
        <SectionPanel title="Workspace notes">
          <p className="text-sm text-slate-500">
            This shell reserves the right rail for annotations, evidence, and document references.
          </p>
        </SectionPanel>
        <SectionPanel title="Document stats">
          {document ? (
            <dl className="space-y-2 text-sm text-slate-600">
              <div>
                <dt className="font-medium text-slate-900">Pages</dt>
                <dd>{document.page_count}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Initial page</dt>
                <dd>{document.initial_page}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">PDF URL</dt>
                <dd className="break-all">{document.pdf_url}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">{loading ? 'Loading document stats...' : 'Document stats unavailable.'}</p>
          )}
        </SectionPanel>
      </WorkspaceRailShell>
    </div>
  );
}

function useManualPdfDocument(documentId?: string) {
  const [document, setDocument] = useState<ManualDocumentView | null>(null);
  const [loadState, setLoadState] = useState<ManualPdfLoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!documentId) {
      setDocument(null);
      setErrorMessage(null);
      setLoadState('idle');
      return () => {
        active = false;
      };
    }

    setLoadState('loading');
    setErrorMessage(null);
    setDocument(null);

    void getManualDocumentView(documentId)
      .then((loadedDocument) => {
        if (!active) return;
        setDocument(loadedDocument);
        setLoadState('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDocument(null);
        setLoadState('error');
        setErrorMessage(buildPdfWorkspaceErrorMessage(error, documentId));
      });

    return () => {
      active = false;
    };
  }, [documentId]);

  return { document, loadState, errorMessage };
}

export default function ManualPdfPage() {
  const { documentId } = useParams();
  const { document, loadState, errorMessage } = useManualPdfDocument(documentId);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [readerMode, setReaderMode] = useState<ManualPdfReaderMode>('continuous');
  const [zoomPreset, setZoomPreset] = useState<ManualPdfZoomPreset>('fit');

  return (
    <PageShell>
      <PageHeader
        eyebrow="PDF Workspace"
        title="Open PDF document"
        description={
          loadState === 'error'
            ? errorMessage || 'Read the source PDF in a dedicated workspace with navigation, zoom, and annotations.'
            : document?.subtitle || 'Read the source PDF in a dedicated workspace with navigation, zoom, and annotations.'
        }
      />

      <ManualPdfWorkspace
        documentId={documentId}
        document={document}
        loading={loadState === 'loading'}
        errorMessage={loadState === 'error' ? errorMessage : null}
        isLeftCollapsed={isLeftCollapsed}
        isRightCollapsed={isRightCollapsed}
        readerMode={readerMode}
        zoomPreset={zoomPreset}
        onToggleLeft={() => setIsLeftCollapsed((collapsed) => !collapsed)}
        onToggleRight={() => setIsRightCollapsed((collapsed) => !collapsed)}
        onReaderModeChange={setReaderMode}
        onZoomChange={setZoomPreset}
      />
    </PageShell>
  );
}
