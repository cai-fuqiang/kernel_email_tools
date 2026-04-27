# AI 概括功能 — 交互模型与实现

## 设计原则

**AI 不替代搜索，而是搜索的增强层。** 用户永远先看到搜索结果，AI 概要是用户主动触发的下一步。每一步的证据都是透明的、可点击验证的。

## 交互流程

```
用户输入关键词 → Search (instant, <1s)
  │
  ├→ 看到命中列表 → 可验证搜索质量
  │   │
  │   └→ [AI 概括前 N 条结果] 按钮 (用户主动点击)
  │       │
  │       └→ POST /api/search/summarize → LLM 总结 top-10 命中
  │           │
  │           ├→ 内联展示概括文本 ([Message-ID] 可点击 → ThreadDrawer)
  │           │
  │           └→ [创建草稿] 按钮 → 展开 Knowledge/Annotation/Tag 预览
  │               │
  │               └→ 保存 → Knowledge/Annotation/Tag 落库
```

## 后端 API

### `POST /api/search/summarize`
- Input: `{ query: str, hits: list[dict] }` — 前端传当前页命中 (最多 10 条)
- Processing: ChatLLMClient.complete() with evidence prompt, no agentic planning, no multi-query retrieval
- Output: `{ answer: str, sources: list[SourceRef], model: str }`
- Fallback: LLM 不可用时返回 "Found N emails but LLM unavailable"

### `POST /api/search/summarize/draft`
- Input: `{ query: str, summary: str, sources: list[SourceRef] }`
- Processing: AskDraftService.generate(query, summary, sources, tag_exists)
- Output: `{ knowledge_drafts, annotation_drafts, tag_assignment_drafts, warnings }`

### `POST /api/search/summarize/draft/apply`
- 复用原 `/api/ask/draft/apply` 的业务逻辑
- 批量创建 Knowledge / Annotation / Tag assignment，允许部分成功

## 前端实现

### SearchPage.tsx 关键状态
```typescript
summarizing: boolean      // LLM 请求进行中
summary: SummarizeResponse | null  // 概括结果
draftBundle: AskDraftResponse | null  // 草稿
showDraftPanel: boolean   // 草稿面板展开
```

### [Message-ID] 引用链接
- 概括文本中的 `[Message-ID]` 被解析为按钮
- 点击 → `setSelectedThread(thread_id)` → ThreadDrawer 打开
- 用户可验证 AI 概括是否基于原始邮件内容

### 草稿面板
- 内联展开在概括面板内部
- 显示 Knowledge entity (entity_type + canonical_name + summary)
- 显示 Annotation (target_type + target_label)
- 显示 Tag assignment (tag 存在性用绿色/灰色区分)
- 已缺失的 tag 自动取消勾选

## 已移除的功能
- ~~独立 Ask 页面~~ (/app/ask)
- ~~AskAgent agentic pipeline~~ (LLM 搜索规划 + 多路 chunk 召回)
- ~~硬编码 CJK 翻译字典~~ (QUERY_TRANSLATION_HINTS)
- ~~搜索计划/执行查询展示~~ (search_plan, executed_queries 不再暴露给用户)
- ~~AskDraftPanel 独立组件~~ (逻辑内联进 SearchPage)

## 保留的组件
- `src/qa/providers.py::ChatLLMClient` — 用于 summarize + draft
- `src/qa/providers.py::DashScopeEmbeddingProvider` — 用于 vector indexer
- `src/qa/ask_drafts.py::AskDraftService` — 草稿转 Knowledge 核心逻辑
- `src/indexer/email_chunks.py` — chunk 索引供后续扩展
- `src/indexer/email_vector.py` — 向量索引基础设施
