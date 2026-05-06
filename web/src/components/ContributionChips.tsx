import type { ReactNode } from 'react';
import type { ContributionStats } from '../api/contributions';

/**
 * PLAN-34001: 贡献度标记 chip.
 *
 * 约定:
 *  - 蓝色 K<N>: 该邮件/线程已被引用为 N 条 knowledge evidence
 *  - 紫色 A<N>: 已有 N 条 annotation 关联
 *  - 灰色 D<N>: 有 N 条 pending knowledge draft (仅 thread 级)
 * 0 计数不渲染, 保持安静。
 */

interface ContributionChipsProps {
  stats?: ContributionStats | null;
  /** compact: 只显示带字母的小徽章, 适合卡片内联 */
  compact?: boolean;
  className?: string;
}

export default function ContributionChips({
  stats,
  compact = true,
  className = '',
}: ContributionChipsProps) {
  if (!stats) return null;
  const ev = stats.knowledge_evidence_count || 0;
  const an = stats.annotation_count || 0;
  const dr = stats.draft_count || 0;
  if (ev === 0 && an === 0 && dr === 0) return null;

  const chips: ReactNode[] = [];
  if (ev > 0) {
    chips.push(
      <span
        key="k"
        title={`${ev} 条知识引用`}
        className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700"
      >
        {compact ? `K${ev}` : `${ev} 知识引用`}
      </span>,
    );
  }
  if (an > 0) {
    chips.push(
      <span
        key="a"
        title={`${an} 条批注`}
        className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700"
      >
        {compact ? `A${an}` : `${an} 批注`}
      </span>,
    );
  }
  if (dr > 0) {
    chips.push(
      <span
        key="d"
        title={`${dr} 条待审 draft`}
        className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
      >
        {compact ? `D${dr}` : `${dr} 待审 draft`}
      </span>,
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {chips}
    </span>
  );
}