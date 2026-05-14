import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MainLayout navigation', () => {
  it('keeps a visible tags navigation entry for tag management', () => {
    const filePath = resolve(import.meta.dirname, '..', 'MainLayout.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain("to: '/tags'");
  });
});
