import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useAuth } from '../auth';
import { showToast } from './Toast';
import EmailTagEditor from './EmailTagEditor';
import KernelPathLinkedText from './KernelPathLinkedText';
import KnowledgeBackRefs from './KnowledgeBackRefs';
import PatchDiffBlock from './PatchDiffBlock';
import QuotedTextBlock from './QuotedTextBlock';
import ThreadAnnotationCard, { AnnotationInput } from './ThreadAnnotationCard';
import { extractPatchVersion } from '../utils/kernelPathRefs';
import { loreUrl } from '../utils/externalLinks';
import {
  countDescendants,
  getParagraphAnchor,
  type ThreadNode,
  type TranslationMap,
} from '../utils/threadTree';
import {
  parseParagraphs,
  getDisplayBody,
  getAuthorName,
  shouldTranslate,
  type ParagraphBlock,
} from '../utils/emailBody';

interface LayeredEmailCardProps {
  node: ThreadNode;
  isExpanded: boolean;
  highlightedTarget: string | null;
  onToggleExpand: (id: number) => void;
  translations: TranslationMap;
  onTranslationUpdate: (para: string, translation: string) => void;
  onClearParagraphCache: (paragraph: string) => void;
  onAddAnnotation: (threadId: string, inReplyTo: string, body: string, visibility: 'public' | 'private') => void;
  onEditAnnotation: (annotationId: string, body: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  replyingTo: string | null;
  threadId: string;
  onRefresh: () => void;
  onSetReplyingTo: (id: string | null) => void;
}

/**
 * 分层模式邮件卡片：扁平展示一封邮件，**不递归**渲染 children。
 *
 * 子节点由 `ThreadDrawer` 通过 `getVisibleNodes` 拍平后单独渲染，
 * 由父节点的 `isExpanded` 状态控制是否在视图中出现。
 */
export default function LayeredEmailCard({
  node,
  isExpanded,
  highlightedTarget,
  onToggleExpand,
  translations,
  onTranslationUpdate,
  onClearParagraphCache,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  replyingTo,
  onSetReplyingTo,
  threadId,
  onRefresh,
}: LayeredEmailCardProps) {
  const { canWrite } = useAuth();
  const { email, children, depth } = node;
  const paragraphs = parseParagraphs(getDisplayBody(email));
  const kernelVersion = extractPatchVersion(email.subject || '') || 'latest';
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
          <KnowledgeBackRefs messageId={email.message_id} />
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
      <a
        href={loreUrl(email.message_id)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-gray-300 hover:text-indigo-500 transition-colors flex-shrink-0"
        title="在 lore.kernel.org 查看原文"
      >
        <ExternalLink className="w-4 h-4" />
      </a>
      <button
        onClick={(e) => { e.stopPropagation(); void (async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/app/?thread=${threadId}&msg=${email.message_id}`); showToast('链接已复制', 'success'); } catch { showToast('复制失败', 'error'); } })(); }}
        className="text-gray-300 hover:text-blue-500 transition-colors flex-shrink-0"
        title="复制消息链接"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
      </button>
    </div>
    );
  };

  const renderParagraph = (block: ParagraphBlock, idx: number) => {
    const { text: para, type: blockType } = block;
    const paragraphAnchor = getParagraphAnchor(para, idx);

    // 引用块：展示但不翻译
    if (blockType === 'quoted') {
      return <QuotedTextBlock key={idx} text={para} />;
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
          <KernelPathLinkedText text={para} version={kernelVersion} className="text-sm whitespace-pre-wrap break-words text-gray-700 leading-relaxed" />
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
          <KernelPathLinkedText text={para} version={kernelVersion} className="text-sm whitespace-pre-wrap break-words text-gray-700 leading-relaxed" />
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
      <ThreadAnnotationCard
        annotation={node.annotation}
        depth={depth}
        highlighted={highlightedTarget === `annotation:${node.annotation.annotation_id}`}
        onEdit={onEditAnnotation}
        onDelete={onDeleteAnnotation}
        onReply={(id) => onSetReplyingTo(id)}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <div
      data-message-id={email.message_id}
      className={`email-node rounded-lg transition-all ${
        highlightedTarget === `message:${email.message_id}` ? 'ring-2 ring-amber-200 bg-amber-50/60' : ''
      }`}
      style={{ marginLeft: depth > 0 ? `${Math.min(depth, 6) * 16}px` : 0 }}
    >
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
            <PatchDiffBlock content={email.patch_content} version={kernelVersion} />
          )}
          {/* 添加批注按钮 */}
          <div className="mt-3">
            {canWrite && replyingTo === email.message_id ? (
              <AnnotationInput
                onSubmit={(body, visibility) => { onAddAnnotation(node.email.message_id, email.message_id, body, visibility); onSetReplyingTo(null); }}
                onCancel={() => onSetReplyingTo(null)}
              />
            ) : canWrite ? (
              <button
                onClick={() => onSetReplyingTo(email.message_id)}
                className="text-xs px-3 py-1.5 text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg transition-colors"
              >
                + 添加批注
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
