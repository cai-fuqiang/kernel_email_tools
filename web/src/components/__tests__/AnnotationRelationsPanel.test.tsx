import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AnnotationRelation, CodeAnnotation } from '../../api/types';
import AnnotationRelationsPanel from '../AnnotationRelationsPanel';

const baseRelation: Omit<
  AnnotationRelation,
  'relation_id' | 'source_annotation_id' | 'target_annotation_id' | 'relation_type' | 'source_kind' | 'description'
> = {
  meta: {},
  created_by: 'tester',
  updated_by: 'tester',
  created_by_user_id: 'user-1',
  updated_by_user_id: 'user-1',
  created_at: '2026-05-14T00:00:00Z',
  updated_at: '2026-05-14T00:00:00Z',
};

const baseAnnotation: CodeAnnotation = {
  annotation_id: 'ann-current',
  annotation_type: 'code',
  version: 'v6.6',
  file_path: 'mm/mmap.c',
  start_line: 10,
  end_line: 12,
  body: 'Current annotation',
  author: 'tester',
  author_user_id: 'user-1',
  visibility: 'private',
  publish_status: 'none',
  created_at: '2026-05-14T00:00:00Z',
  parent_annotation_id: '',
  in_reply_to: '',
  updated_at: '2026-05-14T00:00:00Z',
  target_type: 'code',
  target_ref: 'v6.6:mm/mmap.c:10-12',
  target_label: 'mm/mmap.c:10-12',
  target_subtitle: 'v6.6',
  anchor: {},
  meta: {},
};

describe('AnnotationRelationsPanel', () => {
  it('renders outgoing and incoming relations with peer ids and markdown reference state', () => {
    const relations: AnnotationRelation[] = [
      {
        ...baseRelation,
        relation_id: 'rel-manual',
        source_annotation_id: 'ann-current',
        target_annotation_id: 'ann-target',
        relation_type: 'depends_on',
        source_kind: 'manual',
        description: 'Needs the setup note first.',
      },
      {
        ...baseRelation,
        relation_id: 'rel-markdown',
        source_annotation_id: 'ann-source',
        target_annotation_id: 'ann-current',
        relation_type: 'references',
        source_kind: 'markdown_link',
        description: '',
      },
    ];

    const html = renderToStaticMarkup(
      <AnnotationRelationsPanel
        annotationId="ann-current"
        subjectAnnotation={baseAnnotation}
        candidateAnnotations={[baseAnnotation]}
        relations={relations}
        loading={false}
        error=""
        onOpenAnnotation={vi.fn()}
        onCreateRelation={vi.fn().mockResolvedValue(undefined)}
        onDeleteRelation={vi.fn().mockResolvedValue(undefined)}
        onSearchAnnotations={vi.fn().mockResolvedValue([])}
      />,
    );

    expect(html).toContain('Relations');
    expect(html).toContain('Outgoing');
    expect(html).toContain('Incoming');
    expect(html).toContain('This annotation depends on target');
    expect(html).toContain('Target references this annotation');
    expect(html).toContain('ann-target');
    expect(html).toContain('ann-source');
    expect(html).toContain('Markdown reference');
  });

  it('shows a delete button only for manual relations', () => {
    const relations: AnnotationRelation[] = [
      {
        ...baseRelation,
        relation_id: 'rel-manual',
        source_annotation_id: 'ann-current',
        target_annotation_id: 'ann-target',
        relation_type: 'explains',
        source_kind: 'manual',
        description: '',
      },
      {
        ...baseRelation,
        relation_id: 'rel-markdown',
        source_annotation_id: 'ann-source',
        target_annotation_id: 'ann-current',
        relation_type: 'references',
        source_kind: 'markdown_link',
        description: '',
      },
    ];

    const html = renderToStaticMarkup(
      <AnnotationRelationsPanel
        annotationId="ann-current"
        subjectAnnotation={baseAnnotation}
        candidateAnnotations={[baseAnnotation]}
        relations={relations}
        loading={false}
        error=""
        onOpenAnnotation={vi.fn()}
        onCreateRelation={vi.fn().mockResolvedValue(undefined)}
        onDeleteRelation={vi.fn().mockResolvedValue(undefined)}
        onSearchAnnotations={vi.fn().mockResolvedValue([])}
      />,
    );

    expect(html).toContain('aria-label="Delete relation rel-manual"');
    expect(html).not.toContain('aria-label="Delete relation rel-markdown"');
  });
});
