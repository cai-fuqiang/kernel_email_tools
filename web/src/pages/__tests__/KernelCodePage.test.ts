import { describe, expect, it } from 'vitest';

import { buildKernelCodeSelectionMarkdownDragPayload, clampRequestedLine } from '../KernelCodePage';

describe('clampRequestedLine', () => {
  it('clamps a requested line to the file line count', () => {
    expect(clampRequestedLine(159, 42)).toBe(42);
  });

  it('keeps an in-range line unchanged', () => {
    expect(clampRequestedLine(12, 42)).toBe(12);
  });

  it('returns null for missing or invalid requested lines', () => {
    expect(clampRequestedLine(null, 42)).toBeNull();
    expect(clampRequestedLine(0, 42)).toBeNull();
  });
});

describe('buildKernelCodeSelectionMarkdownDragPayload', () => {
  it('builds a fenced code preview with a link back to the selected range', () => {
    const payload = buildKernelCodeSelectionMarkdownDragPayload({
      version: 'v6.6',
      filePath: 'mm/mmap.c',
      rangeLabel: 'L123-L124',
      startLine: 123,
      selectedText: 'static int example(void)\n{\n}',
      origin: 'http://aliyun.cloud.vm:8080',
    });

    expect(payload.markdown).toContain('[code: mm/mmap.c L123-L124](http://aliyun.cloud.vm:8080/app/kernel-code?v=v6.6&path=mm%2Fmmap.c&line=123)');
    expect(payload.markdown).toContain('```c');
    expect(payload.markdown).toContain('static int example(void)');
    expect(payload.plainText).toBe(payload.markdown);
  });
});
