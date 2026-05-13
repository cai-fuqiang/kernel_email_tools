# Code Annotation Preview Design

## Goal

Add a lightweight annotation preview experience to the kernel code browser so readers can inspect an annotation with nearby code context without losing their place in the current file. The preview should feel related to the existing symbol preview: a compact floating preview for quick reading, plus a shareable full preview page for deeper inspection.

The feature must preserve the current annotation reading model:

- Single-click an annotation card to jump/select its code range.
- Double-click an annotation card to pin or unpin it.
- Use an explicit preview action when the user wants a richer split-pane preview.

## Model And Reasoning Guidance

Use the current Codex/GPT-5 coding model with high reasoning effort for implementation. The work is mostly UI state, routing, data loading, and reuse of existing preview/detail components. High reasoning is enough because the risk is interaction conflict rather than algorithmic complexity.

Do not rely on or publish hidden chain-of-thought. Use an auditable engineering trace instead:

- Keep the interaction contract explicit in tests and commit notes.
- Verify that preview actions do not trigger card single-click or double-click behavior.
- Verify the full preview route from a real annotated kernel file.
- Record any data-loading fallback that is needed for missing or deleted annotations.

## Current Context

The code browser already has three relevant foundations:

1. `KernelSymbolQuickPreviewPopover` provides a draggable and resizable floating preview with code context, zoom, and an `Open full preview` action.
2. `KernelSymbolPreviewPage` provides a full-page preview experience with a left code pane and right symbol information.
3. `AnnotationPanel` already renders annotation cards, detail modal content, replies, tags, and edit/publication actions.

The existing annotation detail modal is useful for management tasks, but it is not optimized for reading annotation context beside code. The new preview should therefore be a reading-first surface rather than a replacement for every existing annotation management action.

## Interaction Model

### Annotation Card Actions

Each annotation card gets a compact preview icon button. The button opens the floating annotation preview and must not trigger card selection, jump, or pin behavior. It should use the same event isolation pattern as other card actions, for example a `data-no-annotation-select` marker and `stopPropagation`.

Recommended action mapping:

- Card single click: jump to code range and select the annotation.
- Card double click: toggle pin.
- Preview button click: open floating preview.
- Existing detail/edit controls: keep their current behavior unless later consolidation is explicitly approved.

Avoid hover previews. Hover would conflict with reading, scrolling, and the 2.5D roller focus effect.

### Floating Preview

The floating preview opens near the current viewport and behaves like the symbol quick preview:

- Draggable and resizable.
- Keyboard-closeable with Escape.
- Contains an `Open full preview` action.
- Keeps its own scroll position and does not move the main code pane unless the user chooses an explicit jump/open action.

The floating preview is a two-pane compact surface:

- Left pane: code context for the annotation file and line range.
- Right pane: annotation content and metadata.

The left pane should center or scroll to the annotation range when opened. The annotation range should be highlighted in a way that matches existing selected/range marker colors, while surrounding code stays readable.

The right pane should show:

- Annotation title or line range label.
- Author, status, created/updated time when available.
- Markdown body.
- Tags.
- Reply count and recent replies.
- Compact actions such as open full preview, open in code browser, and existing detail/edit when permitted.

### Full Preview Page

Add a shareable full-page annotation preview route:

`/kernel-code/annotation-preview?v=<version>&path=<file_path>&annotation=<annotation_id>`

The route uses `v` and `path` as the primary loading keys so it can fetch the file and file annotations without requiring a new backend endpoint. The `annotation` query parameter selects the target annotation after the file annotations are loaded.

The page layout should mirror the symbol preview page:

- Header with back navigation, file/version metadata, and `Open in Atlas`.
- Left pane showing code for the file, highlighted around the annotation range.
- Right pane showing the annotation preview content, replies, tags, and permitted actions.

If the annotation id is missing or no longer present in that file:

- Keep the file loaded when possible.
- Show a clear empty state in the right pane.
- Offer `Open in Atlas` for the file rather than failing the entire page.

## Component Architecture

### New Components

`AnnotationQuickPreviewPopover`

- Owns floating frame state and preview presentation.
- Receives the selected annotation, file metadata, callbacks, and open/close state.
- Loads code context only while open.
- Reuses symbol preview behavior where practical instead of copying low-level drag/resize logic.

`AnnotationPreviewContent`

- Shared right-pane annotation rendering used by the popover and full preview page.
- Extracts the read-only parts of the existing annotation detail modal: metadata, markdown body, tags, replies, status, and compact actions.
- Does not own card selection or pinning state.

`KernelAnnotationPreviewPage`

- Full-page route for `v`, `path`, and `annotation`.
- Loads the file and annotation list.
- Chooses the target annotation and passes it into the shared preview content.

`KernelCodePreviewPane`

