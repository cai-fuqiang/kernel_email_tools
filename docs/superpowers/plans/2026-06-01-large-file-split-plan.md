# Large File Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the largest backend and frontend files into smaller, responsibility-focused modules while preserving database schema, API behavior, routes, UI behavior, and public imports.

**Architecture:** Use compatibility facades first, then move internals behind stable names. Backend splits keep existing `src.storage.models`, `src.storage.annotation_store`, `src.storage.knowledge_store`, `src.storage.tag_store`, `src.api.routers.annotations`, `src.api.routers.knowledge`, and `src.api.schemas` import paths working until all consumers are migrated. Frontend splits keep `web/src/api/client.ts`, `web/src/api/types.ts`, and page/component default exports working as barrels or thin orchestrators.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, Pydantic, React, TypeScript, Vite, existing project tests.

---

## Scope Lock

Approved source files:

- `src/storage/models.py`
- `src/storage/annotation_store.py`
- `src/storage/knowledge_store.py`
- `src/storage/tag_store.py`
- `src/api/routers/annotations.py`
- `src/api/routers/knowledge.py`
- `src/api/schemas.py`
- `web/src/api/client.ts`
- `web/src/api/types.ts`
- `web/src/pages/KernelCodePage.tsx`
- `web/src/pages/ManualPdfPage.tsx`
- `web/src/components/AnnotationRelationsPanel.tsx`
- `web/src/components/kernelCode/AnnotationPanel.tsx`
- `web/src/components/knowledge/KnowledgeWorkbench.tsx`

Explicit exclusions:

- Do not change database schema.
- Do not change API behavior, route paths, request bodies, response bodies, auth behavior, or status codes.
- Do not change parser, collector, translator, retriever, chunker, or indexer code.
- Do not redesign UI behavior.
- Do not implement feature behavior during this split.

## Global Rules For Every Task

- Keep a compatibility facade at every current public import path until a final cleanup task proves no direct consumers remain.
- Commit after each file family is split and verified.
- Move code mechanically first, then simplify imports. Avoid opportunistic rewrites.
- Preserve names and exported symbols unless the task explicitly says to introduce a new private helper.
- Keep each new module under roughly 400 lines when practical.
- Prefer package names that do not collide with existing files. For example, create `src/storage/annotations/` while keeping `src/storage/annotation_store.py` as the facade.
- If implementation needs tests or config files not listed in this brief, update the brief before reading or editing them.

## Target End State

Backend:

- `src/storage/models.py` becomes a compatibility facade and no longer owns every ORM and Pydantic model.
- Store files become thin orchestration facades over domain packages:
  - `src/storage/annotations/`
  - `src/storage/knowledge/`
  - `src/storage/tags/`
- Router files become thin include-router aggregators over route submodules:
  - `src/api/routers/annotation_routes/`
  - `src/api/routers/knowledge_routes/`
- `src/api/schemas.py` becomes a compatibility facade over API schema modules.

Frontend:

- `web/src/api/client.ts` becomes a barrel over domain clients.
- `web/src/api/types.ts` becomes a barrel over domain type modules.
- `KernelCodePage.tsx`, `ManualPdfPage.tsx`, `AnnotationPanel.tsx`, `AnnotationRelationsPanel.tsx`, and `KnowledgeWorkbench.tsx` become orchestrators that import focused hooks, helpers, and presentational components.

## Phase 0: Baseline And Safety Net

### Task 0.1: Capture Current Module Inventory

**Files:**

- Read only approved files.
- Do not modify source code.

- [ ] Record line counts for all approved files.
- [ ] Record exported Python classes/functions and TypeScript exports.
- [ ] Record route paths from `src/api/routers/annotations.py` and `src/api/routers/knowledge.py`.
- [ ] Record frontend public exports from `web/src/api/client.ts`, `web/src/api/types.ts`, and page/component default exports.
- [ ] Save the inventory in the implementation notes for the first split commit.

### Task 0.2: Decide Verification Commands Before Editing

**Files:**

- If test/build command definitions are not already known, add the relevant config files to the brief before reading them.

- [ ] Identify backend unit/API test command.
- [ ] Identify frontend typecheck/build command.
- [ ] Identify targeted frontend component test command if existing.
- [ ] Run the commands once before the first code move.
- [ ] Commit nothing in this task.

## Phase 1: Split Type And Schema Files First

This phase reduces import pressure before moving behavior. It should not change runtime behavior.

### Task 1.1: Split `src/storage/models.py` ORM Models

**Current responsibilities:**

