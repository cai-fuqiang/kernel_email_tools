import { describe, expect, it } from 'vitest';

import { getTagTargetActionLabels } from '../TagManager';

describe('TagManager target actions', () => {
  it('shows delete alongside open and move when removal is allowed', () => {
    expect(getTagTargetActionLabels(true)).toEqual(['Open', 'Move', 'Delete']);
  });

  it('hides delete when removal is not allowed', () => {
    expect(getTagTargetActionLabels(false)).toEqual(['Open', 'Move']);
  });
});
