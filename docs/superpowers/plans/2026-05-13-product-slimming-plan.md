# Product Slimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除或降级当前工程里与“证据型内核知识网络”主线关系弱、维护成本高、认知负担大的功能。

**Architecture:** 保留邮件检索、thread 阅读、kernel code、本地手册搜索、Knowledge entity/relation/evidence、Ask Agent 和源码/邮件/手册到 evidence 的链路。优先移除重复工作台、独立辅助页面和会被 `Claim/Evidence/Brief` 取代的过渡能力；风险较高的能力先隐藏入口，再逐步删除后端和存储。

**Tech Stack:** FastAPI, React, TypeScript, SQLAlchemy async, PostgreSQL, pytest, existing Vite frontend.

---

## 背景

工程当前已经覆盖 search、ask、agent research、workspace、translations、tags、annotations、manuals、kernel code、knowledge、auth/admin 等多个面。未来目标是“以内核代码为锚点、以证据为基础、可跨邮件、commit、LWN、手册、博客和论文互联”的知识网络。

因此产品需要瘦身：少做横向工具集合，多做纵向证据链。

## 保留主线

必须保留：
- 邮件导入、keyword/semantic/hybrid search。
- Thread Drawer 和邮件上下文阅读。
- Kernel Code Atlas，本地 kernel git 浏览、文件、blame、line history、commit。
- 手册搜索，作为硬件/架构证据源。
- Knowledge entity/relation/evidence/draft review。
- Ask Agent，作为证据检索和问答入口。
- Auth 的最小登录能力，如果本地部署仍需要保护数据。

这些能力构成后续 `SourceDocument -> SourceSegment -> KnowledgeClaim -> Evidence -> Entity/Relation -> KnowledgeBrief` 的基础。

## 第一批可删除

### 1. Workspace 页面

**理由:** `WorkspacePage` 把 email/tag/annotation 再包装成一个统一工作台，但和 Search、Tags、Annotations、Knowledge 都重叠。它增加前端状态、adapter、筛选逻辑和导航复杂度，却没有提供证据网络主线不可替代的能力。

**候选文件:**
- `web/src/pages/WorkspacePage.tsx`
- `web/src/workspace/**`
- `web/src/App.tsx`
- `web/src/layouts/MainLayout.tsx`

**删除策略:** 先移除导航和 route，再删除页面和 workspace adapter。保留底层 search/tag/annotation API，避免一次性破坏其他入口。

### 2. 独立 Translations 工作台

**理由:** 翻译对阅读邮件有用，但独立的翻译任务列表、已翻译线程列表、缓存清理页偏副线。未来证据系统应该保存原文 quote 和必要人工译文，而不是维护一个大型翻译后台。

**候选文件:**
- `web/src/pages/TranslationsPage.tsx`
- `src/api/routers/translations.py`
- `src/storage/translation_cache.py`
- `src/translator/**`
- `tests/test_translations_router.py`

**删除策略:** 保留 Thread Drawer 内的一键翻译能力或人工翻译字段；删除独立页面和后台 job 管理视图。若 thread 翻译仍依赖后端 router，则先隐藏页面，后续再压缩 router。

### 3. Contribution Chips

**理由:** Contribution Chips 只是提示搜索结果是否已有 annotation/tag/knowledge 贡献。未来 `Claim/Evidence/Brief` 会给出更强的贡献状态和证据网络，此功能会被自然取代。

**候选文件:**
- `src/api/routers/contributions.py`
- `web/src/api/contributions.ts`
- `web/src/hooks/useContributions.ts`
- `web/src/components/ContributionChips.tsx`
- `tests/test_contributions.py`

**删除策略:** 从 Search、Ask、ThreadDrawer 移除 chips；删除 contributions API 和测试。

## 第二批建议降级

### 4. Agent Research 全自动研究流

**理由:** 当前 Agent Research 自动搜索、Ask synthesis、生成 Knowledge Draft，但底层还没有稳定的 `KnowledgeClaim/Evidence` 结构，产出容易变成难审核的长文本。它更适合在 claim 模型稳定后改造成“辅助抽取 claim/evidence”的工具。