- SQLAlchemy base.
- User/session ORM.
- Tag ORM.
- Email/chunk ORM.
- Annotation/relation ORM.
- Knowledge ORM.
- Pydantic DTOs.
- `parsed_email_to_create`.

**Create:**

- `src/storage/model_base.py`
- `src/storage/orm/user.py`
- `src/storage/orm/tag.py`
- `src/storage/orm/email.py`
- `src/storage/orm/annotation.py`
- `src/storage/orm/knowledge.py`
- `src/storage/storage_schemas/tags.py`
- `src/storage/storage_schemas/email.py`
- `src/storage/storage_schemas/annotations.py`
- `src/storage/storage_schemas/knowledge.py`
- `src/storage/storage_schemas/users.py`
- `src/storage/storage_schemas/email_parser.py`

**Modify:**

- `src/storage/models.py`

- [ ] Move `Base` to `model_base.py`.
- [ ] Move `UserORM` and `UserSessionORM` to `orm/user.py`.
- [ ] Move `TagORM`, `TagAliasORM`, and `TagAssignmentORM` to `orm/tag.py`.
- [ ] Move `EmailORM` and `EmailChunkORM` to `orm/email.py`.
- [ ] Move `AnnotationORM` and `AnnotationRelationORM` to `orm/annotation.py`.
- [ ] Move `KnowledgeEntityORM`, `KnowledgeEntityVersionORM`, `KnowledgeRelationORM`, `KnowledgeEvidenceORM`, and `KnowledgeDraftORM` to `orm/knowledge.py`.
- [ ] Move tag Pydantic classes to `storage_schemas/tags.py`.
- [ ] Move email Pydantic classes and `parsed_email_to_create` to `storage_schemas/email.py` and `storage_schemas/email_parser.py`.
- [ ] Move annotation Pydantic classes to `storage_schemas/annotations.py`.
- [ ] Move knowledge Pydantic classes to `storage_schemas/knowledge.py`.
- [ ] Move user Pydantic classes to `storage_schemas/users.py`.
- [ ] Keep `src/storage/models.py` as a re-export facade for all old names.
- [ ] Verify no table name, column name, relationship name, index, or constraint changed.
- [ ] Run backend tests.
- [ ] Commit: `refactor: split storage models by domain`.

### Task 1.2: Split `src/api/schemas.py`

**Current responsibilities:**

- Annotation API response/request schemas.
- Annotation relation schemas.
- Knowledge draft apply schemas.
- Manual document schemas.
- Annotation serialization helpers.

**Create:**

- `src/api/schema_models/annotations.py`
- `src/api/schema_models/annotation_relations.py`
- `src/api/schema_models/knowledge_drafts.py`
- `src/api/schema_models/manual_documents.py`

**Modify:**

- `src/api/schemas.py`

- [ ] Move `AnnotationTargetRef`, `AnnotationResponse`, and `_annotation_to_response` to `schema_models/annotations.py`.
- [ ] Move `AnnotationRelationRequest`, `AnnotationRelationResponse`, `AnnotationRelationsResponse`, and `_annotation_relation_to_response` to `schema_models/annotation_relations.py`.
- [ ] Move `DraftApplyRequest` and `DraftApplyResponse` to `schema_models/knowledge_drafts.py`.
- [ ] Move manual document schemas to `schema_models/manual_documents.py`.
- [ ] Keep `src/api/schemas.py` as a re-export facade for all old names.
- [ ] Verify router imports still work without changing route behavior.
- [ ] Run backend tests.
- [ ] Commit: `refactor: split api schemas by domain`.

### Task 1.3: Split `web/src/api/types.ts`

**Current responsibilities:**

- Search, auth, tags, annotations, manual PDFs, knowledge, kernel/code browser, and system types.

**Create:**

- `web/src/api/types/search.ts`
- `web/src/api/types/auth.ts`
- `web/src/api/types/tags.ts`
- `web/src/api/types/annotations.ts`
- `web/src/api/types/manuals.ts`
- `web/src/api/types/knowledge.ts`
- `web/src/api/types/kernel.ts`
- `web/src/api/types/system.ts`

**Modify:**

- `web/src/api/types.ts`

