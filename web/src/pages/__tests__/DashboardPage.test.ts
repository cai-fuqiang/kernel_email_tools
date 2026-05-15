import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DashboardPage admin approvals tile', () => {
  it('matches the annotation review destination by counting pending annotations only', () => {
    const filePath = resolve(import.meta.dirname, '..', 'DashboardPage.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain('value={pendingAnnotations.length}');
    expect(source).toContain('hint="Pending annotations awaiting review"');
  });
});
