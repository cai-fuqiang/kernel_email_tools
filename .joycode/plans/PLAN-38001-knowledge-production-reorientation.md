> **Status**: planned
> **Updated**: 2026-05-09
> **Depends-on**: PLAN-38000, PLAN-35001, PLAN-31002, PLAN-30002
> **Priority**: P0 design alignment, P1 implementation foundation

# PLAN-38001: Evidence-Driven Kernel Knowledge Production

## Background

PLAN-38000 restates the original pain: Linux kernel learning is difficult because the
important knowledge is scattered across code, commit history, mailing lists, manuals, LWN,
books, and personal notes. Code alone often cannot explain why a design exists, what
alternatives were rejected, or whether a mechanism has changed across time.

The current project has grown far beyond an email search tool. It already has mailing-list
ingest, keyword and semantic retrieval, Ask Agent, Research Agent, Knowledge Workbench,
Draft Review, annotations, tags, manuals, translation, and kernel source browsing. The next
step is not to add another isolated feature, but to realign these modules around the real
product goal:

> Build an evidence-driven Linux kernel knowledge production system where AI helps collect,
> connect, summarize, and draft knowledge, while humans review and maintain the durable
> knowledge base.

## Core Judgment

Traditional RAG is useful but insufficient for this project.

RAG can find related snippets, but kernel knowledge usually requires more than top-k
retrieval:

- A design topic may span years, versions, patch revisions, and multiple mailing lists.
- The key question is often historical: why a design was introduced, who objected, what
  tradeoffs were accepted, and whether later patches superseded it.
- Evidence may live in a patch hunk, source line, commit message, manual section, or mailing
  list reply, not only in one email body.
- AI output must be reviewable before it becomes durable knowledge.

Therefore AI should not be treated as an automatic expert that writes directly into the
formal knowledge base. AI should be treated as a structured draft generator and research
assistant. Its output must flow through Draft Review before becoming Knowledge, Annotation,
TagAssignment, Relation, or Evidence.

## Product Reorientation

The project should be described as:

```text
raw kernel material
  -> retrieval and context packing
  -> AI-assisted analysis and draft generation
  -> human review and merge
  -> durable knowledge graph with evidence links
```

The center of the project is no longer `email`. The center is `knowledge with evidence`.

Email remains the first and most important corpus, but it is one corpus among several:

- mailing-list messages and threads
- patch discussions and patch hunks
- local kernel source code
- commit messages
- kernel documentation
- architecture and vendor manuals
- LWN, blogs, books, and other curated external references
- human notes and annotations

## Desired Module Boundaries

Current modules are mostly feature-oriented. The long-term boundary should become workflow-
oriented:

```text
src/corpus/          # raw source adapters: email, commit, manual, docs, external refs
src/targets/         # stable target references: EmailTarget, CodeTarget, PatchTarget, ManualTarget
src/retrieval/       # keyword, semantic, hybrid, graph expansion
src/context/         # ContextPack builders for thread, patch, code, topic, manual section
src/ai_workflows/    # ask, research, survey, summarize, classify
src/review/          # draft lifecycle, review, accept, reject, merge
src/knowledge/       # entity, claim, relation, evidence, version history
src/notes/           # annotation and human notes
src/api/             # HTTP adapters only
```

This does not require a large immediate refactor. It is a target architecture used to guide
new work and prevent new feature sprawl.

## Key Concepts To Introduce

### EvidenceRef

Introduce a unified evidence reference model. It should replace email-specific assumptions
in new code and gradually backfill existing evidence records.

Minimum shape:

```text
EvidenceRef:
  source_type: email_message | email_thread | patch_hunk | code_range | commit | manual_section | external_url | annotation
  source_ref: stable source identifier
  target: structured target payload
  quote: optional quoted evidence
  claim: what this evidence supports
  confidence: human/AI confidence label
  created_by / created_by_user_id
```

For compatibility, existing `message_id` and `thread_id` fields can remain, but they should
be treated as projections of `EvidenceRef`, not the general model.

### ContextPack

Introduce a stable context object for AI workflows. Ask, Research Agent, Survey, and future
thread summarization should not each invent their own prompt input format.

ContextPack should describe:

- target being studied: thread, patch, code range, symbol, topic, or manual section
- primary evidence refs
- compact source excerpts
- timeline or patch revision history when available
- existing related knowledge
- known caveats, contradictions, and unresolved questions
- token/cost estimate metadata

The first implementation should support single email thread and patch discussion context.

### Draft As The Only AI Write Path

