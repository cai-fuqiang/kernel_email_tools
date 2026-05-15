# Kernel Knowledge Base Product Refactor

## Goal

Refactor the project from an AI-forward kernel mail assistant into a kernel knowledge base platform with a strong human-facing workbench and reusable retrieval APIs.

The success criteria are:

1. The product surface no longer presents Ask, Agent Research, or other product-layer AI workflows.
2. The repository remains a strong retrieval and knowledge base backend for future external agents such as Hermes.
3. Human workflows become easier, especially creating and connecting code annotations inside the code-reading experience.
4. The overall product reads as a knowledge workbench instead of a collection of experimental tools.

## Product Definition

This project should become:

- a kernel knowledge base API
- a human-facing kernel knowledge production workbench
- a retrieval substrate that external agents can call

This project should not continue as:

- a first-party AI chat product
- an in-product research agent orchestrator
- a mixed surface where AI product features and knowledge workflows compete for attention

The product identity should be "kernel knowledge base" first, not "AI for kernel knowledge."

## Core Model Direction

Use `Evidence` as the primary conceptual anchor.

Recommended model progression:

`SourceDocument -> SourceSegment -> Evidence -> Claim -> Entity/Relation -> Knowledge Views`

This direction keeps the system grounded in inspectable source material. It also prevents AI-generated conclusions from becoming the primary truth surface. AI, if used later through external systems, should propose evidence, claims, or links for review rather than directly author product truth.

## Keep vs Remove

### Keep

Keep these capabilities in the project:

- keyword search
- semantic search
- hybrid search
- vector and embedding infrastructure
- thread reading and source inspection
- kernel code browsing
- annotation creation and review workflows
- annotation relations
- knowledge entities, relations, and evidence views
- manuals as a supporting evidence source

These are part of the long-term knowledge base substrate and are still useful whether the caller is a human or an external agent.

### Remove

Remove these product-layer AI capabilities completely:

- Ask product workflows
- Ask conversation history and session persistence
- Agent Research workflows
- research run orchestration, status views, and trace views
- AI draft generation flows tied to Ask or Agent Research

Removal should include:

- frontend pages
- frontend API client methods
- frontend types
- backend routers
- backend service wiring
- state initialization
- stores
- ORM models and read models
- tests
- database objects associated with these features

The removal is intentional hard deletion, not temporary hiding, deprecation, or archival retention.

## Architectural Boundary

The key product boundary is:

- retain retrieval infrastructure
- remove product-layer AI orchestration

In practice this means semantic retrieval, embeddings, and vector-backed search remain in place because future external agents may use them through this project. What disappears is the first-party UI and orchestration layer that turns the product itself into an AI assistant.

## Information Architecture

### Primary Navigation

Reduce the primary navigation to:

- `Kernel Code`
- `Search`
- `Knowledge`

These three represent the main user flows:

- produce knowledge in context
- discover source material
- review and organize accumulated knowledge

### Secondary Surfaces

Demote these to secondary or contextual entry points:

- `Annotations`
- `Manuals`
- `Tags`

Their roles should become:

- `Annotations`: management, recovery, exact lookup, and cross-context maintenance
- `Manuals`: supporting evidence source, not a top-level product identity
- `Tags`: lightweight filtering and organization, not a second ontology

### Dashboard Direction

The old dashboard should no longer behave like a tool launcher for unrelated capabilities. It should be reduced and reshaped into a lightweight workbench home.

## Home Page Direction

Do not use the raw code browser as the homepage.

The homepage should instead become an `Ops Workbench` for knowledge production:

- it should feel like the home of a kernel knowledge base
- it should help the user continue active work quickly
- it should still route naturally into the code-reading workflow

### First-Screen Priorities

The homepage should emphasize:

1. continuing work
2. knowledge progress
3. strong but secondary search access

### Continue Working

The most prominent action should be:

- `Continue last code context`

This should restore the most specific viable context in this order:

1. last active annotation-centered context
2. last active line range
3. last active file

The primary card on the page should show recent code context, not just generic recents.

### Knowledge Progress

The knowledge section should foreground:

