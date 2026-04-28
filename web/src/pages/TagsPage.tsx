import TagManager from '../components/TagManager';
import { PageHeader, PageShell, SectionPanel } from '../components/ui';

export default function TagsPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Knowledge Workbench"
        title="Tag Management"
        description="Maintain the shared taxonomy used by search, email threads, annotations, and knowledge items."
      />
      <SectionPanel>
        <TagManager />
      </SectionPanel>
    </PageShell>
  );
}