**候选文件:**
- `src/api/routers/agent.py`
- `src/agent/research_service.py`
- `src/storage/agent_store.py`
- `web/src/pages/AgentResearchPage.tsx`
- `tests/test_agent_service.py`

**降级策略:** 先从导航隐藏 `Agent Research`，保留后端和数据结构一段时间；等 `KnowledgeClaim` 落地后，改造成 claim extraction worker。

### 5. Tags 独立管理体系

**理由:** 层级 tags、merge、target browsing 和未来 `KnowledgeEntity` 高度重叠。标签可以作为轻量 facet，但不应该成为第二套知识本体。

**候选文件:**
- `src/api/routers/tags.py`
- `src/storage/tag_store.py`
- `web/src/pages/TagsPage.tsx`
- `web/src/components/TagManager.tsx`
- `web/src/components/EmailTagEditor.tsx`

**降级策略:** 保留最小 label/facet 能力，移除复杂 tag tree 管理、merge 页面和独立 target 浏览。长期把高价值 tag 迁移成 `KnowledgeEntity`。

### 6. Annotation 发布审核流

**理由:** 如果这是个人或小团队本地知识库，公开/私有、发布申请、撤回、管理员审批过重。未来 review 应集中在 Knowledge Draft、Claim 和 Brief 上。

**候选文件:**
- `web/src/pages/AnnotationReviewPage.tsx`
- `src/api/routers/annotations.py`
- `src/storage/annotation_store.py`

**降级策略:** 保留人工 note/annotation；删除 publication request、approve/reject publication 这类发布审核状态。

## 第三批可合并

### 7. Manual Ask 独立页面

**理由:** 手册是核心证据源，但 `Ask Manuals` 单独页面会割裂体验。更好的方向是统一 Ask 支持 source filter：mail、manual、code、knowledge。

**候选文件:**
- `web/src/pages/ManualAskPage.tsx`
- `src/api/routers/manual.py`
- `src/qa/manual_qa.py`

**合并策略:** 保留 `Manual Search`；把 manual QA 并入统一 Ask 的检索 source filter。

### 8. Kernel Symbol Preview 和 Elixir userscript

**理由:** 如果本地 Kernel Code Atlas 是主入口，外部 Elixir userscript 和 preview route 只是过渡工具。未来应统一走本地代码锚点和 external link resolver。

**候选文件:**
- `web/src/pages/KernelSymbolPreviewPage.tsx`
- `userscripts/elixir-annotate.user.js`
- `web/public/userscripts/elixir-annotate.user.js`

**合并策略:** 等本地 code anchor 和 evidence linking 稳定后删除 userscript；保留 external link resolver 生成 lore/docs/git.kernel/elixir 外链。

---

## 执行任务