- [ ] Move `SearchHit`, `SearchResponse`, `SourceRef`, and summary types to `types/search.ts`.
- [ ] Move current user, user admin, login, register, and auth session types to `types/auth.ts`.
- [ ] Move tag tree, stats, assignment, and target types to `types/tags.ts`.
- [ ] Move annotation, relation, and code annotation types to `types/annotations.ts`.
- [ ] Move manual search/document/stat types to `types/manuals.ts`.
- [ ] Move knowledge entity, relation, evidence, draft, graph, import/export, and version types to `types/knowledge.ts`.
- [ ] Move kernel repository, file, tree, resolve, symbol, commit, history, and patch types to `types/kernel.ts`.
- [ ] Move system config types to `types/system.ts`.
- [ ] Keep `web/src/api/types.ts` as a barrel re-exporting every type.
- [ ] Run frontend typecheck/build.
- [ ] Commit: `refactor: split api types by domain`.

## Phase 2: Split API Client By Domain

### Task 2.1: Extract Shared Fetch Helpers

**Create:**

- `web/src/api/http.ts`

**Modify:**

- `web/src/api/client.ts`

- [ ] Move `API_BASE`, `encodeCodePath`, `fetchJSON`, and `fetchWithBody` to `http.ts`.
- [ ] Move annotation normalization helpers to `web/src/api/annotationNormalization.ts`.
- [ ] Keep all exported client functions in `client.ts` during this first extraction.
- [ ] Run frontend typecheck/build.
- [ ] Commit: `refactor: extract api http helpers`.

### Task 2.2: Extract Auth, Users, Tags, Search, Manual, Translation, Annotation, Knowledge, Kernel, And System Clients

**Create:**

- `web/src/api/clients/auth.ts`
- `web/src/api/clients/users.ts`
- `web/src/api/clients/tags.ts`
- `web/src/api/clients/search.ts`
- `web/src/api/clients/manuals.ts`
- `web/src/api/clients/translations.ts`
- `web/src/api/clients/annotations.ts`
- `web/src/api/clients/knowledge.ts`
- `web/src/api/clients/kernel.ts`
- `web/src/api/clients/system.ts`

**Modify:**

- `web/src/api/client.ts`

- [ ] Move auth functions to `clients/auth.ts`: `getCurrentUser`, `getAuthSession`, `registerAccount`, `loginAccount`, `logoutAccount`, `changePassword`.
- [ ] Move user admin functions to `clients/users.ts`.
- [ ] Move tag functions to `clients/tags.ts`.
- [ ] Move search and summary functions to `clients/search.ts`.
- [ ] Move manual document and manual search functions to `clients/manuals.ts`.
- [ ] Move translation functions to `clients/translations.ts`.
- [ ] Move annotation functions to `clients/annotations.ts`.
- [ ] Move knowledge functions to `clients/knowledge.ts`.
- [ ] Move kernel/code browser functions to `clients/kernel.ts`.
- [ ] Move system config function to `clients/system.ts`.
- [ ] Turn `client.ts` into a barrel that re-exports all functions and existing public type exports.
- [ ] Run frontend typecheck/build.
- [ ] Commit: `refactor: split api client by domain`.

## Phase 3: Split Backend Stores

### Task 3.1: Split `src/storage/annotation_store.py`

**Current responsibilities:**

- Annotation payload normalization.
- Annotation serialization.
- Search/list filtering.
- CRUD.
- Relation CRUD.
- Markdown reference relation sync.
- Publication workflow.
- Import/export.

**Create:**

- `src/storage/annotations/payloads.py`
- `src/storage/annotations/serializers.py`
- `src/storage/annotations/query_filters.py`
- `src/storage/annotations/reader.py`
- `src/storage/annotations/writer.py`
- `src/storage/annotations/relations.py`
- `src/storage/annotations/publication.py`
- `src/storage/annotations/import_export.py`
- `src/storage/annotations/store.py`

**Modify:**

- `src/storage/annotation_store.py`

- [ ] Move module-level helpers to `payloads.py` and `query_filters.py`.
- [ ] Move `_to_annotation_read`, `_to_relation_read`, and `_serialize_row` logic to `serializers.py`.
- [ ] Move `list_by_thread`, `list_by_code`, `list_map_annotations`, `list_all`, `search`, `_list_with_filters`, `get`, and `export_thread` read behavior to `reader.py`.
- [ ] Move `create`, `update`, and `delete` to `writer.py`.
- [ ] Move relation operations and markdown sync to `relations.py`.
- [ ] Move publication request/withdraw/review methods to `publication.py`.
- [ ] Move import/export all/thread methods to `import_export.py`.
- [ ] Keep `annotation_store.py` exporting `UnifiedAnnotationStore` from `annotations/store.py`.
- [ ] Run backend tests.
- [ ] Commit: `refactor: split annotation store by responsibility`.

### Task 3.2: Split `src/storage/knowledge_store.py`

