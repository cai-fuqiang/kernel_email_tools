import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { SupportPanelId } from './knowledgeLayout';

const drawerTitles: Record<SupportPanelId, string> = {
  evidence: 'Evidence',
  notes: 'Notes',
  history: 'History',
  relations: 'Relations',
  timeline: 'Timeline',
};

interface KnowledgeSupportDrawerProps {
  panel: SupportPanelId | null;
  children: ReactNode;
  onClose: () => void;
}

export default function KnowledgeSupportDrawer({
  panel,
  children,
  onClose,
}: KnowledgeSupportDrawerProps) {
  if (!panel) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close support panel"
        className="absolute inset-0 bg-slate-950/30"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-support-drawer-title"
        className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-2xl shadow-slate-950/20 md:w-[min(760px,72vw)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2
              id="knowledge-support-drawer-title"
              className="text-base font-semibold text-slate-950"
            >
              {drawerTitles[panel]}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Supporting context stays separate from the main document.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close support panel"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}
