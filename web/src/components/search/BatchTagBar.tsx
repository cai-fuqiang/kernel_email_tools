interface BatchTagBarProps {
  selectedCount: number;
  batchTagInput: string;
  onBatchTagInputChange: (value: string) => void;
  batchTagging: boolean;
  onBatchTag: () => void;
  onCancel: () => void;
}

export default function BatchTagBar({
  selectedCount,
  batchTagInput,
  onBatchTagInputChange,
  batchTagging,
  onBatchTag,
  onCancel,
}: BatchTagBarProps) {
  return (
    <div className="sticky top-0 z-10 mb-4 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 shadow-sm">
      <span className="text-sm font-medium text-indigo-800">
        已选 {selectedCount} 封邮件
      </span>
      <input
        value={batchTagInput}
        onChange={(e) => onBatchTagInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onBatchTag();
        }}
        placeholder="输入标签名..."
        className="flex-1 rounded-lg border border-indigo-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        disabled={batchTagging}
      />
      <button
        onClick={onBatchTag}
        disabled={batchTagging || !batchTagInput.trim()}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {batchTagging ? '处理中...' : '批量打标签'}
      </button>
      <button
        onClick={onCancel}
        className="text-xs text-indigo-600 hover:text-indigo-800"
      >
        取消
      </button>
    </div>
  );
}