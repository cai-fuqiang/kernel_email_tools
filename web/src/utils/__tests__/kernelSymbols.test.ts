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

  it('detects function with brace on next line (multi-line)', () => {
    const src = lines('static int foo(int x)\n{\n  return x;\n}');
    expect(detectNearestSymbol(src, 2)).toBe('foo');
    expect(detectNearestSymbol(src, 3)).toBe('foo');
  });

  it('detects function with attrs on separate line before brace', () => {
    const src = lines('static int __init foo_init(void)\n__attribute__((cold))\n{\n  return 0;\n}');
    expect(detectNearestSymbol(src, 3)).toBe('foo_init');
  });

  it('handles multi-line signature spanning 2 lines (prev_badblocks pattern)', () => {
    const src = lines(
      'static int prev_badblocks(struct badblocks *bb, struct badblocks_context *bad,\n' +
      '                          int hint)\n' +
      '{\n' +
      '  sector_t s = bad->start;\n' +
      '}',
    );
    expect(detectNearestSymbol(src, 3)).toBe('prev_badblocks');
    expect(detectNearestSymbol(src, 4)).toBe('prev_badblocks');
  });

  it('finds the function at focusLine itself (own definition, single-line)', () => {
    // focusLine is the line defining B — should return B, not the function above it
    const src = lines('static int A(void) { return 0; }\nstatic int B(int x) { return x; }');
    expect(detectNearestSymbol(src, 2)).toBe('B');
  });

  it('finds the function at focusLine itself (own definition, multi-line)', () => {
    // focusLine is the signature line, { on next line
    const src = lines('static int A(void) { return 0; }\nstatic int B(int x)\n{\n  return x;\n}');
    expect(detectNearestSymbol(src, 2)).toBe('B');
    expect(detectNearestSymbol(src, 3)).toBe('B');
  });

  it('finds function when focusLine is on split-signature first line (dpll_pre_doit pattern)', () => {
    // Signature split across 2 lines, { on 3rd line, focusLine on the FIRST signature line
    const src = lines(
      'static int dpll_nl_device_get_dumpit(struct sk_buff *skb, struct netlink_callback *cb)\n' +
      '{\n' +
      '  return 0;\n' +
      '}\n' +
      '\n' +
      'int dpll_pre_doit(const struct genl_split_ops *ops, struct sk_buff *skb,\n' +
      '                  struct genl_info *info)\n' +
      '{\n' +
      '  return 0;\n' +
      '}\n',
    );
    expect(detectNearestSymbol(src, 6)).toBe('dpll_pre_doit');
    expect(detectNearestSymbol(src, 7)).toBe('dpll_pre_doit');
    expect(detectNearestSymbol(src, 8)).toBe('dpll_pre_doit');
  });

  it('does not confuse if/while/for with standalone brace', () => {
    const src = lines('void foo(void)\n{\n  if (x)\n  {\n    bar();\n  }\n}');
    expect(detectNearestSymbol(src, 4)).toBe('foo');
  });

  it('returns null when no function or define found', () => {
    expect(detectNearestSymbol(lines('int x = 42;'), 1)).toBeNull();
    expect(detectNearestSymbol(lines(''), 1)).toBeNull();
  });
});