- Shared code preview pane for symbol and annotation preview surfaces when feasible.
- Supports highlighted ranges, initial scroll-to-line, zoom, and loading/error states.
- If extracting this shared pane becomes too broad for the first implementation, the first version can keep symbol code intact and introduce an annotation-specific pane with the same visual contract.

### Existing Components To Update

`AnnotationPanel`

- Add a preview icon button to annotation cards.
- Wire the button to a callback such as `onPreviewAnnotation(annotation)`.
- Ensure the preview action is excluded from row click/double-click selection handling.

`KernelCodePage`

- Own the active preview annotation state for the current browser session.
- Render `AnnotationQuickPreviewPopover`.
- Build the full preview URL with the current kernel version, file path, and annotation id.

`App`

- Add a lazy route for `KernelAnnotationPreviewPage`.

## Data Flow

### Floating Preview Data Flow

1. User clicks an annotation preview button.
2. `AnnotationPanel` calls `onPreviewAnnotation(annotation)`.
3. `KernelCodePage` stores the annotation as the active preview target.
4. `AnnotationQuickPreviewPopover` loads file content with the existing kernel file API for `annotation.version` and `annotation.file_path`.
5. The popover renders code context on the left and `AnnotationPreviewContent` on the right.

The popover should prefer annotation data already present in the page to avoid an unnecessary list reload. It can fetch file content lazily because the preview may not be used during a normal reading session.

### Full Preview Data Flow

1. The route reads `v`, `path`, and `annotation` from query parameters.
2. The page loads the kernel file for `v/path`.
3. The page loads annotations for that same file.
4. The page selects the annotation matching the id.
5. The page renders the code pane and annotation content.

This avoids adding a backend `GET annotation by id` endpoint for the first version. If full-page loading later needs to support arbitrary annotation ids without file path context, a backend lookup endpoint can be added as a separate change.

## Visual Design

The preview should be dense and work-focused, not decorative. It should feel like an inspector tool:

- Code and annotation panes are peers.
- The highlighted range is the primary relationship cue.
- Metadata uses compact labels and restrained color.
- Markdown content remains readable at small popover sizes.
- Cards or nested cards are avoided inside the preview; use simple pane sections and dividers.

Use icon buttons from the existing icon set. The preview icon should be distinct from edit, delete, publish, and jump. A good default is `PanelRightOpen`, `Eye`, or `SquareArrowOutUpRight`, depending on what already reads best next to existing actions.

## Accessibility And Keyboard Behavior

- Preview controls are real buttons with visible focus rings.
- The preview button has an `aria-label`, for example `Preview annotation for lines 120-135`.
- Escape closes the floating preview.
- The popover traps focus only if it behaves modally; otherwise it should use normal floating-panel focus behavior and return focus to the triggering button on close.
- Full preview page works without hover-only interactions.
- Reduced-motion users should not receive animated zoom or transform effects beyond simple state changes.

## Performance

- Load preview code only when the popover opens.
- Lazy-load the full preview page route.
- Do not rerender the annotation roller when only the floating preview frame is dragged or resized.
- Keep markdown rendering scoped to the active preview.
- For the first version, use the same code rendering strategy as the existing symbol preview. If large kernel files become slow, add line-windowing around the annotation range as a later optimization.

## Testing And Verification

Implementation should include focused tests for:

1. Annotation preview button click calls the preview handler without triggering card selection or pin toggling.
2. Full preview URL is generated with version, path, and annotation id.
3. The full preview page selects the target annotation from loaded file annotations.
4. Missing annotation ids render a useful empty state.

Manual/browser verification should cover:

1. Open `http://aliyun.cloud.vm:8080/app/kernel-code?v=v6.7-rc7&path=crypto%2Falgif_aead.c`.
2. Click an annotation preview button and confirm the floating split preview opens.
3. Confirm the left preview pane highlights the annotation range.
4. Confirm single-click still jumps/selects and double-click still toggles pin.
5. Open the full preview page and confirm `Open in Atlas` returns to the code browser at the annotation line.
6. Confirm no horizontal overlap or text clipping at a narrow desktop width.

## Success Criteria

1. Annotation cards provide an explicit preview action.
2. Floating preview shows code context on the left and annotation details on the right.
3. Full preview page is shareable through `v`, `path`, and `annotation` query parameters.
4. Existing card single-click, double-click pin, jump, edit, publish, delete, and reply behaviors continue to work.
5. Preview opening does not create cross-pane scroll sync side effects.
6. Build and browser checks pass after implementation.

## Out Of Scope

- New backend annotation-by-id API.
- Hover preview.
- Changing the annotation data model.
- Replacing the existing annotation detail modal.
- Cross-file annotation aggregation.
- Virtualized code preview rendering unless performance testing shows it is necessary.
