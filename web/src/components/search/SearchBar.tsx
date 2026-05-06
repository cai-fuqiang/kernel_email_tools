import { Search } from 'lucide-react';
import type { TagStats } from '../../api/client';
import type { ChannelOption } from '../../api/types';
import { PrimaryButton } from '../ui';

interface SearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  mode: string;
  onModeChange: (value: string) => void;
  selectedChannel: string;
  onChannelChange: (value: string) => void;
  channelOptions: ChannelOption[];
  sortBy: string;
  sortOrder: string;
  onSortChange: (by: string, order: string) => void;
  loading: boolean;
  semanticNeedsQuery: boolean;
  onSearch: () => void;
  tagStats: TagStats[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
}

export default function SearchBar({
  query,
  onQueryChange,
  mode,
  onModeChange,
  selectedChannel,
  onChannelChange,
  channelOptions,
  sortBy,
  sortOrder,
  onSortChange,
  loading,
  semanticNeedsQuery,
  onSearch,
  tagStats,
  selectedTags,
  onTagToggle,
}: SearchBarProps) {
  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="flex-1 relative">
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="Search emails... e.g. shmem mount"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pl-11 text-sm shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
          />
          <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
        </div>
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
        >
          <option value="hybrid">Hybrid</option>
          <option value="keyword">Keyword</option>
          <option value="semantic">Semantic</option>
        </select>
        <select
          value={selectedChannel}
          onChange={(e) => onChannelChange(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
        >
          {channelOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={`${sortBy}:${sortOrder}`}
          onChange={(e) => {
            const [by, order] = e.target.value.split(':');
            onSortChange(by, order);
          }}
          className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
        >
          <option value=":">Relevance (default)</option>
          <option value="date:desc">Newest first</option>
          <option value="date:asc">Oldest first</option>
        </select>
        <PrimaryButton onClick={onSearch} disabled={loading || semanticNeedsQuery}>
          {loading ? 'Searching...' : 'Search'}
        </PrimaryButton>
      </div>
      {semanticNeedsQuery && (
        <p className="mt-2 text-xs text-amber-700">
          Semantic search needs query text. Use Keyword or Hybrid for filter-only searches.
        </p>
      )}

      {tagStats.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Popular tags:</span>
            {tagStats.slice(0, 8).map((tag) => (
              <button
                key={tag.name}
                onClick={() => onTagToggle(tag.name)}
                className={`px-2 py-1 text-xs rounded-full transition-colors ${
                  selectedTags.includes(tag.name)
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tag.name} ({tag.count})
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}