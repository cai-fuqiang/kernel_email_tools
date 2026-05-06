> **Status**: done (Phase 1 done; Phase 3 done except language unification; Phase 4 done; Phase 5 done except symbol search / Knowledge dedup; Phase 2 派生为 PLAN-34001)
> **Updated**: 2026-05-06
> **Depends-on**: 无
> **Priority**: P1 — ThreadDrawer 2085→719 行（-65%），KnowledgePage 1644→810 行（-51%），SearchPage 841→547 行（-35%），KernelCodePage 708→486 行（-31%），AskPage 656→465 行（-29%）；KnowledgePage 构建 chunk 500→54 KB（-89%）；SemanticRetriever 测试 2→6 项

# PLAN-34000: Semantic Search and Product Quality Improvements

## Summary

This plan turns the current broad feature surface into a more trustworthy and usable product, starting with the highest-priority gap: `mode=semantic` must become a real pgvector-backed search mode instead of a visible but mostly empty promise.

The implementation is split into phases so the first delivery can be small and safe, while still recording the broader improvements previously identified across UI, workflow, code quality, Knowledge, Code Browser, Manuals, responsiveness, and performance.

## Implementation Status

- Phase 1 is implemented: `mode=semantic` now uses `email_chunks` / `email_chunk_embeddings`, supports query embeddings, email-level dedupe, pagination, and shared filters including `has_patch`.
- Phase 3 is partially implemented: the main app navigation, Ask layout, Knowledge layout, and Kernel Code layout are responsive; browser-native alerts in touched paths use toast feedback.
- Phase 4 is implemented for the current warning set: `npm run lint` is clean with zero warnings and zero errors.
- Phase 4 ThreadDrawer split (first batch, 2026-05-01): `PatchDiffBlock`, `KnowledgeBackRefs`, `ThreadAnnotationCard` (含 `AnnotationInput`) 抽出为独立组件文件；`ThreadDrawer.tsx` 从 2085 行降到 1611 行（-22%）。剩余 `LayeredEmailCard` (303 行) / `TreeEmailCard` (301 行) 由后续 PR 继续拆分。
- Phase 4 ThreadDrawer split (second batch, 2026-05-01): `LayeredEmailCard` 和 `TreeEmailCard` 抽出为独立文件；同时把共享工具拆出 `utils/threadTree.ts`（ThreadNode + buildThreadTree / buildNodeMap / getVisibleNodes / countDescendants / collectDescendantIds + FoldLevel / ViewMode / TranslationMap 类型）和 `utils/emailBody.ts`（parseParagraphs / getDisplayBody / shouldTranslate / getAuthorName / stripDiffAndSignature 等）。`ThreadDrawer.tsx` 从 1611 行进一步降到 719 行，累计减重 -65%（2085→719）。
- Phase 4 KnowledgePage split (2026-05-06): 抽出 `components/knowledge/` 目录下 8 个独立子组件（DraftInboxPanel / EntityListPanel / EntityDetailHeader + DeleteConfirmModal / EntityMetricsCards / EntityExplanationEditor / EntityRelationsPanel / EvidencePanel / HumanNotesPanel）以及共享工具文件 `knowledgeUtils.ts`（常量 / type / formatDate / statusTone / extractKnowledgeEvidence / normalizeDraftPayload / agentDraftMeta 等）。`KnowledgePage.tsx` 从 1644 行降到 810 行，-51%。主页面只保留 state / hooks / handlers，最大子组件 293 行。`npm run build` + `npm run lint` 对本次改动全部通过。
- Phase 4 SearchPage split (2026-05-06): 抽出 `components/search/` 目录下 6 个独立子组件（SearchBar / AdvancedFilters / SummaryPanel / BatchTagBar / AnnotationResults / ResultCard）和共享工具 `searchUtils.ts`（escapeHtml / highlightSnippet / normalizeMessageId / resolveCitationSource / compactSender / compactDate / truncateText / errorMessage / citationLabel）。`SearchPage.tsx` 从 841 行降到 547 行，-35%。子组件最大 154 行（AdvancedFilters）。同时修复 `PreviewModal.tsx` 的 `@typescript-eslint/no-unused-vars` 错误，`npm run lint` 全绿（零错误零警告），`npm run build` 成功。
- Phase 4 AskPage split (2026-05-06): 抽出 `components/ask/ConversationCard.tsx`（158 行，含 `ConversationTurn` type 导出 + `buildSourceMap` / `renderAnswerWithLinks` 内部辅助），同时删除本地重复的 `normalizeMessageId` / `compactSender` / `compactDate` / `truncateText` / `citationLabel`，改为从 `components/search/searchUtils.ts` 导入复用。`AskPage.tsx` 从 656 行降到 465 行，-29%。`npm run lint` 全绿，`npm run build` 成功。
- Phase 4 KernelCodePage split (2026-05-06): 抽出 `components/kernelCode/AnnotationPanel.tsx`（225 行，含 `PublishButton` 内部子组件、批注 CRUD / 发布审核交互、Markdown 渲染、Tag 编辑器联动）。同时清理 KernelCodePage 中已不再使用的 import（ReactMarkdown / remarkGfm / createCodeAnnotation / deleteCodeAnnotation / 4 个 publication API / EmailTagEditor / useAuth）。`KernelCodePage.tsx` 从 708 行降到 486 行，-31%。`npm run lint` 全绿，`npm run build` 成功。
- Phase 1 test plan completion (2026-05-06): `tests/test_semantic_retriever.py` 从 2 个测试扩充到 6 个，新增 `test_semantic_retriever_pagination`（page 1/2/3 切片 + 总数）、`test_semantic_retriever_forwards_date_filters`（date_from/date_to 透传）、`test_semantic_retriever_missing_embedding_provider_returns_empty`（缺失 provider 时返回空 + 警告日志 + 不调用 storage）、`test_semantic_retriever_disabled_returns_empty`（disabled 短路）。同时 `tests/test_search.py` 中 9 个 `_is_semantic_query` routing 测试保持。`pytest tests/test_semantic_retriever.py tests/test_search.py -v` 共 15 个测试全过。
- Phase 3 confirm/prompt → ConfirmModal 替换 (2026-05-06): 替换 9 处原生 `window.prompt` / `window.alert` / 全局 `confirm()` 为 `ConfirmModal` + `showToast()`：
  - `components/kernelCode/AnnotationPanel.tsx`: 4 处（审核备注/驳回原因 prompt + 删除注解/回复 confirm）→ 单一 `pendingAction` state + 4-action modal config map
  - `components/ThreadAnnotationCard.tsx`: 2 处（审核通过/驳回 prompt）→ `reviewAction` state + ConfirmModal
  - `components/TagManager.tsx`: 3 处（删除标签 confirm + 合并 prompt + 移动 prompt）→ `pendingAction` state + 3-kind action handler
  - `pages/UsersPage.tsx`: 3 处（reject reason + reset password prompt + reset password alert）→ `pendingAction` state + ConfirmModal + showToast
  - 验证：`grep -rnE 'window\.(confirm|prompt|alert)|confirm\(|prompt\(|alert\(' web/src` 返回零结果，`npm run lint` 全绿，`npm run build` 成功
