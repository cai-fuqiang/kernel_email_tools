import { useEffect, useRef, useCallback } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import type { KnowledgeEntity, KnowledgeRelation } from '../api/types';

const TYPE_COLORS: Record<string, string> = {
  concept: '#4f46e5',
  subsystem: '#0891b2',
  mechanism: '#059669',
  issue: '#dc2626',
  symbol: '#7c3aed',
  patch_discussion: '#d97706',
};

const DEFAULT_COLOR = '#6b7280';

interface KnowledgeGraphViewProps {
  nodes: KnowledgeEntity[];
  edges: KnowledgeRelation[];
  centerEntityId: string;
  onNodeClick: (entityId: string) => void;
}

export default function KnowledgeGraphView({
  nodes,
  edges,
  centerEntityId,
  onNodeClick,
}: KnowledgeGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const handleNodeClick = useCallback(
    (entityId: string) => {
      onNodeClick(entityId);
    },
    [onNodeClick]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const elements: cytoscape.ElementDefinition[] = [];

    for (const node of nodes) {
      const color = TYPE_COLORS[node.entity_type] || DEFAULT_COLOR;
      elements.push({
        data: {
          id: node.entity_id,
          label: node.canonical_name,
          type: node.entity_type,
          summary: node.summary || '',
          status: node.status,
          isCenter: node.entity_id === centerEntityId,
        },
        classes: node.entity_id === centerEntityId ? 'center' : '',
        style: {
          'background-color': color,
          color: '#1f2937',
        },
      });
    }

    for (const edge of edges) {
      const sourceId = edge.source_entity_id;
      const targetId = edge.target_entity_id;
      if (
        !nodes.find((n) => n.entity_id === sourceId) ||
        !nodes.find((n) => n.entity_id === targetId)
      ) {
        continue;
      }

      elements.push({
        data: {
          id: edge.relation_id,
          source: sourceId,
          target: targetId,
          label: edge.relation_type.replace(/_/g, ' '),
          description: edge.description || '',
        },
      });
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'font-size': '12px',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 6,
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            'text-overflow-wrap': 'anywhere',
            'width': 24,
            'height': 24,
            'border-width': 2,
            'border-color': '#fff',
            'shape': 'ellipse',
          },
        },
        {
          selector: 'node.center',
          style: {
            'width': 34,
            'height': 34,
            'border-width': 3,
            'border-color': '#1e1b4b',
            'font-size': '14px',
            'font-weight': 700,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': '#4f46e5',
            'border-width': 3,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': '#d1d5db',
            'target-arrow-color': '#9ca3af',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'font-size': '10px',
            'label': 'data(label)',
            'color': '#6b7280',
            'text-rotation': 'autorotate',
            'text-margin-y': -6,
          },
        },
        {
          selector: 'edge:hover',
          style: {
            'line-color': '#6366f1',
            'target-arrow-color': '#6366f1',
            'width': 2.5,
            'color': '#4f46e5',
            'font-size': '11px',
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: true,
        animationDuration: 400,
        fit: true,
        padding: 40,
        nodeRepulsion: () => 6000,
        idealEdgeLength: () => 120,
        gravity: 0.25,
      },
      minZoom: 0.3,
      maxZoom: 3,
      wheelSensitivity: 0.3,
    });

    cy.on('tap', 'node', (evt: EventObject) => {
      const nodeId = evt.target.data('id');
      if (nodeId) handleNodeClick(nodeId);
    });

    // Tooltip on hover
    cy.on('mouseover', 'node', (evt: EventObject) => {
      const summary = evt.target.data('summary');
      if (summary) {
        const tip = document.createElement('div');
        tip.id = 'cy-tooltip';
        tip.className =
          'absolute z-50 max-w-xs rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-700 shadow-lg';
        tip.textContent = summary;
        tip.style.left = evt.renderedPosition.x + 12 + 'px';
        tip.style.top = evt.renderedPosition.y - 12 + 'px';
        containerRef.current?.appendChild(tip);
      }
    });

    cy.on('mouseout', 'node', () => {
      const tip = document.getElementById('cy-tooltip');
      if (tip) tip.remove();
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [nodes, edges, centerEntityId, handleNodeClick]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div ref={containerRef} className="h-[520px] w-full" />
    </div>
  );
}
