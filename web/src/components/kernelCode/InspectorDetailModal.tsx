import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../ui';

interface InspectorDetailModalProps {
  title: string;
  subtitle?: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export default function InspectorDetailModal({
  title,
  subtitle,
  isOpen,
  onClose,
  children,
  footer,
}: InspectorDetailModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-950">{title}</h2>
            {subtitle && <div className="mt-1 text-xs text-slate-500">{subtitle}</div>}
          </div>
          <IconButton label="Close detail view" onClick={onClose} className="h-8 w-8 shrink-0">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-200 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}
