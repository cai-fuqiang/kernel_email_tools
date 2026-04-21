import { useState, useEffect } from 'react';
import { getTagTree, createTag, deleteTag, type TagTree } from '../api/client';

interface TagManagerProps {
  onTagsChanged?: () => void;
}

export default function TagManager({ onTagsChanged }: TagManagerProps) {
  const [tags, setTags] = useState<TagTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');
  const [newTagParentId, setNewTagParentId] = useState<number | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const loadTags = async () => {
    try {
      const data = await getTagTree();
      setTags(data);
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
      await loadTags();
      onTagsChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete tag');
    }
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
          <TagNodeList nodes={tags} onDelete={handleDelete} depth={0} />
        )}
      </div>
    </div>
  );
}

function TagNodeList({ nodes, onDelete, depth }: {
  nodes: TagTree[];
  onDelete: (id: number, name: string) => void;
  depth: number;
}) {
  return (
    <ul className={depth > 0 ? 'ml-4 border-l border-gray-100 pl-3' : ''}>
      {nodes.map(tag => (
        <li key={tag.id} className="py-1.5">
          <div className="flex items-center gap-2 group">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
            <span className="text-sm text-gray-800 flex-1">{tag.name}</span>
            <button
              onClick={() => onDelete(tag.id, tag.name)}
              className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              Delete
            </button>
          </div>
          {tag.children.length > 0 && (
            <TagNodeList nodes={tag.children} onDelete={onDelete} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}