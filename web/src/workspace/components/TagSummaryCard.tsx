import { useEffect, useState } from 'react';
import { getTagTargets } from '../../api/client';
import type { TagRead, TagTree, TagTargetItem } from '../../api/types';

interface TagSummaryCardProps {
  tag: TagTree | TagRead;
  /** 点击 target 行时的回调，用于跳转到 thread / code / annotation 等 */
  onOpenTarget?: (target: TagTargetItem) => void;
}

/**
 * Tag 详情面板：展示 tag 元信息 + 懒加载 target 子列表
 *
 * 约束：这是 `EntityDetailPanel` 下的 tag kind renderer，不作为独立页面使用。
 */
export default function TagSummaryCard({ tag, onOpenTarget }: TagSummaryCardProps) {
  const [targets, setTargets] = useState<TagTargetItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTagTargets(tag.slug || tag.name, 1, 20)
      .then((res) => {
        if (cancelled) return;
        setTargets(res.targets);
        setTotal(res.total);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tag.slug, tag.name]);

  return (
    <div className="space-y-4 p-5 text-sm">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Metadata</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-slate-500">slug</dt>
          <dd className="font-mono text-slate-800">{tag.slug}</dd>
          <dt className="text-slate-500">kind</dt>
          <dd className="text-slate-800">{tag.tag_kind || 'general'}</dd>
          <dt className="text-slate-500">visibility</dt>
          <dd className="text-slate-800">{tag.visibility || 'public'}</dd>
          <dt className="text-slate-500">status</dt>
          <dd className="text-slate-800">{tag.status || 'active'}</dd>
        </dl>
      </div>

      {tag.description && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Description</div>
          <p className="text-xs leading-relaxed text-slate-700">{tag.description}</p>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Targets ({total})
          </div>
        </div>
        {loading ? (
          <div className="text-xs text-slate-500">Loading targets…</div>
        ) : error ? (
          <div className="text-xs text-rose-600">Failed to load: {error}</div>
        ) : targets.length === 0 ? (
          <div className="text-xs text-slate-500">没有已绑定的目标</div>
        ) : (
          <ul className="space-y-1.5">
            {targets.map((t) => (
              <li
                key={t.assignment_id}
                className="cursor-pointer rounded-lg border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50"
                onClick={() => onOpenTarget?.(t)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-900">
                    {describeTarget(t)}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                    {t.target_type}
                  </span>
                </div>
                {t.target_meta && Object.keys(t.target_meta).length > 0 && (
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">
                    {formatTargetMeta(t.target_meta)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function describeTarget(t: TagTargetItem): string {
  const meta = t.target_meta || {};
  const label = (meta.label as string) || (meta.subject as string) || (meta.title as string);
  if (label) return label;
  return t.target_ref || '(unknown)';
}

function formatTargetMeta(meta: Record<string, unknown>): string {
  const keys = ['sender', 'date', 'list_name', 'file_path', 'version'];
  return keys.map((k) => meta[k]).filter(Boolean).join(' · ');
}