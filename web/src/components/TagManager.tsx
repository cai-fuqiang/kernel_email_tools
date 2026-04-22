import { useState, useEffect } from 'react';
import {
  getTagTree,
  getTagStats,
  createTag,
  deleteTag,
  getEmailsByTag,
  type TagTree,
  type TagStats,
  type TagEmailItem,
} from '../api/client';
import ThreadDrawer from './ThreadDrawer';

interface TagManagerProps {
  onTagsChanged?: () => void;
}

export default function TagManager({ onTagsChanged }: TagManagerProps) {
  const [tags, setTags] = useState<TagTree[]>([]);
  const [tagStats, setTagStats] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');
  const [newTagParentId, setNewTagParentId] = useState<number | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // 展开的标签（查看邮件列表）
  const [expandedTag, setExpandedTag] = useState<string | null>(null);

  // ThreadDrawer 状态
  const [selectedThread, setSelectedThread] = useState<string | null>(null);

  const loadTags = async () => {
    try {
      const [data, stats] = await Promise.all([getTagTree(), getTagStats()]);
      setTags(data);
      const m = new Map<string, number>();
      stats.forEach((s: TagStats) => m.set(s.name, s.count));
      setTagStats(m);
    } catch {
      setError('Failed to load tags');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTags(); }, []);

  const handleCreate = async () => {
    if (!newTagName.trim()) return;
    setCreating(true);
    setError('');
    try {
      await createTag(newTagName.trim(), newTagParentId, newTagColor);
      setNewTagName('');
      setNewTagParentId(undefined);
      await loadTags();
      onTagsChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create tag');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (tagId: number, tagName: string) => {
    if (!confirm(`Delete tag "${tagName}" and all its children?`)) return;
    setError('');
    try {
      await deleteTag(tagId);
      if (expandedTag === tagName) setExpandedTag(null);
      await loadTags();
      onTagsChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete tag');
    }
  };

  const handleToggleExpand = (tagName: string) => {
    setExpandedTag(prev => prev === tagName ? null : tagName);
  };

  // 扁平化标签树用于 parent 选择
  const flatTags: { id: number; name: string; depth: number }[] = [];
  const flatten = (nodes: TagTree[], depth = 0) => {
    for (const n of nodes) {
      flatTags.push({ id: n.id, name: n.name, depth });
      flatten(n.children, depth + 1);
    }
  };
  flatten(tags);

  const COLORS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

  return (
    <div className="space-y-4">
      {/* 创建标签 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Create Tag</h4>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <input
              type="text"
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Tag name"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <select
            value={newTagParentId ?? ''}
            onChange={e => setNewTagParentId(e.target.value ? Number(e.target.value) : undefined)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
          >
            <option value="">No parent</option>
            {flatTags.map(t => (
              <option key={t.id} value={t.id}>{'  '.repeat(t.depth) + t.name}</option>
            ))}
          </select>
          <button
            onClick={handleCreate}
            disabled={creating || !newTagName.trim()}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating ? '...' : 'Add'}
          </button>
        </div>
        {/* 颜色选择 */}
        <div className="flex gap-1.5 mt-2">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => setNewTagColor(c)}
              className={`w-6 h-6 rounded-full border-2 transition-transform ${newTagColor === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{error}</div>
      )}

      {/* 标签树 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">All Tags</h4>
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : tags.length === 0 ? (
          <p className="text-sm text-gray-400">No tags yet. Create one above.</p>
        ) : (
          <TagNodeList
            nodes={tags}
            onDelete={handleDelete}
            depth={0}
            tagStats={tagStats}
            expandedTag={expandedTag}
            onToggleExpand={handleToggleExpand}
            onOpenThread={setSelectedThread}
          />
        )}
      </div>

      {/* ThreadDrawer */}
      {selectedThread && (
        <ThreadDrawer
          threadId={selectedThread}
          onClose={() => setSelectedThread(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// 标签节点列表（递归）
// ============================================================

function TagNodeList({ nodes, onDelete, depth, tagStats, expandedTag, onToggleExpand, onOpenThread }: {
  nodes: TagTree[];
  onDelete: (id: number, name: string) => void;
  depth: number;
  tagStats: Map<string, number>;
  expandedTag: string | null;
  onToggleExpand: (tagName: string) => void;
  onOpenThread: (threadId: string) => void;
}) {
  return (
    <ul className={depth > 0 ? 'ml-4 border-l border-gray-100 pl-3' : ''}>
      {nodes.map(tag => {
        const count = tagStats.get(tag.name) ?? 0;
        const isExpanded = expandedTag === tag.name;

        return (
          <li key={tag.id} className="py-1.5">
            <div className="flex items-center gap-2 group">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
              <button
                onClick={() => count > 0 && onToggleExpand(tag.name)}
                className={`text-sm flex-1 text-left flex items-center gap-1.5 ${count > 0 ? 'text-gray-800 hover:text-indigo-600 cursor-pointer' : 'text-gray-400 cursor-default'}`}
              >
                <span className={isExpanded ? 'font-semibold text-indigo-700' : ''}>{tag.name}</span>
                {count > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    {count}
                  </span>
                )}
                {count > 0 && (
                  <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => onDelete(tag.id, tag.name)}
                className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Delete
              </button>
            </div>
            {/* 展开的邮件列表 */}
            {isExpanded && (
              <TagEmailList tagName={tag.name} onOpenThread={onOpenThread} />
            )}
            {tag.children.length > 0 && (
              <TagNodeList
                nodes={tag.children}
                onDelete={onDelete}
                depth={depth + 1}
                tagStats={tagStats}
                expandedTag={expandedTag}
                onToggleExpand={onToggleExpand}
                onOpenThread={onOpenThread}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ============================================================
// 标签邮件列表子组件
// ============================================================

function TagEmailList({ tagName, onOpenThread }: {
  tagName: string;
  onOpenThread: (threadId: string) => void;
}) {
  const [emails, setEmails] = useState<TagEmailItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageSize = 10;

  const load = async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await getEmailsByTag(tagName, p, pageSize);
      setEmails(res.emails);
      setTotal(res.total);
      setPage(p);
    } catch {
      setError('Failed to load emails');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); }, [tagName]);

  const totalPages = Math.ceil(total / pageSize);

  if (loading && emails.length === 0) {
    return <div className="ml-5 mt-2 text-xs text-gray-400">Loading emails...</div>;
  }

  if (error) {
    return <div className="ml-5 mt-2 text-xs text-red-500">{error}</div>;
  }

  if (total === 0) {
    return <div className="ml-5 mt-2 text-xs text-gray-400">No emails with this tag.</div>;
  }

  return (
    <div className="ml-5 mt-2 mb-1 border border-gray-100 rounded-lg bg-gray-50 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-100 text-gray-500">
            <th className="text-left px-3 py-1.5 font-medium">Subject</th>
            <th className="text-left px-3 py-1.5 font-medium w-36">Sender</th>
            <th className="text-left px-3 py-1.5 font-medium w-28">Date</th>
            <th className="text-left px-3 py-1.5 font-medium w-20">Channel</th>
          </tr>
        </thead>
        <tbody>
          {emails.map(email => (
            <tr
              key={email.message_id}
              onClick={() => onOpenThread(email.thread_id)}
              className="border-t border-gray-100 hover:bg-indigo-50 cursor-pointer transition-colors"
            >
              <td className="px-3 py-2 truncate max-w-xs">
                <span className="text-gray-800">{email.subject}</span>
                {email.has_patch && (
                  <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                    PATCH
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-500 truncate">{extractName(email.sender)}</td>
              <td className="px-3 py-2 text-gray-400">{formatDate(email.date)}</td>
              <td className="px-3 py-2 text-gray-400">{email.list_name}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 bg-gray-100 text-xs text-gray-500">
          <span>{total} emails total</span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1 || loading}
              onClick={() => load(page - 1)}
              className="px-2 py-0.5 rounded bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-2 py-0.5">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages || loading}
              onClick={() => load(page + 1)}
              className="px-2 py-0.5 rounded bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 辅助函数

function extractName(sender: string): string {
  const match = sender.match(/^([^<]+)/);
  return match ? match[1].trim() : sender;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}