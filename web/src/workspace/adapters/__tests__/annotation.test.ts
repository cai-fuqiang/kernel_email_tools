import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { AnnotationListItem, CodeAnnotation } from '../../../api/types';
import { annotationToEntity, codeAnnotationToEntity } from '../annotation';

function makeEmailAnnotation(overrides: Partial<AnnotationListItem> = {}): AnnotationListItem {
  return {
    annotation_id: 'ann-1',
    annotation_type: 'email',
    author: 'me',
    visibility: 'private',
    publish_status: 'none',
    body: 'Short note\nSecond line ignored',
    parent_annotation_id: '',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    target_type: 'email_message',
    target_ref: 'msg-42',
    target_label: 'Re: something',
    target_subtitle: 'linux-mm',
    anchor: {},
    thread_id: 'thread-42',
    in_reply_to: '',
    ...overrides,
  };
}

function makeCodeAnnotation(overrides: Partial<CodeAnnotation> = {}): CodeAnnotation {
  return {
    annotation_id: 'cann-1',
    annotation_type: 'code',
    version: 'v6.8',
    file_path: 'mm/slub.c',
    start_line: 100,
    end_line: 105,
    body: 'Race fix explanation',
    author: 'me',
    visibility: 'public',
    publish_status: 'approved',
    created_at: '2026-05-02T00:00:00Z',
    updated_at: '2026-05-02T00:00:00Z',
    target_type: 'code_line',
    target_ref: 'v6.8:mm/slub.c',
    target_label: 'mm/slub.c:100-105',
    target_subtitle: 'v6.8',
    anchor: { start_line: 100, end_line: 105 },
    ...overrides,
  };
}

describe('annotation adapter', () => {
  it('adapts email and code annotations into workspace entities', () => {
    // case 1: 邮件批注正常
    {
      const e = annotationToEntity(makeEmailAnnotation());
      assert.equal(e.kind, 'annotation');
      assert.equal(e.id, 'annotation:ann-1');
      assert.equal(e.target.type, 'email_message');
      assert.equal(e.title, 'Short note'); // 只取第一行
      assert.ok(e.badges.some((b) => b.label === 'private'));
    }

    // case 2: 邮件批注 pending review
    {
      const e = annotationToEntity(makeEmailAnnotation({ visibility: 'public', publish_status: 'pending' }));
      assert.ok(e.badges.some((b) => b.label === 'pending review'));
    }

    // case 3: 空 body 兜底
    {
      const e = annotationToEntity(makeEmailAnnotation({ body: '' }));
      assert.equal(e.title, '(empty annotation)');
      assert.equal(e.excerpt, '');
    }

    // case 4: 代码批注
    {
      const e = codeAnnotationToEntity(makeCodeAnnotation());
      assert.equal(e.kind, 'annotation');
      assert.equal(e.target.type, 'code_line');
      assert.equal(e.target.ref, 'v6.8:mm/slub.c');
      assert.ok(e.badges.some((b) => b.label === 'code'));
      assert.ok(e.badges.some((b) => b.label === 'public'));
      assert.ok(e.subtitle?.includes('mm/slub.c:100-105'));
    }
  });
});
