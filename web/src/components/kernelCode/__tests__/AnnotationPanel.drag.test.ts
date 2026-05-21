import { describe, expect, it } from 'vitest';

import { buildAnnotationMarkdownDragPayload } from '../AnnotationPanel';

describe('AnnotationPanel Markdown drag payloads', () => {
  it('builds a static Markdown preview with an absolute annotation link', () => {
    const payload = buildAnnotationMarkdownDragPayload({
      annotationId: 'code-annot-fc475b4cbec9',
      body: 'This explains mmap locking.\n\nSecond paragraph is extra context.',
      label: 'mm/mmap.c',
      lineRange: 'L123-L130',
      origin: 'http://aliyun.cloud.vm:8080',
    });

    expect(payload.markdown).toContain(
      '[annotation: mm/mmap.c L123-L130](http://aliyun.cloud.vm:8080/app/annotations?q=code-annot-fc475b4cbec9)',
    );
    expect(payload.markdown).toContain('> This explains mmap locking.');
    expect(payload.plainText).toBe(payload.markdown);
    expect(payload.url).toBe('http://aliyun.cloud.vm:8080/app/annotations?q=code-annot-fc475b4cbec9');
  });
});
