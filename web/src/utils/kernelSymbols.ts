const CONTROL_KEYWORDS = new Set([
  'if',
  'while',
  'for',
  'switch',
  '__attribute__',
]);

// Single-line function definition: name(params) ... {
const FN_DEF_RE = /\b([A-Za-z_]\w*)\s*\([^{};]*\)[^{};]*\{/g;

// Function signature (without the opening brace):
//   identifier followed by (...) with a matching closing paren
// The $ anchor and greedy [^{};]*\) ensure we match the LAST ) on the line
// (the function's parameter-list closing paren), not an intermediate call/macro.
const SIG_RE = /\b([A-Za-z_]\w*)\s*\([^{};]*\)\s*$/;

// Standalone opening brace (multi-line function body)
const OPEN_BRACE_RE = /^\s*\{\s*$/;

const DEFINE_RE = /^\s*#\s*define\s+([A-Za-z_]\w*)\b/;

/** Collect up to `maxLines` lines before `braceIdx`, joining them into one
 *  signature string. Stops early if a line ends with `;` (block statement). */
function collectSignatureLines(
  lines: string[],
  braceIdx: number,
  maxLines = 3,
): string | null {
  const parts: string[] = [];
  for (let i = braceIdx - 1; i >= Math.max(0, braceIdx - maxLines); i -= 1) {
    const trimmed = lines[i].trim();
    if (/;\s*$/.test(trimmed)) break;
    parts.unshift(trimmed);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

export function detectNearestSymbol(lines: string[], focusLine: number | null): string | null {
  if (!focusLine || focusLine < 1) return null;

  for (let idx = Math.min(focusLine - 1, lines.length - 1); idx >= 0; idx -= 1) {
    const line = lines[idx].trim();

    // 1) Single-line definition: name(params) ... {
    for (const match of line.matchAll(FN_DEF_RE)) {
      const name = match[1];
      if (!CONTROL_KEYWORDS.has(name)) return name;
    }

    // 2) Multi-line definition: standalone { — collect preceding lines
    //    into a single signature string and match against that.
    if (OPEN_BRACE_RE.test(line)) {
      const joined = collectSignatureLines(lines, idx);
      if (joined) {
        const m = joined.match(SIG_RE);
        if (m?.[1] && !CONTROL_KEYWORDS.has(m[1])) return m[1];
      }
    }

    // 3) #define macro
    const defineMatch = line.match(DEFINE_RE);
    if (defineMatch?.[1]) return defineMatch[1];
  }

  return null;
}