- recently added evidence
- recently added or changed relations
- recently active annotations

It should then map those items to higher-level knowledge entities or relation surfaces as supporting context. This keeps the homepage grounded in active knowledge production instead of prematurely centering abstract entities.

### Search

Search should remain highly visible and easy to reach, but it should not overpower the homepage's "continue working" narrative.

## Primary Near-Term UX Priority

The first user-visible improvement should be in the code-reading flow:

- creating annotation relations must become easy and humane

This matters more than general cleanup alone, because the current user pain is not just excess surface area. The main pain is that knowledge production inside the code workflow is still difficult.

## Annotation Relation UX Direction

### Problem

The current relation workflow is too ID-driven.

Users can technically search annotations globally, but relation creation itself does not provide a human-friendly target selection flow. The result is a broken curation experience:

- finding the right target annotation is awkward
- relation types are difficult to understand
- relation direction is easy to get wrong
- if the target annotation does not exist yet, the workflow breaks

This is primarily a curation problem, with a search sub-problem embedded inside it.

### Design Principle

Relation creation must be context-aware, not ID-driven.

### First-Version Workflow

The first version should center on a target annotation picker with this flow:

1. show nearby context-aware candidates first
2. allow full-library search as fallback
3. support preview before confirmation
4. explain relation type and direction clearly
5. allow inline creation of a missing target annotation and immediate relation backfill

### Candidate Strategy

For code annotations, candidate sourcing should prioritize:

1. same function or symbol
2. nearby lines in the same file
3. recent browsing or editing context
4. full-library search results

Do not make mail-thread inference a first-version dependency. Mapping code to patch series and multi-version mail threads is valuable but too ambiguous to anchor the first iteration.

### Interaction Model

Use a two-layer interaction:

- a fast command-palette-like layer for quick selection
- a richer drawer layer for grouped candidates, preview, reasoning, and confirmation

The workflow should preserve the current code-reading context. Users may temporarily inspect candidate targets, but the system should always preserve a clear return anchor back to the current code context and current annotation.

### Subject and Direction

The UI should keep the current annotation fixed as the semantic subject while still showing the surrounding code anchor.

Default behavior should focus on outgoing relations, with an explicit but secondary option to switch direction. Direction should be explained through both text and visuals.

### Relation Type Clarity

Relation types should not appear as unexplained raw enums.

The product should provide:

- recommended relation types based on context
- short inline explanations
- direction-aware wording
- a dedicated help page for full relation semantics, examples, and anti-patterns

This is especially important for relation types such as `explains` and `evidence_for`, where direction is not obvious to new users.

### Inline Create-and-Link

If the target annotation does not exist yet, the relation picker should support creating it inline.

That inline creation flow should:

- default to the current code context
- allow changing the target position
- prefill the target location and quoted code context
- avoid AI-authored content by default
- return directly into relation creation after the annotation is created

## Product Sequencing

Recommended sequence:

1. hard-delete product-layer AI features and their storage/model/test footprint
2. simplify primary navigation and home-page identity
3. implement the first-version code annotation relation picker and supporting UX
4. continue evolving the knowledge surfaces once knowledge production is easier

This order keeps the repository clean enough for lower-token future work while still making the first meaningful usability improvement land quickly after cleanup.

## Out of Scope for This Refactor

The following are intentionally not first-wave requirements:

- rebuilding AI workflows inside this repository
- mail-thread recommendation as a dependency for code relation creation
- making `Knowledge` the sole homepage identity before production workflows improve
- replacing all tag behavior with knowledge entities immediately
- full ontology redesign beyond the evidence-first direction

## Success Criteria

This refactor is successful when:

1. the repository no longer contains active Ask or Agent Research product flows
2. the top-level product identity reads as a kernel knowledge base workbench
3. navigation emphasizes `Kernel Code`, `Search`, and `Knowledge`
4. the homepage helps the user continue active work instead of launching unrelated tools
5. creating relations from code annotations is substantially easier than the current ID-driven flow
6. the codebase becomes lighter to work on because removed AI product layers no longer consume development attention or context budget
