import { describe, expect, it } from 'vitest';
import { detectNearestSymbol } from '../kernelSymbols';

function lines(src: string): string[] {
  return src.split('\n');
}

describe('detectNearestSymbol', () => {
  it('returns null when focusLine is null or 0', () => {
    expect(detectNearestSymbol(['int foo(int x) {'], null)).toBeNull();
    expect(detectNearestSymbol(['int foo(int x) {'], 0)).toBeNull();
  });

  it('detects a simple function definition', () => {
    expect(detectNearestSymbol(lines('int foo(int x) {'), 1)).toBe('foo');
  });

  it('detects function with pointer return type', () => {
    expect(detectNearestSymbol(lines('struct foo *bar(int arg) {'), 1)).toBe('bar');
  });

  it('detects function with a star directly before the name', () => {
    expect(detectNearestSymbol(lines('int *baz(int x) {'), 1)).toBe('baz');
  });

  it('detects function with multi-word return type', () => {
    expect(detectNearestSymbol(lines('unsigned long long bar(int x) {'), 1)).toBe('bar');
  });

  it('detects static inline function', () => {
    expect(detectNearestSymbol(lines('static inline int foo(int x) {'), 1)).toBe('foo');
  });

  it('detects function with __attribute__ after params', () => {
    expect(
      detectNearestSymbol(lines('static int __init foo_init(void) __attribute__((cold)) {'), 1),
    ).toBe('foo_init');
  });

  it('detects function with nested parentheses in params', () => {
    expect(detectNearestSymbol(lines('void foo(int (*cb)(int)) {'), 1)).toBe('foo');
  });

  it('detects function with body on the same line', () => {
    expect(detectNearestSymbol(lines('int foo(int x) { return x; }'), 1)).toBe('foo');
  });

  it('filters out if keyword', () => {
    const src = lines('void foo(int x) {\n  if (x > 0) {\n    bar(x);\n  }\n}');
    expect(detectNearestSymbol(src, 3)).toBe('foo');
  });

  it('filters out while keyword', () => {
    const src = lines('void foo(int x) {\n  while (x > 0) {\n    bar(x);\n  }\n}');
    expect(detectNearestSymbol(src, 3)).toBe('foo');
  });

  it('filters out for keyword', () => {
    const src = lines('void foo(int x) {\n  for (int i = 0; i < 10; i++) {\n    bar(i);\n  }\n}');
    expect(detectNearestSymbol(src, 3)).toBe('foo');
  });

  it('filters out switch keyword', () => {
    const src = lines('void foo(int x) {\n  switch (x) {\n  case 0:\n    bar();\n  }\n}');
    expect(detectNearestSymbol(src, 3)).toBe('foo');
  });

  it('does not match function declarations (no body)', () => {
    expect(detectNearestSymbol(lines('int foo(int x);'), 1)).toBeNull();
  });

  it('walks backwards from focusLine to find containing function', () => {
    const src = lines(
      'int foo(int x) {\n  int a = 1;\n  int b = 2;\n  return a + b;\n}',
    );
    // focusLine is on "return a + b" (line 4)
    expect(detectNearestSymbol(src, 4)).toBe('foo');
  });

  it('detects #define macro', () => {
    expect(detectNearestSymbol(lines('#define FOO 42'), 1)).toBe('FOO');
  });

  it('does not match function-like macros as function definitions', () => {
    // function-like macros don't end with {, so FN_DEF_RE won't match,
    // but #define should still catch them
    expect(detectNearestSymbol(lines('#define FOO(x) ((x) + 1)'), 1)).toBe('FOO');
  });

  it('returns first containing function when walking back', () => {
    const src = lines(
      'int outer(void) {\n  int inner(void) {\n    return 1;\n  }\n  return inner();\n}',
    );
    // focusLine inside inner()
    expect(detectNearestSymbol(src, 3)).toBe('inner');
    // Scan is brace-unaware: after inner's closing brace, still finds inner first.
    expect(detectNearestSymbol(src, 5)).toBe('inner');
  });

  it('returns null when no function or define found', () => {
    expect(detectNearestSymbol(lines('int x = 42;'), 1)).toBeNull();
    expect(detectNearestSymbol(lines(''), 1)).toBeNull();
  });
});
