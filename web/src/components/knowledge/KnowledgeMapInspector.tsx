import type {
  KnowledgeMapAnnotationNode,
  KnowledgeMapCenterNode,
  KnowledgeMapObjectNode,
} from './knowledgeMap';

type InspectorSelection =
  | { kind: 'center'; node: KnowledgeMapCenterNode }
  | { kind: 'annotation'; node: KnowledgeMapAnnotationNode }
  | { kind: 'object'; node: KnowledgeMapObjectNode };

export default function KnowledgeMapInspector({
  selection,
  onOpenObject,
}: {
  selection: InspectorSelection | null;
  onOpenObject?: (targetRef: string) => void;
}) {
  if (!selection) {
    return (
      <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Select a card to inspect the details here.
      </aside>
    );
  }

  if (selection.kind === 'center') {
    return (
      <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Center object
        </div>
        <div className="mt-2 text-lg font-semibold text-slate-950">{selection.node.label}</div>
        <div className="mt-1 text-sm text-slate-500">{selection.node.entity_type}</div>
        {selection.node.summary && (
          <p className="mt-3 text-sm leading-6 text-slate-700">{selection.node.summary}</p>
        )}
      </aside>
    );
  }

  if (selection.kind === 'annotation') {
    return (
      <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
            {selection.node.annotation_type}
          </span>
          {selection.node.pinned && (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800">
              pinned
            </span>
          )}
        </div>
        <div className="mt-3 text-base font-semibold text-slate-950">{selection.node.label}</div>
        <p className="mt-2 text-sm leading-6 text-slate-700">{selection.node.body}</p>
      </aside>
    );
  }

  return (
    <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        Related object
      </div>
      <div className="mt-2 text-base font-semibold text-slate-950">{selection.node.label}</div>
      <div className="mt-1 text-sm text-slate-500">{selection.node.subtitle}</div>
      <div className="mt-2 text-xs text-slate-500">{selection.node.target_ref}</div>
      {onOpenObject && selection.node.navigable && (
        <button
          type="button"
          onClick={() => onOpenObject(selection.node.target_ref)}
          className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Open object
        </button>
      )}
    </aside>
  );
}
