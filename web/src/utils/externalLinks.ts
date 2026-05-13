/**
 * External code / mailing-list link builders.
 *
 * PLAN-30002 已调整为 local-first code resolver：代码阅读主路径优先走
 * 本系统 Code Browser，Elixir / git.kernel.org 作为 fallback 外链。
 * 本模块保留外链 URL 拼接和本地 Code Browser URL 拼接，避免硬编码散落。
 *
 * 内网部署可通过 `/api/system/config` 暴露的 `external_links` 配置覆盖默认 base URL。
 */

// ============================================================================
// Default base URLs
// ============================================================================

const DEFAULT_ELIXIR_BASE = 'https://elixir.bootlin.com/linux';
const DEFAULT_GIT_BASE =
  'https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git';
const DEFAULT_LORE_BASE = 'https://lore.kernel.org/all';

export interface ExternalLinksConfig {
  elixir_base?: string;
  git_base?: string;
  lore_base?: string;
}

let configOverride: ExternalLinksConfig = {};

/**
 * 由前端启动流程在拿到 `/api/system/config` 后调用，注入运行时基地址。
 * 若未调用则全部走默认 base。
 */
export function setExternalLinksConfig(cfg: ExternalLinksConfig): void {
  configOverride = { ...cfg };
}

function elixirBase(): string {
  return (configOverride.elixir_base || DEFAULT_ELIXIR_BASE).replace(/\/+$/, '');
}

function gitBase(): string {
  return (configOverride.git_base || DEFAULT_GIT_BASE).replace(/\/+$/, '');
}

function loreBase(): string {
  return (configOverride.lore_base || DEFAULT_LORE_BASE).replace(/\/+$/, '');
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * 对路径中的每段进行 encodeURIComponent，但保留 `/` 分隔符。
 * 用于构造形如 `mm/vmscan.c` 的内核路径。
 */
function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

/**
 * 构建本系统 Code Browser URL。BrowserRouter 使用 `/app` basename，
 * 所以普通 anchor 需要带 `/app/kernel-code` 前缀。
 */
export function localKernelCodeUrl(
  version: string,
  filePath: string,
  line?: number,
): string {
  return `/app${kernelCodePath(version, filePath, line)}`;
}

/**
 * 构建 Code Browser 路径，供 react-router navigate 使用。
 */
export function kernelCodePath(
  version: string,
  filePath: string,
  line?: number,
): string {
  const params = new URLSearchParams();
  params.set('v', version);
  params.set('path', filePath);
  if (line && line > 0) params.set('line', String(line));
  return `/kernel-code?${params.toString()}`;
}

/**
 * 构建内置符号预览页 URL。
 */
export function kernelSymbolPreviewPath(
  version: string,
  filePath: string,
  line?: number,
  symbol?: string,
): string {
  const params = new URLSearchParams();
  params.set('v', version);
  params.set('path', filePath);
  if (line && line > 0) params.set('line', String(line));
  if (symbol) params.set('symbol', symbol);
  return `/kernel-code/preview?${params.toString()}`;
}

/**
 * 构建内置符号预览页的绝对链接。
 */
export function localKernelSymbolPreviewUrl(
  version: string,
  filePath: string,
  line?: number,
  symbol?: string,
): string {
  return `/app${kernelSymbolPreviewPath(version, filePath, line, symbol)}`;
}

/**
 * 构建内置代码批注预览页 URL。
 */
export function kernelAnnotationPreviewPath(
  version: string,
  filePath: string,
  annotationId: string,
): string {
  const params = new URLSearchParams();
  params.set('v', version);
  params.set('path', filePath);
  params.set('annotation', annotationId);
  return `/kernel-code/annotation-preview?${params.toString()}`;
}

/**
 * 构建内置代码批注预览页的绝对链接。
 */
export function localKernelAnnotationPreviewUrl(
  version: string,
  filePath: string,
  annotationId: string,
): string {
  return `/app${kernelAnnotationPreviewPath(version, filePath, annotationId)}`;
}

/**
 * 判断 Elixir 是否覆盖给定版本。Elixir 通常覆盖 v2.6.12 及以后的 release/rc tag，
 * 也支持 `latest` / `master`。对于过旧或异常 tag 我们 fallback 到 git.kernel.org。
 *
 * 该函数使用启发式判断，宁可放过也不漏报：只有明显不被支持的旧版本才返回 false。
 */
export function elixirSupportsVersion(version: string): boolean {
  if (!version) return false;
  const v = version.trim();
  if (v === 'latest' || v === 'master') return true;
  // v2.6.12+ 是 Elixir 支持的下限
  const m = v.match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return true; // 未知格式，默认尝试 Elixir
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] ? Number(m[3]) : 0;
  if (major < 2) return false;
  if (major === 2 && minor < 6) return false;
  if (major === 2 && minor === 6 && patch < 12) return false;
  return true;
}

