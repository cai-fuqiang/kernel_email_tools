import { describe, expect, it } from 'vitest';

import {
  buildCommitPatchModel,
  buildFilePatchDisplayRows,
  choosePrimaryTarget,
  formatChangedFileLabel,
  mergeExpandedPatchRows,
} from '../commitPatchModel';

describe('commitPatchModel', () => {
  it('prefers nearest tag targets when requested', () => {
    const model = buildCommitPatchModel({
      nearest_tag_version: 'v6.5',
      files: [
        {
          path: 'mm/mmap.c',
          old_path: 'mm/mmap.c',
          new_path: 'mm/mmap.c',
          status: 'modified',
          added: '2',
          deleted: '1',
          is_binary: false,
          truncated: false,
          hunks: [
            {
              header: '@@ -10,1 +20,2 @@',
              old_start: 10,
              old_count: 1,
              new_start: 20,
              new_count: 2,
              rows: [
                {
                  type: 'expander',
                  id: 'top',
                  direction: 'up',
                  hidden_count: 9,
                  step_size: 20,
                  old_start: 1,
                  old_end: 9,
                  new_start: 1,
                  new_end: 9,
                  expand_key: 'expand-top',
                },
                { type: 'line', kind: 'add', text: '+line_c', old_line: null, new_line: 20 },
              ],
              current_version_target: { available: true, version: 'v6.6', path: 'mm/mmap.c', line: 20, reason: null },
              nearest_tag_target: { available: true, version: 'v6.5', path: 'mm/mmap.c', line: 18, reason: null },
            },
          ],
        },
      ],
    });

    const hunk = model!.files[0].hunks[0];
    expect(hunk.rows[0]).toEqual({
      type: 'expander',
      id: 'top',
      direction: 'up',
      hiddenCount: 9,
      stepSize: 20,
      oldStart: 1,
      oldEnd: 9,
      newStart: 1,
      newEnd: 9,
      expandKey: 'expand-top',
    });
    expect(choosePrimaryTarget(hunk, 'nearest-tag')).toEqual({
      available: true,
      version: 'v6.5',
      path: 'mm/mmap.c',
      line: 18,
      reason: null,
    });
  });

  it('formats rename labels with both paths', () => {
    expect(
      formatChangedFileLabel({ status: 'renamed', old_path: 'old.c', new_path: 'new.c', path: 'new.c' }),
    ).toBe('old.c -> new.c');
  });

  it('uses the real file path for deleted files', () => {
    expect(
      formatChangedFileLabel({ status: 'deleted', old_path: 'old.c', new_path: '/dev/null', path: 'old.c' }),
    ).toBe('old.c');
  });

  it('merges upward expansion rows before the existing hunk body', () => {
    expect(
      mergeExpandedPatchRows({
        sourceRows: [
          {
            type: 'expander',
            id: 'top',
            direction: 'up',
            hiddenCount: 9,
            stepSize: 20,
            oldStart: 1,
            oldEnd: 9,
            newStart: 1,
            newEnd: 9,
            expandKey: 'expand-top',
          },
          { type: 'line', kind: 'context', text: 'line_10', oldLine: 10, newLine: 10 },
          { type: 'line', kind: 'add', text: '+line_11', oldLine: null, newLine: 11 },
        ],
        expanderId: 'top',
        direction: 'up',
        insertedRows: [
          { type: 'line', kind: 'context', text: 'line_8', oldLine: 8, newLine: 8 },
          { type: 'line', kind: 'context', text: 'line_9', oldLine: 9, newLine: 9 },
        ],
        remainingExpander: {
          type: 'expander',
          id: 'top',
          direction: 'up',
          hiddenCount: 7,
          stepSize: 20,
          oldStart: 1,
          oldEnd: 7,
          newStart: 1,
          newEnd: 7,
          expandKey: 'expand-top',
        },
      }),
    ).toEqual([
      {
        type: 'expander',
        id: 'top',
        direction: 'up',
        hiddenCount: 7,
        stepSize: 20,
        oldStart: 1,
        oldEnd: 7,
        newStart: 1,
        newEnd: 7,
        expandKey: 'expand-top',
      },
      { type: 'line', kind: 'context', text: 'line_8', oldLine: 8, newLine: 8 },
      { type: 'line', kind: 'context', text: 'line_9', oldLine: 9, newLine: 9 },
      { type: 'line', kind: 'context', text: 'line_10', oldLine: 10, newLine: 10 },
      { type: 'line', kind: 'add', text: '+line_11', oldLine: null, newLine: 11 },
    ]);
  });

  it('merges downward expansion rows after the existing hunk body', () => {
    expect(
      mergeExpandedPatchRows({
        sourceRows: [
          { type: 'line', kind: 'context', text: 'line_10', oldLine: 10, newLine: 10 },
          { type: 'line', kind: 'add', text: '+line_11', oldLine: null, newLine: 11 },
          {
            type: 'expander',
            id: 'bottom',
            direction: 'down',
            hiddenCount: 9,
            stepSize: 20,
            oldStart: 12,
            oldEnd: 20,
            newStart: 12,
            newEnd: 20,
            expandKey: 'expand-bottom',
          },
        ],
        expanderId: 'bottom',
        direction: 'down',
        insertedRows: [
          { type: 'line', kind: 'context', text: 'line_12', oldLine: 12, newLine: 12 },
          { type: 'line', kind: 'context', text: 'line_13', oldLine: 13, newLine: 13 },
        ],
        remainingExpander: null,
      }),
    ).toEqual([
      { type: 'line', kind: 'context', text: 'line_10', oldLine: 10, newLine: 10 },
      { type: 'line', kind: 'add', text: '+line_11', oldLine: null, newLine: 11 },
      { type: 'line', kind: 'context', text: 'line_12', oldLine: 12, newLine: 12 },
      { type: 'line', kind: 'context', text: 'line_13', oldLine: 13, newLine: 13 },
    ]);
  });

  it('builds one file-level patch surface and collapses duplicated inter-hunk gap expanders', () => {
    const model = buildCommitPatchModel({
      nearest_tag_version: 'v6.5',
      files: [
        {
          path: 'mm/mmap.c',
          old_path: 'mm/mmap.c',
          new_path: 'mm/mmap.c',
          status: 'modified',
          added: '2',
          deleted: '1',
          is_binary: false,
          truncated: false,
          hunks: [
            {
              header: '@@ -10,1 +10,1 @@',
              old_start: 10,
              old_count: 1,
              new_start: 10,
              new_count: 1,
              rows: [
                { type: 'line', kind: 'del', text: '-old', old_line: 10, new_line: null },
                {
                  type: 'expander',
                  id: 'gap-down',
                  direction: 'down',
                  hidden_count: 12,
                  step_size: 20,
                  old_start: 11,
                  old_end: 22,
                  new_start: 11,
                  new_end: 22,
                  expand_key: 'gap-down',
                },
              ],
              current_version_target: { available: true, version: 'v6.6', path: 'mm/mmap.c', line: 10, reason: null },
              nearest_tag_target: { available: true, version: 'v6.5', path: 'mm/mmap.c', line: 10, reason: null },
            },
            {
              header: '@@ -23,1 +23,1 @@',
              old_start: 23,
              old_count: 1,
              new_start: 23,
              new_count: 1,
              rows: [
                {
                  type: 'expander',
                  id: 'gap-up',
                  direction: 'up',
                  hidden_count: 12,
                  step_size: 20,
                  old_start: 11,
                  old_end: 22,
                  new_start: 11,
                  new_end: 22,
                  expand_key: 'gap-up',
                },
                { type: 'line', kind: 'add', text: '+new', old_line: null, new_line: 23 },
              ],
              current_version_target: { available: true, version: 'v6.6', path: 'mm/mmap.c', line: 23, reason: null },
              nearest_tag_target: { available: true, version: 'v6.5', path: 'mm/mmap.c', line: 23, reason: null },
            },
          ],
        },
      ],
    });

    const rows = buildFilePatchDisplayRows(model!.files[0], {});

    expect(rows.map((row) => row.type)).toEqual([
      'hunk-header',
      'line',
      'expander',
      'hunk-header',
      'line',
    ]);
    expect(rows[2].type).toBe('expander');
    if (rows[2].type !== 'expander') {
      throw new Error('expected expander row');
    }
    expect(rows[2].actions.map((action) => action.direction)).toEqual(['down', 'up']);
  });
});
