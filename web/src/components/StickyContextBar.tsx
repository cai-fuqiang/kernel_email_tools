import type { ReactNode } from 'react';

function cx(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ');
}

export default function StickyContextBar({
  title,
  subtitle,
  meta,
  actions,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur md:-mx-6 md:px-6',
        className,
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div>}
        </div>
        {(meta || actions) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {meta}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
