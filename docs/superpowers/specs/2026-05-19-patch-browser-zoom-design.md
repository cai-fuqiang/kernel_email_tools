# Patch Browser Zoom Design

**Goal:** Add a larger patch-browser overlay inside commit detail so users can inspect diffs and keep context expansion available while zoomed.

**Approach:** Keep all patch-browser expansion state in one place inside the commit detail flow, then render the same browser view both inline and inside a larger overlay. The enlarged view should preserve file selection, expanded context, loading states, and navigation actions instead of opening a separate data flow.

**UX Notes:**
- Add a zoom button in the patch browser header.
- Open a larger overlay focused on the patch browser instead of resizing the whole commit detail modal.
- Preserve expand/collapse behavior in both inline and zoomed views.
- Close via backdrop, close button, or `Escape`.
