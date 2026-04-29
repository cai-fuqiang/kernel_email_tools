# Kernel Email Knowledge Base — 项目架构

## 定位

面向 Linux 内核邮件列表的本地知识库系统。项目把 lore.kernel.org 邮件、keyword/semantic/hybrid 检索、Ask Agent、AI Research Agent、手册问答、内核源码浏览、标签、批注和 Knowledge Draft Review 组织到一个 Web 工作台中。

核心目标：把邮件讨论、patch review、手册证据和代码批注沉淀成可引用、可审核、可维护的内核知识库。

## 技术栈

- 后端：Python 3.11+ / FastAPI / SQLAlchemy 2 async / PostgreSQL 16+ / pgvector / Pydantic v2
- 前端：React 18+ / TypeScript / Vite / Tailwind CSS / React Router
- AI：DashScope Qwen / DashScope `text-embedding-v3` / pgvector
- 数据源：lore.kernel.org git mirror、Intel SDM PDF、本地 kernel git repo

## 当前主入口

- Web 应用：`/app/`
- Search：`/app/`
- Ask Agent：`/app/ask`
- Agent Research：`/app/agent-research`
- Knowledge：`/app/knowledge`
- API 文档：`/docs`

## 目录结构

```text
src/
├── collector/       # lore git mirror 采集
├── parser/          # 邮件、patch、PDF/SDM 解析
├── chunker/         # 手册/文本分片
├── storage/         # PostgreSQL ORM、TagStore、AnnotationStore、KnowledgeStore、AgentStore
├── indexer/         # 全文索引、邮件 RAG chunk、向量索引
├── retriever/       # KeywordRetriever / SemanticRetriever / HybridRetriever / ManualRetriever
├── qa/              # AskAgent、AskDraftService、ManualQA、LLM/embedding provider
├── kernel_source/   # 本地 kernel git 浏览
├── symbol_indexer/  # ctags 符号索引脚本，定义跳转仍是后续计划
├── translator/      # 翻译与缓存
└── api/             # FastAPI server.py

web/src/
├── pages/           # Search / Ask / Agent Research / Knowledge / Tags / Annotations / Code / Manuals / Admin
├── components/      # ThreadDrawer、DraftReviewPanel、EmailTagEditor、KnowledgeGraphView 等
├── layouts/         # MainLayout
├── api/             # client.ts / types.ts
└── auth.tsx         # 前端认证状态
```

## 核心流程

### 邮件导入

```text
lore git mirror -> EmailParser -> PostgresStorage(emails)
  -> search_vector 回填 -> GIN fulltext index
```

普通导入不构建 semantic 所需的 RAG chunk/vector。

### Semantic 检索

```text
emails -> email_chunks -> email_chunk_embeddings
  -> DashScope query embedding -> pgvector cosine search
  -> message_id 去重 -> SearchHit(source=semantic)
```

`mode=semantic` 必须依赖 `email_chunks` 和 `email_chunk_embeddings`。短缩写、宏名、函数名、Message-ID 片段优先用 `keyword` 或 `hybrid`。

### Ask / Draft

```text
用户问题 -> AskAgent 生成检索计划
  -> keyword + semantic chunk retrieval
  -> thread expansion
  -> LLM synthesis with sources
  -> AskDraftService 生成可编辑 Knowledge/Annotation/Tag drafts
  -> 用户 review 后落库
```

### AI Research Agent

```text
topic -> agent_research_runs
  -> background task
  -> search / relevance trace / Ask synthesis
  -> KnowledgeDraft(source_type=agent_research)
  -> human review
```

Agent 是特殊系统用户，默认 `agent:lobster-agent`，role 为 `agent`。Agent 不自动修改 accepted Knowledge，只写 draft 和 trace。

## 关键约束

- Search 页面默认 `mode=semantic`，但 filter-only 搜索必须用 keyword/hybrid。
- 新导入邮件后，如需 semantic，必须额外跑 `--build-chunks` 和 `--build-vector`。
- Ask 草稿只默认绑定已有 tag，不自动创建新 tag。
- Knowledge Draft 是 AI 输出进入知识库的审核边界，不允许绕过 review 自动落库。
- Agent Research 当前是 single-pass MVP，不是完整自主多轮 agent。
- API key 优先级：环境变量 > `settings.yaml`。
- Header-based auth 仅适用于可信代理环境。
- Knowledge 模块是最终产品形态；新功能应优先服务“如何让用户消费、验证和复用知识”。
