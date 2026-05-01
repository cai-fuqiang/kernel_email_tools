import type { ThreadEmail } from '../api/types';

/** 段落块：原文段落 + 类型标记（普通文本 / 引用） */
export type ParagraphBlock = {
  text: string;
  type: 'normal' | 'quoted';
};

/** 从 "Name <email>" 形式的发件人字符串提取人名部分 */
export function getAuthorName(sender: string): string {
  const match = sender.match(/^([^<]+)/);
  return match ? match[1].trim() : sender;
}

/** 判断一行是否为引用行（以 `>` 开头） */
export function isQuotedLine(line: string): boolean {
  return /^\s*>/.test(line);
}

/**
 * 从 body_raw 中剔除 diff/patch 块和签名（`-- ` 之后），保留引用行。
 *
 * - 检测 `diff --git`、`diff --cc`、`--- a/x` + `+++ b/x` 起始的 diff 块，全部跳过
 * - 检测 unified diff 起始（`---` + `+++`）也跳过
 * - 签名分隔符 `-- ` 之后的内容全部丢弃
 */
export function stripDiffAndSignature(bodyRaw: string): string {
  if (!bodyRaw) return '';
  const lines = bodyRaw.split('\n');
  const result: string[] = [];
  let inDiff = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 签名分隔符 —— 后面全部丢弃
    if (trimmed === '-- ' || trimmed === '--') {
      // 检查是否真是签名（不是 diff 的 -- ）
      // 如果前面不在 diff 中且后面不是 +++ 开头则视为签名
      if (!inDiff) {
        break;
      }
    }

    // 检测 diff 块起始
    if (trimmed.startsWith('diff --git ') ||
        trimmed.startsWith('diff --cc ') ||
        (trimmed.startsWith('--- a/') && i + 1 < lines.length && lines[i + 1].trim().startsWith('+++ b/'))) {
      inDiff = true;
    }

    // 也检测 unified diff 起始（--- / +++ 配对但不是 diff --git 格式）
    if (!inDiff && trimmed.match(/^---\s+\S/) && i + 1 < lines.length && lines[i + 1].trim().match(/^\+\+\+\s+\S/)) {
      inDiff = true;
    }

    if (inDiff) {
      // diff 行全部跳过
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * 将处理后的正文拆分为段落块（普通文本 / 引用）。
 *
 * - 按空行分段
 * - 纯引用段落 → `quoted` 类型
 * - 混合段落按连续行类型自动拆分为多个子块
 */
export function parseParagraphs(body: string): ParagraphBlock[] {
  if (!body) return [];
  // 按空行分段
  const rawParagraphs = body.split(/\n\n+/).filter(p => p.trim());
  const blocks: ParagraphBlock[] = [];

  for (const para of rawParagraphs) {
    const lines = para.split('\n');

    // 检查整个段落是否全部为引用行
    const allQuoted = lines.every(l => isQuotedLine(l) || !l.trim());
    if (allQuoted && lines.some(l => l.trim())) {
      blocks.push({ text: para, type: 'quoted' });
      continue;
    }

    // 整段都是普通文本
    const anyQuoted = lines.some(l => isQuotedLine(l));
    if (!anyQuoted) {
      blocks.push({ text: para, type: 'normal' });
      continue;
    }

    // 混合段落：按连续行类型拆分
    let currentLines: string[] = [];
    let currentType: 'normal' | 'quoted' = 'normal';

    const flushCurrent = () => {
      const text = currentLines.join('\n');
      if (text.trim()) blocks.push({ text, type: currentType });
      currentLines = [];
    };

    for (const line of lines) {
      const lineType: 'normal' | 'quoted' = isQuotedLine(line) ? 'quoted' : 'normal';
      if (lineType !== currentType && currentLines.length > 0) {
        flushCurrent();
      }
      currentType = lineType;
      currentLines.push(line);
    }
    flushCurrent();
  }

  return blocks;
}

/**
 * 判断段落是否需要翻译。
 *
 * - 引用块（quoted）→ 不翻译
 * - 含中文 → 不翻译
 * - 元数据行（Signed-off-by / Reviewed-by / Cc 等超过 80%）→ 不翻译
 * - 其余 normal 类型 → 翻译
 */
export function shouldTranslate(block: ParagraphBlock): boolean {
  // 引用块不翻译
  if (block.type === 'quoted') return false;
  const text = block.text;
  if (!text || /[一-译]/.test(text)) return false;
  const lines = text.split('\n');
  if (lines.length === 0) return false;
  const nonEmptyLines = lines.filter(l => l.trim());
  const skipLines = nonEmptyLines.filter(l => {
    const t = l.trim();
    return t.startsWith('Signed-off-by:') ||
      t.startsWith('Reviewed-by:') ||
      t.startsWith('Acked-by:') ||
      t.startsWith('Tested-by:') ||
      t.startsWith('Cc:') ||
      t.startsWith('Link:');
  });
  return skipLines.length < nonEmptyLines.length * 0.8 && nonEmptyLines.length > 0;
}

/**
 * 从邮件获取用于展示的正文。
 *
 * 优先使用 `body_raw`（保留引用行），再去除 diff 和签名；
 * 若 `body_raw` 为空，回退到 `body`（已清洗）。
 */
export function getDisplayBody(email: ThreadEmail): string {
  if (email.body_raw) {
    return stripDiffAndSignature(email.body_raw);
  }
  return email.body || '';
}