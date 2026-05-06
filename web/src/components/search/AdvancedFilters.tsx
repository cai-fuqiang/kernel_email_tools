import type { TagStats } from '../../api/client';
import TagFilter from '../TagFilter';
import { PrimaryButton, SecondaryButton } from '../ui';

interface AdvancedFiltersProps {
  sender: string;
  onSenderChange: (value: string) => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  hasPatch: boolean | null;
  onHasPatchChange: (value: boolean | null) => void;
  tagStats: TagStats[];
  selectedTags: string[];
  tagMode: 'any' | 'all';
  onTagToggle: (tag: string) => void;
  onTagModeChange: (mode: 'any' | 'all') => void;
  includeAnnotations: boolean;
  onIncludeAnnotationsChange: (value: boolean) => void;
  onResetFilters: () => void;
  loading: boolean;
  hasFilters: boolean;
  query: string;
  semanticNeedsQuery: boolean;
  onSearch: () => void;
}

export default function AdvancedFilters({
  sender,
  onSenderChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  hasPatch,
  onHasPatchChange,
  tagStats,
  selectedTags,
  tagMode,
  onTagToggle,
  onTagModeChange,
  includeAnnotations,
  onIncludeAnnotationsChange,
  onResetFilters,
  loading,
  hasFilters,
  query,
  semanticNeedsQuery,
  onSearch,
}: AdvancedFiltersProps) {
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 发件人过滤 */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Sender</label>
          <input
            type="text"
            value={sender}
            onChange={(e) => onSenderChange(e.target.value)}
            placeholder="e.g. torvalds"
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* 起始日期 */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">From Date</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* 结束日期 */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">To Date</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* 是否包含补丁 */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Has Patch</label>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => onHasPatchChange(hasPatch === true ? null : true)}
              className={`flex-1 px-3 py-2 text-xs rounded-lg border ${
                hasPatch === true
                  ? 'bg-green-50 border-green-300 text-green-700'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Yes
            </button>
            <button
              onClick={() => onHasPatchChange(hasPatch === false ? null : false)}
              className={`flex-1 px-3 py-2 text-xs rounded-lg border ${
                hasPatch === false
                  ? 'bg-red-50 border-red-300 text-red-700'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              No
            </button>
          </div>
        </div>
      </div>

      {/* 标签筛选 */}
      {tagStats.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <TagFilter
            tags={tagStats}
            selectedTags={selectedTags}
            tagMode={tagMode}
            onTagToggle={onTagToggle}
            onTagModeChange={onTagModeChange}
          />
        </div>
      )}

      {/* 搜索按钮 */}
      <div className="mt-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <SecondaryButton onClick={onResetFilters} className="px-3 py-1.5 text-xs">
            Reset filters
          </SecondaryButton>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeAnnotations}
              onChange={(e) => onIncludeAnnotationsChange(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-300"
            />
            搜索批注
          </label>
        </div>
        <PrimaryButton
          onClick={onSearch}
          disabled={loading || (!query.trim() && !hasFilters) || semanticNeedsQuery}
        >
          {loading ? 'Searching...' : 'Search'}
        </PrimaryButton>
      </div>
    </div>
  );
}