**Current responsibilities:**

- Slug helpers.
- Entity CRUD.
- Entity delete dependency checks.
- Similarity/search/list.
- Relation validation and CRUD.
- Evidence CRUD.
- Draft CRUD and accept/reject support.
- Entity merge and annotation retargeting.
- Graph building.
- Import/export.
- Serialization helpers.

**Create:**

- `src/storage/knowledge/slugs.py`
- `src/storage/knowledge/annotation_links.py`
- `src/storage/knowledge/serializers.py`
- `src/storage/knowledge/entities.py`
- `src/storage/knowledge/search.py`
- `src/storage/knowledge/relations.py`
- `src/storage/knowledge/relation_validation.py`
- `src/storage/knowledge/evidence.py`
- `src/storage/knowledge/drafts.py`
- `src/storage/knowledge/merge.py`
- `src/storage/knowledge/graph.py`
- `src/storage/knowledge/import_export.py`
- `src/storage/knowledge/store.py`

**Modify:**

- `src/storage/knowledge_store.py`

- [ ] Move `normalize_slug` and `can_relation_become_subtopic` to `slugs.py`.
- [ ] Move annotation target matching and retarget helpers to `annotation_links.py`.
- [ ] Move ORM-to-read conversions to `serializers.py`.
- [ ] Move entity CRUD, delete checks, `get_many`, and stats to `entities.py`.
- [ ] Move `find_similar`, `search_entities`, and list search filtering to `search.py`.
- [ ] Move relation CRUD and read conversion to `relations.py`.
- [ ] Move subtopic and non-subtopic validation helpers to `relation_validation.py`.
- [ ] Move evidence CRUD to `evidence.py`.
- [ ] Move draft CRUD to `drafts.py`.
- [ ] Move merge behavior to `merge.py`.
- [ ] Move graph building to `graph.py`.
- [ ] Move import/export to `import_export.py`.
- [ ] Keep `knowledge_store.py` exporting `KnowledgeStore` from `knowledge/store.py`.
- [ ] Run backend tests.
- [ ] Commit: `refactor: split knowledge store by responsibility`.

### Task 3.3: Split `src/storage/tag_store.py`

**Current responsibilities:**

- Tag slug/anchor helpers.
- Tag CRUD.
- Alias checks.
- Merge/delete behavior.
- Tree/list behavior.
- Assignment CRUD.
- Target bundle/tag aggregation.
- Legacy email tag helpers.
- Tag stats and reverse target lookup.
- Serialization helpers.

**Create:**

- `src/storage/tags/normalization.py`
- `src/storage/tags/serializers.py`
- `src/storage/tags/tag_crud.py`
- `src/storage/tags/tag_tree.py`
- `src/storage/tags/assignments.py`
- `src/storage/tags/target_tags.py`
- `src/storage/tags/email_tags.py`
- `src/storage/tags/stats.py`
- `src/storage/tags/store.py`

**Modify:**

- `src/storage/tag_store.py`

- [ ] Move `slugify_tag`, anchor normalization, anchor hashing, and paragraph anchor building to `normalization.py`.
- [ ] Move `_to_tag_read` and `_to_assignment_read` to `serializers.py`.
- [ ] Move create/update/get/delete/merge and availability checks to `tag_crud.py`.
- [ ] Move `get_all_tags`, `get_tag_tree`, and `list_tags` to `tag_tree.py`.
- [ ] Move assignment CRUD and tag resolution to `assignments.py`.
- [ ] Move target bundle, target tag names, aggregated tag statements, and target reverse lookup to `target_tags.py`.
- [ ] Move email tag compatibility methods to `email_tags.py`.
- [ ] Move stats to `stats.py`.
- [ ] Keep `tag_store.py` exporting `TagStore` from `tags/store.py`.
- [ ] Run backend tests.
- [ ] Commit: `refactor: split tag store by responsibility`.

## Phase 4: Split Backend Routers

### Task 4.1: Split `src/api/routers/annotations.py`

**Current responsibilities:**

- Thread read route.
- Stats routes.
- Annotation list/create/update/delete routes.
- Relation routes.
- Publication workflow routes.
- Import/export routes.
- Inline request/response classes.

**Create:**

- `src/api/routers/annotation_routes/thread.py`
- `src/api/routers/annotation_routes/stats.py`
- `src/api/routers/annotation_routes/crud.py`
- `src/api/routers/annotation_routes/relations.py`
- `src/api/routers/annotation_routes/publication.py`
- `src/api/routers/annotation_routes/import_export.py`
- `src/api/routers/annotation_routes/schemas.py`