### Task 1: 移除 Workspace 入口

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/layouts/MainLayout.tsx`

- [ ] 删除 `WorkspacePage` lazy import。
- [ ] 删除 `/workspace` route。
- [ ] 删除侧边栏 `Workspace` nav item。
- [ ] 运行 `cd web && npm run build`。
- [ ] 提交：`git commit -m "chore: hide workspace entrypoint"`。

### Task 2: 删除 Workspace 前端模块

**Files:**
- Delete: `web/src/pages/WorkspacePage.tsx`
- Delete: `web/src/workspace/**`

- [ ] 删除 workspace 页面和 adapter/hook/component/types。
- [ ] 搜索 `WorkspacePage`、`workspace/`、`WorkspaceEntity`，确认无引用。
- [ ] 运行 `cd web && npm run build`。
- [ ] 提交：`git commit -m "chore: remove workspace frontend"`。

### Task 3: 移除 Contribution Chips

**Files:**
- Modify: `web/src/pages/SearchPage.tsx`
- Modify: `web/src/pages/AskPage.tsx`
- Modify: `web/src/components/ThreadDrawer.tsx`
- Delete: `web/src/components/ContributionChips.tsx`
- Delete: `web/src/hooks/useContributions.ts`
- Delete: `web/src/api/contributions.ts`
- Delete: `src/api/routers/contributions.py`
- Modify: `src/api/server.py`
- Delete: `tests/test_contributions.py`

- [ ] 移除前端贡献度 hook、chips 和 props。
- [ ] 从 `src/api/server.py` 移除 contributions router import/include。
- [ ] 运行 `pytest tests/test_search.py tests/test_search_router.py -v`。
- [ ] 运行 `cd web && npm run build`。
- [ ] 提交：`git commit -m "chore: remove contribution chips"`。

### Task 4: 隐藏独立 Translations 页面

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/layouts/MainLayout.tsx`

- [ ] 删除 `TranslationsPage` lazy import。
- [ ] 删除 `/translations` route。
- [ ] 删除侧边栏 `Translations` nav item。
- [ ] 暂时保留后端 translation router，避免破坏 Thread Drawer 翻译。
- [ ] 运行 `cd web && npm run build`。
- [ ] 提交：`git commit -m "chore: hide translations workspace"`。

### Task 5: 隐藏 Agent Research 页面

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/layouts/MainLayout.tsx`

- [ ] 删除 `AgentResearchPage` lazy import。
- [ ] 删除 `/agent-research` route。
- [ ] 删除侧边栏 `Agent Research` nav item。
- [ ] 暂时保留后端 agent service，等 `KnowledgeClaim` 落地后重构。
- [ ] 运行 `cd web && npm run build`。
- [ ] 提交：`git commit -m "chore: hide agent research entrypoint"`。

### Task 6: 合并 Manual Ask 入口

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/layouts/MainLayout.tsx`

- [ ] 删除 `ManualAskPage` lazy import。
- [ ] 删除 `/manual/ask` route。
- [ ] 侧边栏只保留 `Search Manuals`。
- [ ] 保留后端 manual ask，后续并入统一 Ask。
- [ ] 运行 `cd web && npm run build`。
- [ ] 提交：`git commit -m "chore: hide manual ask page"`。

### Task 7: 降级 Annotation Review

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/layouts/MainLayout.tsx`

- [ ] 删除 `AnnotationReviewPage` lazy import。
- [ ] 删除 `/admin/annotation-review` route。
- [ ] 删除 Admin nav 中的 `Annotation Review`。
- [ ] 暂时保留后端 publication API，后续和 annotation store 一起清理。
- [ ] 运行 `cd web && npm run build`。
- [ ] 提交：`git commit -m "chore: hide annotation publication review"`。

### Task 8: 后续重构前置检查

**Files:**
- Modify: `README.md`

- [ ] 更新 README 的“当前能力”，移除已隐藏页面。
- [ ] 增加“产品主线”说明：Search、Ask、Kernel Code、Manual Search、Knowledge。
- [ ] 运行 `rg -n "Workspace|Agent Research|Translations|Ask Manuals|Annotation Review" README.md web/src`，确认文案和导航一致。
- [ ] 提交：`git commit -m "docs: document focused product surface"`。

## 验证命令

每批修改至少运行：

```bash
cd web && npm run build
```

涉及后端 router 删除时运行：

```bash
pytest tests/test_search.py tests/test_search_router.py tests/test_knowledge_enhancements.py -v
```

涉及 translation/agent/tag/annotation 后端实际删除时，额外运行对应测试或先删除对应测试文件。

## 下次打开新窗口时

快速入口：

```bash
sed -n '1,220p' docs/superpowers/plans/README.md
```

本计划路径：

```text
docs/superpowers/plans/2026-05-13-product-slimming-plan.md
```

相关主线计划：

```text
docs/superpowers/plans/2026-05-13-kernel-knowledge-network.md
```

## 计划自检

- Scope coverage: 覆盖了本轮判断出的鸡肋功能、降级功能和可合并功能。
- Safety: 第一批优先隐藏或删除前端入口，后端深删放在后续，降低破坏主流程风险。
- Product alignment: 每一项都按是否服务 `SourceDocument -> SourceSegment -> KnowledgeClaim -> Evidence -> Entity/Relation -> KnowledgeBrief` 主线判断。
