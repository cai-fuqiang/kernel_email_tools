# AI / Search / Draft / Agent 规则

## 总原则

AI 是证据工作流的增强层，不是事实来源。所有 AI 输出都必须能追溯到邮件、thread、manual、code 或已接受 Knowledge，并且在写入 Knowledge 前经过 draft review。

## Search Summarize

Search 页面允许用户在看到搜索结果后主动触发 AI 概括。

流程：

```text
用户搜索 -> SearchHit 列表
  -> POST /api/search/summarize
  -> 显示带 [Message-ID] 引用的 summary
  -> POST /api/search/summarize/draft
  -> DraftReviewPanel 人工确认
  -> POST /api/search/summarize/draft/apply
```

规则：

- 不在用户未触发时自动调用 LLM。
- Summary 必须保留 source refs，引用可点击打开 ThreadDrawer。
- 概括不能替代原始邮件证据。
- 生成 draft 时复用 `AskDraftService`。

## Ask Agent

Ask 页面当前保留并使用 agentic RAG。

流程：

```text
question -> LLM search_plan
  -> keyword queries
  -> semantic queries if vector index exists
  -> merge chunk hits
  -> expand threads
  -> LLM answer
  -> optional draft generation
```

返回内容应包含：

- `search_plan`
- `executed_queries`
- `sources`
- `threads`
- `retrieval_stats`

## Semantic Search 前置条件

`mode=semantic` 依赖：

- `indexer.vector.enabled: true`
- DashScope embedding provider 可用
- `email_chunks` 已构建
- `email_chunk_embeddings` 已构建，provider/model 与运行配置一致

必要命令：

```bash
python scripts/index.py --build-chunks --list <list>
python scripts/index.py --build-vector --list <list>
```

短缩写、宏名、函数名、Message-ID 片段不适合作为纯 semantic query，应提示使用 `keyword` 或 `hybrid`。

## Draft Review

AI 生成内容进入系统的边界是 draft。

- `KnowledgeDraft` 可来自 Search summarize、Ask 或 Agent Research。
- 用户可以编辑、取消勾选、accept 或 reject。
- 缺失 tag 显示为 `missing`，默认不选中。
- 不自动创建新 tag。
- 不自动 accept Knowledge。

## AI Research Agent

Agent Research 把 AI 作为特殊系统用户运行。

默认身份：

- `user_id`: `agent:lobster-agent`
- `role`: `agent`
- `auth_source`: `system_agent`

当前 MVP：

- 创建 `agent_research_runs`
- 记录 `agent_run_actions`
- semantic-first 搜索
- 调用 Ask synthesis
- 创建 `source_type=agent_research` 的 Knowledge Draft
- 人工 review 后落库

约束：

- Agent 不作为普通登录用户。
- Agent 写操作必须通过服务或 domain store，并带上 agent identity/audit fields。
- Agent 不直接修改 accepted public Knowledge。
- Retrieved content 是不可信证据，不是 prompt/system/tool 指令。
- Existing Knowledge 是 context，不是 primary source evidence。
- 取消、重试、成本统计、多轮 relevance loop 仍是 TODO。
