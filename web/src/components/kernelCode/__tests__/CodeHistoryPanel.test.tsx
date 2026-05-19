import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CommitPatchBrowser, buildCommitPatchModel } from '../CodeHistoryPanel';

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
              lines: [{ kind: 'add', text: '+line_c', old_line: null, new_line: 20 }],
              context_preview: { focus_start_line: 20, focus_end_line: 21, snippet: 'line_b2\nline_c' },
              current_version_target: { available: true, version: 'v6.6', path: 'mm/mmap.c', line: 20, reason: null },
              nearest_tag_target: { available: true, version: 'v6.5', path: 'mm/mmap.c', line: 18, reason: null },
            },
          ],
        },
      ],
    });

    const tree = CommitPatchBrowser({
      model: model!,
      selectedFilePath: 'mm/mmap.c',
      onSelectFile: () => {},
      onOpenTarget,
    });
    const buttons = collectClickables(tree);
    const jumpButton = buttons.find((props) => flattenText(props.children) === 'Jump to nearest tag');

    expect(jumpButton).toBeTruthy();
    expect(tree).toBeTruthy();

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
