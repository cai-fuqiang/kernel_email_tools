# PLAN-34000: Semantic Search and Product Quality Improvements

## Summary

This plan turns the current broad feature surface into a more trustworthy and usable product, starting with the highest-priority gap: `mode=semantic` must become a real pgvector-backed search mode instead of a visible but mostly empty promise.

The implementation is split into phases so the first delivery can be small and safe, while still recording the broader improvements previously identified across UI, workflow, code quality, Knowledge, Code Browser, Manuals, responsiveness, and performance.

## Implementation Status

- Phase 1 is implemented: `mode=semantic` now uses `email_chunks` / `email_chunk_embeddings`, supports query embeddings, email-level dedupe, pagination, and shared filters including `has_patch`.
- Phase 3 is partially implemented: the main app navigation, Ask layout, Knowledge layout, and Kernel Code layout are responsive; browser-native alerts in touched paths use toast feedback.
- Phase 4 is implemented for the current warning set: `npm run lint` is clean with zero warnings and zero errors.
- Phase 5 is partially implemented: route-level code splitting is active, Manual Search has richer previews and an Ask Manuals path, Knowledge shows evidence quality summary, and Code Browser uses the existing kernel tree API for path browsing.
- Larger follow-ups still intentionally remain: deeper Knowledge duplicate prevention, full ThreadDrawer extraction, full Kernel annotation review UX replacement for confirm/prompt flows, and annotation drift detection across kernel versions.

## Phase 1: Make `mode=semantic` Real

### Backend semantic retrieval

- Rework `src/retriever/semantic.py` to use existing `email_chunks` and `email_chunk_embeddings`, not the unused legacy `email_embeddings` table.
- Inject `PostgresStorage`, `DashScopeEmbeddingProvider`, provider name, and model into `SemanticRetriever` from `src/api/server.py` startup.
- Use `DashScopeEmbeddingProvider.embed_texts([query.text])` to create the query vector.
- Call `PostgresStorage.search_email_chunks_vector()` for pgvector retrieval.
- Aggregate chunk results to email-level `SearchHit` rows by `message_id`, keeping the highest-scoring chunk per message.
- Preserve and return these fields in `SearchHit`: `message_id`, `subject`, `sender`, `date`, `list_name`, `thread_id`, `score`, `snippet`, `source="semantic"`.
- Apply pagination after message-level deduplication.
- Return an empty result with a clear log warning if vector retrieval is enabled but the embedding provider is missing.

### Search API behavior

- Keep the existing `/api/search` endpoint and response shape.
- For `mode=semantic`, require a non-empty `q`; return HTTP 400 for empty semantic queries.
- Keep keyword and hybrid behavior unchanged except where shared helper code is needed.
- Pass all supported filters through semantic retrieval: `list_name`, `sender`, `date_from`, `date_to`, `tags`, `tag_mode`, and `has_patch`.
- Add `has_patch` support to chunk vector search by joining or filtering against `emails.has_patch`, because `email_chunks` does not currently store `has_patch`.

### Frontend search UI

- Change `SearchPage` default mode from `hybrid` to `semantic`.
- Ensure search requests explicitly send `mode=semantic` when semantic is selected.
- Disable the Search button when mode is `semantic` and the query is empty.
- Show a short inline hint that semantic search requires query text.
- Preserve `Keyword` and `Hybrid` mode options for fallback and comparison.
- Display the result source badge so users can see when results are semantic.
- Remove `any` from SearchPage error handling while touching the file.

### Operational notes

- Document that semantic search requires:
  - `indexer.vector.enabled: true`
  - `indexer.vector.provider: dashscope`
  - `indexer.vector.model: text-embedding-v3`
  - `DASHSCOPE_API_KEY` or the existing config fallback.
- Document the required indexing commands when chunks or embeddings are missing:
  - `python scripts/index.py --build-chunks --list <list>`
  - `python scripts/index.py --build-vector --list <list>`

## Phase 2: Core Research Workflow Polish

- Make the main user path feel continuous: search or ask -> inspect thread evidence -> tag or annotate -> generate draft -> review draft -> save Knowledge.
- Add clearer cross-links between Search/Ask answers, ThreadDrawer evidence, Knowledge drafts, and saved Knowledge entities.
- Add capability gating so unavailable features are hidden or disabled instead of exposed as working controls.
- Surface whether an email/thread already contributed to saved Knowledge, an annotation, or a draft.
- Keep this phase focused on workflow polish; do not introduce a new database model unless a concrete workflow cannot be represented with existing entities.

