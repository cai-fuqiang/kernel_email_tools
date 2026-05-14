import { describe, expect, it } from 'vitest';

import {
  buildTagPopoverStyle,
  getVisibleTagOptions,
  type TagOptionViewMode,
} from '../EmailTagEditor';

describe('EmailTagEditor portal helpers', () => {
  it('keeps the floating panel within the viewport width', () => {
    const style = buildTagPopoverStyle(
      { left: 320, top: 120, bottom: 144, width: 28, height: 24 },
      true,
      360,
      640,
    );

    expect(style.left).toBe(28);
    expect(style.top).toBe(152);
  });

  it('opens above the trigger in compact mode when there is room', () => {
    const style = buildTagPopoverStyle(
      { left: 120, top: 300, bottom: 324, width: 28, height: 24 },
      true,
      800,
      800,
    );

    expect(style.top).toBe(92);
  });

  it.each([
    ['all' as TagOptionViewMode, ['alpha', 'beta', 'gamma']],
    ['matching' as TagOptionViewMode, ['alpha']],
    ['related' as TagOptionViewMode, ['gamma']],
  ])('filters visible options for %s mode', (mode, expected) => {
    const items = getVisibleTagOptions({
      mode,
      inputValue: 'alp',
      suggestions: [
        { id: 1, name: 'alpha' },
        { id: 2, name: 'beta' },
      ],
      related: [{ id: 3, name: 'gamma' }],
    });

    expect(items.map((item) => item.name)).toEqual(expected);
  });
});
