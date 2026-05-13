import { describe, expect, it } from 'vitest';
import type { CodeAnnotation } from '../../../api/types';
import {
  buildLineMarker,
  getAnnotationLineRange,
  lineDistanceToRange,
  pickActiveAnnotation,
  rankRollerItems,
  shouldAllowSync,
} from '../annotationSync';

function annotation(patch: Partial<CodeAnnotation>): CodeAnnotation {
  return {
    annotation_id: 'a1',
    annotation_type: 'note',
    version: 'v6.6',
    file_path: 'mm/mmap.c',
    start_line: 10,
    end_line: 10,
    body: 'body',
    author: 'tester',
    visibility: 'private',
    publish_status: 'none',
    created_at: '',
    updated_at: '',
    target_type: 'kernel_line_range',
    target_ref: 'v6.6:mm/mmap.c',
    target_label: '',
    target_subtitle: '',
    anchor: {},
    meta: {},
    ...patch,
  };
}

describe('annotation sync helpers', () => {
  it('reads line range from explicit fields first', () => {
    expect(getAnnotationLineRange(annotation({ start_line: 5, end_line: 8 }))).toEqual({
      start: 5,
      end: 8,
    });
  });

  it('falls back to anchor line range when explicit fields are missing', () => {
    expect(
      getAnnotationLineRange(
        annotation({
          start_line: 0,
          end_line: 0,
          anchor: { start_line: '21', end_line: '24' },
        }),
      ),
    ).toEqual({ start: 21, end: 24 });
  });

  it('falls back to code target line range', () => {
    expect(
      getAnnotationLineRange(
        annotation({
          start_line: 0,
          end_line: 0,
          code_target: {
            repo: 'linux',
            version: 'v6.6',
            path: 'mm/mmap.c',
            start_line: 31,
            end_line: 34,
            symbol: '',
            commit: '',
            patch_id: '',
            message_id: '',
            target_ref: 'v6.6:mm/mmap.c',
          },
        }),
      ),
    ).toEqual({ start: 31, end: 34 });
  });

  it('falls back to meta code target line range', () => {
    expect(
      getAnnotationLineRange(
        annotation({
          start_line: 0,
          end_line: 0,
          meta: { code_target: { start_line: '41', end_line: '44' } },
        }),
      ),
    ).toEqual({ start: 41, end: 44 });
  });

  it('calculates distance from a line to a range', () => {
    expect(lineDistanceToRange(12, { start: 10, end: 15 })).toBe(0);
    expect(lineDistanceToRange(7, { start: 10, end: 15 })).toBe(3);
    expect(lineDistanceToRange(19, { start: 10, end: 15 })).toBe(4);
  });

  it('picks annotation containing center line before nearest annotation', () => {
    const annotations = [
      annotation({ annotation_id: 'near', start_line: 20, end_line: 22 }),
      annotation({ annotation_id: 'contains', start_line: 30, end_line: 40 }),
    ];

    expect(pickActiveAnnotation(annotations, 35)?.annotation_id).toBe('contains');
  });

  it('picks nearest annotation when center line has no direct overlap', () => {
    const annotations = [
      annotation({ annotation_id: 'before', start_line: 10, end_line: 11 }),
      annotation({ annotation_id: 'after', start_line: 40, end_line: 41 }),
    ];

    expect(pickActiveAnnotation(annotations, 32)?.annotation_id).toBe('after');
  });

  it('does not pick an unknown line range over a valid annotation', () => {
    const annotations = [
      annotation({ annotation_id: 'unknown', start_line: 0, end_line: 0 }),
      annotation({ annotation_id: 'valid', start_line: 40, end_line: 41 }),
    ];

    expect(pickActiveAnnotation(annotations, 1)?.annotation_id).toBe('valid');
  });

  it('ranks roller items around the active annotation', () => {
    const annotations = [
      annotation({ annotation_id: 'a', start_line: 10, end_line: 10 }),
      annotation({ annotation_id: 'b', start_line: 20, end_line: 20 }),
      annotation({ annotation_id: 'c', start_line: 30, end_line: 30 }),
    ];

    expect(rankRollerItems(annotations, 'b').map((item) => [item.annotation.annotation_id, item.position])).toEqual([
      ['a', -1],
      ['b', 0],
      ['c', 1],
    ]);
  });

  it('ranks roller items from the first item when active annotation is null or unknown', () => {
    const annotations = [
      annotation({ annotation_id: 'a', start_line: 10, end_line: 10 }),
      annotation({ annotation_id: 'b', start_line: 20, end_line: 20 }),
    ];

    expect(rankRollerItems(annotations, null).map((item) => [item.annotation.annotation_id, item.position, item.active])).toEqual([
      ['a', 0, false],
      ['b', 1, false],
    ]);
    expect(rankRollerItems(annotations, 'missing').map((item) => item.active)).toEqual([false, false]);
  });

  it('uses a dot for single-line annotation markers', () => {
    expect(
      buildLineMarker({
        line: 10,
        annotations: [annotation({ start_line: 10, end_line: 10 })],
        selectedLines: new Set<number>(),
        activeAnnotationId: null,
      }),
    ).toMatchObject({ kind: 'dot', selected: false, active: false });
  });

  it('uses a vertical line for multi-line annotation markers', () => {
    expect(
      buildLineMarker({
        line: 11,
        annotations: [annotation({ start_line: 10, end_line: 12 })],
        selectedLines: new Set<number>(),
        activeAnnotationId: null,
      }),
    ).toMatchObject({ kind: 'range', selected: false, active: false });
  });

  it('promotes selected multi-line range to selected range marker', () => {
    expect(
      buildLineMarker({
        line: 11,
        annotations: [],
        selectedLines: new Set<number>([10, 11, 12]),
        activeAnnotationId: null,
      }),
    ).toMatchObject({ kind: 'range', selected: true, active: false });
  });

  it('does not mark non-selected lines during a multi-line selection', () => {
    expect(
      buildLineMarker({
        line: 9,
        annotations: [],
        selectedLines: new Set<number>([10, 11, 12]),
        activeAnnotationId: null,
      }),
    ).toMatchObject({ kind: 'none', selected: false, active: false });
  });

  it('only counts root annotations in line markers', () => {
    expect(
      buildLineMarker({
        line: 10,
        annotations: [annotation({ annotation_id: 'reply', in_reply_to: 'root', start_line: 10, end_line: 10 })],
        selectedLines: new Set<number>(),
        activeAnnotationId: 'reply',
      }),
    ).toMatchObject({ kind: 'none', selected: false, active: false, annotationCount: 0 });

    expect(
      buildLineMarker({
        line: 10,
        annotations: [annotation({ annotation_id: 'root', start_line: 10, end_line: 10 })],
        selectedLines: new Set<number>(),
        activeAnnotationId: 'root',
      }),
    ).toMatchObject({ kind: 'dot', selected: false, active: true, annotationCount: 1 });
  });

  it('blocks immediate reverse sync from the same source lock', () => {
    expect(shouldAllowSync({ source: 'code', requestedBy: 'annotation', now: 1000, lockedUntil: 1300 })).toBe(false);
    expect(shouldAllowSync({ source: 'code', requestedBy: 'annotation', now: 1400, lockedUntil: 1300 })).toBe(true);
  });
});
