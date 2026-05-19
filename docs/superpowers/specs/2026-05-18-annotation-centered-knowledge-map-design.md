# Annotation-Centered Knowledge Map

## Goal

Redesign the kernel knowledge layer so that annotation becomes the single durable knowledge primitive across code, mail, commits, manuals, and specs, while the graph UI becomes a lightweight, readable knowledge map instead of a generic force-directed network.

The success criteria are:

1. Any important object in the system can be annotated through one consistent model.
2. Knowledge links are expressed through annotations instead of a growing set of direct object-to-object knowledge edges.
3. The default map becomes easier to read than the current Cytoscape force graph.
4. Phase 2 stays intentionally light enough to ship without introducing a heavyweight claim/evidence ontology.

## Current Problems

### Knowledge model is split across incompatible mental models

The repository currently has:

- a general `AnnotationORM` model used across email, code, and spec-like targets
- `AnnotationRelationORM` for annotation-to-annotation links
- a separate `KnowledgeEntityORM / KnowledgeRelationORM / KnowledgeEvidenceORM` stack
- a knowledge graph UI that assumes entities and relations are the main product surface

This is powerful but heavy. In practice it creates two competing centers of gravity:

- annotations as the place where human knowledge actually gets written
- knowledge entities as the place where the graph expects truth to live

That tension makes curation harder than it should be.

### The current graph is hard to read

The existing graph view in [web/src/components/KnowledgeGraphView.tsx](/Users/wangfuqiang49/workspace/tmp/kernel_email_tools/web/src/components/KnowledgeGraphView.tsx:1):

- uses a generic force-directed layout
- renders small colored dots with external labels
- shows too many relation labels at once
- relies on color legend more than layout hierarchy

The result is visually noisy and product-light. It looks like an internal debugging graph rather than a durable knowledge navigation surface.

### The next model step risks becoming too heavy

A fully normalized `SourceDocument -> SourceSegment -> Evidence -> Claim -> Entity/Relation` ontology is attractive, but it is too much for the next iteration. The user goal is not to build a graph database first. The user goal is to make kernel knowledge easier to capture, connect, and revisit.

## Design Direction

Phase 2 should adopt an annotation-centered model:

- objects are anchors
- annotations are the knowledge layer
- annotation relations carry durable human meaning
- the map only visualizes high-value knowledge, not every note

This keeps the system closer to how users already work. It also matches the strength of the current codebase, which already has a unified annotation substrate in [src/storage/models.py](/Users/wangfuqiang49/workspace/tmp/kernel_email_tools/src/storage/models.py:291) and [src/storage/annotation_store.py](/Users/wangfuqiang49/workspace/tmp/kernel_email_tools/src/storage/annotation_store.py:1).

## Core Principles

### 1. Everything important can be annotated

The system should treat annotation as a universal knowledge capability. Phase 2 should support annotation targets for:

- `mail_thread`
- `mail_message`
- `commit`
- `spec_section`
- `symbol`
- `file`
- `subsystem`
- `concept`

This does not mean every object needs a custom product page first. It means the annotation model and APIs must be able to point at all of them consistently.

### 2. Annotation is the knowledge primitive

Phase 2 should not introduce a separate first-class `Claim` model. Instead:

- `claim` becomes an `annotation_type`
- evidence-like excerpts also remain annotations
- summaries remain annotations
- lightweight bridge nodes remain annotations

This keeps Phase 2 light while leaving room for Phase 3 to extract a dedicated claim model if the data proves it is needed.

### 3. No empty knowledge nodes

The system should not allow truly empty annotations that exist only as invisible join records. The lightest allowed unit is a `link` annotation with minimal semantic payload:

- `annotation_type`
- `short_label`
- `primary_target`

This prevents graph pollution and keeps every node interpretable later.

### 4. One primary target, many related targets

Each annotation should have:

- exactly one `primary_target`
- zero or more `related_targets`

This keeps ownership and reading flow clear. An annotation may discuss multiple objects, but it must still belong somewhere first.

### 5. Knowledge edges route through annotations

Phase 2 should avoid introducing new manual object-to-object knowledge edges. Knowledge should primarily flow through:

- `object -> annotation`
- `annotation -> related object`
- `annotation -> annotation`

Purely structural system edges may still exist internally, but they are not the user-facing knowledge model.

### 6. The map is selective, not exhaustive

The default map should not render every annotation. It should only render high-value annotations:

- `claim`
- `summary`
- `link`
- pinned or explicitly promoted `note`

Lower-value annotations such as routine excerpts and scratch notes should stay in drawers, sidebars, or detail panels.

## Phase 2 Data Model

### Object layer

Objects remain anchors, not truth nodes. They may be modeled as existing entities, external resources, or target references, but the mental model is the same:

- code objects such as symbols and files
- source objects such as mail messages, threads, commits, and spec sections
- conceptual objects such as subsystems and concepts

These objects need stable identifiers and human-readable labels, but they do not need to absorb all knowledge semantics directly.

