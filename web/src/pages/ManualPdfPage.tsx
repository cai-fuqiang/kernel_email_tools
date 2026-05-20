import { useParams } from 'react-router-dom';

import { PageHeader, PageShell, SectionPanel } from '../components/ui';

export default function ManualPdfPage() {
  const { documentId } = useParams();

  return (
    <PageShell>
      <PageHeader
        eyebrow="PDF Workspace"
        title="Open PDF document"
        description="Read the source PDF in a dedicated workspace with navigation, zoom, and annotations."
      />

      <SectionPanel title="Workspace ready">
        <p className="text-sm text-gray-600">
          {documentId ? (
            <>
              Open document <span className="font-medium text-gray-900">{documentId}</span> in the dedicated PDF workspace.
            </>
          ) : (
            'A document id is required for this workspace.'
          )}
        </p>
      </SectionPanel>
    </PageShell>
  );
}
