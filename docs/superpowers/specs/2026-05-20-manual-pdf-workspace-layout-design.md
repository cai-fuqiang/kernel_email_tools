# Manual PDF Workspace Layout Design

Date: 2026-05-20
Status: Proposed
Scope: `web/src/pages/ManualPdfPage.tsx`

## Goal

Make the PDF workspace feel closer to the kernel code browser on desktop by upgrading the shell around the reader:

- add elegant left and right collapsible rails
- allow dragging rail widths on desktop
- prioritize the center reader pane
- remove placeholder paragraph copy from the reader surface

This change is intentionally limited to the existing manual PDF page and does not change backend APIs, annotation data, or routing.

## Current Problems

The current PDF workspace has the right pieces but not the right interaction model:

- left and right panels collapse as large cards instead of editor-style rails
- panel widths are fixed and cannot be resized
- the reader is pushed down by metadata cards that are not needed during reading
- placeholder explanatory paragraphs make the page feel unfinished
- the center pane does not yet behave like the dominant surface

## Desired Experience

On desktop, the page should read like a three-column editor:

- a left document rail for metadata and outline
- a dominant center reader pane
- a right workspace rail for annotation tools and page-specific context

The rails should feel available even when collapsed, not removed. A collapsed rail becomes a slim vertical strip with a clear expansion affordance. The center reader should expand naturally as rails collapse.

## Layout Design

### Desktop Layout

At `xl` and above, the workspace uses a persistent three-column shell:

`left rail | reader | right rail`

Behavior:

- both rails start expanded
- the reader takes all remaining width
- each expanded rail has a bounded width range
- each rail can collapse independently into a slim strip
- when both rails are collapsed, the reader becomes the clear focus surface

### Narrow Screens

Below `xl`, the page keeps the simpler stacked layout:

- no drag handles
- normal expand/collapse buttons remain available
- layout remains readable without complex desktop-only interaction

This avoids introducing fragile pointer behavior on touch and narrow screens.

## Rail Behavior

### Expanded State

Expanded rails remain card-based containers with section content, but the framing should feel tighter and more editor-like than the current large workspace cards.

Left rail sections:

- document metadata
- outline

Right rail sections:

- annotation mode controls
- annotations for the active page
- document stats

### Collapsed State

Collapsed rails do not disappear. Instead they become slim vertical rails that:

- preserve their side in the layout
- show a short rail label or directional hint
- provide a single clear button to expand the rail

Collapsed rails should be visually lightweight but still obviously interactive.

## Resizing Design

Desktop rails support pointer-based resizing.

Behavior:

- the left rail has a resize handle between the left rail and reader
- the right rail has a resize handle between the reader and right rail
- dragging updates width live
- hover and active states make the handle discoverable
- the cursor switches to `col-resize`

Constraints:

- resizing only works while the rail is expanded
- each rail has a minimum width that preserves its content readability
- each rail has a maximum width so the reader remains dominant
- the reader also has an implicit minimum width by way of those bounds

Persistence:

- widths and collapse state live only in component state
- refresh resets the layout to defaults
- reopening a collapsed rail returns it to the default expanded width

## Reader Pane Design

The center pane should feel like the main product, not a demo shell.

### Header Controls

Keep a compact control bar with:

- reader mode controls
- zoom controls
- current mode/status chips

Remove explanatory copy that describes what the shell is doing. The reader should communicate through layout and state, not helper paragraphs.

### Metadata Placement

Remove the inline metadata cards from above the PDF viewport:

- title
- subtitle
- document id

Those details move to the left rail so the reader surface starts earlier.

### Page Surface

Keep the current placeholder canvas blocks for now, but remove all placeholder prose such as:

- center-pane readiness copy
- continuous-scroll explanation paragraphs inside page cards
- single-page focus explanation paragraphs inside page cards

Each page card should only show:

- page label
- active/focused status
- the canvas placeholder area

This keeps the page surface visually quiet and ready for future real rendering work.

## Visual Direction

The page should echo the kernel code browser without becoming a separate design system.

Key cues:

- slim collapsible side rails
- restrained handles between panels
- a dominant dark reader shell
- clean white page surfaces inside the reader
- compact state labels instead of descriptive paragraphs

The goal is not perfect visual parity, but matching the same mental model: rails frame the work, the center pane owns attention, and controls stay compact.

## State and Implementation Notes

All behavior stays inside `web/src/pages/ManualPdfPage.tsx`.

Expected local state additions:

- left rail width
- right rail width
- active resize side or pointer session state

Expected implementation approach:

- reuse existing collapse state
- add desktop-only resize handles
- update shell layout classes to support fixed-width rails plus flexible center pane
- move reader metadata into the left rail
- delete placeholder copy from the reader pane

No backend work is required.

## Testing and Verification

Verify at minimum:

1. Left rail can collapse and expand without breaking outline access.
2. Right rail can collapse and expand without breaking annotation access.
3. Dragging each expanded rail changes width live on desktop.
4. Drag handles are hidden when the corresponding rail is collapsed.
5. The reader grows when one or both rails collapse.
6. Placeholder paragraph text is removed from the reader pane.
7. Narrow-screen layout still stacks cleanly without desktop resize behavior.

## Risks

- `ManualPdfPage.tsx` is already responsible for multiple concerns, so interaction logic may become denser.
- Pointer event cleanup must be handled carefully to avoid stuck drag state.
- Desktop tuning must not regress the stacked mobile layout.

These risks are acceptable because the scope stays in one file and the user explicitly requested a focused interaction upgrade rather than a broader refactor.
