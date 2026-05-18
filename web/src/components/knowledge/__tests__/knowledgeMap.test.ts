import { describe, expect, it } from 'vitest';

import type { AnnotationListItem, KnowledgeEntity } from '../../../api/types';
import { buildKnowledgeMapModel } from '../knowledgeMap';

function entity(patch: Partial<KnowledgeEntity> = {}): KnowledgeEntity {
  return {
    entity_id: 'symbol:do_mmap',
    entity_type: 'symbol',
    canonical_name: 'do_mmap',
    slug: 'do-mmap',
    aliases: [],
    summary: '',
    description: '',
    status: 'active',
    meta: {},
    created_by: '',
    updated_by: '',
    created_at: '',
    updated_at: '',
    ...patch,
  };
}

function annotation(patch: Partial<AnnotationListItem>): AnnotationListItem {
  return {
    annotation_id: 'ann-1',
    annotation_type: 'claim',
    short_label: 'Locking guarantee',
    author: 'tester',
    author_user_id: 'user-1',
    visibility: 'public',
    publish_status: 'approved',
    body: 'Caller already holds mmap_lock.',
    pinned: false,
    parent_annotation_id: '',
    publish_review_comment: '',
    created_at: '2026-05-18T00:00:00Z',
    updated_at: '2026-05-18T00:00:00Z',
    target_type: 'symbol',
    target_ref: 'symbol:do_mmap',
    target_label: 'do_mmap',
    target_subtitle: 'symbol',
    related_targets: [],
    anchor: {},
    meta: {},
    thread_id: '',
    in_reply_to: '',
    ...patch,
  };
}

describe('knowledge map adapter', () => {
  it('builds a map model from a current object and promoted annotations', () => {
    const model = buildKnowledgeMapModel({
      center: entity(),
      annotations: [
        annotation({
          annotation_id: 'ann-1',
          annotation_type: 'claim',
          short_label: 'Caller already holds mmap_lock',
          related_targets: [{ target_type: 'commit', target_ref: 'commit:abc123' }],
        }),
      ],
    });

    expect(model.centerNode.id).toBe('symbol:do_mmap');
    expect(model.annotationNodes).toHaveLength(1);
    expect(model.relatedObjectNodes).toHaveLength(1);
    expect(model.edges).toHaveLength(2);
  });

  it('filters out excerpts and unpinned notes while keeping related primary targets', () => {
    const model = buildKnowledgeMapModel({
      center: entity(),
      annotations: [
        annotation({
          annotation_id: 'ann-excerpt',
          annotation_type: 'excerpt',
          short_label: 'Context only',
        }),
        annotation({
          annotation_id: 'ann-note',
          annotation_type: 'note',
          pinned: false,
          short_label: 'Unpinned note',
        }),
        annotation({
          annotation_id: 'ann-related',
          annotation_type: 'summary',
          target_type: 'commit',
          target_ref: 'commit:def456',
          target_label: 'def456',
          related_targets: [{ target_type: 'symbol', target_ref: 'symbol:do_mmap' }],
        }),
      ],
    });

    expect(model.annotationNodes.map((item) => item.annotation_id)).toEqual(['ann-related']);
    expect(model.relatedObjectNodes.map((item) => item.id)).toEqual(['commit:def456']);
  });
});
