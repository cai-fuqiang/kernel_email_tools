import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KnowledgeEntity, KnowledgeRelation } from '../../../api/types';
import KnowledgeGraphView from '../../KnowledgeGraphView';
import {
  buildEntityListSubtitle,
  isKnowledgeMapObjectNavigable,
  buildSupportPanelItems,
  splitRelationsForDocument,
  summarizeRelations,
  summarizeTimeline,
} from '../knowledgeLayout';
import type { KnowledgeMapModel, KnowledgeMapObjectNode } from '../knowledgeMap';

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

function mapModel(): KnowledgeMapModel {
  return {
    centerNode: {
      id: 'symbol:do_mmap',
      label: 'do_mmap',
      entity_type: 'symbol',
      summary: 'Maps memory for the target VMA.',
    },
    annotationNodes: [
      {
        id: 'ann-1',
        annotation_id: 'ann-1',
        annotation_type: 'claim',
        label: 'Caller already holds mmap_lock',
        body: 'The caller enters with mmap_lock held.',
        pinned: false,
        target_type: 'symbol',
        target_ref: 'symbol:do_mmap',
      },
    ],
    relatedObjectNodes: [
      {
        id: 'commit:abc123',
        target_type: 'commit',
        target_ref: 'commit:abc123',
        label: 'abc123',
        subtitle: 'commit',
        role: '',
        navigable: false,
      },
    ],
    edges: [
      { id: 'center->ann-1', source: 'symbol:do_mmap', target: 'ann-1', kind: 'annotates' },
      { id: 'ann-1->commit:abc123', source: 'ann-1', target: 'commit:abc123', kind: 'references' },
    ],
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

  it('labels subtopic search results with their parent topic', () => {
    expect(
      buildEntityListSubtitle(
        entity({
          canonical_name: 'VMCS lifecycle',
          meta: {
            subtopic_parent: {
              entity_id: 'concept:vmcs',
              canonical_name: 'VMCS',
            },
          },
        }),
      ),
    ).toBe('Subtopic of VMCS');
  });

  it('splits subtopics away from ordinary relations for document rendering', () => {
    const groups = splitRelationsForDocument({
      outgoing: [
        relation({
          relation_id: 'subtopic-1',
          relation_type: 'has_subtopic',
          target_entity_id: 'concept:vmcs-lifecycle',
          target_entity: entity({
            entity_id: 'concept:vmcs-lifecycle',
            canonical_name: 'VMCS lifecycle',
          }),
        }),
        relation({
          relation_id: 'related-1',
          relation_type: 'related_to',
          target_entity_id: 'concept:vmx',
          target_entity: entity({
            entity_id: 'concept:vmx',
            canonical_name: 'VMX',
          }),
        }),
      ],
      incoming: [
        relation({
          relation_id: 'incoming-1',
          relation_type: 'part_of',
          source_entity_id: 'concept:kvm',
          source_entity: entity({
            entity_id: 'concept:kvm',
            canonical_name: 'KVM',
          }),
        }),
      ],
    });

    expect(groups.subtopics).toHaveLength(1);
    expect(groups.subtopics[0].relation_id).toBe('subtopic-1');
    expect(groups.related.outgoing).toHaveLength(1);
    expect(groups.related.outgoing[0].relation_id).toBe('related-1');
    expect(groups.related.incoming).toHaveLength(1);
    expect(groups.related.incoming[0].relation_id).toBe('incoming-1');
  });

  it('shows Knowledge Map instead of Local knowledge graph', () => {
    const html = renderToStaticMarkup(
      createElement(KnowledgeGraphView, {
        model: mapModel(),
        onNodeClick: () => {},
      }),
    );

    expect(html).toContain('Knowledge Map');
  });

  it('shows filter controls for promoted annotation classes', () => {
    const html = renderToStaticMarkup(
      createElement(KnowledgeGraphView, {
        model: mapModel(),
        onNodeClick: () => {},
      }),
    );

    expect(html).toContain('Claims');
    expect(html).toContain('Summaries');
    expect(html).toContain('Links');
    expect(html).toContain('Pinned notes');
  });

  it('treats non-knowledge targets as non-navigable map objects', () => {
    const node: KnowledgeMapObjectNode = {
      id: 'commit:abc123',
      target_type: 'commit',
      target_ref: 'commit:abc123',
      label: 'abc123',
      subtitle: 'commit',
      role: '',
      navigable: false,
    };

    expect(isKnowledgeMapObjectNavigable(node)).toBe(false);
  });

  it('treats supported knowledge entity targets as navigable map objects', () => {
    const node: KnowledgeMapObjectNode = {
      id: 'concept:memory-management',
      target_type: 'concept',
      target_ref: 'concept:memory-management',
      label: 'Memory management',
      subtitle: 'concept',
      role: '',
      navigable: true,
    };

    expect(isKnowledgeMapObjectNavigable(node)).toBe(true);
  });
});
