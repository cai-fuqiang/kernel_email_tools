const CONTROL_KEYWORDS = new Set([
  'if',
  'while',
  'for',
  'switch',
]);

// Matches C function definitions of the form:
//   [return_type] name(params) [attrs] {
// Uses \b to walk past multi-word return types and pointer stars.
// Control-flow keywords are filtered to avoid matching if/while/for/switch.
const FN_DEF_RE = /\b([A-Za-z_]\w*)\s*\([^{};]*\)[^{};]*\{/g;
const DEFINE_RE = /^\s*#\s*define\s+([A-Za-z_]\w*)\b/;

export function detectNearestSymbol(lines: string[], focusLine: number | null): string | null {
  if (!focusLine || focusLine < 1) return null;

  for (let idx = Math.min(focusLine - 1, lines.length - 1); idx >= 0; idx -= 1) {
    const line = lines[idx].trim();

    for (const match of line.matchAll(FN_DEF_RE)) {
      const name = match[1];
      if (!CONTROL_KEYWORDS.has(name)) return name;
    }

    const defineMatch = line.match(DEFINE_RE);
    if (defineMatch?.[1]) return defineMatch[1];
  }

  return null;
}
