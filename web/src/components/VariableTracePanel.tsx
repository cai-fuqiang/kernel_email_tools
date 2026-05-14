import { useMemo } from 'react';
import { ArrowDownRight, GitBranch, MoveRight } from 'lucide-react';

import type { AnnotationRelation, AnnotationRelationType } from '../api/types';
import { getRelationPeerId } from './AnnotationRelationsPanel';

export const VARIABLE_TRACE_RELATION_TYPES: AnnotationRelationType[] = [
  'same_variable',
  'variable_evolves_to',
  'value_passed_to',
  'depends_on',
];

export interface VariableTracePanelProps {
  annotationId: string;
  relations: AnnotationRelation[];
  onOpenAnnotation: (annotationId: string) => void;
}

export function getVariableTraceItems(
  annotationId: string,
  relations: AnnotationRelation[],
): Array<{
  relation: AnnotationRelation;
  peerId: string;
  direction: 'outgoing' | 'incoming';
}> {
  return relations
    .filter((relation) => VARIABLE_TRACE_RELATION_TYPES.includes(relation.relation_type))
    .filter(
      (relation) =>
        relation.source_annotation_id === annotationId ||
        relation.target_annotation_id === annotationId,
    )
    .map((relation) => ({
      relation,
      peerId: getRelationPeerId(annotationId, relation),
      direction:
        relation.source_annotation_id === annotationId ? 'outgoing' : 'incoming',
    }));
}

function relationLabel(type: AnnotationRelationType): string {
  switch (type) {
    case 'same_variable':
      return 'same variable';
    case 'variable_evolves_to':
      return 'evolves to';
    case 'value_passed_to':
      return 'value passed to';
    case 'depends_on':
      return 'depends on';
    default:
      return type;
  }
}

function variableName(meta: Record<string, unknown>): string {
  const value = meta.variable ?? meta.variable_name ?? meta.symbol ?? meta.name;
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export default function VariableTracePanel({
  annotationId,
  relations,
  onOpenAnnotation,
}: VariableTracePanelProps) {
  const traceItems = useMemo(
    () => getVariableTraceItems(annotationId, relations),
    [annotationId, relations],
  );

  if (traceItems.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-slate-50 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-cyan-100 px-3 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-600 text-white shadow-sm">
              <GitBranch size={14} />
            </span>
            Variable trace
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Code-flow relations around this annotation.
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-cyan-800 ring-1 ring-inset ring-cyan-200">
          {traceItems.length} hops
        </span>
      </div>

      <div className="space-y-1 px-3 py-3">
        {traceItems.map(({ relation, peerId, direction }) => {
          const variable = variableName(relation.meta);
          return (
            <button
              key={relation.relation_id}
              type="button"
              onClick={() => onOpenAnnotation(peerId)}
              className="group grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-cyan-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2"
            >
              <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-cyan-700 ring-1 ring-inset ring-cyan-200 group-hover:bg-cyan-600 group-hover:text-white">
                {direction === 'outgoing' ? (
                  <MoveRight size={14} />
                ) : (
                  <ArrowDownRight size={14} className="rotate-180" />
                )}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-slate-950 px-2 py-0.5 font-mono text-[11px] font-medium text-white">
                    {relationLabel(relation.relation_type)}
                  </span>
                  <span className="text-[11px] font-medium text-slate-500">
                    {direction === 'outgoing' ? 'from here' : 'into here'}
                  </span>
                  {variable ? (
                    <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-cyan-800 ring-1 ring-inset ring-cyan-200">
                      {variable}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block truncate text-sm font-semibold text-slate-900">
                  {peerId}
                </span>
                {relation.description ? (
                  <span className="mt-1 block text-xs leading-5 text-slate-600">
                    {relation.description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
