import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CodeAnnotation } from '../../../api/types';
import AnnotationPreviewContent from '../AnnotationPreviewContent';

const baseCodeAnnotation: CodeAnnotation = {
  annotation_id: 'code-ann-current',
  annotation_type: 'code',
  version: 'v6.6',
  file_path: 'mm/mmap.c',
  start_line: 10,
  end_line: 12,
  body: 'Read [the setup note](annotation:code-ann-target).',
  author: 'Tester',
  author_user_id: 'user-1',
  visibility: 'public',
  publish_status: 'none',
  publish_review_comment: '',
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

describe('AnnotationPreviewContent annotation links', () => {
  it('renders annotation links as internal buttons in the annotation body and replies', () => {
    const html = renderToStaticMarkup(
      <AnnotationPreviewContent
        annotation={baseCodeAnnotation}
        replies={[
          {
            ...baseCodeAnnotation,
            annotation_id: 'code-ann-reply',
            body: 'Reply links to [another note](annotation:code-ann-reply-target).',
            in_reply_to: baseCodeAnnotation.annotation_id,
          },
        ]}
      />,
    );

    expect(html).toContain('aria-label="Open annotation the setup note"');
    expect(html).toContain('aria-label="Open annotation another note"');
  });
});
