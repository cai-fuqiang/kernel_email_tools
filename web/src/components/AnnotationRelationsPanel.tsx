import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  FileSearch,
  Link2,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import type {
  AnnotationRelation,
  AnnotationRelationCreate,
  AnnotationRelationType,
  CodeAnnotation,
} from '../api/types';
import AnnotationIdBadge from './AnnotationIdBadge';
import AnnotationQuickPreviewPopover from './kernelCode/AnnotationQuickPreviewPopover';

export interface AnnotationRelationsPanelProps {
  annotationId: string;
  subjectAnnotation: CodeAnnotation | null;
  candidateAnnotations: CodeAnnotation[];
  relations: AnnotationRelation[];
  loading: boolean;
  error: string;
  onOpenAnnotation: (annotationId: string) => void;
  onCreateRelation: (payload: AnnotationRelationCreate) => Promise<void>;
  onDeleteRelation: (relationId: string) => Promise<void>;
  onSearchAnnotations: (query: string) => Promise<CodeAnnotation[]>;
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

const RELATION_LABELS: Record<
  AnnotationRelationType,
  { outgoing: string; incoming: string; hint: string }
> = {
  references: {
    outgoing: 'This annotation references target',
    incoming: 'Target references this annotation',
    hint: 'Cross-reference another note.',
  },
  explains: {
    outgoing: 'This annotation explains target',
    incoming: 'Target explains this annotation',
    hint: 'Use when one note clarifies another.',
  },
  refines: {
    outgoing: 'This annotation refines target',
    incoming: 'Target refines this annotation',
    hint: 'Narrow or improve a broader note.',
  },
  contradicts: {
    outgoing: 'This annotation contradicts target',
    incoming: 'Target contradicts this annotation',
    hint: 'Capture an explicit conflict.',
  },
  same_variable: {
    outgoing: 'Same variable as target',
    incoming: 'Same variable as this annotation',
    hint: 'Both notes refer to the same variable.',
  },
  variable_evolves_to: {
    outgoing: 'Variable here evolves to target',
    incoming: 'Variable in target evolves to this note',
    hint: 'Track state progression.',
  },
  value_passed_to: {
    outgoing: 'Value here is passed to target',
    incoming: 'Value in target is passed to this note',
    hint: 'Track parameter/value flow.',
  },
  depends_on: {
    outgoing: 'This annotation depends on target',
    incoming: 'Target depends on this annotation',
    hint: 'Prerequisite or dependency relation.',
  },
  evidence_for: {
    outgoing: 'This annotation is evidence for target',
    incoming: 'Target is evidence for this annotation',
    hint: 'Support a claim with concrete evidence.',
  },
};

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
  subjectAnnotation,
  candidateAnnotations,
  relations,
  loading,
  error,
  onOpenAnnotation,
  onCreateRelation,
  onDeleteRelation,
  onSearchAnnotations,
}: AnnotationRelationsPanelProps) {
  const groupedRelations = useMemo(
    () => groupAnnotationRelations(annotationId, relations),
    [annotationId, relations],
  );
  const [targetAnnotationId, setTargetAnnotationId] = useState<string | null>(
    null,
  );
  const [relationType, setRelationType] =
    useState<AnnotationRelationType>('references');
  const [relationDirection, setRelationDirection] = useState<
    'outgoing' | 'incoming'
  >('outgoing');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CodeAnnotation[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [previewAnnotation, setPreviewAnnotation] = useState<CodeAnnotation | null>(
    null,
  );

  const relatedPeerIds = useMemo(() => {
    const peers = new Set<string>();
    for (const relation of relations) {
      peers.add(getRelationPeerId(annotationId, relation));
    }
    return peers;
  }, [annotationId, relations]);

  const nearbyCandidates = useMemo(() => {
    if (!subjectAnnotation) return [];
    const scored = candidateAnnotations
      .filter((item) => item.annotation_id !== annotationId)
      .map((item) => {
        const sameFile = item.file_path === subjectAnnotation.file_path;
        const overlap =
          item.start_line <= subjectAnnotation.end_line &&
          item.end_line >= subjectAnnotation.start_line;
        const distance = sameFile
          ? Math.abs(item.start_line - subjectAnnotation.start_line)
          : 100000;
        const alreadyLinked = relatedPeerIds.has(item.annotation_id);
        return { item, sameFile, overlap, distance, alreadyLinked };
      })
      .sort((a, b) => {
        if (a.sameFile !== b.sameFile) return a.sameFile ? -1 : 1;
        if (a.overlap !== b.overlap) return a.overlap ? -1 : 1;
        if (a.distance !== b.distance) return a.distance - b.distance;
        if (a.alreadyLinked !== b.alreadyLinked) return a.alreadyLinked ? 1 : -1;
        return b.item.updated_at.localeCompare(a.item.updated_at);
      })
      .slice(0, 8)
      .map((entry) => entry.item);
    return scored;
  }, [annotationId, candidateAnnotations, relatedPeerIds, subjectAnnotation]);

  const candidateMap = useMemo(() => {
    const map = new Map<string, CodeAnnotation>();
    for (const candidate of [...candidateAnnotations, ...searchResults]) {
      map.set(candidate.annotation_id, candidate);
    }
    return map;
  }, [candidateAnnotations, searchResults]);

  useEffect(() => {
    if (targetAnnotationId) {
      setPreviewAnnotation(candidateMap.get(targetAnnotationId) || null);
      return;
    }
    setPreviewAnnotation(null);
  }, [candidateMap, targetAnnotationId]);

  const visibleError = formError || error;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextTargetAnnotationId = (targetAnnotationId || '').trim();
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
        meta: relationDirection === 'incoming' ? { reverse_direction: true } : {},
      });
      setTargetAnnotationId(null);
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

  async function performSearch() {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setFormError('');
    try {
      const result = await onSearchAnnotations(query);
      setSearchResults(
        result.filter((item) => item.annotation_id !== annotationId).slice(0, 12),
      );
    } catch (searchError) {
      setFormError(
        searchError instanceof Error
          ? searchError.message
          : 'Failed to search annotations.',
      );
    } finally {
      setSearching(false);
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
              <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white">
                          {RELATION_LABELS[relation.relation_type][direction]}
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
    <>
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
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Relation direction
              </span>
              <div className="flex rounded-lg border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setRelationDirection('outgoing')}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${relationDirection === 'outgoing' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  Current {'->'} target
                </button>
                <button
                  type="button"
                  onClick={() => setRelationDirection('incoming')}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${relationDirection === 'incoming' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  Target {'->'} current
                </button>
              </div>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Relation type
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
                    {RELATION_LABELS[option][relationDirection]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
              <ArrowRightLeft size={13} />
              {RELATION_LABELS[relationType][relationDirection]}
            </span>
            <span className="ml-2">{RELATION_LABELS[relationType].hint}</span>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Nearby candidates
            </div>
            {nearbyCandidates.length > 0 ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5">
                {nearbyCandidates.map((candidate) => (
                  <button
                    key={candidate.annotation_id}
                    type="button"
                    onClick={() => setTargetAnnotationId(candidate.annotation_id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100 ${targetAnnotationId === candidate.annotation_id ? 'bg-sky-50 ring-1 ring-sky-200' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <AnnotationIdBadge annotationId={candidate.annotation_id} compact />
                      <span className="text-slate-500">
                        L{candidate.start_line}-{candidate.end_line}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-slate-600">{candidate.body}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                No nearby candidates in current context.
              </div>
            )}
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Full-library search
              </span>
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Annotation ID or text"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300"
                />
              </div>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void performSearch()}
                className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100"
              >
                {searching ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <FileSearch size={14} />
                )}
                Search
              </button>
            </div>
          </div>

          {searchResults.length > 0 ? (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5">
              {searchResults.map((candidate) => (
                <button
                  key={candidate.annotation_id}
                  type="button"
                  onClick={() => setTargetAnnotationId(candidate.annotation_id)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100 ${targetAnnotationId === candidate.annotation_id ? 'bg-sky-50 ring-1 ring-sky-200' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <AnnotationIdBadge annotationId={candidate.annotation_id} compact />
                    <span className="truncate text-slate-500">
                      {candidate.file_path}:L{candidate.start_line}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-slate-600">{candidate.body}</div>
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting || !targetAnnotationId}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              Create relation
            </button>
          </div>
        </div>
      </form>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {renderGroup('Outgoing', groupedRelations.outgoing, 'outgoing')}
        {renderGroup('Incoming', groupedRelations.incoming, 'incoming')}
      </div>
    </section>

    <AnnotationQuickPreviewPopover
      isOpen={!!previewAnnotation}
      annotation={previewAnnotation}
      anchorRect={null}
      avoidRect={null}
      onClose={() => setTargetAnnotationId(null)}
      onOpenFullPreview={() => {}}
      onOpenInAtlas={() => {}}
      onOpenAnnotation={onOpenAnnotation}
    />
    </>
  );
}
