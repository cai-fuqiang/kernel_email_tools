import { ChevronDown, ChevronUp } from 'lucide-react';
import TagFilter from '../../components/TagFilter';
import type { TagStats } from '../../api/client';
import type { ChannelOption } from '../../api/types';
import type { WorkspaceFilters } from '../hooks/useWorkspaceData';

interface Props {
  filters: WorkspaceFilters;
  onChange: (patch: Partial<WorkspaceFilters>) => void;
  channelOptions: ChannelOption[];
  tagStats: TagStats[];
  expanded: boolean;
  onToggleExpanded: () => void;
  semanticNeedsQuery: boolean;
}

export default function EmailFilterBar({
  filters,
  onChange,
  channelOptions,
  tagStats,
  expanded,
  onToggleExpanded,
  semanticNeedsQuery,
}: Props) {
  const sortValue = `${filters.sort_by || ''}:${filters.sort_order || ''}`;

  return (
    <div className="space-y-2">
      {/* 一行主过滤：mode / channel / sort + 高级按钮 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-slate-600">
          <span>Mode</span>
          <select
            value={filters.mode || 'hybrid'}
            onChange={(e) => onChange({ mode: e.target.value as WorkspaceFilters['mode'] })}
            className="rounded border-slate-300 px-2 py-1 text-xs"
          >
            <option value="hybrid">Hybrid</option>
            <option value="keyword">Keyword</option>
            <option value="semantic">Semantic</option>
          </select>
        </label>

        <label className="flex items-center gap-1 text-slate-600">
          <span>Channel</span>
          <select
            value={filters.list_name || ''}
            onChange={(e) => onChange({ list_name: e.target.value || undefined })}
            className="rounded border-slate-300 px-2 py-1 text-xs"
          >
            {channelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-slate-600">
          <span>Sort</span>
          <select
            value={sortValue}
            onChange={(e) => {
              const [by, order] = e.target.value.split(':');
              onChange({
                sort_by: (by || '') as WorkspaceFilters['sort_by'],
                sort_order: (order || '') as WorkspaceFilters['sort_order'],
              });
            }}
            className="rounded border-slate-300 px-2 py-1 text-xs"
          >
            <option value=":">Relevance</option>
            <option value="date:desc">Newest first</option>
            <option value="date:asc">Oldest first</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-slate-600">
          <input
            type="checkbox"
            checked={filters.has_patch === true}
            onChange={(e) => onChange({ has_patch: e.target.checked ? true : undefined })}
            className="rounded border-slate-300"
          />
          has patch
        </label>

        <button
          type="button"
          onClick={onToggleExpanded}
          className="ml-auto inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-slate-600 hover:bg-slate-50"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          高级过滤
        </button>
      </div>

      {semanticNeedsQuery && (
        <p className="text-xs text-amber-700">
          Semantic 模式需要关键词。请用 Keyword 或 Hybrid 做 filter-only 搜索。
        </p>
      )}

      {/* 高级过滤：sender / date / tags */}
      {expanded && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600">Sender</label>
              <input
                type="text"
                value={filters.sender || ''}
                onChange={(e) => onChange({ sender: e.target.value || undefined })}
                placeholder="e.g. torvalds"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600">From date</label>
              <input
                type="date"
                value={filters.date_from || ''}
                onChange={(e) => onChange({ date_from: e.target.value || undefined })}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600">To date</label>
              <input
                type="date"
                value={filters.date_to || ''}
                onChange={(e) => onChange({ date_to: e.target.value || undefined })}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
              />
            </div>
          </div>

          {tagStats.length > 0 && (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <TagFilter
                tags={tagStats}
                selectedTags={filters.tags || []}
                tagMode={filters.tag_mode || 'any'}
                onTagToggle={(tag) => {
                  const cur = filters.tags || [];
                  const next = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag];
                  onChange({ tags: next.length > 0 ? next : undefined });
                }}
                onTagModeChange={(m) => onChange({ tag_mode: m })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}