# Patch Browser Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zoomed patch-browser overlay that keeps file selection and context expansion in sync with the inline patch browser.

**Architecture:** Move patch-browser interaction state to a shared panel component within commit detail, then render the same browser view inline and inside a larger overlay. Keep the backend contract unchanged and preserve existing expand/collapse behavior.

**Tech Stack:** React, TypeScript, Tailwind CSS, existing kernel commit patch browser helpers

---

### Task 1: Share patch-browser state across inline and zoomed views

**Files:**
- Modify: `web/src/components/kernelCode/CodeHistoryPanel.tsx`

- [ ] Add a commit-detail-local patch browser panel component that owns selected patch rows, expander loading state, and expander errors.
- [ ] Update the patch browser view so each rendered instance uses its own scroll container while calling the shared expand handler.

### Task 2: Add the zoom overlay UX

**Files:**
- Modify: `web/src/components/kernelCode/CodeHistoryPanel.tsx`

- [ ] Add a zoom button to the patch browser header.
- [ ] Render a larger overlay with close controls and `Escape` handling.
- [ ] Reuse the same patch browser view inside the overlay so file switching and context expansion stay synchronized.

### Task 3: Verify behavior and record the change

**Files:**
- Modify: `AGENTS.md`

- [ ] Run targeted verification for TypeScript compilation and any affected frontend tests if available.
- [ ] Append one Architecture Decisions Log entry describing the shared-state zoom overlay behavior.
- [ ] Clear Current Feature Context before finishing.
