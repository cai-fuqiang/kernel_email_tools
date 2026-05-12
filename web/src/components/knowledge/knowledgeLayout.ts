import type { KnowledgeRelation } from '../../api/types';
import type { KnowledgeTimelineEvent } from '../../utils/knowledgeMeta';
import { formatDate, relationEntityName, relationLabel } from './knowledgeUtils';

export type SupportPanelId = 'evidence' | 'notes' | 'history' | 'relations' | 'timeline';

export type SupportPanelCounts = {
  evidenceCount: number;
  notesCount: number;
  historyCount: number;
  relationCount: number;
  timelineCount: number;
};

export type SupportPanelItem = {
  id: SupportPanelId;
  label: string;
  description: string;
  count: number;
  countLabel: string;
};

function readableCount(count: number) {
  if (count > 99) return '99+';
  return String(count);
}

export function buildSupportPanelItems(counts: SupportPanelCounts): SupportPanelItem[] {
  return [
    {
      id: 'evidence',
      label: 'Evidence',
      description: 'Claims, sources, and verification material',
      count: counts.evidenceCount,
      countLabel: readableCount(counts.evidenceCount),
    },
    {
      id: 'notes',
      label: 'Notes',
      description: 'Human reviewer notes',
      count: counts.notesCount,
      countLabel: readableCount(counts.notesCount),
    },
    {
      id: 'history',
      label: 'History',
      description: 'Entity changes and audit trail',
      count: counts.historyCount,
      countLabel: readableCount(counts.historyCount),
    },
    {
      id: 'relations',
      label: 'Relations',
      description: 'Full graph and relation editing',
      count: counts.relationCount,
      countLabel: readableCount(counts.relationCount),
    },
    {
      id: 'timeline',
      label: 'Timeline',
      description: 'Full timeline editing',
      count: counts.timelineCount,
      countLabel: readableCount(counts.timelineCount),
    },
  ];
}

export function summarizeTimeline(timeline: KnowledgeTimelineEvent[], limit = 3) {
  return [...timeline]
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    })
    .slice(0, limit)
    .map((event) => ({
      ...event,
      displayDate: event.date ? formatDate(event.date) : 'No date',
    }));
}

export type RelationSummaryItem = {
  relationId: string;
  relationType: string;
  label: string;
  name: string;
  direction: 'outgoing' | 'incoming';
};

export function summarizeRelations(
  relations: {
    outgoing: KnowledgeRelation[];
    incoming: KnowledgeRelation[];
  },
  limit = 4,
) {
  const outgoing = relations.outgoing.map<RelationSummaryItem>((relation) => ({
    relationId: relation.relation_id,
    relationType: relation.relation_type,
    label: relationLabel(relation.relation_type),
    name: relationEntityName(relation.target_entity, relation.target_entity_id),
    direction: 'outgoing',
  }));
  const incoming = relations.incoming.map<RelationSummaryItem>((relation) => ({
    relationId: relation.relation_id,
    relationType: relation.relation_type,
    label: relationLabel(relation.relation_type),
    name: relationEntityName(relation.source_entity, relation.source_entity_id),
    direction: 'incoming',
  }));

  const items = [...outgoing, ...incoming];
  return {
    total: items.length,
    items: items.slice(0, limit),
    remaining: Math.max(0, items.length - limit),
  };
}
