import assert from 'node:assert/strict';
import type { TagTree } from '../../../api/types';
import { flattenTagTreeToEntities, tagToEntity } from '../tag';

function makeTag(overrides: Partial<TagTree> = {}): TagTree {
  return {
    id: 1,
    slug: 'kasan',
    name: 'kasan',
    description: 'Kernel Address Sanitizer',
    color: '#f97316',
    status: 'active',
    tag_kind: 'general',
    visibility: 'public',
    assignment_count: 28,
    children: [],
    ...overrides,
  };
}

// case 1: 普通 tag
{
  const e = tagToEntity(makeTag());
  assert.equal(e.kind, 'tag');
  assert.equal(e.id, 'tag:kasan');
  assert.equal(e.target.type, 'tag');
  assert.equal(e.target.ref, 'kasan');
  assert.equal(e.title, 'kasan');
  assert.equal(e.excerpt, 'Kernel Address Sanitizer');
  assert.ok(e.subtitle?.includes('28 targets'));
  assert.ok(e.badges.some((b) => b.label === 'public'));
  assert.ok(e.counts?.some((c) => c.label === 'targets' && c.value === 28));
}

// case 2: 有子节点
{
  const parent = makeTag({
    slug: 'memory-safety',
    name: 'memory-safety',
    children: [makeTag(), makeTag({ slug: 'ubsan', name: 'ubsan', assignment_count: 11 })],
  });
  const e = tagToEntity(parent);
  assert.ok(e.subtitle?.includes('2 children'));
}

// case 3: 非 active status
{
  const e = tagToEntity(makeTag({ status: 'deprecated' }));
  assert.ok(e.badges.some((b) => b.label === 'deprecated'));
}

// case 4: flatten 递归
{
  const tree = [
    makeTag({ slug: 'root', name: 'root', children: [makeTag({ slug: 'leaf1', name: 'leaf1' })] }),
    makeTag({ slug: 'other', name: 'other' }),
  ];
  const flat = flattenTagTreeToEntities(tree);
  assert.equal(flat.length, 3);
  assert.deepEqual(flat.map((x) => x.id), ['tag:root', 'tag:leaf1', 'tag:other']);
}

// eslint-disable-next-line no-console
console.log('✓ tag adapter tests passed');