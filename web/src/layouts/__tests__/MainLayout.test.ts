import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MainLayout navigation', () => {
  it('keeps a visible tags navigation entry for tag management', () => {
    const filePath = resolve(import.meta.dirname, '..', 'MainLayout.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain("to: '/tags'");
  });

  it('exposes one Code navigation entry for source repositories', () => {
    const filePath = resolve(import.meta.dirname, '..', 'MainLayout.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source.match(/label: 'Code'/g) ?? []).toHaveLength(1);
    expect(source).toContain("to: '/kernel-code'");
    expect(source).toContain("activePrefixes: ['/code']");
    expect(source).not.toContain("label: 'Kernel Code'");
    expect(source).not.toContain("to: '/code/qemu'");
    expect(source).not.toContain("label: 'QEMU Code'");
  });
});
