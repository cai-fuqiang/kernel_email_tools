import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AnnotationRelation } from '../../api/types';
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
        relations={relations}
        loading={false}
        error=""
        onOpenAnnotation={vi.fn()}
        onCreateRelation={vi.fn().mockResolvedValue(undefined)}
        onDeleteRelation={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(html).toContain('Relations');
    expect(html).toContain('Outgoing');
    expect(html).toContain('Incoming');
    expect(html).toContain('depends_on');
    expect(html).toContain('references');
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
        relations={relations}
        loading={false}
        error=""
        onOpenAnnotation={vi.fn()}
        onCreateRelation={vi.fn().mockResolvedValue(undefined)}
        onDeleteRelation={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(html).toContain('aria-label="Delete relation rel-manual"');
    expect(html).not.toContain('aria-label="Delete relation rel-markdown"');
  });
});
