import { describe, expect, it } from 'vitest';

import {
  buildCommitPatchModel,
  choosePrimaryTarget,
  formatChangedFileLabel,
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
});
