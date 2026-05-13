# Code Annotation Roller Redesign

## Goal

Redesign the kernel code browser annotation experience so annotations remain visually tied to the code while reading. The right annotation panel should follow code scrolling, support annotation-driven code navigation, and make selected or annotated line ranges obvious in the code gutter.

## Model And Reasoning Guidance

Use the current Codex/GPT-5 coding model with high reasoning effort for planning and implementation. The task has enough UI state coordination, DOM measurement, and scroll feedback-loop risk to justify high reasoning, but it does not require extra-high reasoning unless implementation reveals a hard-to-reproduce synchronization bug.

Do not rely on or publish hidden chain-of-thought. Use an auditable engineering trace instead:

- State the active hypothesis before fixing scroll behavior.
- Write failing tests for pure sync and marker logic before production changes.
- Capture verification evidence from Vitest, TypeScript build, and browser interaction.
- Summarize decisions, trade-offs, and observed behavior in commit or final notes.

## Current Problems

1. `KernelCodePage` tracks selected lines, but not the line range currently centered in the code viewport.
2. `AnnotationPanel` filters by `selectedLines`; it does not know which annotation should be active while the user scrolls code.
3. Code rows show a small annotation dot per line, which does not communicate multi-line annotation ranges.
4. Annotation cards do not have a first-class jump action back to code.
5. A future bidirectional sync needs guardrails so code scrolling and annotation scrolling do not trigger each other indefinitely.

## Design Direction

Use a dual-mode annotation rail:

- A pinned region at the top for explicit line or annotation selection.
- A 2.5D roller region below it for scroll-following annotations.

The code pane and annotation rail should be peers. Code scrolling can drive the roller, and annotation navigation can drive the code pane. Both sides must expose enough visual cues to show the current relationship without forcing the user to infer it from line numbers alone.

## Interaction Model

### Code Scroll To Annotation

When the user scrolls the code pane, the page computes the line nearest the vertical center of the code viewport. The active annotation becomes the annotation whose line range contains that center line, or the nearest annotation by distance when no annotation overlaps the center line.

The annotation roller scrolls so that active annotation is centered in the roller viewport. The active card is visually strongest. Neighboring cards remain visible but smaller and quieter, creating a 2.5D roller effect.

### Annotation Scroll To Code

The annotation roller can also drive the code pane. When the user scrolls the annotation list and a new card settles near the roller center, the code pane scrolls to that annotation's `start_line`.

This sync should be restrained:

- Use a short source lock, for example `code`, `annotation`, or `jump`, to prevent feedback loops.
- Do not reverse-sync during programmatic scroll animations.
- Resume normal sync after the scroll settles.
- Pause auto-sync while the user is editing or composing an annotation.

### Annotation Jump

Each annotation card gets a compact jump button. Clicking it:

1. Scrolls the code pane to the annotation `start_line`.
2. Selects the annotation range in the code pane.
3. Pins the annotation at the top of the annotation panel.
4. Keeps the annotation tab open.

### Code Line Click

Clicking a code line keeps the existing line selection behavior and adds pinning:

- If the clicked line intersects one or more annotations, the most relevant annotation is pinned.
- If the line has no annotation, the pinned region shows the selected line range and the create-annotation affordance.
- Shift-click range selection pins the first overlapping annotation in the selected range, or shows the empty selected range state.

## Right Panel Layout

The existing `Annotations` inspector view should remain the entry point. Inside it, the annotation content becomes:

1. Composer controls for the current selected range when applicable.
2. Pinned annotation block.
3. 2.5D roller block.

The pinned block is compact and sticky at the top of the annotation panel body. It should not consume the full panel when the annotation is long; long pinned content can still use the existing detail modal.

The roller block shows root annotations ordered by `start_line`. Replies stay attached to their root card and inherit the root card's line range for sync.

## 2.5D Roller Visual Treatment

The roller should feel like a focused wheel without becoming decorative or hard to read.

Use these states:

- Active card: normal scale, full opacity, stronger border, subtle shadow, visible line label.
- Near cards: slightly reduced scale and opacity.
- Far cards: more compressed, lower opacity, still readable enough to identify.

Do not use a real 3D cylinder transform for annotation text. Long markdown content must remain readable. Respect reduced motion by disabling animated transform effects and using color/weight changes only.

## Code Gutter Markers

Replace the current one-dot-only marker with a range-aware marker system:

- Single-line annotation: small dot.
- Multi-line annotation range: thin vertical line spanning every line in the range.
- Selected single line: stronger dot plus selected-row background.
- Selected multi-line range: stronger vertical line spanning the selected range plus selected-row background.
- Overlap between annotation and selection: selected range uses the stronger style, annotation range remains visible on non-selected lines.

The marker column should keep stable width so code text does not shift during hover, selection, or annotation state changes.

## Connection Cues

On desktop widths, show a lightweight relationship cue between active code and active annotation:

- Highlight the active code range gutter marker.
- Highlight the active annotation card edge with the same color family.
- Optionally draw a subtle connector line in the gutter/inspector gap when measurements are stable.

The connector line is enhancement-only. If it becomes fragile during resize, collapsed panels, or mobile layout, the synchronized highlights are sufficient.

## Accessibility And Performance

- Use real `button` elements for annotation jumps and card actions.
- Keep visible focus rings.
- Provide `aria-label` text for jump controls such as `Jump to lines 120-135`.
- Respect `prefers-reduced-motion`.
- Throttle scroll-derived active line computation with `requestAnimationFrame`.
- Avoid measuring every code row on every scroll. Use row height and container scroll position where possible; query the DOM only when needed.
- Keep mobile behavior simple: stacked layout can use jump buttons and highlights without desktop connector lines.

## Success Criteria

1. Scrolling code changes the active annotation in the 2.5D roller.
2. Scrolling the roller can move the code pane to the centered annotation without scroll-loop jitter.
3. Clicking an annotation jump button scrolls code and pins that annotation.
4. Clicking or selecting code lines pins the related annotation or selected empty range.
5. Multi-line annotations and selections render as vertical gutter lines.
6. Existing create, edit, publish, delete, detail modal, and reply behaviors remain intact.
7. Vitest covers sync selection and marker classification logic.
8. Browser verification confirms no horizontal text overlap, no unstable hover shifts, and usable reduced-motion behavior.

## Out Of Scope

- New backend annotation APIs.
- Full SVG connector layout if it proves fragile.
- Virtualized code rendering.
- Redesigning non-annotation inspector tabs.
- Changing the annotation data model.
