# Knowledge Layout Redesign

## Goal

Redesign the knowledge workbench so the selected knowledge entity reads like a structured document instead of a long operations-heavy dashboard. The primary success criterion is that reading and editing the explanation becomes the dominant experience, while evidence, notes, history, and review flows stay accessible without constantly crowding the main content.

## Current Problems

1. The selected entity view is a long vertical stack of unrelated sections.
2. Reading content competes with heavy operational modules such as evidence, relations, notes, and draft review.
3. Important context is split between the main document flow and floating controls, which makes scanning and editing feel fragmented.
4. The entity list header is overloaded with search, stats, quick capture, and admin actions.
5. High-value supporting information is either too visible all the time or too easy to miss.

## Design Direction

Use a document-reader layout.

The selected knowledge entity should feel like a reusable internal knowledge page:

- The center column is for continuous reading and editing.
- The right rail is for navigation, queueing, metadata, and contextual actions.
- Heavy support surfaces open on demand instead of occupying permanent vertical space.

This keeps the main reading surface clean without hiding important workflow tools.

## Layout Structure

### Desktop

Use a two-column shell:

- Main document column: flexible wide content area.
- Right rail: fixed-width contextual work rail.

Do not keep a full-height always-open left entity navigator inside the knowledge page. Entity discovery and switching should move into the right rail so the selected entity can own the page.

### Mobile and Narrow Widths

Collapse the right rail into an overlay drawer or sheet opened from the header.

The mobile reading order should be:

1. Header
2. Summary
3. Explanation
4. Timeline summary
5. Relations summary

Evidence, notes, history, draft review, and entity switching should move behind explicit actions on narrow screens.

## Main Document Column

The main column should present content in this order:

1. Document header
2. Summary
3. Main explanation
4. Timeline summary
5. Relations summary

### Document Header

The header should include:

- Entity type
- Status
- Canonical name
- Aliases
- Last updated indicator
- Primary save action
- Secondary actions such as open rail or open support panels

The header should feel editorial rather than dashboard-like. It is the entry point for the page, not a control cluster.

### Summary

Keep the short answer near the top as a reusable answer block. It should be easy to read and easy to edit, since this is the most reusable piece of knowledge in downstream Ask flows.

### Main Explanation

This is the primary reading and editing surface.

- Give it the most width.
- Treat it like the body of an internal document.
- Keep editing controls close, but not visually dominant.
- Avoid surrounding it with unrelated metric cards or large utility sections.

### Timeline Summary

Do not show the full timeline editor inline by default.

Instead, show a compact summary:

- most recent events
- key milestones
- direct link to open the full timeline editing surface

This preserves temporal context without breaking reading flow.

### Relations Summary

Do not render the full graph and relation management tools inline by default.

Show a concise summary:

- most important connected entities
- relation counts
- relation types preview
- action to open the full relations surface

## Right Rail

The right rail becomes the operational sidecar for the document.

It should contain:

1. Search and entity switcher
2. Draft inbox or review queue
3. Entity metadata card
4. Entry points to support panels

### Search and Entity Switcher

Move entity discovery into the rail.

This area should support:

- search input
- result list
- recent or pinned entities
- lightweight switching between items

It should be optimized for fast context switching without taking over the whole page.

### Draft Inbox or Review Queue

Draft handling should not sit inline above the main document by default.

Instead:

- show queue state in the rail
- open the full draft review surface only when the user chooses to review a draft

Draft review is a task mode, not background reading context.

### Entity Metadata Card

Keep always-visible metadata in the rail:

- status
- tags
- type
- update time
- supporting entity facts

This information is important enough to stay visible, but not important enough to interrupt the document flow.

### Support Panel Triggers

The rail should provide explicit entry points for:

- evidence
- notes
- history
- full relations
- full timeline

These should read as secondary work surfaces, not sections of the core document.

## Support Surfaces

Avoid default modal dialogs for most support content. They interrupt reading too aggressively and hide too much context.

Prefer the following patterns.

### Evidence

Use a right-side drawer.

Reason:

- users need to compare evidence with the main explanation
- evidence is dense and inspectable
- a drawer preserves enough of the main document for side-by-side validation

### Notes

Use a drawer or collapsible side panel.

Reason:

- notes are supportive rather than primary
- users may want to glance at them while keeping the explanation visible

### History

Use a drawer or secondary expandable panel.

Reason:

- history is useful, but usually not part of the core reading path

### Draft Review

Use either:

- a dedicated full-width review sheet, or
- a dedicated task state within the page

Do not use a small modal.

Reason:

- review is a focused task
- it needs space for comparison, approval, and edits

### Full Relations and Full Timeline

Use expandable secondary surfaces rather than always-open inline modules.

Possible forms:

- drawer
- secondary page section revealed on demand
- dedicated focus mode

The important constraint is that these tools should not permanently displace the reading surface.

## Interaction Model

### Reading Mode

Default state when opening an entity:

- clean document center
- right rail visible on desktop
- support panels closed

### Editing Mode

Editing remains inline in the summary and explanation areas.

- Save stays visible and easy to reach.
- Editing should not require opening a separate modal.

### Inspection Mode

When a user opens evidence, notes, history, relations, or timeline details:

- keep the document visible if possible
- avoid full context loss
- make closing the support surface trivial

## Information Hierarchy

The page hierarchy should be:

1. What this entity is
2. The reusable answer
3. The fuller explanation
4. Temporal and relational context
5. Supporting verification and operational tools

This hierarchy should remain true in both layout and visual emphasis.

## Components Affected

The redesign will primarily affect:

- `KnowledgeWorkbench`
- `EntityListPanel`
- `EntityDetailHeader`
- `EntityExplanationEditor`
- `KnowledgeTimelinePanel`
- `EntityRelationsPanel`
- `EvidencePanel`
- `HumanNotesPanel`
- `EntityHistoryPanel`
- `DraftInboxPanel`
- `KnowledgeInspectorDock`

Expected architectural shift:

- inline heavy sections become summarized or deferred
- right-rail responsibilities expand
- floating dock behavior may be replaced or absorbed into the rail/drawer model

## Accessibility and Usability Requirements

- Keyboard focus order must match visible reading order.
- Support drawers must trap focus only while open and must restore focus on close.
- Mobile must preserve access to all hidden rail functions through explicit actions.
- Save and review actions must stay visible and understandable.
- Section headings must follow a clean hierarchy.
- Avoid hidden hover-only actions for critical workflows.

## Out of Scope

- Changing backend data models
- Redefining knowledge entity semantics
- Rewriting evidence or relation business logic
- Replacing the whole app shell or global navigation

## Expected Outcome

After the redesign:

- reading a knowledge entity feels calm and intentional
- editing the explanation feels central rather than incidental
- support information becomes easier to access without dominating the page
- draft review becomes a clearer task flow
- the page feels less like stacked admin modules and more like a durable knowledge document
