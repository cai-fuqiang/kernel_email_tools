import assert from 'node:assert/strict';
import type { SearchHit } from '../../../api/types';
import { emailHitToEntity } from '../emailHit';

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    message_id: 'msg-1',
    subject: 'test subject',
    sender: 'Alice <alice@example.com>',
    date: '2026-05-01T00:00:00Z',
    list_name: 'linux-mm',
    thread_id: 'thread-1',
    has_patch: false,
    tags: [],
    score: 0.5,
    snippet: 'hello world',
    source: 'keyword',
    ...overrides,
  };
}

// case 1: normal
{
  const e = emailHitToEntity(makeHit());
  assert.equal(e.kind, 'email_thread');
  assert.equal(e.id, 'email_thread:thread-1:msg-1');
  assert.equal(e.target.type, 'email_thread');
  assert.equal(e.target.ref, 'thread-1');
  assert.equal(e.title, 'test subject');
  assert.ok(e.subtitle?.includes('Alice'));
  assert.ok(e.subtitle?.includes('linux-mm'));
  assert.equal(e.excerpt, 'hello world');
}

// case 2: patch + multiple tags（>3 折叠）
{
  const e = emailHitToEntity(makeHit({ has_patch: true, tags: ['a', 'b', 'c', 'd', 'e'] }));
  const labels = e.badges.map((b) => b.label);
  assert.ok(labels.includes('PATCH'));
  assert.ok(labels.includes('a'));
  assert.ok(labels.includes('+2'));
}

// case 3: 缺字段兜底
{
  const e = emailHitToEntity(makeHit({ subject: '', sender: '', date: '', thread_id: '', snippet: '' }));
  assert.equal(e.title, '(no subject)');
  assert.equal(e.target.ref, 'msg-1'); // thread_id 缺 → message_id 回退
  assert.equal(e.excerpt, undefined);
}

// case 4: 邮件没有 list_name 时 subtitle 不含空分隔
{
  const e = emailHitToEntity(makeHit({ list_name: '', date: '' }));
  assert.ok(!e.subtitle?.includes(' · ·'));
  assert.ok(e.subtitle?.length);
}

// eslint-disable-next-line no-console
console.log('✓ emailHit adapter tests passed');