### Annotation layer

Extend the existing annotation model with a richer cross-domain schema.

Recommended Phase 2 fields:

- `annotation_type`
  - `excerpt`
  - `claim`
  - `note`
  - `summary`
  - `link`
- `short_label`
  - one-line readable title for map and list rendering
- `primary_target_type`
  - canonical target type
- `primary_target_ref`
  - canonical target identifier
- `related_targets`
  - array of `{target_type, target_ref, label?, subtitle?, anchor?, role?}`
- `pinned`
  - whether this annotation is promoted into the default map
- `map_weight`
  - optional lightweight ranking hint for future display ordering

The existing `target_type`, `target_ref`, `target_label`, `target_subtitle`, `anchor`, and `meta` fields already point in this direction. Phase 2 should build on them rather than replace them.

### Annotation relation layer

Annotation-to-annotation relations remain valuable and should become the main place for durable knowledge semantics.

Recommended relation vocabulary:

- `supports`
- `refines`
- `contradicts`
- `summarizes`
- `related_to`

These do not need to replace every existing relation type immediately. Phase 2 can preserve current relation types for compatibility and progressively normalize the UI vocabulary.

## Graph and Map Design

### Rename the surface

The default UI should move away from the language of a raw graph. Recommended product name:

- `Knowledge Map`

This is more accurate than `Local knowledge graph` because the surface is curated, selective, and reading-oriented.

### Replace generic force graph with semantic map

The default map should not be a free force-directed network. It should use a semantic layout:

- center column: current object
- left column: high-value annotations attached to that object
- right column: related objects reached through selected annotations
- side inspector: annotation detail, backlinks, and source context

This turns the map into a reasoning aid:

`current object -> what we know about it -> where that knowledge points next`

### Visual hierarchy

The map should establish role hierarchy through size, card treatment, and whitespace instead of color overload.

Node classes:

- object card
  - largest
  - neutral surface
  - stable title and type badge
- promoted annotation card
  - medium
  - visible annotation type chip
  - short label
- related object pill/card
  - smaller
  - optimized for jump navigation

### Label and edge rules

Edges should be visually quiet:

- no always-on edge labels by default
- highlight edges only for hover, focus, or selection
- explain semantics in the inspector, not on every line

This reduces clutter and avoids the current "hairball with captions" effect.

### Filtering rules

The map should include a small top filter bar instead of a bottom legend.

Initial filters:

- `Claims`
- `Summaries`
- `Links`
- `Pinned notes`

This lets the user choose what knowledge layer is visible without learning a color taxonomy.

### Relationship to reading views

The map should not become the full reading experience. Its job is navigation and structural understanding. The full content belongs in:

- annotation detail drawer
- right-side inspector
- object detail page sections

## Phase 2 Scope

Phase 2 should do the following:

- generalize annotation targets
- enrich annotation types and target linkage
- route knowledge navigation through annotations
- redesign the default graph into a knowledge map
- integrate map-friendly annotation promotion rules

Phase 2 should explicitly not do the following:

- create a first-class `Claim` table
- build a normalized evidence ontology
- introduce a graph database
- fully replace `KnowledgeEntityORM` with a new storage stack
- auto-infer large numbers of object-to-object knowledge edges
- ship a heavy global graph explorer

## Rollout Strategy

### Stage 1: Expand unified annotation schema

Extend the annotation model, APIs, and store so all important object types can be targets and so annotations can carry:

- richer type semantics
- short labels
- related targets
- promotion flags

### Stage 2: Shift knowledge navigation to annotation bridges

Use annotation-centered traversal as the user-facing knowledge model. Existing entity and relation surfaces may continue to exist internally, but the map and curation flow should center annotations.

### Stage 3: Replace graph UI with knowledge map

Redesign the current graph surface into the new semantic layout with filter bar, inspector, and selective rendering.

### Stage 4: Integrate annotation flows across source surfaces

Ensure users can create and review promoted annotations directly from:

- code browsing
- mail thread reading
- knowledge workbench
- spec/manual surfaces where available

### Stage 5: Stabilize vocabulary and promotion logic

Normalize annotation types, relation types, and high-value map rules. Avoid letting the system become a free-form pile of unreviewed note shapes.

## Phase 3 Reserved Plan

Phase 3 should remain a future upgrade path, not a Phase 2 dependency.

Candidate upgrades:

- extract `claim` into its own object model if data proves the need
- normalize source segmentation into first-class `source_segment`
- derive stable object-to-object knowledge edges from reviewed annotations
- add curated topic maps or canvas-like human-authored maps
- introduce stronger review and merge workflows for duplicate claims

## Why This Direction Is Better

This design is intentionally less ambitious than a full ontology-first graph system. That is a feature, not a compromise.

It fits the current repository because:

- annotations are already the strongest existing human knowledge substrate
- users already think in terms of "annotate this thing"
- the map quality problem is mostly a visualization and model-center problem, not a missing graph-engine problem

Phase 2 should therefore make the system more unified, not more theoretical.
