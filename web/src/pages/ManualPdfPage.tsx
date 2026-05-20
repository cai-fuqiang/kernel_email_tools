import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { getManualDocumentView } from '../api/client';
import type {
  ManualDocumentTocNode,
  ManualDocumentView,
  ManualPdfReaderMode,
  ManualPdfZoomPreset,
} from '../api/types';
import { PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';

const ZOOM_PRESETS: Array<{ label: string; value: ManualPdfZoomPreset }> = [
  { label: 'Fit width', value: 'fit' },
  { label: '100%', value: '1.00' },
  { label: '125%', value: '1.25' },
  { label: '150%', value: '1.50' },
];

function zoomPresetToScale(zoomPreset: ManualPdfZoomPreset): string {
  return zoomPreset === 'fit' ? '1' : zoomPreset;
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

export default function ManualPdfPage() {
  const { documentId } = useParams();
  const [readerDocument, setReaderDocument] = useState<ManualDocumentView | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [readerMode, setReaderMode] = useState<ManualPdfReaderMode>('continuous');
  const [zoomPreset, setZoomPreset] = useState<ManualPdfZoomPreset>('fit');

  useEffect(() => {
    let active = true;

    if (!documentId) {
      setReaderDocument(null);
      setReaderLoading(false);
      return () => {
        active = false;
      };
    }

    setReaderLoading(true);
    setReaderDocument(null);

    void getManualDocumentView(documentId)
      .then((document) => {
        if (active) {
          setReaderDocument(document);
        }
      })
      .catch(() => {
        if (active) {
          setReaderDocument(null);
        }
      })
      .finally(() => {
        if (active) {
          setReaderLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [documentId]);

  const focusLayout = isLeftCollapsed && isRightCollapsed;
  const zoomScale = zoomPresetToScale(zoomPreset);

  return (
    <PageShell>
      <PageHeader
        eyebrow="PDF Workspace"
        title="Open PDF document"
        description={
          readerDocument?.subtitle ||
          'Read the source PDF in a dedicated workspace with navigation, zoom, and annotations.'
        }
      />

      <div
        data-testid="pdf-workspace-root"
        data-left-collapsed={String(isLeftCollapsed)}
        data-right-collapsed={String(isRightCollapsed)}
        className="mt-6 flex min-h-[calc(100vh-13rem)] flex-col gap-4 xl:flex-row"
      >
        <aside
          className={`shrink-0 rounded-2xl border border-slate-200 bg-white shadow-sm transition-all ${
            isLeftCollapsed ? 'w-full xl:w-16' : 'w-full xl:w-80'
          }`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            {!isLeftCollapsed ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Document rail</p>
                <h2 className="text-sm font-semibold text-slate-900">Outline</h2>
              </div>
            ) : (
              <div aria-hidden="true" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Outline
              </div>
            )}
            <PrimaryButton
              type="button"
              onClick={() => setIsLeftCollapsed((collapsed) => !collapsed)}
              className="shrink-0"
            >
              {isLeftCollapsed ? 'Expand left panel' : 'Collapse left panel'}
            </PrimaryButton>
          </div>
          {!isLeftCollapsed && (
            <div className="space-y-4 p-4">
              <SectionPanel title={readerDocument?.title || 'Document details'}>
                {readerLoading ? (
                  <p className="text-sm text-slate-500">Loading document...</p>
                ) : readerDocument ? (
                  <dl className="space-y-2 text-sm text-slate-600">
                    <div>
                      <dt className="font-medium text-slate-900">Manual type</dt>
                      <dd>{readerDocument.manual_type}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Version</dt>
                      <dd>{readerDocument.manual_version}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Pages</dt>
                      <dd>{readerDocument.page_count}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Initial page</dt>
                      <dd>{readerDocument.initial_page}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-slate-500">
                    {documentId ? 'Document metadata is unavailable.' : 'A document id is required for this workspace.'}
                  </p>
                )}
              </SectionPanel>

              <SectionPanel title="Outline">
                {readerDocument ? renderToc(readerDocument.toc) : <p className="text-sm text-slate-500">Loading outline...</p>}
              </SectionPanel>
            </div>
          )}
        </aside>

        <section
          data-testid="pdf-reader-pane"
          data-focus-layout={String(focusLayout)}
          data-zoom={zoomScale}
          className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-950 text-white shadow-lg"
        >
          <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <PrimaryButton
                  type="button"
                  aria-pressed={readerMode === 'continuous'}
                  onClick={() => setReaderMode('continuous')}
                  className={readerMode === 'continuous' ? 'bg-sky-500 hover:bg-sky-400' : 'bg-slate-700 hover:bg-slate-600'}
                >
                  Continuous scroll
                </PrimaryButton>
                <PrimaryButton
                  type="button"
                  aria-pressed={readerMode === 'single'}
                  onClick={() => setReaderMode('single')}
                  className={readerMode === 'single' ? 'bg-sky-500 hover:bg-sky-400' : 'bg-slate-700 hover:bg-slate-600'}
                >
                  Single-page focus
                </PrimaryButton>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {ZOOM_PRESETS.map((preset) => (
                  <PrimaryButton
                    key={preset.value}
                    type="button"
                    aria-pressed={zoomPreset === preset.value}
                    onClick={() => setZoomPreset(preset.value)}
                    className={zoomPreset === preset.value ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-slate-700 hover:bg-slate-600'}
                  >
                    {preset.label}
                  </PrimaryButton>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 text-sm text-slate-300">
              <span className="rounded-full border border-white/10 px-3 py-1">
                Reader mode: {readerMode === 'continuous' ? 'continuous' : 'single-page focus'}
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1">Zoom: {zoomScale}</span>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <SectionPanel title={readerDocument?.title || 'PDF canvas'}>
              {readerLoading ? (
                <p className="text-sm text-slate-300">Loading PDF workspace...</p>
              ) : readerDocument ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-300">
                    Center pane ready for PDF reading. The workspace shell is wired to the loaded document and preserves
                    reader mode when zoom presets change.
                  </p>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Title</p>
                      <p className="mt-1 text-sm font-medium text-white">{readerDocument.title}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Subtitle</p>
                      <p className="mt-1 text-sm font-medium text-white">{readerDocument.subtitle}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Document id</p>
                      <p className="mt-1 text-sm font-medium text-white">{readerDocument.document_id}</p>
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

        <aside
          className={`shrink-0 rounded-2xl border border-slate-200 bg-white shadow-sm transition-all ${
            isRightCollapsed ? 'w-full xl:w-16' : 'w-full xl:w-80'
          }`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            {!isRightCollapsed ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workspace rail</p>
                <h2 className="text-sm font-semibold text-slate-900">References</h2>
              </div>
            ) : (
              <div aria-hidden="true" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                References
              </div>
            )}
            <PrimaryButton
              type="button"
              onClick={() => setIsRightCollapsed((collapsed) => !collapsed)}
              className="shrink-0"
            >
              {isRightCollapsed ? 'Expand right panel' : 'Collapse right panel'}
            </PrimaryButton>
          </div>
          {!isRightCollapsed && (
            <div className="space-y-4 p-4">
              <SectionPanel title="Workspace notes">
                <p className="text-sm text-slate-500">
                  This shell reserves the right rail for annotations, evidence, and document references.
                </p>
              </SectionPanel>
              <SectionPanel title="Document stats">
                {readerDocument ? (
                  <dl className="space-y-2 text-sm text-slate-600">
                    <div>
                      <dt className="font-medium text-slate-900">Pages</dt>
                      <dd>{readerDocument.page_count}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Initial page</dt>
                      <dd>{readerDocument.initial_page}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">PDF URL</dt>
                      <dd className="break-all">{readerDocument.pdf_url}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-slate-500">Loading document stats...</p>
                )}
              </SectionPanel>
            </div>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
