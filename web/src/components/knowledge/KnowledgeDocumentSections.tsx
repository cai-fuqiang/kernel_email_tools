import { ArrowRight, Clock3, GitBranch } from 'lucide-react';
import type { KnowledgeEntity, KnowledgeRelation } from '../../api/types';
import type { KnowledgeEntityMetaSchema } from '../../utils/knowledgeMeta';
import EntityExplanationEditor from './EntityExplanationEditor';
import type { SupportPanelId } from './knowledgeLayout';
import {
  relationEntityName,
} from './knowledgeUtils';
import {
  splitRelationsForDocument,
  summarizeRelations,
  summarizeTimeline,
} from './knowledgeLayout';

interface KnowledgeDocumentSectionsProps {
  selectedEntity: KnowledgeEntity;
  selectedMetaSchema: KnowledgeEntityMetaSchema;
  relations: {
    outgoing: KnowledgeRelation[];
    incoming: KnowledgeRelation[];
  };
  canWrite: boolean;
  saving: boolean;
  onSave: () => void;
  onOpenSupportPanel: (panel: SupportPanelId) => void;
  onSelectEntity: (entityId: string) => void;
  onUpdateSummary: (value: string) => void;
  onUpdateDescription: (value: string) => void;
}

export default function KnowledgeDocumentSections({
  selectedEntity,
  selectedMetaSchema,
  relations,
  canWrite,
  saving,
  onSave,
  onOpenSupportPanel,
  onSelectEntity,
  onUpdateSummary,
  onUpdateDescription,
}: KnowledgeDocumentSectionsProps) {
  const timelineSummary = summarizeTimeline(selectedMetaSchema.timeline, 3);
  const relationGroups = splitRelationsForDocument(relations);
  const relationSummary = summarizeRelations(relationGroups.related, 4);

  return (
    <div className="space-y-5">
      <EntityExplanationEditor
        selectedEntity={selectedEntity}
        canWrite={canWrite}
        saving={saving}
        onSave={onSave}
        onUpdateSummary={onUpdateSummary}
        onUpdateDescription={onUpdateDescription}
        variant="document"
      />

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <GitBranch className="h-4 w-4 text-slate-500" />
              Subtopics
            </div>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Child topics that expand this page without sharing its evidence.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenSupportPanel('relations')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Manage <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {relationGroups.subtopics.length > 0 ? (
            relationGroups.subtopics.map((relation) => {
              const subtopic = relation.target_entity;
              const subtopicId = relation.target_entity_id;
              return (
                <button
                  key={relation.relation_id}
                  type="button"
                  onClick={() => onSelectEntity(subtopicId)}
                  className="flex w-full items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {relationEntityName(subtopic, subtopicId)}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">Subtopic</div>
                    {relation.description && (
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                        {relation.description}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
              No subtopics yet.
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Clock3 className="h-4 w-4 text-slate-500" />
                Timeline
              </div>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                Key moments without opening the full editor.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenSupportPanel('timeline')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Open <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {timelineSummary.length > 0 ? (
              timelineSummary.map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3 text-[11px] font-medium text-slate-600">
                    <span>{event.displayDate}</span>
                    <span>{event.event_type.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {event.title || 'Untitled event'}
                  </div>
                  {event.summary && (
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                      {event.summary}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
                No timeline events yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <GitBranch className="h-4 w-4 text-slate-500" />
                Relations
              </div>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                Closest connected knowledge items.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenSupportPanel('relations')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Open <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {relationSummary.items.length > 0 ? (
              relationSummary.items.map((item) => (
                <div
                  key={item.relationId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{item.name}</div>
                    <div className="mt-0.5 text-xs text-slate-600">
                      {item.direction} · {item.label}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
                No relations yet.
              </div>
            )}
            {relationSummary.remaining > 0 && (
              <div className="text-xs text-slate-600">
                {relationSummary.remaining} more in the full relations panel.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
