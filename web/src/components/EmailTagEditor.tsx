import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTagAssignment,
  deleteTagAssignment,
  getTagTree,
  getTargetTags,
  listTagAssignments,
  type TagAssignment,
  type TagRead,
  type TagTree,
} from '../api/client';
import { useAuth } from '../auth';

interface EmailTagEditorProps {
  messageId?: string;
  targetType?: string;
  targetRef?: string;
  anchor?: Record<string, unknown>;
  compact?: boolean;
  placeholder?: string;
  initialTags?: string[];
}

export default function EmailTagEditor({
  messageId,
  targetType,
  targetRef,
  anchor,
  compact = false,
  placeholder = 'Type tag name...',
  initialTags,
}: EmailTagEditorProps) {
  const resolvedTargetType = targetType ?? 'email_message';
  const resolvedTargetRef = targetRef ?? messageId ?? '';
  const resolvedAnchor = anchor ?? {};
  const { canWrite, currentUser, isAdmin } = useAuth();

  const [directAssignments, setDirectAssignments] = useState<TagAssignment[]>([]);
  const [directTags, setDirectTags] = useState<TagRead[]>(
    () =>
      (initialTags ?? []).map((name, index) => ({
        id: -(index + 1),
        slug: name,
        name,
        description: '',
        parent_tag_id: null,
        color: '#6366f1',
        status: 'active',
        tag_kind: 'topic',
        visibility: 'public',
        aliases: [],
        owner_user_id: null,
        created_by: 'me',
        updated_by: 'me',
        created_by_user_id: null,
        updated_by_user_id: null,
        created_at: '',
        updated_at: '',
      })),
  );
  const [aggregatedTags, setAggregatedTags] = useState<TagRead[]>([]);
  const [allTags, setAllTags] = useState<TagTree[]>([]);
  const [showPopover, setShowPopover] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const resolvedAnchorKey = JSON.stringify(resolvedAnchor);

  const loadTargetTags = useCallback(async () => {
    if (!resolvedTargetRef) return;
    const anchorValue = JSON.parse(resolvedAnchorKey) as Record<string, unknown>;
    const [bundle, assignments] = await Promise.all([
      getTargetTags(resolvedTargetType, resolvedTargetRef, anchorValue),
      listTagAssignments({
        target_type: resolvedTargetType,
        target_ref: resolvedTargetRef,
        anchor: anchorValue,
      }),
    ]);
    setDirectTags(bundle.direct_tags);
    setAggregatedTags(bundle.aggregated_tags);
    setDirectAssignments(assignments);
  }, [resolvedAnchorKey, resolvedTargetRef, resolvedTargetType]);

  useEffect(() => {
    loadTargetTags().catch(() => {});
  }, [loadTargetTags]);

  // Cache tag tree for 60s to avoid re-fetching on every popover open
  const tagTreeCache = useRef<{ tree: TagTree[]; ts: number } | null>(null);

  useEffect(() => {
    if (!showPopover) return;
    const now = Date.now();
    if (tagTreeCache.current && (now - tagTreeCache.current.ts) < 60_000) {
      setAllTags(tagTreeCache.current.tree);
      return;
    }
    getTagTree(true)
      .then((tree) => {
        const tags: TagTree[] = [];
        const collect = (nodes: TagTree[]) => {
          for (const node of nodes) {
            tags.push(node);
            collect(node.children);
          }
        };
        collect(tree);
        tagTreeCache.current = { tree: tags, ts: Date.now() };
        setAllTags(tags);
      })
      .catch(() => {});
  }, [showPopover]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    };
    if (showPopover) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPopover]);

  const directTagNames = useMemo(() => directTags.map((tag) => tag.name), [directTags]);
  const aggregatedOnly = useMemo(
    () => aggregatedTags.filter((tag) => !directTagNames.includes(tag.name)),
    [aggregatedTags, directTagNames],
  );

  const suggestions = useMemo(
    () =>
      allTags
        .filter((tag) => !directTagNames.includes(tag.name))
        .filter((tag) => isAdmin || tag.visibility === 'public' || (tag.visibility === 'private' && tag.owner_user_id === currentUser?.user_id))
        .filter((tag) => !inputValue || tag.name.toLowerCase().includes(inputValue.toLowerCase())),
    [allTags, currentUser?.user_id, directTagNames, inputValue, isAdmin],
  );

  const canManageTag = (tag: TagRead, assignment?: TagAssignment) => {
    if (isAdmin) return true;
    if (!currentUser?.user_id) return false;
    if (tag.visibility !== 'private') return false;
    if (tag.owner_user_id !== currentUser.user_id && tag.created_by_user_id !== currentUser.user_id) return false;
    if (assignment && assignment.created_by_user_id !== currentUser.user_id) return false;
    return true;
  };

  const handleAdd = async (tagName: string) => {
    const value = tagName.trim();
    if (!value || !resolvedTargetRef || directTagNames.includes(value)) return;
    if (!isAdmin && !suggestions.some((tag) => tag.name === value)) return;
    setLoading(true);
    try {
      await createTagAssignment({
        tag_name: value,
        target_type: resolvedTargetType,
        target_ref: resolvedTargetRef,
        anchor: resolvedAnchor,
      });
      setInputValue('');
      await loadTargetTags();
    } catch {
      // keep UI quiet for now
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (tagName: string) => {
    setLoading(true);
    try {
      const match = directAssignments.filter((item) => item.tag_name === tagName);
      for (const assignment of match) {
        await deleteTagAssignment(assignment.assignment_id);
      }
      await loadTargetTags();
    } catch {
      // keep UI quiet for now
    } finally {
      setLoading(false);
    }
  };

  if (!resolvedTargetRef) return null;

  return (
    <div className="relative inline-flex items-center gap-1 flex-wrap">
      {directTags.map((tag) => (
        (() => {
          const removable = directAssignments.some(
            (assignment) => assignment.tag_id === tag.id && canManageTag(tag, assignment),
          );
          return (
            <span
              key={`direct-${tag.slug}`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs group"
              style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
            >
              {tag.name}
              {removable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(tag.name);
                  }}
                  className="opacity-0 group-hover:opacity-100 ml-0.5"
                  disabled={loading}
                >
                  &times;
                </button>
              )}
            </span>
          );
        })()
      ))}

      {aggregatedOnly.map((tag) => (
        <span
          key={`agg-${tag.slug}`}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs"
          title="Aggregated from related targets"
        >
          {tag.name}
        </span>
      ))}

      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!canWrite) return;
          setShowPopover((prev) => !prev);
        }}
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded transition-colors ${canWrite ? 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50' : 'text-gray-300 cursor-not-allowed'} ${compact ? '' : ''}`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        tag
      </button>

      {showPopover && (
        <div
          ref={popoverRef}
          className="absolute top-full left-0 mt-1 z-50 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-2"
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputValue.trim()) handleAdd(inputValue);
            }}
            placeholder={placeholder}
            className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded mb-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            autoFocus
            disabled={!canWrite}
          />

          {aggregatedOnly.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Aggregated</div>
              <div className="flex flex-wrap gap-1">
                {aggregatedOnly.map((tag) => (
                  <span key={tag.slug} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {isAdmin && suggestions.length === 0 && inputValue.trim() && (
              <button
                onClick={() => handleAdd(inputValue)}
                className="w-full text-left px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded"
              >
                Create "{inputValue.trim()}"
              </button>
            )}
            {suggestions.map((tag) => (
              <button
                key={tag.id}
                onClick={() => handleAdd(tag.name)}
                className="w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded"
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
