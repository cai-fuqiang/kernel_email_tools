import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  CommitPatchBrowserView,
  buildCommitPatchModel,
  buildPatchRowAnchor,
  findExpansionViewportAnchor,
} from '../CodeHistoryPanel';

function collectClickables(node: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(node)) {
    return node.flatMap(collectClickables);
  }
  if (!isValidElement(node)) {
    return [];
  }
  const props = (node as { props?: Record<string, unknown> }).props || {};
  const children = props.children;
  const nested = collectClickables(children);
  if (typeof props.onClick === 'function') {
    return [props, ...nested];
  }
  return nested;
}

function flattenText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(flattenText).join('');
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (isValidElement(value)) {
    return flattenText((value as { props?: Record<string, unknown> }).props?.children);
  }
  return '';
}

describe('CodeHistoryPanel commit patch browser', () => {
  it('keeps the closest stable line as the viewport anchor during upward expansion', () => {
    expect(
      findExpansionViewportAnchor(
        [
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
          { type: 'line', kind: 'context', text: 'line_11', oldLine: 11, newLine: 11 },
        ],
        'top',
        'up',
      ),
    ).toBe(buildPatchRowAnchor({ oldLine: 10, newLine: 10 }));
  });

  it('keeps the closest stable line as the viewport anchor during downward expansion', () => {
    expect(
      findExpansionViewportAnchor(
        [
          { type: 'line', kind: 'context', text: 'line_10', oldLine: 10, newLine: 10 },
          { type: 'line', kind: 'context', text: 'line_11', oldLine: 11, newLine: 11 },
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
        'bottom',
        'down',
      ),
    ).toBe(buildPatchRowAnchor({ oldLine: 11, newLine: 11 }));
  });

  it('renders the file navigator and emits nearest-tag navigation requests', () => {
    const onOpenTarget = vi.fn();
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

    const tree = CommitPatchBrowserView({
      model: model!,
      selectedFilePath: 'mm/mmap.c',
      onSelectFile: () => {},
      onOpenTarget,
      rowsByHunk: {
        'mm/mmap.c::@@ -10,1 +20,2 @@::0': model!.files[0].hunks[0].rows,
      },
      loadingExpanders: {},
      expanderErrors: {},
      onExpand: () => {},
    });
    const buttons = collectClickables(tree);
    const jumpButton = buttons.find((props) => flattenText(props.children) === 'Jump to nearest tag');

    expect(flattenText(tree)).toContain('mm/mmap.c');
    expect(flattenText(tree)).toContain('+line_c');
    expect(jumpButton).toBeTruthy();

    (jumpButton?.onClick as (() => void) | undefined)?.();

    expect(onOpenTarget).toHaveBeenCalledWith({
      available: true,
      version: 'v6.5',
      path: 'mm/mmap.c',
      line: 18,
      reason: null,
    });
  });
});
