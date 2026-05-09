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
//   identifier followed by (...) with a matching closing paren.
// The $ anchor and greedy [^{};]*\) ensure we match the LAST ) on the line
// (the function's parameter-list closing paren), not an intermediate call/macro.
const SIG_RE = /\b([A-Za-z_]\w*)\s*\([^{};]*\)\s*$/;

// Standalone opening brace (multi-line function body)
const OPEN_BRACE_RE = /^\s*\{\s*$/;

const DEFINE_RE = /^\s*#\s*define\s+([A-Za-z_]\w*)\b/;

/** Collect up to `maxLines` lines before `braceIdx`, joining them into one
 *  signature string. Stops early if a line ends with `;` (block statement). */
function collectLinesBefore(lines: string[], braceIdx: number, maxLines = 3): string | null {
  const parts: string[] = [];
  for (let i = braceIdx - 1; i >= Math.max(0, braceIdx - maxLines); i -= 1) {
    const trimmed = lines[i].trim();
    if (/;\s*$/.test(trimmed)) break;
    parts.unshift(trimmed);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Collect lines from `startIdx` forward until a bare `{` or `maxLines` lines.
 *  Returns the joined signature string (without the `{` line). */
function collectLinesForward(lines: string[], startIdx: number, maxLines = 4): string | null {
  const parts: string[] = [];
  for (let i = startIdx; i < Math.min(startIdx + maxLines, lines.length); i += 1) {
    const t = lines[i].trim();
    if (OPEN_BRACE_RE.test(t)) break;
    if (/;\s*$/.test(t)) return null; // statement, not a function sig
    parts.push(t);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Check whether a bare `{` (on its own line) appears within `lookAhead` lines
 *  after `lineIdx`. Returns true if found before any other non-empty line. */
function braceFollowsSoon(lines: string[], lineIdx: number, lookAhead = 2): boolean {
  for (let i = lineIdx + 1; i < Math.min(lineIdx + 1 + lookAhead, lines.length); i += 1) {
    const t = lines[i].trim();
    if (OPEN_BRACE_RE.test(t)) return true;
    if (t !== '') return false; // non-empty, non-brace line → bail
  }
  return false;
}

function tryMatchSignature(joined: string): string | null {
  const m = joined.match(SIG_RE);
  return m?.[1] && !CONTROL_KEYWORDS.has(m[1]) ? m[1] : null;
}

export function detectNearestSymbol(lines: string[], focusLine: number | null): string | null {
  if (!focusLine || focusLine < 1) return null;

  for (let idx = Math.min(focusLine, lines.length - 1); idx >= 0; idx -= 1) {
    const line = lines[idx].trim();

    // 1) Single-line definition: name(params) ... {
    for (const match of line.matchAll(FN_DEF_RE)) {
      const name = match[1];
      if (!CONTROL_KEYWORDS.has(name)) return name;
    }

    // 2) Multi-line: standalone { — collect preceding lines backward
    if (OPEN_BRACE_RE.test(line)) {
      const joined = collectLinesBefore(lines, idx);
      if (joined) {
        const name = tryMatchSignature(joined);
        if (name) return name;
      }
    }

    // 3) Complete signature on one line (has both ( and )) + { follows
    const sigMatch = line.match(SIG_RE);
    if (sigMatch?.[1] && !CONTROL_KEYWORDS.has(sigMatch[1])) {
      const prefix = line.slice(0, sigMatch.index);
      if (!/[=,]\s*$/.test(prefix) && braceFollowsSoon(lines, idx)) {
        return sigMatch[1];
      }
    }

    // 4) Start of split signature: line has ( but no ) and no {.
    //    The function name is on this line but the closing paren and
    //    opening brace are below.  E.g.:
    //      int dpll_pre_doit(const struct genl_split_ops *ops, ...
    //                        struct genl_info *info)
    //      {
    if (line.includes('(') && !line.includes(')') && !/\{\s*$/.test(line)) {
      const joined = collectLinesForward(lines, idx);
      if (joined) {
        const name = tryMatchSignature(joined);
        if (name) return name;
      }
    }

    // 5) #define macro
    const defineMatch = line.match(DEFINE_RE);
    if (defineMatch?.[1]) return defineMatch[1];
  }

  return null;
}