**Modify:**

- `src/api/routers/annotations.py`

- [ ] Move inline request/response models to `annotation_routes/schemas.py`.
- [ ] Move `/api/thread/{thread_id:path}` to `thread.py`.
- [ ] Move stats endpoints to `stats.py`.
- [ ] Move annotation CRUD/list endpoints to `crud.py`.
- [ ] Move relation endpoints to `relations.py`.
- [ ] Move publication endpoints to `publication.py`.
- [ ] Move import/export endpoints to `import_export.py`.
- [ ] Keep `annotations.py` creating a single `router` and including sub-routers in the existing route order.
- [ ] Verify relation routes remain before catchall thread route where route ambiguity matters.
- [ ] Run backend API tests.
- [ ] Commit: `refactor: split annotation routes by workflow`.

### Task 4.2: Split `src/api/routers/knowledge.py`

**Current responsibilities:**

- Entity list/create/get/update/delete.
- Draft list/create/update/accept/reject.
- Entity merge.
- Relations.
- Evidence.
- Graph.
- Versions.
- Import/export.
- Inline request/response classes.

**Create:**

- `src/api/routers/knowledge_routes/entities.py`
- `src/api/routers/knowledge_routes/drafts.py`
- `src/api/routers/knowledge_routes/merge.py`
- `src/api/routers/knowledge_routes/relations.py`
- `src/api/routers/knowledge_routes/evidence.py`
- `src/api/routers/knowledge_routes/graph.py`
- `src/api/routers/knowledge_routes/versions.py`
- `src/api/routers/knowledge_routes/import_export.py`
- `src/api/routers/knowledge_routes/schemas.py`

**Modify:**

- `src/api/routers/knowledge.py`

- [ ] Move inline request/response models to `knowledge_routes/schemas.py`.
- [ ] Move entity routes to `entities.py`.
- [ ] Move draft routes to `drafts.py`.
- [ ] Move merge route to `merge.py`.
- [ ] Move relation routes to `relations.py`.
- [ ] Move evidence routes to `evidence.py`.
- [ ] Move graph route to `graph.py`.
- [ ] Move versions route to `versions.py`.
- [ ] Move import/export routes to `import_export.py`.
- [ ] Keep `knowledge.py` creating a single `router` and including sub-routers in the existing route order.
- [ ] Run backend API tests.
- [ ] Commit: `refactor: split knowledge routes by workflow`.

## Phase 5: Split Frontend Pages And Components

### Task 5.1: Split `web/src/pages/KernelCodePage.tsx`

**Current responsibilities:**

- Repository route and local storage state.
- Kernel/code path resolution.
- Tree navigation and caching.
- File loading and rendering.
- Code selection and drag payload generation.
- Annotation sync.
- Tag/thread/knowledge side loading.
- Symbol popovers and symbol navigation.
- Resizable rails and inspector rendering.
- Directory rendering.

**Create:**

- `web/src/pages/kernelCodePage/repositoryLocation.ts`
- `web/src/pages/kernelCodePage/codeSelection.ts`
- `web/src/pages/kernelCodePage/patchMatching.ts`
- `web/src/pages/kernelCodePage/highlightedCode.tsx`
- `web/src/pages/kernelCodePage/useRepositoryState.ts`
- `web/src/pages/kernelCodePage/useCodeTree.ts`
- `web/src/pages/kernelCodePage/useCodeFile.ts`
- `web/src/pages/kernelCodePage/useCodeSelection.ts`
- `web/src/pages/kernelCodePage/useAnnotationSync.ts`
- `web/src/pages/kernelCodePage/useRelatedContext.ts`
- `web/src/pages/kernelCodePage/useSymbolPreview.ts`
- `web/src/pages/kernelCodePage/CodeNavigator.tsx`
- `web/src/pages/kernelCodePage/CodeViewer.tsx`
- `web/src/pages/kernelCodePage/CodeInspector.tsx`
- `web/src/pages/kernelCodePage/DirectoryView.tsx`
- `web/src/pages/kernelCodePage/RepositoryToolbar.tsx`

**Modify:**

- `web/src/pages/KernelCodePage.tsx`

