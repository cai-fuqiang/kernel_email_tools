import { describe, expect, it } from 'vitest';

import { clampRequestedLine } from '../KernelCodePage';

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
