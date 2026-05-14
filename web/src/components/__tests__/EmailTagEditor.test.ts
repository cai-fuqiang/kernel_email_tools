import { describe, expect, it } from 'vitest';

import { getTagPopoverPlacementClass } from '../EmailTagEditor';

describe('EmailTagEditor popover placement', () => {
  it('opens upward in compact mode to avoid clipping inside detail cards', () => {
    expect(getTagPopoverPlacementClass(true)).toContain('bottom-full');
    expect(getTagPopoverPlacementClass(true)).toContain('mb-1');
  });

  it('opens downward in regular mode', () => {
    expect(getTagPopoverPlacementClass(false)).toContain('top-full');
    expect(getTagPopoverPlacementClass(false)).toContain('mt-1');
  });
});
