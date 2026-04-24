import { useEffect, useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getThread, translateBatch, clearTranslationCache, createAnnotation, updateAnnotation, deleteAnnotation, exportAnnotations, importAnnotations } from '../api/client';
import type { ThreadResponse, ThreadEmail, Annotation } from '../api/types';
import EmailTagEditor from './EmailTagEditor';

// 线程节点类型（支持邮件和批注两种）
interface ThreadNode {
  email: ThreadEmail;
  children: ThreadNode[];
  depth: number;
  isAnnotation?: boolean;
  annotation?: Annotation;
}

// 构建线程树（含批注混入）
function buildThreadTree(emails: ThreadEmail[], annotations: Annotation[] = []): ThreadNode[] {
  const nodes: Map<string, ThreadNode> = new Map();
  const roots: ThreadNode[] = [];
  
  // 先创建邮件节点
  emails.forEach(email => {
    nodes.set(email.message_id, { email, children: [], depth: 0 });
  });

  // 将批注转为虚拟 ThreadNode 混入
  annotations.forEach(ann => {
    const fakeEmail: ThreadEmail = {
      id: -Math.abs(hashCode(ann.annotation_id)),  // 负数 ID 避免和真实邮件冲突
      message_id: ann.annotation_id,
      subject: '批注',
      sender: ann.author,
      date: ann.created_at,
      in_reply_to: ann.in_reply_to,
      references: [],
      has_patch: false,
      patch_content: '',
      body: ann.body,
      body_raw: '',
    };
    nodes.set(ann.annotation_id, {
      email: fakeEmail,
      children: [],
      depth: 0,
      isAnnotation: true,
      annotation: ann,
    });
  });
  
  // 构建父子关系
  nodes.forEach((node) => {
    const replyTo = node.email.in_reply_to;
    if (replyTo) {
      const parent = nodes.get(replyTo);
      if (parent) {
        parent.children.push(node);
        node.depth = parent.depth + 1;
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  });
  
  const sortChildren = (nodes: ThreadNode[]) => {
    nodes.sort((a, b) => {
      // 批注优先排在最前面
      if (a.isAnnotation && !b.isAnnotation) return -1;
      if (!a.isAnnotation && b.isAnnotation) return 1;
      // 同类型按日期升序
      const dateA = a.email.date ? new Date(a.email.date).getTime() : 0;
      const dateB = b.email.date ? new Date(b.email.date).getTime() : 0;
      return dateA - dateB;
    });
    nodes.forEach(node => sortChildren(node.children));
  };
  sortChildren(roots);
  
  const recalcDepth = (nodes: ThreadNode[], depth: number) => {
    nodes.forEach(node => {
      node.depth = depth;
      recalcDepth(node.children, depth + 1);
    });
  };
  recalcDepth(roots, 0);
  
  return roots;
}

// 简单 hash 函数用于生成批注的虚拟 ID
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function getParagraphAnchor(text: string, index: number): Record<string, unknown> {
  return {
    paragraph_index: index,
    paragraph_hash: String(hashCode(text.trim())).padStart(8, '0'),
  };
}

function getAuthorName(sender: string): string {
  const match = sender.match(/^([^<]+)/);
  return match ? match[1].trim() : sender;
}

// 段落类型标记
type ParagraphBlock = {
  text: string;
  type: 'normal' | 'quoted';
};

// 从 body_raw 中剔除 diff/patch 部分和签名，保留引用行
function stripDiffAndSignature(bodyRaw: string): string {
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

// 将处理后的正文拆分为段落块（普通文本 / 引用）
function parseParagraphs(body: string): ParagraphBlock[] {
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

function shouldTranslate(block: ParagraphBlock): boolean {
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

// 从邮件获取用于展示的正文（body_raw 去除 diff 和签名）
function getDisplayBody(email: ThreadEmail): string {
  // 优先使用 body_raw（包含引用行），去除 diff 和签名
  if (email.body_raw) {
    return stripDiffAndSignature(email.body_raw);
  }
  // 回退到 body（不含引用行）
  return email.body || '';
}

// 判断一行是否为引用行
function isQuotedLine(line: string): boolean {
  return /^\s*>/.test(line);
}

type TranslationMap = Map<string, { translation: string; loading: boolean; error?: string }>;
type FoldLevel = 'expanded' | 'body_only' | 'collapsed';
type ViewMode = 'tree' | 'layered';

// =============================================================
// 分层模式辅助函数
// =============================================================
function collectDescendantIds(node: ThreadNode): number[] {
  const ids: number[] = [];
  const walk = (n: ThreadNode) => {
    for (const child of n.children) {
      ids.push(child.email.id);
      walk(child);
    }
  };
  walk(node);
  return ids;
}

// 计算节点下所有后代的总数（不含自身）
function countDescendants(node: ThreadNode): number {
  let count = 0;
  const walk = (n: ThreadNode) => {
    for (const child of n.children) {
      count++;
      walk(child);
    }
  };
  walk(node);
  return count;
}

function buildNodeMap(roots: ThreadNode[]): Map<number, ThreadNode> {
  const map = new Map<number, ThreadNode>();
  const walk = (node: ThreadNode) => {
    map.set(node.email.id, node);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return map;
}

// 计算分层模式下可见的节点列表（扁平化）
// 规则：根节点始终可见；子节点仅当其直接父节点被展开时可见
function getVisibleNodes(roots: ThreadNode[], expandedIds: Set<number>): ThreadNode[] {
  const visible: ThreadNode[] = [];
  const walk = (nodes: ThreadNode[], parentExpanded: boolean) => {
    for (const node of nodes) {
      if (node.depth === 0 || parentExpanded) {
        visible.push(node);
        const isExpanded = expandedIds.has(node.email.id);
        walk(node.children, isExpanded);
      }
    }
  };
  walk(roots, true);
  return visible;
}

// =============================================================
// Diff 行着色辅助
// =============================================================
function getDiffLineClass(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('+++') || trimmed.startsWith('---')) return 'diff-line diff-meta';
  if (trimmed.startsWith('+')) return 'diff-line diff-add';
  if (trimmed.startsWith('-')) return 'diff-line diff-del';
  if (trimmed.startsWith('@@')) return 'diff-line diff-hunk';
  if (trimmed.startsWith('diff ')) return 'diff-line diff-header';
  if (trimmed.startsWith('index ')) return 'diff-line diff-meta';
  return 'diff-line diff-ctx';
}

// =============================================================
// 批注输入组件
// =============================================================
function AnnotationInput({ 
  onSubmit, 
  onCancel,
  initialBody,
  submitLabel,
}: { 
  onSubmit: (body: string) => void; 
  onCancel: () => void;
  initialBody?: string;
  submitLabel?: string;
}) {
  const [body, setBody] = useState(initialBody || '');
  return (
    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full min-h-[80px] p-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 bg-white"
        placeholder="输入批注内容（支持 Markdown）..."
        autoFocus
      />
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => { if (body.trim()) onSubmit(body.trim()); }}
          disabled={!body.trim()}
          className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitLabel || '提交批注'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// =============================================================
// 批注卡片组件（用于显示已有批注）
// =============================================================
function AnnotationCard({
  annotation,
  depth,
  onEdit,
  onDelete,
  onReply,
}: {
  annotation: Annotation;
  depth: number;
  onEdit: (annotationId: string, body: string) => void;
  onDelete: (annotationId: string) => void;
  onReply: (annotationId: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div
      className="annotation-node border-l-4 border-blue-400 bg-blue-50 rounded-lg p-4 my-2"
      style={{ marginLeft: depth > 0 ? `${Math.min(depth, 6) * 16}px` : 0 }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="px-2 py-0.5 bg-blue-200 text-blue-800 text-xs rounded font-medium">我的批注</span>
        <span className="text-sm font-medium text-blue-900">{annotation.author}</span>
        <span className="text-xs text-blue-500 ml-auto">
          {new Date(annotation.created_at).toLocaleDateString('zh-CN', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </span>
        {annotation.updated_at !== annotation.created_at && (
          <span className="text-xs text-blue-400">(已编辑)</span>
        )}
      </div>
      {editing ? (
        <AnnotationInput
          initialBody={annotation.body}
          submitLabel="保存修改"
          onSubmit={(body) => { onEdit(annotation.annotation_id, body); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="annotation-markdown text-sm text-blue-900 leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{annotation.body}</ReactMarkdown>
          </div>
          <div className="mt-2">
            <EmailTagEditor
              targetType="annotation"
              targetRef={annotation.annotation_id}
              compact
            />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => onReply(annotation.annotation_id)}
              className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-100 rounded transition-colors"
            >
              回复
            </button>
            <button
              onClick={() => setEditing(true)}
              className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-100 rounded transition-colors"
            >
              编辑
            </button>
            <button
              onClick={() => onDelete(annotation.annotation_id)}
              className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded transition-colors"
            >
              删除
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================
// PATCH Diff 折叠组件
// =============================================================
function PatchDiffBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const lines = content.split('\n');
  const fileCount = lines.filter(l => l.trimStart().startsWith('diff ')).length;
  const addCount = lines.filter(l => {
    const t = l.trimStart();
    return t.startsWith('+') && !t.startsWith('+++');
  }).length;
  const delCount = lines.filter(l => {
    const t = l.trimStart();
    return t.startsWith('-') && !t.startsWith('---');
  }).length;

  return (
    <div className="mt-4 border-t border-gray-200 pt-3 patch-diff">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors"
      >
        <span className="text-gray-400 text-sm">{open ? '▼' : '▶'}</span>
        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded font-medium">PATCH</span>
        <span className="text-xs text-gray-500">
          {fileCount > 0 && `${fileCount} file${fileCount > 1 ? 's' : ''}`}
        </span>
        {(addCount > 0 || delCount > 0) && (
          <span className="text-xs font-mono">
            {addCount > 0 && <span className="text-green-600">+{addCount}</span>}
            {addCount > 0 && delCount > 0 && <span className="text-gray-400 mx-0.5">/</span>}
            {delCount > 0 && <span className="text-red-500">-{delCount}</span>}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 bg-gray-900 rounded-lg overflow-x-auto font-mono text-xs leading-relaxed">
          {lines.map((line, i) => (
            <div key={i} className={getDiffLineClass(line)}>
              <span className="diff-line-no">{i + 1}</span>
              <span className="diff-line-text">{line || ' '}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================
// 分层模式邮件卡片组件（不递归渲染 children）
// =============================================================
function LayeredEmailCard({
  node,
  isExpanded,
  onToggleExpand,
  translations,
  onTranslationUpdate,
  onClearParagraphCache,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  replyingTo,
  onSetReplyingTo,
}: {
  node: ThreadNode;
  isExpanded: boolean;
  onToggleExpand: (id: number) => void;
  translations: TranslationMap;
  onTranslationUpdate: (para: string, translation: string) => void;
  onClearParagraphCache: (paragraph: string) => void;
  onAddAnnotation: (threadId: string, inReplyTo: string, body: string) => void;
  onEditAnnotation: (annotationId: string, body: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  replyingTo: string | null;
  onSetReplyingTo: (id: string | null) => void;
}) {
  const { email, children, depth } = node;
  const paragraphs = parseParagraphs(getDisplayBody(email));
  const [editingPara, setEditingPara] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const handleStartEdit = (para: string, currentTrans: string) => {
    setEditingPara(para);
    setEditText(currentTrans || para);
  };
  const handleSaveEdit = () => {
    if (!editingPara) return;
    onTranslationUpdate(editingPara, editText);
    setEditingPara(null);
    setEditText('');
  };
  const handleCancelEdit = () => {
    setEditingPara(null);
    setEditText('');
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}月前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const renderCollapsedSummary = () => (
    <div className="flex items-center gap-2 py-2 px-4 text-sm">
      <div 
        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
        style={{ backgroundColor: `hsl(${getAuthorName(email.sender).charCodeAt(0) * 15 % 360}, 65%, 50%)` }}
      >
        {getAuthorName(email.sender).charAt(0).toUpperCase()}
      </div>
      <span className="font-medium text-gray-900 truncate max-w-[150px]">
        {getAuthorName(email.sender)}
      </span>
      <span className="text-gray-400 text-xs">{formatDate(email.date)}</span>
      <span className="text-gray-600 truncate flex-1">{email.subject}</span>
      {email.has_patch && (
        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded font-medium">PATCH</span>
      )}
      {children.length > 0 && (() => {
        const totalDesc = countDescendants(node);
        return (
          <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded-full">
            {children.length} 回复{totalDesc > children.length && (
              <span className="text-gray-400"> / 共 {totalDesc}</span>
            )}
          </span>
        );
      })()}
      <span className="text-gray-400 ml-auto">{isExpanded ? '▼' : '▶'}</span>
    </div>
  );

  const renderFullHeader = () => {
    const totalDesc = children.length > 0 ? countDescendants(node) : 0;
    return (
    <div className="flex items-center gap-3 py-3 px-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border-l-4 border-blue-400">
      <div 
        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm"
        style={{ backgroundColor: `hsl(${getAuthorName(email.sender).charCodeAt(0) * 15 % 360}, 65%, 50%)` }}
      >
        {getAuthorName(email.sender).charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">{getAuthorName(email.sender)}</span>
          {depth > 0 && (
            <span className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded">
              → {depth} 层回复
            </span>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {email.date ? new Date(email.date).toLocaleDateString('zh-CN', { 
              year: 'numeric', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit'
            }) : ''}
          </span>
        </div>
        <div className="text-sm text-gray-600 truncate mt-1">{email.subject}</div>
      </div>
      {email.has_patch && (
        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded font-medium">PATCH</span>
      )}
      {children.length > 0 && (
        <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded-full">
          {children.length} 回复{totalDesc > children.length && (
            <span className="text-gray-400"> / 共 {totalDesc}</span>
          )}
        </span>
      )}
      <span className="text-gray-400 text-lg">{isExpanded ? '▼' : '▶'}</span>
    </div>
    );
  };

  const renderParagraph = (block: ParagraphBlock, idx: number) => {
    const { text: para, type: blockType } = block;
    const paragraphAnchor = getParagraphAnchor(para, idx);

    // 引用块：展示但不翻译
    if (blockType === 'quoted') {
      return (
        <div key={idx} className="email-paragraph">
          <pre className="text-sm whitespace-pre-wrap break-words text-gray-500 leading-relaxed border-l-3 border-gray-300 pl-3 italic">{para}</pre>
        </div>
      );
    }

    const needTrans = shouldTranslate(block);
    const transState = translations.get(para);
    const isLoading = transState?.loading;
    const translation = transState?.translation;
    const transError = transState?.error;

    if (!needTrans) {
      return (
        <div key={idx} className="email-paragraph">
          <div className="mb-1">
            <EmailTagEditor
              targetType="email_paragraph"
              targetRef={email.message_id}
              anchor={paragraphAnchor}
              compact
            />
          </div>
          <pre className="text-sm whitespace-pre-wrap break-words text-gray-700 leading-relaxed">{para}</pre>
        </div>
      );
    }

    return (
      <div key={idx} className="bilingual-block">
        <div className="bilingual-original">
          <div className="mb-1">
            <EmailTagEditor
              targetType="email_paragraph"
              targetRef={email.message_id}
              anchor={paragraphAnchor}
              compact
            />
          </div>
          <pre className="text-sm whitespace-pre-wrap break-words text-gray-700 leading-relaxed">{para}</pre>
        </div>
        <div className="bilingual-translation">
          {translation && editingPara !== para && (
            <div className="flex gap-1 mb-2 justify-end">
              <button onClick={() => handleStartEdit(para, translation)} className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200" title="编辑翻译">✏️</button>
              <button onClick={() => onClearParagraphCache(para)} className="text-xs px-2 py-1 bg-orange-100 text-orange-600 rounded hover:bg-orange-200" title="清除此段缓存">🗑️</button>
            </div>
          )}
          {editingPara === para ? (
            <div>
              <textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="w-full min-h-[80px] p-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400" placeholder="输入人工翻译..." />
              <div className="flex gap-2 mt-2">
                <button onClick={handleSaveEdit} className="px-3 py-1.5 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600">保存</button>
                <button onClick={handleCancelEdit} className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300">取消</button>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full"></div>
              <span className="ml-2 text-sm text-gray-500">翻译中...</span>
            </div>
          ) : translation ? (
            <pre className="text-sm whitespace-pre-wrap break-words text-gray-800 leading-relaxed">{translation}</pre>
          ) : transError ? (
            <div className="text-sm text-red-500 py-2">翻译失败: {transError}</div>
          ) : (
            <pre className="text-sm whitespace-pre-wrap break-words text-gray-800 leading-relaxed opacity-50">{para}</pre>
          )}
        </div>
      </div>
    );
  };

  // 批注节点特殊渲染
  if (node.isAnnotation && node.annotation) {
    return (
      <AnnotationCard
        annotation={node.annotation}
        depth={depth}
        onEdit={onEditAnnotation}
        onDelete={onDeleteAnnotation}
        onReply={(id) => onSetReplyingTo(id)}
      />
    );
  }

  return (
    <div className="email-node" style={{ marginLeft: depth > 0 ? `${Math.min(depth, 6) * 16}px` : 0 }}>
      <div 
        onClick={() => onToggleExpand(email.id)}
        className="cursor-pointer hover:bg-gray-50 rounded-lg border border-gray-200 transition-colors"
      >
        {isExpanded ? renderFullHeader() : renderCollapsedSummary()}
      </div>

      {isExpanded && (
        <div className="email-body px-4 pb-4 mt-2">
          <div className="mb-3">
            <EmailTagEditor messageId={email.message_id} />
          </div>
          <div className="email-content rounded-lg overflow-hidden">
            {paragraphs.map((block, idx) => renderParagraph(block, idx))}
          </div>
          {email.has_patch && email.patch_content && (
            <PatchDiffBlock content={email.patch_content} />
          )}
          {/* 添加批注按钮 */}
          <div className="mt-3">
            {replyingTo === email.message_id ? (
              <AnnotationInput
                onSubmit={(body) => { onAddAnnotation(node.email.message_id, email.message_id, body); onSetReplyingTo(null); }}
                onCancel={() => onSetReplyingTo(null)}
              />
            ) : (
              <button
                onClick={() => onSetReplyingTo(email.message_id)}
                className="text-xs px-3 py-1.5 text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg transition-colors"
              >
                + 添加批注
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================
// 树形模式邮件卡片组件（递归渲染 children）
// =============================================================
function TreeEmailCard({ 
  node, 
  expandedIds,
  toggleExpand,
  translations,
  onTranslationUpdate,
  onClearParagraphCache,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  replyingTo,
  onSetReplyingTo,
}: { 
  node: ThreadNode;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
  translations: TranslationMap;
  onTranslationUpdate: (para: string, translation: string) => void;
  onClearParagraphCache: (paragraph: string) => void;
  onAddAnnotation: (threadId: string, inReplyTo: string, body: string) => void;
  onEditAnnotation: (annotationId: string, body: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  replyingTo: string | null;
  onSetReplyingTo: (id: string | null) => void;
}) {
  const { email, children, depth } = node;
  const isExpanded = expandedIds.has(email.id);
  const paragraphs = parseParagraphs(getDisplayBody(email));
  const [editingPara, setEditingPara] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const handleStartEdit = (para: string, currentTrans: string) => {
    setEditingPara(para);
    setEditText(currentTrans || para);
  };
  const handleSaveEdit = () => {
    if (!editingPara) return;
    onTranslationUpdate(editingPara, editText);
    setEditingPara(null);
    setEditText('');
  };
  const handleCancelEdit = () => {
    setEditingPara(null);
    setEditText('');
  };

  const renderFullHeader = () => {
    const totalDesc = children.length > 0 ? countDescendants(node) : 0;
    return (
    <div className="flex items-center gap-3 py-3 px-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border-l-4 border-blue-400">
      <div 
        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm"
        style={{ backgroundColor: `hsl(${getAuthorName(email.sender).charCodeAt(0) * 15 % 360}, 65%, 50%)` }}
      >
        {getAuthorName(email.sender).charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">{getAuthorName(email.sender)}</span>
          {depth > 0 && (
            <span className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded">
              → {depth} 层回复
            </span>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {email.date ? new Date(email.date).toLocaleDateString('zh-CN', { 
              year: 'numeric', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit'
            }) : ''}
          </span>
        </div>
        <div className="text-sm text-gray-600 truncate mt-1">{email.subject}</div>
        {email.references && email.references.length > 0 && (
          <div className="text-xs text-gray-400 mt-1 truncate" title={`回复链: ${email.references[email.references.length - 1]}`}>
            ↳ 回复: {email.references[email.references.length - 1]}
          </div>
        )}
      </div>
      {email.has_patch && (
        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded font-medium">PATCH</span>
      )}
      {children.length > 0 && (
        <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded-full">
          {children.length} 回复{totalDesc > children.length && (
            <span className="text-gray-400"> / 共 {totalDesc}</span>
          )}
        </span>
      )}
      <span className="text-gray-400 text-lg">{isExpanded ? '▼' : '▶'}</span>
    </div>
    );
  };

  const renderParagraph = (block: ParagraphBlock, idx: number) => {
    const { text: para, type: blockType } = block;

    // 引用块：展示但不翻译
    if (blockType === 'quoted') {
      return (
        <div key={idx} className="email-paragraph">
          <pre className="text-sm whitespace-pre-wrap break-words text-gray-500 leading-relaxed border-l-3 border-gray-300 pl-3 italic">{para}</pre>
        </div>
      );
    }

    const needTrans = shouldTranslate(block);
    const transState = translations.get(para);
    const isLoading = transState?.loading;
    const translation = transState?.translation;
    const transError = transState?.error;

    if (!needTrans) {
      return (
        <div key={idx} className="email-paragraph">
          <pre className="text-sm whitespace-pre-wrap break-words text-gray-700 leading-relaxed">{para}</pre>
        </div>
      );
    }

    return (
      <div key={idx} className="bilingual-block">
        <div className="bilingual-original">
          <pre className="text-sm whitespace-pre-wrap break-words text-gray-700 leading-relaxed">{para}</pre>
        </div>
        <div className="bilingual-translation">
          {translation && editingPara !== para && (
            <div className="flex gap-1 mb-2 justify-end">
              <button onClick={() => handleStartEdit(para, translation)} className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200" title="编辑翻译">✏️</button>
              <button onClick={() => onClearParagraphCache(para)} className="text-xs px-2 py-1 bg-orange-100 text-orange-600 rounded hover:bg-orange-200" title="清除此段缓存">🗑️</button>
            </div>
          )}
          {editingPara === para ? (
            <div>
              <textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="w-full min-h-[80px] p-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400" placeholder="输入人工翻译..." />
              <div className="flex gap-2 mt-2">
                <button onClick={handleSaveEdit} className="px-3 py-1.5 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600">保存</button>
                <button onClick={handleCancelEdit} className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300">取消</button>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full"></div>
              <span className="ml-2 text-sm text-gray-500">翻译中...</span>
            </div>
          ) : translation ? (
            <pre className="text-sm whitespace-pre-wrap break-words text-gray-800 leading-relaxed">{translation}</pre>
          ) : transError ? (
            <div className="text-sm text-red-500 py-2">翻译失败: {transError}</div>
          ) : (
            <pre className="text-sm whitespace-pre-wrap break-words text-gray-800 leading-relaxed opacity-50">{para}</pre>
          )}
        </div>
      </div>
    );
  };

  // 批注节点特殊渲染
  if (node.isAnnotation && node.annotation) {
    return (
      <div style={{ marginLeft: depth > 0 ? '16px' : 0 }}>
        <AnnotationCard
          annotation={node.annotation}
          depth={0}
          onEdit={onEditAnnotation}
          onDelete={onDeleteAnnotation}
          onReply={(id) => onSetReplyingTo(id)}
        />
        {children.length > 0 && (
          <div className="replies mt-3">
            {children.map(child => (
              <TreeEmailCard 
                key={child.email.id} 
                node={child} 
                expandedIds={expandedIds}
                toggleExpand={toggleExpand}
                translations={translations}
                onTranslationUpdate={onTranslationUpdate}
                onClearParagraphCache={onClearParagraphCache}
                onAddAnnotation={onAddAnnotation}
                onEditAnnotation={onEditAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                replyingTo={replyingTo}
                onSetReplyingTo={onSetReplyingTo}
              />
            ))}
          </div>
        )}
        {replyingTo === node.annotation.annotation_id && (
          <div style={{ marginLeft: '16px' }}>
            <AnnotationInput
              onSubmit={(body) => { onAddAnnotation(node.annotation!.thread_id, node.annotation!.annotation_id, body); onSetReplyingTo(null); }}
              onCancel={() => onSetReplyingTo(null)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="email-node" style={{ marginLeft: depth > 0 ? '16px' : 0 }}>
      <details className="email-thread" open={isExpanded}>
        <summary 
          onClick={(e) => { e.preventDefault(); toggleExpand(email.id); }}
          className="cursor-pointer"
        >
          {renderFullHeader()}
        </summary>
        <div className="email-body px-4 pb-4 mt-2">
          <div className="mb-3">
            <EmailTagEditor messageId={email.message_id} />
          </div>
          <div className="email-content rounded-lg overflow-hidden">
            {paragraphs.map((block, idx) => renderParagraph(block, idx))}
          </div>
          {email.has_patch && email.patch_content && (
            <PatchDiffBlock content={email.patch_content} />
          )}
          {/* 添加批注按钮 */}
          <div className="mt-3">
            {replyingTo === email.message_id ? (
              <AnnotationInput
                onSubmit={(body) => { onAddAnnotation(node.email.message_id, email.message_id, body); onSetReplyingTo(null); }}
                onCancel={() => onSetReplyingTo(null)}
              />
            ) : (
              <button
                onClick={() => onSetReplyingTo(email.message_id)}
                className="text-xs px-3 py-1.5 text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg transition-colors"
              >
                + 添加批注
              </button>
            )}
          </div>
        </div>
      </details>
      {children.length > 0 && (
        <div className="replies mt-3">
          {children.map(child => (
            <TreeEmailCard 
              key={child.email.id} 
              node={child} 
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              translations={translations}
              onTranslationUpdate={onTranslationUpdate}
              onClearParagraphCache={onClearParagraphCache}
              onAddAnnotation={onAddAnnotation}
              onEditAnnotation={onEditAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              replyingTo={replyingTo}
              onSetReplyingTo={onSetReplyingTo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 从线程中提取所有需要翻译的段落
function extractTranslatableParagraphs(thread: ThreadResponse | null): string[] {
  if (!thread) return [];
  const paragraphs = new Set<string>();
  for (const email of thread.emails) {
    const blocks = parseParagraphs(getDisplayBody(email));
    for (const block of blocks) {
      if (shouldTranslate(block)) {
        paragraphs.add(block.text);
      }
    }
  }
  return Array.from(paragraphs);
}

// =============================================================
// 主组件
// =============================================================
interface Props {
  threadId: string;
  onClose: () => void;
}

export default function ThreadDrawer({ threadId, onClose }: Props) {
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [threadTree, setThreadTree] = useState<ThreadNode[]>([]);
  const [translations, setTranslations] = useState<TranslationMap>(new Map());
  const [translating, setTranslating] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [, setFoldLevel] = useState<FoldLevel>('expanded');
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [layeredExpandedIds, setLayeredExpandedIds] = useState<Set<number>>(new Set());

  const nodeMap = useMemo(() => buildNodeMap(threadTree), [threadTree]);

  const visibleNodes = useMemo(() => {
    if (viewMode !== 'layered') return [];
    return getVisibleNodes(threadTree, layeredExpandedIds);
  }, [viewMode, threadTree, layeredExpandedIds]);

  const clearCacheMessage = useCallback(() => { setCacheMessage(null); }, []);

  const handleClearParagraphCache = useCallback(async (paragraph: string) => {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(paragraph);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      const result = await clearTranslationCache('paragraph', hashHex);
      if (result.success) {
        setCacheMessage({ type: 'success', text: '段落缓存已清除' });
        setTranslations(prev => { const next = new Map(prev); next.delete(paragraph); return next; });
      } else {
        setCacheMessage({ type: 'error', text: result.message });
      }
      setTimeout(clearCacheMessage, 2000);
    } catch {
      setCacheMessage({ type: 'error', text: '清除缓存失败' });
      setTimeout(clearCacheMessage, 2000);
    }
  }, [clearCacheMessage]);

  const handleClearAllCache = useCallback(async () => {
    try {
      const result = await clearTranslationCache('all');
      if (result.success) {
        setCacheMessage({ type: 'success', text: `已清除全部缓存 (${result.cleared_count} 条)` });
        setTranslations(new Map());
      } else {
        setCacheMessage({ type: 'error', text: result.message });
      }
      setTimeout(clearCacheMessage, 2000);
    } catch {
      setCacheMessage({ type: 'error', text: '清除缓存失败' });
      setTimeout(clearCacheMessage, 2000);
    }
  }, [clearCacheMessage]);

  const handleTranslationUpdate = useCallback((para: string, translation: string) => {
    setTranslations(prev => {
      const next = new Map(prev);
      next.set(para, { translation, loading: false });
      return next;
    });
  }, []);

  // 批注相关状态
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // 重建线程树（将批注混入）
  const rebuildTree = useCallback((t: ThreadResponse) => {
    const tree = buildThreadTree(t.emails, t.annotations || []);
    setThreadTree(tree);
    return tree;
  }, []);

  const handleAddAnnotation = useCallback(async (_threadId: string, inReplyTo: string, body: string) => {
    try {
      await createAnnotation({
        thread_id: threadId,
        in_reply_to: inReplyTo,
        body,
      });
      // 重新加载线程数据
      const t = await getThread(threadId);
      setThread(t);
      rebuildTree(t);
    } catch (e) {
      console.error('Failed to create annotation:', e);
    }
  }, [threadId, rebuildTree]);

  const handleEditAnnotation = useCallback(async (annotationId: string, body: string) => {
    try {
      await updateAnnotation(annotationId, body);
      const t = await getThread(threadId);
      setThread(t);
      rebuildTree(t);
    } catch (e) {
      console.error('Failed to update annotation:', e);
    }
  }, [threadId, rebuildTree]);

  const handleDeleteAnnotation = useCallback(async (annotationId: string) => {
    if (!confirm('确定删除这条批注？')) return;
    try {
      await deleteAnnotation(annotationId);
      const t = await getThread(threadId);
      setThread(t);
      rebuildTree(t);
    } catch (e) {
      console.error('Failed to delete annotation:', e);
    }
  }, [threadId, rebuildTree]);

  const handleExportAnnotations = useCallback(async () => {
    try {
      const data = await exportAnnotations(threadId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `annotations-${threadId.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export annotations:', e);
    }
  }, [threadId]);

  const handleImportAnnotations = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await importAnnotations(data);
        if (result.total_imported > 0) {
          // 重新加载线程
          const t = await getThread(threadId);
          setThread(t);
          rebuildTree(t);
        }
        alert(`导入完成：${result.total_imported} 条批注`);
      } catch (err) {
        console.error('Failed to import annotations:', err);
        alert('导入失败：' + (err instanceof Error ? err.message : String(err)));
      }
    };
    input.click();
  }, [threadId, rebuildTree]);

  useEffect(() => {
    setLoading(true);
    getThread(threadId)
      .then(t => {
        setThread(t);
        rebuildTree(t);
        if (t.emails.length > 0) {
          setExpandedIds(new Set([t.emails[0].id]));
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [threadId, rebuildTree]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = () => {
    if (thread) {
      setFoldLevel('expanded');
      setExpandedIds(new Set(thread.emails.map(e => e.id)));
    }
  };

  const collapseAll = () => {
    if (thread) {
      setFoldLevel('collapsed');
      setExpandedIds(new Set());
    }
  };

  // 分层展开模式：切换单个邮件展开状态，折叠时级联折叠所有后代
  const toggleLayeredExpand = useCallback((id: number) => {
    setLayeredExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        const node = nodeMap.get(id);
        if (node) {
          for (const descId of collectDescendantIds(node)) {
            next.delete(descId);
          }
        }
      } else {
        next.add(id);
      }
      return next;
    });
  }, [nodeMap]);

  const enterLayeredMode = useCallback(() => {
    setViewMode('layered');
    if (threadTree.length > 0) {
      setLayeredExpandedIds(new Set([threadTree[0].email.id]));
    } else {
      setLayeredExpandedIds(new Set());
    }
  }, [threadTree]);

  const enterTreeMode = useCallback(() => {
    setViewMode('tree');
    if (thread) {
      setExpandedIds(new Set(thread.emails.map(e => e.id)));
    }
  }, [thread]);

  const handleTranslate = useCallback(async () => {
    if (!thread || translating) return;
    setTranslating(true);

    // 按邮件分组提取可翻译段落，以便传入各自的 message_id
    const emailParagraphs: { messageId: string; paragraphs: string[] }[] = [];
    const allNeedTrans: string[] = [];
    for (const email of thread.emails) {
      const paras = parseParagraphs(getDisplayBody(email))
        .filter(b => shouldTranslate(b) && (!translations.has(b.text) || !translations.get(b.text)?.translation))
        .map(b => b.text);
      if (paras.length > 0) {
        emailParagraphs.push({ messageId: email.message_id, paragraphs: paras });
        allNeedTrans.push(...paras);
      }
    }
    if (allNeedTrans.length === 0) { setTranslating(false); return; }

    // 标记所有段落为加载中
    setTranslations(prev => {
      const next = new Map(prev);
      for (const p of allNeedTrans) { next.set(p, { translation: '', loading: true }); }
      return next;
    });

    try {
      const batchSize = 50;

      for (const { messageId, paragraphs } of emailParagraphs) {
        for (let i = 0; i < paragraphs.length; i += batchSize) {
          const batch = paragraphs.slice(i, i + batchSize);
          const result = await translateBatch(batch, 'auto', 'zh-CN', messageId);
          // 每个 batch 完成后立即更新进度
          setTranslations(prev => {
            const next = new Map(prev);
            batch.forEach((para, idx) => {
              next.set(para, { translation: result.translations[idx] || para, loading: false });
            });
            return next;
          });
        }
      }
    } catch {
      setTranslations(prev => {
        const next = new Map(prev);
        for (const p of allNeedTrans) {
          next.set(p, { translation: '', loading: false, error: '翻译服务暂时不可用' });
        }
        return next;
      });
    } finally {
      setTranslating(false);
    }
  }, [thread, translations, translating]);

  const translationStats = useMemo(() => {
    const total = extractTranslatableParagraphs(thread).length;
    const translated = Array.from(translations.values()).filter(t => !!t.translation).length;
    return { total, translated };
  }, [thread, translations]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto bg-gray-50 flex flex-col"
           style={{ width: '90vw', height: '100vh' }}>
        {/* 顶部工具栏 */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <h3 className="text-lg font-bold text-gray-900">
              Thread ({thread?.total ?? '...'})
            </h3>
            {thread?.emails[0] && (
              <span className="text-sm text-gray-500 truncate max-w-md">
                {thread.emails[0].subject}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleTranslate}
              disabled={translating || translationStats.total === 0}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                translating 
                  ? 'bg-blue-300 text-white cursor-not-allowed' 
                  : translationStats.translated > 0
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {translating ? (
                <>
                  <span className="inline-block animate-spin mr-2">&#x27F3;</span>
                  翻译中 ({translationStats.translated}/{translationStats.total})
                </>
              ) : translationStats.translated > 0 ? (
                <>已翻译 ({translationStats.translated}/{translationStats.total})</>
              ) : (
                <>中英对照</>
              )}
            </button>
            <div className="relative">
              <button
                onClick={handleClearAllCache}
                className="px-3 py-2 text-sm text-orange-600 hover:bg-orange-50 rounded-lg transition-colors border border-orange-200"
                title="清除全部翻译缓存"
              >
                清除缓存
              </button>
              {cacheMessage && (
                <div className={`absolute top-full mt-1 right-0 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap z-10 ${
                  cacheMessage.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {cacheMessage.text}
                </div>
              )}
            </div>
            {thread?.annotations && thread.annotations.length > 0 && (
              <button
                onClick={handleExportAnnotations}
                className="px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-blue-200"
                title="导出批注为 JSON"
              >
                导出批注
              </button>
            )}
            <button
              onClick={handleImportAnnotations}
              className="px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-blue-200"
              title="从 JSON 文件导入批注"
            >
              导入批注
            </button>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={enterTreeMode}
                className={`px-2 py-1.5 text-xs rounded transition-colors ${
                  viewMode === 'tree' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-200'
                }`}
                title="树形模式"
              >
                树形
              </button>
              <button
                onClick={enterLayeredMode}
                className={`px-2 py-1.5 text-xs rounded transition-colors ${
                  viewMode === 'layered' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-200'
                }`}
                title="分层展开"
              >
                分层
              </button>
            </div>
            {viewMode === 'tree' && (
              <>
                <button onClick={expandAll} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">全部展开</button>
                <button onClick={collapseAll} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">全部收起</button>
              </>
            )}
            <button 
              onClick={onClose} 
              className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-xl"
            >
              &#x2715;
            </button>
          </div>
        </div>
        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-gray-400 text-lg">加载中...</div>
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center py-20">
              <div className="text-red-600 text-lg">{error}</div>
            </div>
          )}
          {thread && (
            <div className="thread">
              <div className="bg-white rounded-lg px-4 py-3 mb-6 flex items-center gap-6 text-sm text-gray-600 border border-gray-200">
                <span><strong className="text-gray-900">{thread.emails.length}</strong> 封邮件</span>
                <span><strong className="text-gray-900">{threadTree.length}</strong> 个主题</span>
                {thread.annotations && thread.annotations.length > 0 && (
                  <span><strong className="text-blue-600">{thread.annotations.length}</strong> 条批注</span>
                )}
                {translationStats.total > 0 && (
                  <span><strong className="text-gray-900">{translationStats.total}</strong> 段落可翻译</span>
                )}
                <div className="ml-auto">
                  <EmailTagEditor targetType="email_thread" targetRef={threadId} />
                </div>
              </div>
              <div className="space-y-3">
                {viewMode === 'tree' ? (
                  threadTree.map((rootNode, idx) => (
                    <TreeEmailCard 
                      key={`${rootNode.email.id}-${idx}`}
                      node={rootNode}
                      expandedIds={expandedIds}
                      toggleExpand={toggleExpand}
                      translations={translations}
                      onTranslationUpdate={handleTranslationUpdate}
                      onClearParagraphCache={handleClearParagraphCache}
                      onAddAnnotation={handleAddAnnotation}
                      onEditAnnotation={handleEditAnnotation}
                      onDeleteAnnotation={handleDeleteAnnotation}
                      replyingTo={replyingTo}
                      onSetReplyingTo={setReplyingTo}
                    />
                  ))
                ) : (
                  visibleNodes.map((node) => (
                    <LayeredEmailCard
                      key={node.email.id}
                      node={node}
                      isExpanded={layeredExpandedIds.has(node.email.id)}
                      onToggleExpand={toggleLayeredExpand}
                      translations={translations}
                      onTranslationUpdate={handleTranslationUpdate}
                      onClearParagraphCache={handleClearParagraphCache}
                      onAddAnnotation={handleAddAnnotation}
                      onEditAnnotation={handleEditAnnotation}
                      onDeleteAnnotation={handleDeleteAnnotation}
                      replyingTo={replyingTo}
                      onSetReplyingTo={setReplyingTo}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`
        .email-thread > summary {
          cursor: pointer;
          list-style: none;
        }
        .email-thread > summary::-webkit-details-marker {
          display: none;
        }
        .email-content {
          background: white;
          border: 1px solid #e5e7eb;
        }
        .email-paragraph {
          padding: 12px 16px;
          border-bottom: 1px solid #f3f4f6;
        }
        .email-paragraph:last-child {
          border-bottom: none;
        }
        .bilingual-block {
          display: flex;
          border-bottom: 1px solid #e5e7eb;
        }
        .bilingual-block:last-child {
          border-bottom: none;
        }
        .bilingual-original {
          flex: 0 0 40%;
          padding: 12px 16px;
          background: #fafafa;
          border-right: 2px solid #e5e7eb;
        }
        .bilingual-translation {
          flex: 0 0 60%;
          padding: 12px 16px;
          background: #f0f9ff;
        }
        .patch-diff {
          border-left: 3px solid #22c55e;
        }
        .diff-line {
          display: flex;
          padding: 0 12px;
          min-height: 20px;
          line-height: 20px;
        }
        .diff-line-no {
          display: inline-block;
          width: 42px;
          flex-shrink: 0;
          text-align: right;
          padding-right: 10px;
          color: #6b7280;
          user-select: none;
          border-right: 1px solid #374151;
          margin-right: 10px;
        }
        .diff-line-text {
          white-space: pre;
        }
        .diff-add {
          background: rgba(34, 197, 94, 0.15);
        }
        .diff-add .diff-line-text {
          color: #4ade80;
        }
        .diff-del {
          background: rgba(239, 68, 68, 0.15);
        }
        .diff-del .diff-line-text {
          color: #f87171;
        }
        .diff-hunk {
          background: rgba(96, 165, 250, 0.10);
        }
        .diff-hunk .diff-line-text {
          color: #60a5fa;
        }
        .diff-header .diff-line-text {
          color: #fbbf24;
          font-weight: 600;
        }
        .diff-meta .diff-line-text {
          color: #9ca3af;
          font-weight: 600;
        }
        .diff-ctx .diff-line-text {
          color: #d1d5db;
        }
        @media (max-width: 768px) {
          .bilingual-block {
            flex-direction: column;
          }
          .bilingual-original {
            border-right: none;
            border-bottom: 2px dashed #e5e7eb;
          }
        }
      `}</style>
    </div>
  );
}
