import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { Annotation } from '../../api/types';
import ThreadAnnotationCard from '../ThreadAnnotationCard';

const baseAnnotation: Annotation = {
  annotation_id: 'ann-current',
  annotation_type: 'email',
  short_label: '',
  author: 'Tester',
  author_user_id: 'user-1',
  visibility: 'public',
  publish_status: 'none',
  body: 'See [the related note](annotation:ann-target).',
  pinned: false,
  parent_annotation_id: '',
  publish_review_comment: '',
  created_at: '2026-05-14T00:00:00Z',
  updated_at: '2026-05-14T00:00:00Z',
  target_type: 'email_thread',
  target_ref: 'thread-1',
  target_label: 'Thread',
  target_subtitle: '',
  related_targets: [],
  anchor: {},
  thread_id: 'thread-1',
  in_reply_to: '',
  meta: {},
  target: {
    type: 'email_thread',
    ref: 'thread-1',
    label: 'Thread',
    subtitle: '',
    anchor: {},
  },
};

describe('ThreadAnnotationCard annotation links', () => {
  it('renders annotation protocol links as internal buttons in the readable body', () => {
    const html = renderToStaticMarkup(
      <ThreadAnnotationCard
        annotation={baseAnnotation}
        depth={0}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onReply={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Open annotation the related note"');
  });

  it('renders claim metadata when a short label is present', () => {
    const html = renderToStaticMarkup(
      <ThreadAnnotationCard
        annotation={{
          ...baseAnnotation,
          annotation_id: 'ann-claim',
          annotation_type: 'claim',
          short_label: 'Locking guarantee',
          body: 'Caller already holds mmap_lock.',
        }}
        depth={0}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onReply={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain('claim');
    expect(html).toContain('Locking guarantee');
  });
});
