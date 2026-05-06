import { useState, useCallback } from 'react';
import { getEntitiesByMessageId } from '../api/client';
import type { KnowledgeEntity } from '../api/types';

interface KnowledgeBackRefsProps {
  messageId: string;
}

/**
 * 邮件 → Knowledge 反向引用 chip。
 *
 * 默认折叠为一个 "N KG refs" 小按钮；点击时懒加载关联实体并下拉展示。
 * 不阻塞主渲染流程，加载失败 / 0 关联时静默隐藏。
 */
export default function KnowledgeBackRefs({ messageId }: KnowledgeBackRefsProps) {
  const [entities, setEntities] = useState<KnowledgeEntity[] | null>(null);
  const [open, setOpen] = useState(false);

  const handleToggle = useCallback(async () => {
    if (open) { setOpen(false); return; }
    if (entities === null) {
      try {
        const res = await getEntitiesByMessageId(messageId);
        setEntities(res.entities);
      } catch {
        setEntities([]);
      }
    }
    setOpen(true);
  }, [open, entities, messageId]);

  const count = entities?.length ?? -1;
  if (count === 0) return null;
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleToggle}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-colors"
        title="Knowledge entities referencing this email"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
        {count > 0 ? `${count} KG ref${count > 1 ? 's' : ''}` : 'KG...'}
      </button>
      {open && entities && entities.length > 0 && (
        <div className="absolute z-50 mt-1 right-0 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500">Referenced by Knowledge</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xs">&times;</button>
          </div>
          <div className="space-y-2">
            {entities.map((e) => (
              <a
                key={e.entity_id}
                href={`/knowledge?entity_id=${encodeURIComponent(e.entity_id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-2 rounded-lg hover:bg-purple-50 transition-colors"
              >
                <div className="text-sm font-medium text-gray-900 truncate">{e.canonical_name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{e.entity_type}</span>
                  {e.summary && <span className="text-xs text-gray-500 truncate">{e.summary.slice(0, 60)}</span>}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
      {open && entities && entities.length === 0 && (
        <div className="absolute z-50 mt-1 right-0 w-48 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <div className="text-xs text-gray-500">No knowledge entities reference this email.</div>
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xs mt-1">&times; Close</button>
        </div>
      )}
    </div>
  );
}