- [ ] Move pure helpers for path validation, formatting, repository route building, local storage, and saved location handling to `repositoryLocation.ts`.
- [ ] Move patch hunk matching helpers to `patchMatching.ts`.
- [ ] Move C keyword sets and line highlighting to `highlightedCode.tsx`.
- [ ] Move markdown drag payload helpers to `codeSelection.ts`.
- [ ] Extract repository/version selection and reset state to `useRepositoryState.ts`.
- [ ] Extract tree cache, tree loading, tree expansion, and directory open behavior to `useCodeTree.ts`.
- [ ] Extract file loading, abort handling, path open behavior, and line clamping to `useCodeFile.ts`.
- [ ] Extract selected lines, selected range, selected text, drag start, and clear behavior to `useCodeSelection.ts`.
- [ ] Extract scroll-centered annotation sync, active annotation, pinned annotation, and deferred center behavior to `useAnnotationSync.ts`.
- [ ] Extract target tags, related threads, and related knowledge loading to `useRelatedContext.ts`.
- [ ] Extract symbol popover, symbol resolve, symbol candidate labels, and quick preview behavior to `useSymbolPreview.ts`.
- [ ] Extract navigation rail JSX to `CodeNavigator.tsx`.
- [ ] Extract code/directory center pane JSX to `CodeViewer.tsx` and `DirectoryView.tsx`.
- [ ] Extract inspector JSX to `CodeInspector.tsx`.
- [ ] Extract top toolbar JSX to `RepositoryToolbar.tsx`.
- [ ] Keep `KernelCodePage.tsx` as route-level composition and state wiring only.
- [ ] Preserve exports currently used by tests: `clampRequestedLine`, repository location helpers, drag payload helpers, preview path helpers, symbol candidate helpers.
- [ ] Run frontend typecheck/build and existing KernelCodePage tests.
- [ ] Commit: `refactor: split kernel code page into hooks and panels`.

### Task 5.2: Split `web/src/pages/ManualPdfPage.tsx`

**Current responsibilities:**

- PDF.js viewer iframe.
- Rail shell and resizing.
- Annotation mode controls.
- Document loading.
- Annotation loading.
- TOC/page navigation.
- Workspace layout.

**Create:**

- `web/src/pages/manualPdf/manualPdfTypes.ts`
- `web/src/pages/manualPdf/manualPdfUtils.ts`
- `web/src/pages/manualPdf/useManualPdfDocument.ts`
- `web/src/pages/manualPdf/useManualPdfAnnotations.ts`
- `web/src/pages/manualPdf/useWorkspaceRails.ts`
- `web/src/pages/manualPdf/PdfViewer.tsx`
- `web/src/pages/manualPdf/AnnotationModeControls.tsx`
- `web/src/pages/manualPdf/WorkspaceRailShell.tsx`
- `web/src/pages/manualPdf/ManualPdfWorkspace.tsx`

**Modify:**

- `web/src/pages/ManualPdfPage.tsx`

- [ ] Move manual PDF local types and constants to `manualPdfTypes.ts`.
- [ ] Move rail width clamp and annotation summary/page helpers to `manualPdfUtils.ts`.
- [ ] Move document loading hook to `useManualPdfDocument.ts`.
- [ ] Move annotation loading hook to `useManualPdfAnnotations.ts`.
- [ ] Move desktop detection, width state, resize keyboard/mouse behavior, and collapse reset behavior to `useWorkspaceRails.ts`.
- [ ] Move PDF.js iframe viewer to `PdfViewer.tsx`.
- [ ] Move annotation mode controls to `AnnotationModeControls.tsx`.
- [ ] Move rail shell to `WorkspaceRailShell.tsx`.
- [ ] Move workspace composition to `ManualPdfWorkspace.tsx`.
- [ ] Keep `ManualPdfPage.tsx` as route param plus load/error wrapper.
- [ ] Run frontend typecheck/build and existing ManualPdfPage tests.
- [ ] Commit: `refactor: split manual pdf workspace`.

### Task 5.3: Split `web/src/components/AnnotationRelationsPanel.tsx`

**Current responsibilities:**

- Relation grouping helpers.
- Peer ID helper.
- Relation form state.
- Candidate search.
- Nearby candidate selection.
- Relation list rendering.
- Preview popover state.

**Create:**

- `web/src/components/annotationRelations/relationGrouping.ts`
- `web/src/components/annotationRelations/relationOptions.ts`
- `web/src/components/annotationRelations/useAnnotationRelationForm.ts`
- `web/src/components/annotationRelations/RelationCandidatePicker.tsx`
- `web/src/components/annotationRelations/RelationGroupList.tsx`

**Modify:**

- `web/src/components/AnnotationRelationsPanel.tsx`

