import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Link2,
  LoaderCircle,
  Plus,
  Trash2,
} from 'lucide-react';

import type {
  AnnotationRelation,
  AnnotationRelationCreate,
  AnnotationRelationType,
} from '../api/types';

export interface AnnotationRelationsPanelProps {
  annotationId: string;
  relations: AnnotationRelation[];
  loading: boolean;
  error: string;
  onOpenAnnotation: (annotationId: string) => void;
  onCreateRelation: (payload: AnnotationRelationCreate) => Promise<void>;
  onDeleteRelation: (relationId: string) => Promise<void>;
}

export const ANNOTATION_RELATION_TYPE_OPTIONS: AnnotationRelationType[] = [
  'references',
  'explains',
  'refines',
  'contradicts',
  'same_variable',
  'variable_evolves_to',
  'value_passed_to',
  'depends_on',
  'evidence_for',
];

export function groupAnnotationRelations(
  annotationId: string,
  relations: AnnotationRelation[],
): { outgoing: AnnotationRelation[]; incoming: AnnotationRelation[] } {
  return relations.reduce(
    (groups, relation) => {
      if (relation.source_annotation_id === annotationId) {
        groups.outgoing.push(relation);
      } else if (relation.target_annotation_id === annotationId) {
        groups.incoming.push(relation);
      }
      return groups;
    },
    { outgoing: [] as AnnotationRelation[], incoming: [] as AnnotationRelation[] },
  );
}

export function getRelationPeerId(
  annotationId: string,
  relation: AnnotationRelation,
): string {
  return relation.source_annotation_id === annotationId
    ? relation.target_annotation_id
    : relation.source_annotation_id;
}

export default function AnnotationRelationsPanel({
  annotationId,
  relations,
  loading,
  error,
  onOpenAnnotation,
  onCreateRelation,
  onDeleteRelation,
}: AnnotationRelationsPanelProps) {
  const groupedRelations = useMemo(
    () => groupAnnotationRelations(annotationId, relations),
    [annotationId, relations],
  );
  const [targetAnnotationId, setTargetAnnotationId] = useState('');
  const [relationType, setRelationType] =
    useState<AnnotationRelationType>('references');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const visibleError = formError || error;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextTargetAnnotationId = targetAnnotationId.trim();
    if (!nextTargetAnnotationId) {
      setFormError('Target annotation id is required.');
      return;
    }

    if (nextTargetAnnotationId === annotationId) {
      setFormError('Cannot create a relation to the current annotation.');
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      await onCreateRelation({
        target_annotation_id: nextTargetAnnotationId,
        relation_type: relationType,
        description: '',
        meta: {},
      });
      setTargetAnnotationId('');
      setRelationType('references');
    } catch (submitError) {
      setFormError(
        submitError instanceof Error
          ? submitError.message
          : 'Failed to create relation.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function renderGroup(
    title: 'Outgoing' | 'Incoming',
    items: AnnotationRelation[],
    direction: 'outgoing' | 'incoming',
  ) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {direction === 'outgoing' ? (
              <ArrowUpRight size={14} className="text-sky-600" />
            ) : (
              <ArrowDownLeft size={14} className="text-emerald-600" />
            )}
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              {title}
            </h3>
          </div>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
            {items.length}
          </span>
        </div>

        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-500">
            No {direction} relations.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((relation) => {
              const peerId = getRelationPeerId(annotationId, relation);
              const isMarkdownReference =
                relation.source_kind === 'markdown_link';

              return (
                <div
                  key={relation.relation_id}
                  className="border-l-2 border-slate-200 bg-white/70 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-medium text-white">
                          {relation.relation_type}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500">
                          {direction === 'outgoing' ? 'Outgoing' : 'Incoming'} /{' '}
                          {relation.source_kind}
                        </span>
                        {isMarkdownReference && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                            <Link2 size={12} />
                            Markdown reference
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenAnnotation(peerId)}
                        className="mt-2 inline-flex max-w-full items-center rounded-md px-1 py-0.5 text-left text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                      >
                        <span className="truncate">{peerId}</span>
                      </button>

                      {relation.description ? (
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          {relation.description}
                        </p>
                      ) : null}
                    </div>

                    {relation.source_kind === 'manual' ? (
                      <button
                        type="button"
                        aria-label={`Delete relation ${relation.relation_id}`}
                        onClick={() => void onDeleteRelation(relation.relation_id)}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                        Read-only
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="mt-4 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Relations</div>
          <div className="mt-1 text-xs text-slate-500">
            Local annotation neighborhood
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 ring-1 ring-inset ring-slate-200">
              <LoaderCircle size={12} className="animate-spin" />
              Loading
            </span>
          ) : (
            <span className="rounded-full bg-white px-2 py-1 ring-1 ring-inset ring-slate-200">
              {groupedRelations.outgoing.length + groupedRelations.incoming.length}{' '}
              total
            </span>
          )}
        </div>
      </div>

      {visibleError ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
        >
          {visibleError}
        </div>
      ) : null}

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Target ID
            </span>
            <input
              value={targetAnnotationId}
              onChange={(event) => setTargetAnnotationId(event.target.value)}
              placeholder="ann-123"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300"
            />
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Type
            </span>
            <select
              value={relationType}
              onChange={(event) =>
                setRelationType(event.target.value as AnnotationRelationType)
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              {ANNOTATION_RELATION_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              Add
            </button>
          </div>
        </div>
      </form>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {renderGroup('Outgoing', groupedRelations.outgoing, 'outgoing')}
        {renderGroup('Incoming', groupedRelations.incoming, 'incoming')}
      </div>
    </section>
  );
}