## Phase 3: UI Consistency and Responsiveness

- Unify interface language. Prefer Chinese for product UI labels, with English technical terms retained where they are domain terms, for example `Ask Agent`, `Semantic`, `Hybrid`, `Message-ID`, and `pgvector`.
- Standardize Search, Ask, Knowledge, Manuals, and Code Browser on shared UI primitives from `web/src/components/ui.tsx`.
- Replace browser-native `alert`, `confirm`, and `prompt` in user-facing flows with existing modal/toast patterns.
- Improve narrow-screen layouts:
  - Make the main navigation collapsible.
  - Make Ask history collapsible without occupying fixed width on small screens.
  - Make Kernel Code split view stack or collapse the annotation panel on small screens.
- Avoid adding decorative landing-page UI; keep the product centered on dense research workflows.

## Phase 4: Code Quality and Maintainability

- Make `npm run lint` pass.
- Fix current semantic-adjacent lint issues first:
  - `SearchPage` explicit `any` catches.
  - Unused variables in `ThreadDrawer` and `KernelCodePage`.
- Then address hook dependency warnings in a controlled way without changing behavior.
- Split oversized components after functional fixes:
  - Extract ThreadDrawer subcomponents for translation, annotations, patch display, and tree rendering.
  - Extract Kernel Code annotation panel and toolbar.
- Keep refactors behavior-preserving and covered by build/lint checks.

## Phase 5: Knowledge, Code Browser, Manuals, and Performance

### Knowledge

- Improve duplicate prevention and merge workflows for Knowledge entities.
- Make evidence quality visible: number of sources, source threads, last verified time, and whether evidence is direct or generated.
- Improve graph/list toggling so Knowledge can be consumed, not only stored.

### Code Browser

- Add file tree or path suggestions for kernel files.
- Add symbol search or symbol-to-file navigation if existing index data is available.
- Improve line annotation flows and publication review UX.
- Plan, but do not implement in Phase 1, annotation drift detection across kernel versions.

### Manuals

- Improve Manual Search result previews with larger snippets and clearer section/page metadata.
- Add a path from manual evidence into Ask/Knowledge when manual content is relevant to kernel email research.
- Keep manual RAG separate unless a concrete workflow needs unified evidence.

### Performance

- Add route-level code splitting for large frontend areas: Knowledge graph, ThreadDrawer-heavy views, Code Browser, and Manuals.
- Keep Vite build passing and reduce the large JS bundle warning where practical.
- Avoid changing API response shapes just for performance unless needed.

## Test Plan

### Backend

- Add a lightweight test for `SemanticRetriever.search()` with fake storage and fake embedding provider:
  - returns vector hits,
  - deduplicates by `message_id`,
  - keeps the highest score,
  - paginates after dedupe,
  - marks `source="semantic"`.
- Add API-level coverage or route-level unit coverage for `mode=semantic&q=` returning HTTP 400.
- Verify filter forwarding for `list_name`, `sender`, `date_from`, `date_to`, `tags`, `tag_mode`, and `has_patch`.

### Frontend

- `npm run build` must pass.
- `npm run lint` should not gain new errors; Phase 4 target is fully green lint.
- Manually verify Search defaults to Semantic and sends `mode=semantic`.
- Manually verify empty semantic searches are disabled in the UI.
- Manually verify keyword/hybrid fallback modes still work.

### Operational

- If semantic returns zero results, verify:
  - email chunks exist,
  - chunk embeddings exist for the configured provider/model,
  - pgvector Python and PostgreSQL extensions are available,
  - DashScope API key resolution works.

## Assumptions

- The first implementation batch should prioritize Phase 1.
- The plan file belongs in `.joycode/plans/`, matching the existing project convention.
- No new public endpoint is needed for semantic search.
- No new database table is needed for semantic search.
- Existing `email_chunks` and `email_chunk_embeddings` are the source of truth for semantic retrieval.
- Broader UI and workflow improvements are intentionally recorded here so they are not lost, but they should be implemented in separate follow-up batches after semantic search is working.
