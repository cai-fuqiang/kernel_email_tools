import { describe, expect, it, vi } from 'vitest';
import type { CodeAnnotation } from '../../../api/types';
import {
  handleAnnotationPreviewButtonClick,
  resolveAnnotationPreviewState,
  shouldIgnoreAnnotationCardClick,
} from '../annotationPreview';

function annotation(patch: Partial<CodeAnnotation>): CodeAnnotation {
  return {
    annotation_id: 'a1',
    annotation_type: 'note',
    version: 'v6.7-rc7',
    file_path: 'crypto/algif_aead.c',
    start_line: 120,
    end_line: 135,
    body: 'root body',
    author: 'tester',
    visibility: 'public',
    publish_status: 'approved',
    created_at: '2026-05-13T00:00:00Z',
    updated_at: '2026-05-13T00:00:00Z',
    target_type: 'kernel_line_range',
    target_ref: 'v6.7-rc7:crypto/algif_aead.c',
    target_label: '',
    target_subtitle: '',
    anchor: {},
    meta: {},
    ...patch,
  };
}

describe('annotation preview helpers', () => {
  it('selects the target annotation and its replies from a file annotation list', () => {
    const target = annotation({ annotation_id: 'target' });
    const reply = annotation({
      annotation_id: 'reply',
      in_reply_to: 'target',
      body: 'reply body',
      start_line: 122,
      end_line: 122,
    });
    const state = resolveAnnotationPreviewState([annotation({ annotation_id: 'other' }), reply, target], 'target');

    expect(state.target?.annotation_id).toBe('target');
    expect(state.replies.map((item) => item.annotation_id)).toEqual(['reply']);
    expect(state.missing).toBe(false);
  });

  it('returns a useful missing state when the annotation id is no longer in the file list', () => {
    const state = resolveAnnotationPreviewState([annotation({ annotation_id: 'other' })], 'deleted');

    expect(state.target).toBeNull();
    expect(state.replies).toEqual([]);
    expect(state.missing).toBe(true);
  });

  it('isolates preview button clicks from card selection handlers', () => {
    const target = annotation({ annotation_id: 'target' });
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const onPreview = vi.fn();

    handleAnnotationPreviewButtonClick(target, { stopPropagation, preventDefault }, onPreview);

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(target);
  });

  it('suppresses annotation card selection for preview action targets', () => {
    const target = {
      closest: vi.fn((selector: string) => (selector.includes('[data-no-annotation-select]') ? {} : null)),
    };

    expect(shouldIgnoreAnnotationCardClick(target)).toBe(true);
  });

  it('allows card selection when a click originates from a text node inside the card body', () => {
    const textNodeTarget = {
      parentElement: {
        closest: vi.fn(() => null),
      },
    };

    expect(shouldIgnoreAnnotationCardClick(textNodeTarget)).toBe(false);
  });
});
