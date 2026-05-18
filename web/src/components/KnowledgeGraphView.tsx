import { useMemo, useState } from 'react';
import type {
  KnowledgeMapAnnotationNode,
  KnowledgeMapModel,
  KnowledgeMapObjectNode,
} from './knowledge/knowledgeMap';
import KnowledgeMapInspector from './knowledge/KnowledgeMapInspector';

type FilterKey = 'claim' | 'summary' | 'link' | 'note';

const FILTER_ORDER: Array<{ key: FilterKey; label: string }> = [
  { key: 'claim', label: 'Claims' },
  { key: 'summary', label: 'Summaries' },
  { key: 'link', label: 'Links' },
  { key: 'note', label: 'Pinned notes' },
];

function annotationMatchesFilter(annotation: KnowledgeMapAnnotationNode, active: Record<FilterKey, boolean>) {
  if (annotation.annotation_type === 'note') return active.note;
  if (annotation.annotation_type === 'claim') return active.claim;
  if (annotation.annotation_type === 'summary') return active.summary;
  if (annotation.annotation_type === 'link') return active.link;
  return false;
}

export default function KnowledgeGraphView({
  model,
  onNodeClick,
}: {
  model: KnowledgeMapModel;
  onNodeClick: (entityId: string) => void;
}) {
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    claim: true,
    summary: true,
    link: true,
    note: true,
  });
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(
    model.annotationNodes[0]?.annotation_id ?? null,
  );
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(
    model.relatedObjectNodes[0]?.id ?? null,
  );

  const filterCounts = useMemo(
    () => ({
      claim: model.annotationNodes.filter((item) => item.annotation_type === 'claim').length,
      summary: model.annotationNodes.filter((item) => item.annotation_type === 'summary').length,
      link: model.annotationNodes.filter((item) => item.annotation_type === 'link').length,
      note: model.annotationNodes.filter((item) => item.annotation_type === 'note').length,
    }),
    [model.annotationNodes],
  );

  const filteredAnnotations = useMemo(
    () => model.annotationNodes.filter((annotation) => annotationMatchesFilter(annotation, filters)),
    [filters, model.annotationNodes],
  );

  const filteredObjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of model.edges) {
      if (!filteredAnnotations.some((annotation) => annotation.id === edge.source)) continue;
      ids.add(edge.target);
    }
    return ids;
  }, [filteredAnnotations, model.edges]);

  const filteredObjects = useMemo(
    () => model.relatedObjectNodes.filter((node) => filteredObjectIds.has(node.id)),
    [filteredObjectIds, model.relatedObjectNodes],
  );

  const selectedAnnotation = filteredAnnotations.find((item) => item.annotation_id === selectedAnnotationId) ?? null;
  const selectedObject = filteredObjects.find((item) => item.id === selectedObjectId) ?? null;
  const inspectorSelection = selectedAnnotation
    ? { kind: 'annotation' as const, node: selectedAnnotation }
    : selectedObject
      ? { kind: 'object' as const, node: selectedObject }
      : { kind: 'center' as const, node: model.centerNode };

  const annotationCardClass = (annotation: KnowledgeMapAnnotationNode) =>
    `w-full rounded-2xl border px-4 py-3 text-left transition ${
      annotation.annotation_id === selectedAnnotationId
        ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
        : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50'
    }`;

  const objectCardClass = (node: KnowledgeMapObjectNode) =>
    `w-full rounded-2xl border px-4 py-3 text-left transition ${
      node.id === selectedObjectId
        ? 'border-sky-600 bg-sky-50 text-sky-950 shadow-sm'
        : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50'
    }`;

  return (
    <div className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#fff_0%,#f8fafc_100%)] p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Knowledge Map
          </div>
          <div className="mt-2 text-sm text-slate-600">
            {filteredAnnotations.length} promoted annotations · {filteredObjects.length} related objects
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTER_ORDER.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setFilters((current) => ({ ...current, [filter.key]: !current[filter.key] }))}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                filters[filter.key]
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {filter.label}
              <span className="ml-1 opacity-80">{filterCounts[filter.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,280px)_minmax(0,1fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white/90 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Promoted annotations
            </div>
            <div className="mt-3 space-y-3">
              {filteredAnnotations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                  No promoted annotations match the current filters.
                </div>
              ) : (
                filteredAnnotations.map((annotation) => (
                  <button
                    key={annotation.annotation_id}
                    type="button"
                    onClick={() => {
                      setSelectedAnnotationId(annotation.annotation_id);
                      setSelectedObjectId(null);
                    }}
                    className={annotationCardClass(annotation)}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80">
                      {annotation.annotation_type}
                    </div>
                    <div className="mt-2 text-sm font-semibold">{annotation.label}</div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-300 bg-slate-950 px-5 py-6 text-white shadow-xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              Center object
            </div>
            <div className="mt-4 text-2xl font-semibold">{model.centerNode.label}</div>
            <div className="mt-2 text-sm text-slate-300">{model.centerNode.entity_type}</div>
            {model.centerNode.summary && (
              <p className="mt-4 text-sm leading-6 text-slate-200">{model.centerNode.summary}</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white/90 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Related objects
            </div>
            <div className="mt-3 space-y-3">
              {filteredObjects.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                  No related objects surfaced from the visible annotations.
                </div>
              ) : (
                filteredObjects.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => {
                      setSelectedObjectId(node.id);
                      setSelectedAnnotationId(null);
                    }}
                    className={objectCardClass(node)}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {node.target_type}
                    </div>
                    <div className="mt-2 text-sm font-semibold">{node.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{node.subtitle}</div>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>

        <KnowledgeMapInspector
          selection={inspectorSelection}
          onOpenObject={onNodeClick}
        />
      </div>
    </div>
  );
}
