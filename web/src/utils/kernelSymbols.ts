const CONTROL_KEYWORDS = new Set([
  'if',
  'while',
  'for',
  'switch',
  '__attribute__',
]);

// Single-line function definition: name(params) ... {
const FN_DEF_RE = /\b([A-Za-z_]\w*)\s*\([^{};]*\)[^{};]*\{/g;

// Function signature ending a line (no { on same line):
//   static int foo(int x)
const SIG_RE = /\b([A-Za-z_]\w*)\s*\([^{};]*\)\s*$/;

// Standalone opening brace (multi-line function body)
const OPEN_BRACE_RE = /^\s*\{\s*$/;

const DEFINE_RE = /^\s*#\s*define\s+([A-Za-z_]\w*)\b/;

export function detectNearestSymbol(lines: string[], focusLine: number | null): string | null {
  if (!focusLine || focusLine < 1) return null;

  for (let idx = Math.min(focusLine - 1, lines.length - 1); idx >= 0; idx -= 1) {
    const line = lines[idx].trim();

    // 1) Single-line definition: name(params) ... {
    for (const match of line.matchAll(FN_DEF_RE)) {
      const name = match[1];
      if (!CONTROL_KEYWORDS.has(name)) return name;
    }

    // 2) Multi-line definition: standalone { followed by signature on previous lines
    if (OPEN_BRACE_RE.test(line)) {
      for (let sigIdx = idx - 1; sigIdx >= Math.max(0, idx - 3); sigIdx -= 1) {
        const sigLine = lines[sigIdx].trim();
        // A semicolon at end of line means the { belongs to a block, not a function definition
        if (/;\s*$/.test(sigLine)) break;
        const sigMatch = sigLine.match(SIG_RE);
        if (sigMatch?.[1] && !CONTROL_KEYWORDS.has(sigMatch[1])) {
          return sigMatch[1];
        }
      }
    }

    // 3) #define macro
    const defineMatch = line.match(DEFINE_RE);
    if (defineMatch?.[1]) return defineMatch[1];
  }

  return null;
}