- [ ] Move relation options and labels to `relationOptions.ts`.
- [ ] Move `groupAnnotationRelations` and `getRelationPeerId` to `relationGrouping.ts`.
- [ ] Move form state, search state, submit behavior, and candidate map computation to `useAnnotationRelationForm.ts`.
- [ ] Move candidate search/nearby candidate UI to `RelationCandidatePicker.tsx`.
- [ ] Move grouped relation rendering to `RelationGroupList.tsx`.
- [ ] Keep existing public exports from `AnnotationRelationsPanel.tsx`.
- [ ] Run frontend typecheck/build and related tests.
- [ ] Commit: `refactor: split annotation relations panel`.

### Task 5.4: Split `web/src/components/kernelCode/AnnotationPanel.tsx`

**Current responsibilities:**

- Annotation composer.
- Annotation list and replies.
- Roller/pin/focus sync.
- Inline edit.
- Publish request/withdraw/review actions.
- Detail modal.
- Relation loading and creation/deletion in modal.
- Markdown drag payload.
- Range tagging tools.

**Create:**

- `web/src/components/kernelCode/annotationPanel/annotationMarkdownDrag.ts`
- `web/src/components/kernelCode/annotationPanel/annotationPanelUtils.ts`
- `web/src/components/kernelCode/annotationPanel/useAnnotationComposer.ts`
- `web/src/components/kernelCode/annotationPanel/useAnnotationListState.ts`
- `web/src/components/kernelCode/annotationPanel/useAnnotationFocusCapture.ts`
- `web/src/components/kernelCode/annotationPanel/useAnnotationDetailRelations.ts`
- `web/src/components/kernelCode/annotationPanel/AnnotationComposer.tsx`
- `web/src/components/kernelCode/annotationPanel/AnnotationCard.tsx`
- `web/src/components/kernelCode/annotationPanel/AnnotationReplyList.tsx`
- `web/src/components/kernelCode/annotationPanel/AnnotationDetailModal.tsx`
- `web/src/components/kernelCode/annotationPanel/AnnotationRangeTaggingTools.tsx`

**Modify:**

- `web/src/components/kernelCode/AnnotationPanel.tsx`

- [ ] Move environment-label helpers and type-support helpers to `annotationPanelUtils.ts`.
- [ ] Move markdown drag payload builder/writer to `annotationMarkdownDrag.ts`.
- [ ] Move composer body/open/saving behavior to `useAnnotationComposer.ts`.
- [ ] Move root/reply grouping, expanded IDs, inline edit state, roller items, and reply counts to `useAnnotationListState.ts`.
- [ ] Move capture focus and card click timer behavior to `useAnnotationFocusCapture.ts`.
- [ ] Move detail modal relation loading/search/create/delete behavior to `useAnnotationDetailRelations.ts`.
- [ ] Move composer UI to `AnnotationComposer.tsx`.
- [ ] Move card UI to `AnnotationCard.tsx`.
- [ ] Move replies UI to `AnnotationReplyList.tsx`.
- [ ] Move range tagging UI to `AnnotationRangeTaggingTools.tsx`.
- [ ] Move modal UI to `AnnotationDetailModal.tsx`.
- [ ] Keep `AnnotationPanel.tsx` as the main public component and preserve its exported helper functions.
- [ ] Run frontend typecheck/build and existing AnnotationPanel tests.
- [ ] Commit: `refactor: split kernel annotation panel`.

### Task 5.5: Split `web/src/components/knowledge/KnowledgeWorkbench.tsx`

**Current responsibilities:**

- Entity list loading/search/pagination.
- Selected entity loading.
- Annotations, map annotations, relations, evidence, graph, stats, and drafts loading.
- Entity create/update/delete/merge actions.
- Evidence/relation/draft actions.
- Import/export.
- URL query selection.
- Support rail and draft review state.
- Workbench layout composition.

**Create:**

- `web/src/components/knowledge/workbench/useKnowledgeEntities.ts`
- `web/src/components/knowledge/workbench/useSelectedKnowledgeEntity.ts`
- `web/src/components/knowledge/workbench/useKnowledgeAnnotations.ts`
- `web/src/components/knowledge/workbench/useKnowledgeRelations.ts`
- `web/src/components/knowledge/workbench/useKnowledgeEvidence.ts`
- `web/src/components/knowledge/workbench/useKnowledgeDrafts.ts`
- `web/src/components/knowledge/workbench/useKnowledgeGraph.ts`
- `web/src/components/knowledge/workbench/useKnowledgeImportExport.ts`
- `web/src/components/knowledge/workbench/knowledgeWorkbenchActions.ts`
- `web/src/components/knowledge/workbench/KnowledgeWorkbenchLayout.tsx`

