import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AnnotationRelation } from '../../api/types';
import VariableTracePanel, {
  getVariableTraceItems,
} from '../VariableTracePanel';

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

describe('VariableTracePanel', () => {
  it('filters relation types into variable trace items', () => {
    const relations: AnnotationRelation[] = [
      {
        ...baseRelation,
        relation_id: 'rel-trace',
        source_annotation_id: 'ann-current',
        target_annotation_id: 'ann-next',
        relation_type: 'variable_evolves_to',
        source_kind: 'manual',
        description: '',
      },
      {
        ...baseRelation,
        relation_id: 'rel-other',
        source_annotation_id: 'ann-current',
        target_annotation_id: 'ann-doc',
        relation_type: 'references',
        source_kind: 'manual',
        description: '',
      },
    ];

    expect(getVariableTraceItems('ann-current', relations)).toEqual([
      {
        relation: relations[0],
        peerId: 'ann-next',
        direction: 'outgoing',
      },
    ]);
  });

  it('renders variable names, peer ids, and descriptions', () => {
    const relations: AnnotationRelation[] = [
      {
        ...baseRelation,
        relation_id: 'rel-value',
        source_annotation_id: 'ann-source',
        target_annotation_id: 'ann-current',
        relation_type: 'value_passed_to',
        source_kind: 'manual',
        description: 'The file pointer is forwarded into the helper.',
        meta: { variable: 'file' },
      },
    ];

    const html = renderToStaticMarkup(
      <VariableTracePanel
        annotationId="ann-current"
        relations={relations}
        onOpenAnnotation={vi.fn()}
      />,
    );

    expect(html).toContain('Variable trace');
    expect(html).toContain('value passed to');
    expect(html).toContain('ann-source');
    expect(html).toContain('file');
    expect(html).toContain('The file pointer is forwarded into the helper.');
  });

  it('renders nothing when there are no trace relations', () => {
    const html = renderToStaticMarkup(
      <VariableTracePanel
        annotationId="ann-current"
        relations={[]}
        onOpenAnnotation={vi.fn()}
      />,
    );

    expect(html).toBe('');
  });
});
