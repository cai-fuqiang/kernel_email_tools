# Kernel Email Knowledge Base

面向 Linux 内核邮件列表的本地知识库系统。它把 lore.kernel.org git mirror、邮件全文检索、semantic chunk 检索、Ask Agent、AI Research Agent、手册问答、内核源码浏览、标签、批注和 Knowledge Draft Review 组织到一个 Web 工作台里。

目标不是只做一个搜索框，而是把邮件讨论、patch review、手册证据和代码批注沉淀成可引用、可审核、可维护的内核知识库。

## 当前能力

- 邮件导入：支持 `kvm`、`linux-mm`、`lkml` 等 lore git mirror，本地仓库优先。
- Keyword 搜索：PostgreSQL TSVECTOR + GIN，支持 list、sender、date、patch、tag 过滤。
- Semantic 搜索：`email_chunks` + `email_chunk_embeddings` + pgvector，默认使用 DashScope `text-embedding-v3`。
- Hybrid 搜索：短关键词偏 keyword，自然语言问题融合 keyword/semantic。
- Ask Agent：生成检索计划，执行多 query 检索，拉取 thread 上下文，并生成带证据的回答。
- AI Research Agent：把 AI 作为特殊系统用户，按 topic 创建 research run，自动搜索、Ask synthesis、生成 Knowledge Draft，等待人工 review。
- Knowledge Workbench：知识实体、关系、evidence、graph、Draft Inbox、merge。
- Draft Review：Ask/Search/Agent 产出的 Knowledge、Annotation、Tag assignment 草稿先进入 review，不自动污染知识库。
- Tags：层级标签、target 浏览、邮件/知识实体绑定。
- Annotations：邮件、代码、知识实体批注，以及发布审核。
- Thread Drawer：线程阅读、翻译、批注、标签、patch 展示。
- Kernel Code：本地 kernel git 浏览、版本树、文件查看、代码批注；符号索引脚本已存在，定义跳转仍在后续计划中。
- Manuals：Intel SDM 等 PDF 导入、手册搜索和手册问答。
- Auth/Admin：本地账号、角色、审批、公开/私有内容和批注发布审核。

## 架构

```text
src/
├── collector/       # lore git mirror 采集
├── parser/          # 邮件、patch、PDF/SDM 解析
├── chunker/         # 手册/文本分片
├── storage/         # PostgreSQL ORM、标签、批注、知识、agent run、缓存
├── indexer/         # 全文索引、邮件 RAG chunk、向量索引
├── retriever/       # keyword / semantic / hybrid / manual 检索
├── qa/              # AskAgent、AskDraftService、ManualQA、LLM/embedding provider
├── kernel_source/   # 本地 kernel git 浏览
├── symbol_indexer/  # ctags 符号索引
├── translator/      # 翻译与缓存
└── api/             # FastAPI 服务

web/src/
├── pages/           # Search / Ask / Agent Research / Knowledge / Tags / Annotations / Code / Manuals / Admin
├── components/      # ThreadDrawer、DraftReviewPanel、Tag/Annotation 组件等
├── layouts/         # MainLayout
├── api/             # API client 和 TypeScript 类型
└── auth.tsx         # 前端认证状态
```

## 环境要求

- Python 3.11+
- Node.js 18+
- PostgreSQL 16+
- pgvector 扩展
- DashScope API key，用于 email semantic embedding 和默认 LLM/embedding provider

## 安装

```bash
pip install -e ".[dev]"

cd web
npm ci
cd ..
```

## PostgreSQL

示例使用 Podman，也可以换成 Docker 或本机 PostgreSQL。

```bash
podman run -d --name kernel-pg -p 5432:5432 \
  -e POSTGRES_USER=kernel \
  -e POSTGRES_PASSWORD=kernel \
  -e POSTGRES_DB=kernel_email \
  docker.io/postgres:16

podman exec -it kernel-pg psql -U kernel -d kernel_email \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

如果手册库使用单独数据库：

```bash
podman exec -it kernel-pg createdb -U kernel chip_manual_kb
podman exec -it kernel-pg psql -U kernel -d chip_manual_kb \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## 配置

