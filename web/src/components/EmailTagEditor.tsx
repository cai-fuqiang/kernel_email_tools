import { useState, useEffect, useRef } from 'react';
import { getEmailTags, addEmailTag, removeEmailTag, getTagTree, type TagTree } from '../api/client';

interface EmailTagEditorProps {
  messageId: string;
  /** 初始标签（从搜索结果传入，避免额外请求） */
  initialTags?: string[];
}

export default function EmailTagEditor({ messageId, initialTags }: EmailTagEditorProps) {
  const [tags, setTags] = useState<string[]>(initialTags ?? []);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showPopover, setShowPopover] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // 加载邮件当前标签（如果没有 initialTags）
  useEffect(() => {
    if (!initialTags) {
      getEmailTags(messageId).then(setTags).catch(() => {});
    }
  }, [messageId, initialTags]);

  // 加载所有可用标签
  useEffect(() => {
    if (showPopover) {
      getTagTree().then(tree => {
        const names: string[] = [];
        const collect = (nodes: TagTree[]) => {
          for (const n of nodes) {
            names.push(n.name);
            collect(n.children);
          }
        };
        collect(tree);
        setAllTags(names);
      }).catch(() => {});
    }
  }, [showPopover]);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    };
    if (showPopover) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPopover]);

  const handleAdd = async (tagName: string) => {
    if (!tagName.trim() || tags.includes(tagName.trim())) return;
    setLoading(true);
    try {
      await addEmailTag(messageId, tagName.trim());
      setTags(prev => [...prev, tagName.trim()]);
      setInputValue('');
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (tagName: string) => {
    setLoading(true);
    try {
      await removeEmailTag(messageId, tagName);
      setTags(prev => prev.filter(t => t !== tagName));
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  };

  // 过滤建议：排除已有标签，匹配输入
  const suggestions = allTags
    .filter(t => !tags.includes(t))
    .filter(t => !inputValue || t.toLowerCase().includes(inputValue.toLowerCase()));

  return (
    <div className="relative inline-flex items-center gap-1 flex-wrap">
      {/* 已有标签 */}
      {tags.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs group"
        >
          {tag}
          <button
            onClick={e => { e.stopPropagation(); handleRemove(tag); }}
            className="text-indigo-400 hover:text-red-500 opacity-0 group-hover:opacity-100 ml-0.5"
            disabled={loading}
          >
            &times;
          </button>
        </span>
      ))}

      {/* 添加按钮 */}
      <button
        onClick={e => { e.stopPropagation(); setShowPopover(!showPopover); }}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        tag
      </button>

      {/* 弹出层 */}
      {showPopover && (
        <div ref={popoverRef} className="absolute top-full left-0 mt-1 z-50 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && inputValue.trim()) handleAdd(inputValue); }}
            placeholder="Type tag name..."
            className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded mb-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            autoFocus
          />
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {suggestions.length === 0 && inputValue.trim() && (
              <button
                onClick={() => handleAdd(inputValue)}
                className="w-full text-left px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded"
              >
                Create "{inputValue.trim()}"
              </button>
            )}
            {suggestions.map(t => (
              <button
                key={t}
                onClick={() => handleAdd(t)}
                className="w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}