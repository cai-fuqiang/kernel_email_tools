/**
 * Kernel source path detection for email body text.
 *
 * 用于在 ThreadDrawer 邮件正文中识别形如 `mm/vmscan.c`, `fs/ext4/inode.c:1234`,
 * `include/linux/sched.h` 的内核路径，并把它们渲染为可点击外链
 * （Elixir Bootlin / git.kernel.org）。
 *
 * 设计目标：
 * - 宁可漏报不可误报：只匹配以已知内核顶级目录开头的路径
 * - 支持 `:line` 后缀（path:1234）
 * - 支持 PATCH 头部 `--- a/path`、`+++ b/path` 的 `a/` / `b/` 前缀剥离
 *
 * 参考 PLAN-30002 Phase 3。
 */

// Linux 内核根目录下的常见顶级目录。匹配路径必须以这些之一开头才被视为内核路径，
// 避免把诸如 `foo/bar.txt`、`docs/readme.md` 之类的相对路径误识别为内核源码。
const KERNEL_TOP_DIRS = [
  'arch',
  'block',
  'certs',
  'crypto',
  'Documentation',
  'drivers',
  'fs',
  'include',
  'init',
  'io_uring',
  'ipc',
  'kernel',
  'lib',
  'LICENSES',
  'mm',
  'net',
  'rust',
  'samples',
  'scripts',
  'security',
  'sound',
  'tools',
  'usr',
  'virt',
] as const;

const TOP_DIR_PATTERN = KERNEL_TOP_DIRS.join('|');

/**
 * 匹配内核路径的正则。
 *
 * 组成:
 * - (?:^|[^\w./-])  path 前边界，避免把 `foo/arch/x86` 中的 `arch/x86` 切出来
 * - ( TOP_DIR/[a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+ )   完整路径（至少一个斜杠，至少一个扩展名）
 * - (?:[:#](\d+))?  可选的 :行号 或 #行号
 *
 * 使用 `g` flag 支持多次匹配。
 */
const KERNEL_PATH_REGEX = new RegExp(
  `(?:^|[^\\w./-])((?:${TOP_DIR_PATTERN})/[a-zA-Z0-9_./\\-]+?\\.[a-zA-Z0-9]{1,6})(?:[:#](\\d+))?(?=[^\\w./-]|$)`,
  'g',
);

export interface KernelPathRef {
  /** 识别出的原始子串（用于 replace 渲染） */
  raw: string;
  /** 路径部分（不含行号）*/
  path: string;
  /** 可选的行号 */
  line?: number;
  /** 在原文中的起始 offset */
  start: number;
  /** 在原文中的结束 offset（不含）*/
  end: number;
}

/**
 * 判断字符串是否形如内核源码路径（完整匹配模式，用于 PATCH 头部）。
 *
 * 例如 `mm/vmscan.c`、`include/linux/sched.h` 返回 true；
 * `foo/bar.txt`、`README` 返回 false。
 */
export function isKernelPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return false;
  const firstSlash = trimmed.indexOf('/');
  if (firstSlash < 0) return false;
  const topDir = trimmed.slice(0, firstSlash);
  if (!(KERNEL_TOP_DIRS as readonly string[]).includes(topDir)) return false;
  // 必须含扩展名或至少两级目录
  return /\.[a-zA-Z0-9]{1,6}$/.test(trimmed) || trimmed.split('/').length >= 3;
}

/**
 * 在文本中找出所有内核路径引用。
 *
 * @example
 *   parseKernelPathRefs('See mm/vmscan.c:1234 for details.')
 *   // -> [{ raw: 'mm/vmscan.c:1234', path: 'mm/vmscan.c', line: 1234, start: 4, end: 20 }]
 */
export function parseKernelPathRefs(text: string): KernelPathRef[] {
  if (!text) return [];
  const refs: KernelPathRef[] = [];
  const regex = new RegExp(KERNEL_PATH_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const fullMatch = match[0];
    const path = match[1];
    const lineStr = match[2];
    // 找到路径在 fullMatch 中的真实起点（跳过前边界字符）
    const prefixOffset = fullMatch.indexOf(path);
    const start = match.index + prefixOffset;
    const rawLen = lineStr ? path.length + 1 + lineStr.length : path.length;
    refs.push({
      raw: text.slice(start, start + rawLen),
      path,
      line: lineStr ? Number(lineStr) : undefined,
      start,
      end: start + rawLen,
    });
  }
  return refs;
}

/**
 * 从 PATCH 行（`--- a/...` 或 `+++ b/...`）中提取内核路径。
 *
 * - 剥离 `a/` / `b/` 前缀
 * - 处理 `/dev/null`（返回 null）
 * - 剥离 tab 之后的可能 timestamp（旧 diff 格式）
 *
 * @returns 内核路径字符串，或 null 表示该行不是有效路径行
 */
export function extractPatchHeaderPath(line: string): string | null {
  const m = line.match(/^(?:---|\+\+\+)\s+([^\t\n]+)/);
  if (!m) return null;
  let path = m[1].trim();
  if (path === '/dev/null') return null;
  // 剥离 a/ b/ 前缀
  if (path.startsWith('a/') || path.startsWith('b/')) {
    path = path.slice(2);
  }
  if (!path) return null;
  return path;
}

/**
 * 从邮件主题中提取 PATCH 版本号，如 `[PATCH v6.10]`、`[PATCH v3 1/4]`。
 *
 * @returns 版本号字符串（带 `v` 前缀），未找到返回 null
 */
export function extractPatchVersion(subject: string): string | null {
  if (!subject) return null;
  // 匹配 [PATCH ... v6.10 ...] 或 [v6.10] 形式
  const m = subject.match(/\bv(\d+\.\d+(?:\.\d+)?(?:-rc\d+)?)\b/i);
  if (m) return `v${m[1]}`;
  return null;
}