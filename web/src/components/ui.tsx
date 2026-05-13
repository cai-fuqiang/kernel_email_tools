import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

type Tone = 'default' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

function cx(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ');
}

const toneClasses: Record<Tone, string> = {
  default: 'border-slate-300 bg-white text-slate-700',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
  muted: 'border-slate-200 bg-slate-100 text-slate-700',
};

export function PageShell({
  children,
  className = '',
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div className={cx('min-h-full bg-slate-50 px-4 py-4 text-slate-900 md:px-6', className)}>
      <div className={cx('mx-auto w-full space-y-5', wide ? 'max-w-[1920px]' : 'max-w-6xl')}>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">{eyebrow}</div>}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>}
        {meta && <div className="mt-3">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionPanel({
  children,
  title,
  description,
  actions,
  className = '',
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
      {(title || description || actions) && (
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-950">{title}</h2>}
            {description && <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {description && <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = 'default',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span className={cx('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', toneClasses[tone], className)}>
      {children}
    </span>
  );
}

export function PrimaryButton({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  label,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function InspectorSection({
  title,
  icon,
  collapsed,
  onToggle,
  children,
  headerExtra,
}: {
  title: string;
  icon: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
        aria-expanded={!collapsed}
      >
        <span className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-slate-950">
          <span className="text-slate-600">{icon}</span>
          <span className="truncate">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {headerExtra}
          <ChevronRight className={`h-4 w-4 text-slate-600 transition duration-200 ${collapsed ? '' : 'rotate-90'}`} />
        </span>
      </button>
      <div
        className={`grid transition-all duration-200 ease-in-out ${
          collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-slate-200 px-4 py-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={cx('h-4 animate-pulse rounded bg-slate-200', className)} />;
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-slate-200', className)} />;
}

export function SkeletonCard() {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <SkeletonLine className="w-3/4" />
          <SkeletonLine className="w-1/2" />
        </div>
      </div>
      <SkeletonLine className="w-full" />
      <SkeletonLine className="w-5/6" />
      <SkeletonLine className="w-2/3" />
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase text-slate-600">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-600">{hint}</div>}
    </div>
  );
}
