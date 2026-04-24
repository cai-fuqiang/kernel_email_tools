import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createTag,
  deleteTag,
  getTagStats,
  getTagTargets,
  getTagTree,
  type TagStats,
  type TagTargetItem,
  type TagTree,
} from '../api/client';
import ThreadDrawer from './ThreadDrawer';
import { useAuth } from '../auth';

interface TagManagerProps {
  onTagsChanged?: () => void;
}

export default function TagManager({ onTagsChanged }: TagManagerProps) {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const [tags, setTags] = useState<TagTree[]>([]);
  const [tagStats, setTagStats] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');
  const [newTagParentId, setNewTagParentId] = useState<number | undefined>(undefined);
  const [newTagVisibility, setNewTagVisibility] = useState<'public' | 'private'>('public');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [expandedTag, setExpandedTag] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<{
    threadId: string;
    focusMessageId?: string;
    focusAnnotationId?: string;
  } | null>(null);

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

  useEffect(() => {
    loadTags();
  }, []);

  const handleCreate = async () => {
    if (!newTagName.trim()) return;
    setCreating(true);
    setError('');
    try {
      await createTag(newTagName.trim(), newTagParentId, newTagColor, '', 'topic', newTagVisibility);
      setNewTagName('');
      setNewTagParentId(undefined);
      setNewTagVisibility('public');
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
    setExpandedTag((prev) => (prev === tagName ? null : tagName));
  };

  const handleJumpToTarget = (target: TagTargetItem) => {
    const meta = target.target_meta || {};
    if (target.target_type === 'email_thread') {
      const threadId = String(meta.thread_id || target.target_ref || '');
      if (threadId) setSelectedThread({ threadId });
      return;
    }
    if (target.target_type === 'email_message' || target.target_type === 'email_paragraph') {
      const threadId = String(meta.thread_id || '');
      if (threadId) {
        setSelectedThread({
          threadId,
          focusMessageId: String(meta.message_id || target.target_ref),
        });
      }
      return;
    }
    if (target.target_type === 'annotation') {
      const annotationType = String(meta.annotation_type || '');
      if (annotationType === 'code' && meta.version && meta.file_path) {
        const line = Number(meta.start_line || 1);
        navigate(`/kernel-code?v=${encodeURIComponent(String(meta.version))}&path=${encodeURIComponent(String(meta.file_path))}&line=${line}`);
        return;
      }
      const threadId = String(meta.thread_id || '');
      if (threadId) {
        setSelectedThread({
          threadId,
          focusAnnotationId: String(meta.annotation_id || target.target_ref),
        });
        return;
      }
      navigate(`/annotations?q=${encodeURIComponent(String(meta.annotation_id || target.target_ref))}`);
      return;
    }
    if (target.target_type === 'kernel_line_range') {
      const version = String(meta.version || '');
      const filePath = String(meta.file_path || '');
      const line = Number(meta.start_line || target.anchor?.start_line || 1);
      if (version && filePath) {
        navigate(`/kernel-code?v=${encodeURIComponent(version)}&path=${encodeURIComponent(filePath)}&line=${line}`);
      }
    }
  };

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
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Create Tag</h4>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Tag name"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <select
            value={newTagParentId ?? ''}
            onChange={(e) => setNewTagParentId(e.target.value ? Number(e.target.value) : undefined)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
            disabled={!canWrite}
          >
            <option value="">No parent</option>
            {flatTags.map((t) => (
              <option key={t.id} value={t.id}>
                {'  '.repeat(t.depth) + t.name}
              </option>
            ))}
          </select>
          <select
            value={newTagVisibility}
            onChange={(e) => setNewTagVisibility(e.target.value as 'public' | 'private')}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
            disabled={!canWrite}
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
          <button
            onClick={handleCreate}
            disabled={!canWrite || creating || !newTagName.trim()}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating ? '...' : 'Add'}
          </button>
        </div>
        <div className="flex gap-1.5 mt-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setNewTagColor(c)}
              className={`w-6 h-6 rounded-full border-2 transition-transform ${newTagColor === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
              disabled={!canWrite}
            />
          ))}
        </div>
        {!canWrite && <p className="mt-2 text-xs text-amber-700">Current role is read-only. Tag creation is disabled.</p>}
      </div>

      {error && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{error}</div>}

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
            onJumpToTarget={handleJumpToTarget}
            canWrite={canWrite}
          />
        )}
      </div>

      {selectedThread && (
        <ThreadDrawer
          threadId={selectedThread.threadId}
          focusMessageId={selectedThread.focusMessageId}
          focusAnnotationId={selectedThread.focusAnnotationId}
          onClose={() => setSelectedThread(null)}
        />
      )}
    </div>
  );
}

function TagNodeList({
  nodes,
  onDelete,
  depth,
  tagStats,
  expandedTag,
  onToggleExpand,
  onJumpToTarget,
  canWrite,
}: {
  nodes: TagTree[];
  onDelete: (id: number, name: string) => void;
  depth: number;
  tagStats: Map<string, number>;
  expandedTag: string | null;
  onToggleExpand: (tagName: string) => void;
  onJumpToTarget: (target: TagTargetItem) => void;
  canWrite: boolean;
}) {
  return (
    <ul className={depth > 0 ? 'ml-4 border-l border-gray-100 pl-3' : ''}>
      {nodes.map((tag) => {
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
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${tag.visibility === 'private' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {tag.visibility}
                </span>
                {count > 0 && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{count}</span>}
                {count > 0 && (
                  <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>
              {canWrite && (
                <button onClick={() => onDelete(tag.id, tag.name)} className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Delete
                </button>
              )}
            </div>
            {isExpanded && <TagTargetList tagName={tag.name} onJumpToTarget={onJumpToTarget} />}
            {tag.children.length > 0 && (
              <TagNodeList
                nodes={tag.children}
                onDelete={onDelete}
                depth={depth + 1}
                tagStats={tagStats}
                expandedTag={expandedTag}
                onToggleExpand={onToggleExpand}
                onJumpToTarget={onJumpToTarget}
                canWrite={canWrite}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TagTargetList({
  tagName,
  onJumpToTarget,
}: {
  tagName: string;
  onJumpToTarget: (target: TagTargetItem) => void;
}) {
  const [targets, setTargets] = useState<TagTargetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageSize = 10;

  const load = async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await getTagTargets(tagName, p, pageSize);
      setTargets(res.targets);
      setTotal(res.total);
      setPage(p);
    } catch {
      setError('Failed to load tagged targets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
  }, [tagName]);

  const totalPages = Math.ceil(total / pageSize);

  if (loading && targets.length === 0) {
    return <div className="ml-5 mt-2 text-xs text-gray-400">Loading tagged targets...</div>;
  }

  if (error) {
    return <div className="ml-5 mt-2 text-xs text-red-500">{error}</div>;
  }

  if (total === 0) {
    return <div className="ml-5 mt-2 text-xs text-gray-400">No targets with this tag.</div>;
  }

  return (
    <div className="ml-5 mt-2 mb-1 border border-gray-100 rounded-lg bg-gray-50 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-100 text-gray-500">
            <th className="text-left px-3 py-1.5 font-medium">Target</th>
            <th className="text-left px-3 py-1.5 font-medium w-40">Type</th>
            <th className="text-left px-3 py-1.5 font-medium w-48">Meta</th>
            <th className="text-left px-3 py-1.5 font-medium w-20">Action</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((target) => (
            <tr
              key={target.assignment_id}
              onClick={() => onJumpToTarget(target)}
              className="border-t border-gray-100 hover:bg-indigo-50 cursor-pointer transition-colors"
            >
              <td className="px-3 py-2 truncate max-w-xs text-gray-800">{getTargetTitle(target)}</td>
              <td className="px-3 py-2 text-gray-500">{target.target_type}</td>
              <td className="px-3 py-2 text-gray-400 truncate">{getTargetMeta(target)}</td>
              <td className="px-3 py-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onJumpToTarget(target);
                  }}
                  className="text-indigo-600 hover:text-indigo-800"
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 bg-gray-100 text-xs text-gray-500">
          <span>{total} targets total</span>
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

function getTargetTitle(target: TagTargetItem): string {
  const meta = target.target_meta || {};
  if (target.target_type === 'annotation') {
    return String(meta.target_label || meta.body || meta.annotation_id || target.target_ref);
  }
  if (target.target_type === 'email_paragraph') {
    const paragraphIndex = Number(target.anchor?.paragraph_index || 0);
    const subject = String(meta.subject || meta.message_id || target.target_ref);
    return paragraphIndex > 0 ? `${subject} · Paragraph ${paragraphIndex + 1}` : subject;
  }
  if (target.target_type === 'kernel_line_range') {
    return `${String(meta.file_path || target.target_ref)}:${meta.start_line || target.anchor?.start_line || 0}`;
  }
  return String(meta.subject || meta.message_id || meta.thread_id || target.target_ref);
}

function getTargetMeta(target: TagTargetItem): string {
  const meta = target.target_meta || {};
  if (target.target_type === 'annotation') {
    if (meta.version && meta.file_path) {
      return `${meta.version} ${meta.file_path}:${meta.start_line || 0}`;
    }
    return [String(meta.thread_id || ''), String(meta.in_reply_to || ''), String(meta.target_subtitle || '')]
      .filter(Boolean)
      .join(' · ');
  }
  if (target.target_type === 'kernel_line_range') {
    return `${meta.version || ''} L${meta.start_line || 0}-${meta.end_line || 0}`.trim();
  }
  if (target.target_type === 'email_thread') {
    return [extractName(String(meta.sender || '')), formatDate((meta.date as string | null) ?? null), String(meta.list_name || ''), String(meta.thread_id || '')]
      .filter(Boolean)
      .join(' · ');
  }
  return [extractName(String(meta.sender || '')), formatDate((meta.date as string | null) ?? null), String(meta.list_name || '')]
    .filter(Boolean)
    .join(' · ');
}
