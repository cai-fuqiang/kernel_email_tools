import { describe, expect, it } from 'vitest';
import type { KnowledgeEntity, KnowledgeRelation } from '../../../api/types';
import {
  buildSupportPanelItems,
  summarizeRelations,
  summarizeTimeline,
} from '../knowledgeLayout';

function entity(patch: Partial<KnowledgeEntity>): KnowledgeEntity {
  return {
    entity_id: 'entity',
    entity_type: 'concept',
    canonical_name: 'Entity',
    slug: 'entity',
    aliases: [],
    summary: '',
    description: '',
    status: 'active',
    meta: {},
    created_by: '',
    updated_by: '',
    created_at: '',
    updated_at: '',
    ...patch,
  };
}

function relation(patch: Partial<KnowledgeRelation>): KnowledgeRelation {
  return {
    relation_id: 'relation',
    source_entity_id: 'source',
    target_entity_id: 'target',
    relation_type: 'related_to',
    description: '',
    evidence_id: '',
    meta: {},
    created_by: '',
    updated_by: '',
    created_at: '',
    updated_at: '',
    ...patch,
  };
}

describe('knowledge layout helpers', () => {
  it('orders support panels by document-reader priority', () => {
    expect(
      buildSupportPanelItems({
        evidenceCount: 3,
        notesCount: 2,
        historyCount: 5,
        relationCount: 4,
        timelineCount: 1,
      }).map((item) => item.id),
    ).toEqual(['evidence', 'notes', 'history', 'relations', 'timeline']);
  });

  it('keeps support panel counts readable', () => {
    expect(
      buildSupportPanelItems({
        evidenceCount: 103,
        notesCount: 0,
        historyCount: 12,
        relationCount: 4,
        timelineCount: 8,
      })[0],
    ).toMatchObject({
      id: 'evidence',
      label: 'Evidence',
      countLabel: '99+',
    });
  });

  it('summarizes timeline by earliest dated events first and caps the list', () => {
    const events = [
      { id: 'late', event_type: 'commit' as const, title: 'Late', date: '2024-02-01' },
      { id: 'none', event_type: 'note' as const, title: 'No date', date: '' },
      { id: 'early', event_type: 'decision' as const, title: 'Early', date: '2024-01-01' },
      { id: 'middle', event_type: 'mail_thread' as const, title: 'Middle', date: '2024-01-15' },
    ];

    expect(summarizeTimeline(events, 2).map((event) => event.id)).toEqual(['early', 'middle']);
  });

  it('summarizes incoming and outgoing relations together', () => {
    const summary = summarizeRelations({
      outgoing: [
        relation({
          relation_id: 'r1',
          source_entity_id: 'a',
          target_entity_id: 'b',
          relation_type: 'explains',
          target_entity: entity({
            entity_id: 'b',
            entity_type: 'concept',
            canonical_name: 'B',
          }),
        }),
      ],
      incoming: [
        relation({
          relation_id: 'r2',
          source_entity_id: 'c',
          target_entity_id: 'a',
          relation_type: 'part_of',
          source_entity: entity({
            entity_id: 'c',
            entity_type: 'subsystem',
            canonical_name: 'C',
          }),
        }),
      ],
    });

    expect(summary.total).toBe(2);
    expect(summary.items.map((item) => item.name)).toEqual(['B', 'C']);
    expect(summary.items.map((item) => item.direction)).toEqual(['outgoing', 'incoming']);
  });
});