主要配置在 [config/settings.yaml](config/settings.yaml)。

关键项：

```yaml
email_collector:
  base_url: https://lore.kernel.org
  data_dir: ~/workspace/kernel_email
  local_channels:
    - name: kvm
      path: ~/workspace/kernel_email/kvm
    - name: linux-mm
      path: ~/workspace/kernel_email/linux-mm
    - name: lkml
      path: ~/workspace/kernel_email/lkml

storage:
  email:
    database_url: postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email
  manual:
    database_url: postgresql+asyncpg://kernel:kernel@localhost:5432/chip_manual_kb

indexer:
  vector:
    enabled: true
    provider: dashscope
    model: text-embedding-v3
    dimension: 1536
    batch_size: 16

qa:
  email:
    llm_provider: dashscope
    model: qwen3-coder-plus
```

推荐把 API key 放环境变量，配置文件只做本地兜底：

```bash
export DASHSCOPE_API_KEY=...
export KERNEL_ADMIN_PASSWORD=...
```

## 启动

```bash
python scripts/serve.py
```

访问：

- Web 应用：http://localhost:8000/app/
- API 文档：http://localhost:8000/docs

前端开发：

```bash
cd web
npm run dev -- --host 127.0.0.1
# http://127.0.0.1:5173/app/
```

## 邮件导入

普通导入会采集、解析、入库、回填全文索引并重建 GIN 索引；不会默认构建 RAG chunk/vector。

```bash
python scripts/index.py --list kvm --epoch 0
python scripts/index.py --list linux-mm --all-epochs
python scripts/index.py --list lkml --all-epochs
```

小样本测试：

```bash
python scripts/index.py --list kvm --epoch 0 --limit 100
```

大列表可调整批次：

```bash
python scripts/index.py --list lkml --epoch 0 \
  --ingest-batch-size 10000 \
  --db-batch-size 5000
```

如果服务在线且不想临时 drop 全文 GIN 索引：

```bash
python scripts/index.py --list lkml --epoch 0 --keep-fulltext-index
```

导入日志中的 `Epoch ... done` 只表示采集/解析/入库完成；随后还会回填 `search_vector` 并重建索引，大库需要继续等。

## Search 模式与索引

Search 页面默认使用 `Semantic`。它要求非空 query，并依赖邮件 chunk 向量索引。

模式区别：

- `keyword`：精确词检索，适合 `RSDL`、函数名、宏名、Message-ID 片段等短词。
- `semantic`：向量检索，适合自然语言问题或概念性描述。
- `hybrid`：自动路由，短 query 通常只走 keyword，自然语言问题会融合 semantic。

构建 semantic 所需索引：

```bash
# 1. 从 emails 生成 email_chunks
python scripts/index.py --build-chunks --list lkml

# 2. 为 email_chunks 生成 email_chunk_embeddings
python scripts/index.py --build-vector --list lkml
```

两步都需要。只有 `emails` 或全文索引不够，`mode=semantic` 仍会返回空。

一次性重建 chunk + vector：

```bash
python scripts/index.py --rebuild-rag-index --list lkml
```

对 LKML 这种百万级列表，`--build-vector` 会非常慢，并会调用 DashScope embedding 产生费用。短缩写或精确 token 优先用 `Keyword` 或 `Hybrid`。

检查索引状态：

```sql
SELECT COUNT(*) FROM emails;
SELECT COUNT(*) FROM email_chunks;
SELECT provider, model, COUNT(*) FROM email_chunk_embeddings GROUP BY provider, model;
```

## 新导入邮件后要跑什么

如果只需要 keyword/hybrid 的精确搜索：

```bash
python scripts/index.py --list lkml --all-epochs
```

如果还需要 semantic 搜索，再跑：

