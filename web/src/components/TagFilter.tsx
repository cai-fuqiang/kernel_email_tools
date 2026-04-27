import { useState } from 'react';
import { type TagStats } from '../api/client';

interface TagFilterProps {
  tags: TagStats[];
  selectedTags: string[];
  tagMode: 'any' | 'all';
  onTagToggle: (tag: string) => void;
  onTagModeChange: (mode: 'any' | 'all') => void;
}

export default function TagFilter({
  tags,
  selectedTags,
  tagMode,
  onTagToggle,
  onTagModeChange,
}: TagFilterProps) {
  const [showAll, setShowAll] = useState(false);

  const displayedTags = showAll ? tags : tags.slice(0, 12);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-gray-700">Filter by Tags</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Match:</span>
          <button
            onClick={() => onTagModeChange('any')}
            className={`px-2 py-0.5 text-xs rounded ${
              tagMode === 'any'
                ? 'bg-indigo-100 text-indigo-700 font-medium'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            Any
          </button>
          <button
            onClick={() => onTagModeChange('all')}
            className={`px-2 py-0.5 text-xs rounded ${
              tagMode === 'all'
                ? 'bg-indigo-100 text-indigo-700 font-medium'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            All
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {displayedTags.map(tag => (
          <button
            key={tag.name}
            onClick={() => onTagToggle(tag.name)}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              selectedTags.includes(tag.name)
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tag.name}
            <span className={`ml-1 ${selectedTags.includes(tag.name) ? 'text-indigo-200' : 'text-gray-400'}`}>
              ({tag.count})
            </span>
          </button>
        ))}
      </div>

      {tags.length > 12 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-2 text-xs text-indigo-600 hover:text-indigo-800"
        >
          {showAll ? 'Show less' : `Show all ${tags.length} tags`}
        </button>
      )}

      {selectedTags.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <button
            onClick={() => selectedTags.forEach(t => onTagToggle(t))}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear all tags
          </button>
        </div>
      )}
    </div>
  );
}