All AI-generated durable objects must enter a draft state first:

- KnowledgeDraft
- AnnotationDraft
- TagAssignmentDraft
- RelationDraft
- EvidenceDraft
- ThreadSummaryDraft

Ask, Research Agent, and future Survey workflows may produce different draft bundles, but
they should share one review/apply path.

## Current Design Assessment

### Keep

- `AskAgent` should stay, because it already plans searches, expands thread context, uses
  existing knowledge, and cites evidence.
- `AgentResearchService` should stay, because its loop of search, judge, refine, synthesize,
  draft, and review matches the project goal.
- `KnowledgeEntity`, `KnowledgeRelation`, `KnowledgeEvidence`, and `KnowledgeDraft` are the
  right long-term storage direction.
- `Annotation` with `target_type + target_ref + anchor` is a good generic foundation.
- Draft Review is the correct boundary between AI output and durable knowledge.

### Rework

- The project naming and README should gradually move from "email knowledge base" to
  "kernel knowledge production system".
- Evidence storage is too email-centric. New work should use `EvidenceRef`.
- API routers currently mix HTTP handling, authorization details, and application behavior.
  New work should add service-layer modules instead of making routers larger.
- Application startup initializes too many unrelated services in one place. Future modules
  should expose composable service factories.
- Tag, Annotation, Knowledge, and Evidence responsibilities need clearer UI language:
  - Tag: lightweight classification and filtering.
  - Annotation: local human judgment, question, correction, or review note.
  - KnowledgeEntity: reusable conclusion or concept.
  - Evidence: support for a specific claim.

### Avoid

- Do not start with full-corpus LLM processing.
- Do not let AI create tags automatically.
- Do not make Survey a separate product path that bypasses Draft Review.
- Do not build a full kernel code atlas before code targets and evidence refs are stable.
- Do not treat vector search quality as the main success metric. The main metric is whether
  reviewed knowledge accumulates with trustworthy evidence.

## Implementation Plan

### Phase 1: Naming And Design Alignment

- Update documentation to clarify that email is the first corpus, not the product center.
- Add a short architecture note for EvidenceRef, ContextPack, and Draft Review.
- Mark future feature plans against this product direction.
- Audit active plans and identify which ones should be delayed because they do not strengthen
  the evidence-to-knowledge loop.

### Phase 2: EvidenceRef MVP

- Define a small `src/targets/` or equivalent module for structured targets.
- Support at least:
  - email message
  - email thread
  - patch hunk
  - code range
  - manual section
- Add conversion helpers from existing `message_id`, `thread_id`, `version`, `file_path`,
  `start_line`, and `end_line`.
- Use the new structure in new evidence writes while preserving existing fields.

### Phase 3: ContextPack MVP

- Add a context builder for a single email thread.
- Include first message, important replies, patch excerpts, cited code targets, related
  annotations, related tags, and existing knowledge entities.
- Add token/cost estimation metadata.
- Let AskAgent or ResearchAgent optionally consume the context pack without changing public
  API behavior at first.

### Phase 4: Unified Draft Bundle

- Expand draft bundle semantics so Ask, Research, and future Survey can all produce:
  - knowledge drafts
  - annotation drafts
  - tag assignment drafts
  - relation drafts
  - evidence drafts
- Keep one review/apply path.
- Make missing evidence visible in the review UI instead of silently accepting weak knowledge.

### Phase 5: Single-Thread Survey PoC

- Implement only a single-thread survey runner first.
- Survey templates should map choice answers to existing tags only.
- Unknown or unmapped choices should become text answers or `unsure`, not new tags.
- Output should go to Draft Review, not CSV and not formal tables.
- Measure quality, cost, and review burden before any batch mode.

## Success Criteria

- A user can start from a thread or patch discussion and produce reviewed knowledge with
  linked evidence.
- A Knowledge entity can clearly show which claims are supported by which email, patch,
  code, manual, or external reference.
- Ask and Research responses can distinguish existing reviewed knowledge from raw source
  evidence.
- AI-generated output never bypasses review when it affects durable knowledge.
- New modules make the evidence-to-knowledge loop stronger instead of adding isolated pages.

## Priority Recommendation

Next implementation should focus on:

1. EvidenceRef / CodeTarget / SourceTarget normalization.
2. ContextPackBuilder for single thread and patch discussion.
3. Unified AI draft bundle and review path.
4. Single-thread Survey PoC.

Everything else should be judged by whether it strengthens this loop:

```text
source material -> evidence -> context -> AI draft -> human review -> durable knowledge
```