```bash
python scripts/index.py --build-chunks --list lkml
python scripts/index.py --build-vector --list lkml
```

当前脚本的 chunk/vector 构建偏全量重建。后续计划是增量 chunk/vector，只处理新邮件。

## Ask Agent

`POST /api/ask` 的流程：

1. LLM 生成结构化检索计划。
2. 执行多条 keyword query。
3. 如果向量索引可用，执行 semantic query。
4. 合并 chunk 命中，必要时回退邮件级搜索。
5. 展开相关 thread 上下文。
6. LLM 基于证据回答，返回 sources、threads、executed_queries、retrieval_stats。

Ask 页面可以把回答转换成可编辑草稿：

- Knowledge entity 草稿
- Annotation 草稿
- Tag assignment 草稿

保存前用户可以逐项编辑和取消勾选。缺失 tag 会显示为 `missing`，默认不选中；系统不会自动创建新 tag。

## AI Research Agent

Agent Research 是一个第一版 MVP。它把 AI 作为特殊系统用户，而不是普通登录用户。

默认 agent 用户：

- `user_id`: `agent:lobster-agent`
- `username`: `lobster-agent`
- `role`: `agent`
- `auth_source`: `system_agent`

Web 入口：

- `/app/agent-research`
- 左侧导航：`Research` -> `Agent Research`

当前 run 流程：

1. 用户输入 topic 和过滤条件。
2. 后端创建 `agent_research_runs`。
3. 后台任务执行 semantic-first 搜索，失败时回退 hybrid/search flow。
4. 记录 `agent_run_actions` trace。
5. 调用 Ask synthesis。
6. 创建 `source_type=agent_research` 的 Knowledge Draft。
7. 人工在 Knowledge Draft Inbox review/accept/reject。

相关 API：

- `POST /api/agent/research-runs`
- `GET /api/agent/research-runs`
- `GET /api/agent/research-runs/{run_id}`
- `POST /api/agent/research-runs/{run_id}/cancel`
- `POST /api/agent/research-runs/{run_id}/retry`

当前限制：

- 还不是完整自主多轮 agent，只是 bounded single-pass MVP。
- cancel API 会更新 run 状态，但已运行任务尚未完全 cooperative cancellation。
- 不自动 accept Knowledge，只生成 draft。
- 还没有 token/cost accounting。
- 详细 TODO 见 [.joycode/plans/PLAN-35000-ai-agent-special-user.md](.joycode/plans/PLAN-35000-ai-agent-special-user.md)。

## Web 功能

- **Search Emails**：keyword/semantic/hybrid 邮件搜索，支持 channel、sender、date、patch、tag 过滤，搜索结果可 AI 概括并生成草稿。
- **Ask Agent**：agentic RAG 问答，展示检索计划、执行 query、来源、相关 thread，并可生成知识草稿。
- **Agent Research**：按 topic 创建 AI research run，查看 trace，生成 Knowledge Draft。
- **Knowledge**：知识实体、关系、evidence、graph、Draft Inbox。
- **Tags**：层级标签管理、tag target 浏览、邮件/知识实体绑定。
- **Annotations**：统一批注列表，支持邮件/代码/知识实体批注和发布审核。
- **Translations**：线程翻译缓存、批量翻译任务、人工翻译修订。
- **Kernel Code**：本地 kernel git 浏览、版本树、文件查看、代码批注。
- **Manual Search / Ask**：芯片手册搜索与问答。
- **Users / Admin**：本地用户、审批、角色、批注发布审核。

## 常用 API

完整交互以 http://localhost:8000/docs 为准。

### 搜索与 Ask

- `GET /api/search`
- `POST /api/search/summarize`
- `POST /api/search/summarize/draft`
- `POST /api/search/summarize/draft/apply`
- `POST /api/ask`
- `POST /api/ask/draft`
- `POST /api/ask/draft/apply`
- `GET /api/ask/conversations`
- `POST /api/ask/conversations`
- `GET /api/thread/{thread_id}`
- `GET /api/stats`