// ============================================================================
// Elixir Bootlin
// ============================================================================

/**
 * 构建 Elixir Bootlin 源码浏览 URL。
 *
 * @example
 *   elixirSourceUrl('v6.8', 'mm/vmscan.c')
 *   // -> 'https://elixir.bootlin.com/linux/v6.8/source/mm/vmscan.c'
 *   elixirSourceUrl('v6.8', 'mm/vmscan.c', 1234)
 *   // -> 'https://elixir.bootlin.com/linux/v6.8/source/mm/vmscan.c#L1234'
 */
export function elixirSourceUrl(
  version: string,
  filePath: string,
  line?: number,
): string {
  const v = encodeURIComponent(version);
  const p = encodePath(filePath);
  let url = `${elixirBase()}/${v}/source/${p}`;
  if (line && line > 0) url += `#L${line}`;
  return url;
}

/**
 * 构建 Elixir 符号搜索 URL（identifier search）。
 *
 * @example
 *   elixirIdentUrl('v6.8', 'shrink_node')
 *   // -> 'https://elixir.bootlin.com/linux/v6.8/ident/shrink_node'
 */
export function elixirIdentUrl(version: string, symbol: string): string {
  const v = encodeURIComponent(version);
  const s = encodeURIComponent(symbol);
  return `${elixirBase()}/${v}/ident/${s}`;
}

/**
 * 判断字符串是否为合法的 C 标识符（可作为 Elixir ident 搜索关键词）。
 *
 * 规则：首字符必须是字母或下划线，后续可以是字母/数字/下划线，长度 2~128。
 * 单字符标识符和过长文本一律排除（降低误触发率）。
 */
export function isLikelyCIdentifier(text: string): boolean {
  if (!text) return false;
  const s = text.trim();
  if (s.length < 2 || s.length > 128) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

// ============================================================================
// git.kernel.org fallback
// ============================================================================

/**
 * 构建 git.kernel.org cgit 源码 URL，作为 Elixir 不覆盖版本的 fallback。
 *
 * @example
 *   gitKernelOrgUrl('v6.8', 'mm/vmscan.c', 1234)
 *   // -> 'https://git.kernel.org/.../tree/mm/vmscan.c?h=v6.8#n1234'
 */
export function gitKernelOrgUrl(
  version: string,
  filePath: string,
  line?: number,
): string {
  const p = encodePath(filePath);
  const h = encodeURIComponent(version);
  let url = `${gitBase()}/tree/${p}?h=${h}`;
  if (line && line > 0) url += `#n${line}`;
  return url;
}

// ============================================================================
// Smart picker
// ============================================================================

export interface PickedKernelLink {
  url: string;
  source: 'elixir' | 'git.kernel.org';
}

/**
 * 根据版本自动选择合适的源码浏览站点。Elixir 覆盖时优先 Elixir，
 * 否则 fallback 到 git.kernel.org。
 */
export function pickKernelSourceUrl(
  version: string,
  filePath: string,
  line?: number,
): PickedKernelLink {
  if (elixirSupportsVersion(version)) {
    return { url: elixirSourceUrl(version, filePath, line), source: 'elixir' };
  }
  return { url: gitKernelOrgUrl(version, filePath, line), source: 'git.kernel.org' };
}

// ============================================================================
// lore.kernel.org
// ============================================================================

/**
 * 构建 lore.kernel.org 邮件原文 URL。
 *
 * Message-ID 不带尖括号，需要 URL 编码。
 *
 * @example
 *   loreUrl('20240101.123456@example.com')
 *   // -> 'https://lore.kernel.org/all/20240101.123456%40example.com/'
 */
export function loreUrl(messageId: string): string {
  const cleaned = messageId.replace(/^<+|>+$/g, '').trim();
  if (!cleaned) return loreBase();
  return `${loreBase()}/${encodeURIComponent(cleaned)}/`;
}