**Modify:**

- `web/src/components/knowledge/KnowledgeWorkbench.tsx`

- [ ] Move entity list state, query, paging, load more, and selection URL updates to `useKnowledgeEntities.ts`.
- [ ] Move selected entity fetch/save/delete/merge state to `useSelectedKnowledgeEntity.ts`.
- [ ] Move annotation and map annotation loading/creation to `useKnowledgeAnnotations.ts`.
- [ ] Move relation loading/create/update/delete and relation draft state to `useKnowledgeRelations.ts`.
- [ ] Move evidence loading/create counts to `useKnowledgeEvidence.ts`.
- [ ] Move draft loading/filter/open/accept/reject state to `useKnowledgeDrafts.ts`.
- [ ] Move graph loading and depth state to `useKnowledgeGraph.ts`.
- [ ] Move import/export handlers to `useKnowledgeImportExport.ts`.
- [ ] Move action helpers that compose multiple hooks to `knowledgeWorkbenchActions.ts`.
- [ ] Move JSX layout composition to `KnowledgeWorkbenchLayout.tsx`.
- [ ] Keep `KnowledgeWorkbench.tsx` as auth/query-param orchestration and hook wiring.
- [ ] Run frontend typecheck/build and existing KnowledgeWorkbench tests.
- [ ] Commit: `refactor: split knowledge workbench hooks`.

## Phase 6: Consumer Migration And Facade Cleanup

### Task 6.1: Migrate Internal Imports To New Domain Modules

**Modify:**

- Only approved files unless the brief is expanded.

- [ ] In approved files, replace imports from broad facades with domain imports where doing so does not create churn.
- [ ] Leave external or unapproved-file imports against compatibility facades.
- [ ] Run backend and frontend verification.
- [ ] Commit: `refactor: use domain imports in split modules`.

### Task 6.2: Decide Whether To Keep Or Remove Facades

**Modify:**

- `src/storage/models.py`
- `src/storage/annotation_store.py`
- `src/storage/knowledge_store.py`
- `src/storage/tag_store.py`
- `src/api/routers/annotations.py`
- `src/api/routers/knowledge.py`
- `src/api/schemas.py`
- `web/src/api/client.ts`
- `web/src/api/types.ts`

- [ ] Keep facades if unapproved files still import them.
- [ ] Remove only private compatibility imports that are proven unused inside the approved scope.
- [ ] Do not delete a public facade in this plan unless every consumer is included in an expanded brief.
- [ ] Run full verification.
- [ ] Commit: `refactor: clean split-module facades`.

## Risk Register

- **Route order regression:** Annotation relation routes and catchall thread route can conflict. Preserve route registration order exactly.
- **SQLAlchemy relationship regression:** Moving ORM classes can break class name relationship resolution if imports are incomplete. Ensure all ORM modules are imported by the facade before metadata is used.
- **Circular imports:** Store packages should depend on ORM/schema modules, not the facade files that import the store packages.
- **TypeScript barrel cycles:** Domain clients should import types from `web/src/api/types/*`, not from the `types.ts` barrel when a cycle appears.
- **Hook extraction behavior drift:** Frontend page splits must be mechanical first. Keep prop signatures explicit and avoid changing state timing.
- **Test scope gap:** Current brief does not list test files or package config. Add them to the brief before implementation if exact commands or new tests are needed.

## Recommended Commit Sequence

1. `refactor: split storage models by domain`
2. `refactor: split api schemas by domain`
3. `refactor: split api types by domain`
4. `refactor: extract api http helpers`
5. `refactor: split api client by domain`
6. `refactor: split annotation store by responsibility`
7. `refactor: split knowledge store by responsibility`
8. `refactor: split tag store by responsibility`
9. `refactor: split annotation routes by workflow`
10. `refactor: split knowledge routes by workflow`
11. `refactor: split kernel code page into hooks and panels`
12. `refactor: split manual pdf workspace`
13. `refactor: split annotation relations panel`
14. `refactor: split kernel annotation panel`
15. `refactor: split knowledge workbench hooks`
16. `refactor: use domain imports in split modules`
17. `refactor: clean split-module facades`

## Done Criteria

- No approved source file remains over 700 lines unless it is an intentional public facade.
- Public import paths from the approved files continue to work.
- Existing API routes remain byte-for-byte compatible at the request/response contract level.
- No Alembic migration is created.
- Frontend pages render the same workflows with the same route paths.
- Backend and frontend verification commands pass after every phase.
- `AGENTS.md` is updated with the final split architecture decision when implementation is complete.
