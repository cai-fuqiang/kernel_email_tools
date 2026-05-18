import type { AnnotationListItem, AnnotationTargetRef, KnowledgeEntity } from '../../api/types';
import { ENTITY_TYPES, annotationDisplayLabel, isPromotedKnowledgeAnnotation } from './knowledgeUtils';

export type KnowledgeMapCenterNode = {
  id: string;
  label: string;
  entity_type: string;
  summary: string;
};

export type KnowledgeMapAnnotationNode = {
  id: string;
  annotation_id: string;
  annotation_type: string;
  label: string;
  body: string;
  pinned: boolean;
  target_type: string;
  target_ref: string;
};

export type KnowledgeMapObjectNode = {
  id: string;
  target_type: string;
  target_ref: string;
  label: string;
  subtitle: string;
  role: string;
  navigable: boolean;
};

export type KnowledgeMapEdge = {
  id: string;
  source: string;
  target: string;
  kind: 'annotates' | 'references';
};

export type KnowledgeMapModel = {
  centerNode: KnowledgeMapCenterNode;
  annotationNodes: KnowledgeMapAnnotationNode[];
  relatedObjectNodes: KnowledgeMapObjectNode[];
  edges: KnowledgeMapEdge[];
};

function targetMatchesCenter(
  target: Pick<AnnotationTargetRef, 'target_type' | 'target_ref'>,
  center: Pick<KnowledgeEntity, 'entity_type' | 'entity_id'>,
) {
  return target.target_type === center.entity_type && target.target_ref === center.entity_id;
}

function toRelatedObjectNode(target: AnnotationTargetRef): KnowledgeMapObjectNode {
  return {
    id: target.target_ref,
    target_type: target.target_type,
    target_ref: target.target_ref,
    label: target.target_label || target.target_ref,
    subtitle: target.target_subtitle || target.target_type,
    role: target.role || '',
    navigable: ENTITY_TYPES.includes(target.target_type),
  };
}

function collectRelatedTargets(
  annotation: AnnotationListItem,
  center: Pick<KnowledgeEntity, 'entity_type' | 'entity_id'>,
): AnnotationTargetRef[] {
  const related: AnnotationTargetRef[] = [];
  const primaryTarget = {
    target_type: annotation.target_type,
    target_ref: annotation.target_ref,
    target_label: annotation.target_label,
    target_subtitle: annotation.target_subtitle,
    anchor: annotation.anchor,
    role: 'primary',
  };

  if (!targetMatchesCenter(primaryTarget, center)) {
    related.push(primaryTarget);
  }

  for (const target of annotation.related_targets) {
    if (targetMatchesCenter(target, center)) continue;
    related.push(target);
  }

  return related;
}

function annotationTouchesCenter(
  annotation: AnnotationListItem,
  center: Pick<KnowledgeEntity, 'entity_type' | 'entity_id'>,
) {
  if (annotation.target_type === center.entity_type && annotation.target_ref === center.entity_id) {
    return true;
  }
  return annotation.related_targets.some((target) => targetMatchesCenter(target, center));
}

export function buildKnowledgeMapModel({
  center,
  annotations,
}: {
  center: KnowledgeEntity;
  annotations: AnnotationListItem[];
}): KnowledgeMapModel {
  const centerNode: KnowledgeMapCenterNode = {
    id: center.entity_id,
    label: center.canonical_name,
    entity_type: center.entity_type,
    summary: center.summary || '',
  };

  const filtered = annotations.filter(
    (annotation) => isPromotedKnowledgeAnnotation(annotation) && annotationTouchesCenter(annotation, center),
  );

  const annotationNodes: KnowledgeMapAnnotationNode[] = filtered.map((annotation) => ({
    id: annotation.annotation_id,
    annotation_id: annotation.annotation_id,
    annotation_type: annotation.annotation_type,
    label: annotationDisplayLabel(annotation),
    body: annotation.body,
    pinned: annotation.pinned,
    target_type: annotation.target_type,
    target_ref: annotation.target_ref,
  }));

  const relatedObjectMap = new Map<string, KnowledgeMapObjectNode>();
  const edges: KnowledgeMapEdge[] = [];

  for (const annotation of filtered) {
    edges.push({
      id: `${center.entity_id}->${annotation.annotation_id}`,
      source: center.entity_id,
      target: annotation.annotation_id,
      kind: 'annotates',
    });

    for (const target of collectRelatedTargets(annotation, center)) {
      if (!target.target_ref) continue;
      if (!relatedObjectMap.has(target.target_ref)) {
        relatedObjectMap.set(target.target_ref, toRelatedObjectNode(target));
      }
      edges.push({
        id: `${annotation.annotation_id}->${target.target_ref}`,
        source: annotation.annotation_id,
        target: target.target_ref,
        kind: 'references',
      });
    }
  }

  return {
    centerNode,
    annotationNodes,
    relatedObjectNodes: Array.from(relatedObjectMap.values()),
    edges,
  };
}
