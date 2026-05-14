import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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

export function getTagPopoverPlacementClass(compact: boolean): string {
  return compact
    ? 'bottom-full left-0 mb-1'
    : 'top-full left-0 mt-1';
}

export type TagOptionViewMode = 'all' | 'matching' | 'related';

type MinimalTagOption = { id: number; name: string };

type TriggerRect = {
  left: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

const TAG_POPOVER_WIDTH = 320;
const TAG_POPOVER_HEIGHT = 208;
const TAG_POPOVER_MARGIN = 12;

export function buildTagPopoverStyle(
  rect: TriggerRect,
  compact: boolean,
  viewportWidth: number,
  viewportHeight: number,
): CSSProperties {
  const preferredLeft = rect.left;
  const maxLeft = Math.max(TAG_POPOVER_MARGIN, viewportWidth - TAG_POPOVER_WIDTH - TAG_POPOVER_MARGIN);
  const left = Math.min(Math.max(TAG_POPOVER_MARGIN, preferredLeft), maxLeft);
  const openUpward = compact && rect.top > TAG_POPOVER_HEIGHT + TAG_POPOVER_MARGIN;
  const preferredTop = openUpward ? rect.top - TAG_POPOVER_HEIGHT : rect.bottom + 8;
  const maxTop = Math.max(TAG_POPOVER_MARGIN, viewportHeight - TAG_POPOVER_HEIGHT - TAG_POPOVER_MARGIN);
  const top = Math.min(Math.max(TAG_POPOVER_MARGIN, preferredTop), maxTop);

  return {
    position: 'fixed',
    left,
    top,
    width: Math.min(TAG_POPOVER_WIDTH, viewportWidth - TAG_POPOVER_MARGIN * 2),
    zIndex: 120,
  };
}

export function getVisibleTagOptions({
  mode,
  inputValue,
  suggestions,
  related,
}: {
  mode: TagOptionViewMode;
  inputValue: string;
  suggestions: MinimalTagOption[];
  related: MinimalTagOption[];
}): MinimalTagOption[] {
  if (mode === 'related') return related;
  if (mode === 'matching') return suggestions.filter((tag) => tag.name.toLowerCase().includes(inputValue.toLowerCase()));
  const seen = new Set<string>();
  return [...suggestions, ...related].filter((tag) => {
    const key = tag.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface EmailTagEditorProps {
  messageId?: string;
  targetType?: string;
  targetRef?: string;
  anchor?: Record<string, unknown>;
  compact?: boolean;
  hideTags?: boolean;
  placeholder?: string;
  initialTags?: string[];
}

export default function EmailTagEditor({
  messageId,
  targetType,
  targetRef,
  anchor,
  compact = false,
  hideTags = false,
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
  const [viewMode, setViewMode] = useState<TagOptionViewMode>('all');
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resolvedAnchorKey = JSON.stringify(resolvedAnchor);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);

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
    setDirectTags(Array.isArray(bundle.direct_tags) ? bundle.direct_tags : []);
    setAggregatedTags(Array.isArray(bundle.aggregated_tags) ? bundle.aggregated_tags : []);
    setDirectAssignments(Array.isArray(assignments) ? assignments : []);
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
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setShowPopover(false);
      }
    };
    if (showPopover) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPopover]);

  useEffect(() => {
    if (!showPopover || !triggerRef.current || typeof window === 'undefined') return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopoverStyle(
        buildTagPopoverStyle(
          {
            left: rect.left,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
          compact,
          window.innerWidth,
          window.innerHeight,
        ),
      );
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [compact, showPopover]);

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
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allTags, currentUser?.user_id, directTagNames, isAdmin],
  );
  const relatedTagOptions = useMemo(
    () => aggregatedOnly.map((tag) => ({ id: tag.id, name: tag.name })),
    [aggregatedOnly],
  );
  const visibleOptions = useMemo(
    () =>
      getVisibleTagOptions({
        mode: viewMode,
        inputValue,
        suggestions: suggestions.map((tag) => ({ id: tag.id, name: tag.name })),
        related: relatedTagOptions,
      }),
    [inputValue, relatedTagOptions, suggestions, viewMode],
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
      {!hideTags && directTags.map((tag) => (
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

      {!hideTags && aggregatedOnly.map((tag) => (
        <span
          key={`agg-${tag.slug}`}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded text-xs"
          title="Aggregated from related targets"
        >
          {tag.name}
        </span>
      ))}

      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          if (!canWrite) return;
          setShowPopover((prev) => !prev);
        }}
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded transition-colors ${canWrite ? 'text-slate-400 hover:text-indigo-400 hover:bg-indigo-950/30' : 'text-slate-500 cursor-not-allowed'} ${compact ? '' : ''}`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        tag
      </button>

      {showPopover && popoverStyle && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          style={popoverStyle}
          className="rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-[0_24px_80px_rgba(15,23,42,0.45)]"
        >
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (viewMode === 'related') setViewMode('matching');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) handleAdd(inputValue);
              }}
              placeholder={placeholder}
              className="min-w-0 flex-1 rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-600"
              autoFocus
              disabled={!canWrite}
            />
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as TagOptionViewMode)}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200"
            >
              <option value="all">All</option>
              <option value="matching">Matching</option>
              <option value="related">Related</option>
            </select>
          </div>

          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-400">
            <span>{viewMode === 'related' ? 'Related tags' : 'Available tags'}</span>
            <span>{visibleOptions.length}</span>
          </div>

          <div className="max-h-[40vh] min-h-24 overflow-y-auto space-y-1 pr-1">
            {isAdmin && viewMode !== 'related' && suggestions.length === 0 && inputValue.trim() && (
              <button
                onClick={() => handleAdd(inputValue)}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-indigo-300 hover:bg-indigo-950/30"
              >
                Create "{inputValue.trim()}"
              </button>
            )}
            {visibleOptions.length === 0 ? (
              <div className="px-2 py-2 text-xs text-slate-500">
                {viewMode === 'related' ? 'No related tags' : 'No matching tags'}
              </div>
            ) : (
              visibleOptions.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => {
                    if (viewMode !== 'related') void handleAdd(tag.name);
                  }}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs ${
                    viewMode === 'related'
                      ? 'cursor-default text-slate-400'
                      : 'text-slate-200 hover:bg-slate-700'
                  }`}
                  disabled={viewMode === 'related'}
                >
                  {tag.name}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