### AI Research Agent

- `POST /api/agent/research-runs`
- `GET /api/agent/research-runs`
- `GET /api/agent/research-runs/{run_id}`
- `POST /api/agent/research-runs/{run_id}/cancel`
- `POST /api/agent/research-runs/{run_id}/retry`

### Knowledge

- `GET /api/knowledge/entities`
- `POST /api/knowledge/entities`
- `GET /api/knowledge/entities/{entity_id}`
- `PATCH /api/knowledge/entities/{entity_id}`
- `DELETE /api/knowledge/entities/{entity_id}`
- `POST /api/knowledge/entities/merge`
- `GET /api/knowledge/entities/{entity_id}/relations`
- `GET /api/knowledge/entities/{entity_id}/evidence`
- `POST /api/knowledge/entities/{entity_id}/evidence`
- `GET /api/knowledge/entities/{entity_id}/graph`
- `GET /api/knowledge/drafts`
- `POST /api/knowledge/drafts`
- `PATCH /api/knowledge/drafts/{draft_id}`
- `POST /api/knowledge/drafts/{draft_id}/accept`
- `POST /api/knowledge/drafts/{draft_id}/reject`

### Tags

- `GET /api/tags`
- `POST /api/tags`
- `PATCH /api/tags/{tag_id}`
- `DELETE /api/tags/{tag_id}`
- `GET /api/tags/stats`
- `GET /api/channels`
- `GET /api/tag-targets`
- `POST /api/tag-assignments`
- `GET /api/tag-assignments`
- `DELETE /api/tag-assignments/{assignment_id}`
- `GET /api/tag-targets/{target_type}/{target_ref}/tags`
- `GET /api/email/{message_id}/tags`
- `POST /api/email/{message_id}/tags`
- `DELETE /api/email/{message_id}/tags/{tag_name}`

### Annotations

- `GET /api/annotations`
- `POST /api/annotations`
- `DELETE /api/annotations/{annotation_id}`
- `POST /api/annotations/{annotation_id}/publish-request`
- `POST /api/annotations/{annotation_id}/publish-withdraw`
- `POST /api/admin/annotations/{annotation_id}/approve-publication`
- `POST /api/admin/annotations/{annotation_id}/reject-publication`
- `POST /api/annotations/export`
- `POST /api/annotations/import`

### Translation

- `POST /api/translate`
- `POST /api/translate/batch`
- `POST /api/translate/thread`
- `GET /api/translate/jobs`
- `GET /api/translate/jobs/{job_id}`
- `GET /api/translate/threads`
- `PUT /api/translate/manual`
- `DELETE /api/translate/cache`

### Manuals

- `GET /api/manual/search`
- `GET /api/manual/ask`
- `GET /api/manual/stats`

### Kernel Code

- `GET /api/kernel/versions`
- `GET /api/kernel/tree/{version}`
- `GET /api/kernel/file/{version}/{path}`
- `GET /api/kernel/annotations`
- `POST /api/kernel/annotations`
- `DELETE /api/kernel/annotations/{annotation_id}`

### Auth / Admin

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `POST /api/auth/change-password`
- `GET /api/me`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/{user_id}`
- `POST /api/admin/users/{user_id}/approve`
- `POST /api/admin/users/{user_id}/reject`
- `POST /api/admin/users/{user_id}/reset-password`

## 手册导入

```bash
python scripts/ingest_manual.py --pdf ./manuals/intel_sdm/sdm.pdf --store
```

手册使用 `storage.manual.database_url`，可以和邮件库分开。

## 内核源码与符号索引

`config/settings.yaml`：

```yaml
kernel_source:
  repo_path: /path/to/linux-stable/.git
  history_repo_path: /path/to/history/.git
  graft_enabled: true
  version_filter: release