- Phase 5 KnowledgePage chunk lazy-load (2026-05-06): `components/knowledge/EntityRelationsPanel.tsx` 把 `KnowledgeGraphView` 改为 `lazy(() => import('../KnowledgeGraphView'))`，套上 `<Suspense fallback="Loading graph view..." />`。`KnowledgeGraphView` 的 cytoscape (~5.9 MB node_modules) 现在只在用户切到 graph 模式时才下载。构建产物：`KnowledgePage-*.js` 从 500 KB → **54 KB（-89%）**，`KnowledgeGraphView-*.js` 单独 chunk 446 KB（按需）。**Vite 大 chunk 警告已消除**（`built in 2.12s`，无 "chunks larger than 500 kB"）。
- Phase 2 派生为 PLAN-34001（贡献度标记）: Phase 2 提到的 "Surface whether an email/thread already contributed to saved Knowledge / annotation / draft" 是端到端特性（后端 `/api/contributions/lookup` + 前端 hook + 多页面 chip），范围与主 PLAN 风险拆分独立处理。详见 `PLAN-34001-evidence-contribution-badges.md`。
- Larger follow-ups still intentionally remain in separate PLANs:
  - PLAN-34001（贡献度标记）— planned
  - PLAN-31001 / PLAN-31002（Knowledge 去重合并、graph/list 切换体验）— in-progress
  - PLAN-30002 Phase 3+5（ThreadDrawer 邮件正文路径识别、lore 链接）— in-progress
  - 跨内核版本 annotation drift detection — 未开始

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