```

符号索引：

```bash
python scripts/index_symbols.py --help
```

## 数据库维护

重建数据库：

```bash
python scripts/rebuild_db.py
```

这是破坏性操作，会删除并重建相关表。

常用 SQL：

```sql
SELECT list_name, COUNT(*) FROM emails GROUP BY list_name;
SELECT COUNT(*) FROM emails WHERE search_vector IS NOT NULL;
SELECT COUNT(*) FROM email_chunks;
SELECT provider, model, COUNT(*) FROM email_chunk_embeddings GROUP BY provider, model;

SELECT pid, state, query
FROM pg_stat_activity
WHERE datname = 'kernel_email'
ORDER BY query_start;

SELECT * FROM pg_stat_progress_create_index;
```

备份与恢复：

```bash
podman exec -it kernel-pg pg_dump -U kernel kernel_email > kernel_email.sql
podman exec -i kernel-pg psql -U kernel -d kernel_email < kernel_email.sql
```

## 开发与验证

```bash
# Python 语法检查
python -m py_compile src/api/server.py

# 后端单测
pytest tests/test_semantic_retriever.py

# 前端
cd web
npm run lint
npm run build
```

## 常见问题

### Semantic 搜索为什么没有结果？

先确认 `email_chunks` 和 `email_chunk_embeddings` 是否存在数据：

```sql
SELECT COUNT(*) FROM email_chunks;
SELECT provider, model, COUNT(*) FROM email_chunk_embeddings GROUP BY provider, model;
```

如果是 `0`，需要执行：

```bash
python scripts/index.py --build-chunks --list <list>
python scripts/index.py --build-vector --list <list>
```

短缩写、宏名、函数名、Message-ID 片段更适合 `Keyword` 或 `Hybrid`。

### 新导入邮件后 semantic 会自动更新吗？

不会。普通导入只处理邮件入库和全文索引。需要额外构建 chunk/vector。当前实现偏全量，增量向量构建还在 TODO。

### Ask 没有向量召回怎么办？

Ask 会先使用 chunk fulltext 和邮件级 fallback。若希望 semantic query 生效，先构建 RAG 索引。

### Agent Research 会自动修改 Knowledge 吗？

不会。Agent 只生成 `agent_research` draft，并记录 trace。接受、拒绝和实际落库仍由 human reviewer 完成。

### API key 应该放哪里？

推荐环境变量：

```bash
export DASHSCOPE_API_KEY=...
```

`settings.yaml` 的 `api_key` 只建议本地开发兜底。

## 计划文档

- [.joycode/plans/PLAN-35000-ai-agent-special-user.md](.joycode/plans/PLAN-35000-ai-agent-special-user.md)：AI agent 作为特殊用户、research run、trace、draft review 计划与 TODO。
- [.joycode/plans/PLAN-34000-semantic-search.md](.joycode/plans/PLAN-34000-semantic-search.md)：Semantic 搜索落地计划。
- [.joycode/plans/PLAN-31002-knowledge-workbench-roadmap.md](.joycode/plans/PLAN-31002-knowledge-workbench-roadmap.md)：Knowledge Workbench、Evidence、Draft Inbox 与知识沉淀路线。
- [.joycode/plans/PLAN-31003-ui-workbench-refresh.md](.joycode/plans/PLAN-31003-ui-workbench-refresh.md)：全站 UI 统一与知识沉淀工作流优化计划。
- [.joycode/plans/PLAN-31000-unified-knowledge-graph.md](.joycode/plans/PLAN-31000-unified-knowledge-graph.md)：统一知识对象与知识图谱设计。
- [.joycode/plans/PLAN-30000-code-definition-navigation.md](.joycode/plans/PLAN-30000-code-definition-navigation.md)：代码定义跳转后续计划。
- [.joycode/plans/PLAN-20000-generalized-knowledge-tagging.md](.joycode/plans/PLAN-20000-generalized-knowledge-tagging.md)：通用标签系统设计与当前状态。

## 致谢

- Linux 内核邮件列表维护者
- lore.kernel.org
- PostgreSQL / pgvector
- FastAPI、React、Tailwind CSS
