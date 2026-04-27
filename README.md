# Kernel Email Knowledge Base

面向 Linux 内核邮件列表的本地知识库系统。项目把 lore.kernel.org git mirror、手册文档、内核源码、标签、批注和 AI 检索问答组织到一个 Web 应用里，目标不是做一个简单搜索框，而是帮助把邮件讨论沉淀成可引用、可维护的内核知识库。

当前重点能力：

- 邮件列表导入：支持 `kvm`、`linux-mm`、`lkml` 等 lore git mirror，本地仓库优先。
- 高速全文检索：PostgreSQL TSVECTOR + GIN，支持列表、发件人、日期、patch、tag 过滤。
- Agentic Ask：AI 先生成检索计划，再执行多 query、chunk 全文/向量召回、thread 扩展，最后基于证据回答。
- Ask 到知识库：Ask 结果可生成 Knowledge / Annotation / Tag assignment 草稿，用户确认后落库。
- 知识沉淀：统一 Knowledge entity、层级标签、邮件/代码/知识实体批注。
- 线程阅读：邮件线程抽屉支持翻译、批注、标签、patch 展示。
- 内核源码浏览：本地 git kernel source 浏览、symbol definition/resolve、代码批注。
- 芯片手册：Intel SDM 等 PDF 导入、手册搜索和手册问答。
- 多用户：本地账号、角色、审批、公开/私有内容和批注发布审核。

## 架构概览

```text
src/
├── collector/       # lore git mirror 采集
├── parser/          # 邮件、patch、PDF/SDM 解析
├── chunker/         # 手册分片
├── storage/         # PostgreSQL ORM、标签、批注、知识实体、缓存
├── indexer/         # 全文索引、邮件 RAG chunk、向量索引
├── retriever/       # 邮件/手册检索
├── qa/              # AskAgent、AskDraftService、ManualQA、LLM/embedding provider
├── kernel_source/   # 本地 kernel git 浏览
├── symbol_indexer/  # ctags 符号索引
├── translator/      # 翻译与缓存
└── api/             # FastAPI 服务

web/src/
├── pages/           # Search / Ask / Knowledge / Tags / Annotations / Kernel Code / Manuals
├── components/      # ThreadDrawer、AskDraftPanel、Tag/Annotation 组件等
├── layouts/         # MainLayout
├── api/             # API client 和 TypeScript 类型
└── auth.tsx         # 前端认证状态
```

## 快速开始

### 1. 环境要求

- Python 3.11+
- Node.js 18+
- PostgreSQL 16+
- pgvector 扩展

### 2. 安装依赖

```bash
pip install -e ".[dev]"

cd web
npm ci
cd ..
```

### 3. 准备 PostgreSQL

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

如果手册库使用单独数据库，需要额外创建：

```bash
podman exec -it kernel-pg createdb -U kernel chip_manual_kb
podman exec -it kernel-pg psql -U kernel -d chip_manual_kb \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 4. 配置

主要配置在 [config/settings.yaml](config/settings.yaml)。

常用配置形态：

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
    pool_size: 5
  manual:
    database_url: postgresql+asyncpg://kernel:kernel@localhost:5432/chip_manual_kb
    pool_size: 5

indexer:
  vector:
    enabled: true
    provider: dashscope
    model: text-embedding-v3
    dimension: 1536
    batch_size: 16
    api_key: ""

qa:
  email:
    llm_provider: dashscope
    model: qwen-plus-2025-07-28
    api_key: ""
```

API key 优先读环境变量，再读配置文件：

```bash
export DASHSCOPE_API_KEY=你的_key
```

### 5. 启动服务

```bash
python scripts/serve.py
```

访问：

- Web 应用：http://localhost:8000/app/
- API 文档：http://localhost:8000/docs

开发前端：

```bash
cd web
npm run dev -- --host 127.0.0.1
# http://127.0.0.1:5173/app/
```

## 邮件导入与索引

### 普通导入

```bash
python scripts/index.py --list kvm --epoch 0
python scripts/index.py --list linux-mm --all-epochs
```

`scripts/index.py` 会完成：

1. 打开本地 lore git mirror；不存在时尝试远端 clone。
2. 流式采集 commit 中的邮件。
3. 批量解析 RFC2822 邮件。
4. 批量写入 PostgreSQL，按 `message_id` 去重。
5. 回填 `search_vector`。
6. 重建全文 GIN 索引。

### 大列表导入

LKML 单个 epoch 可能有几十万封邮件。默认导入已经针对这种场景优化：

- 流式采集/解析/入库，不一次性把整个 epoch 放进内存。
- 默认 `--ingest-batch-size 5000`。
- 默认 `--db-batch-size 2000`。
- 导入期间临时关闭 `emails_search_vector_trigger`。
- 导入期间临时 drop 全文 GIN 索引，最后统一回填并重建。
- 普通导入不再默认构建 RAG chunk/vector。

示例：

```bash
python scripts/index.py --list lkml --epoch 0
```

如果服务正在使用全文索引，不希望导入时临时 drop GIN 索引：

```bash
python scripts/index.py --list lkml --epoch 0 --keep-fulltext-index
```

如果想调大批次：

```bash
python scripts/index.py --list lkml --epoch 0 \
  --ingest-batch-size 10000 \
  --db-batch-size 5000
```

导入日志出现：

```text
Epoch 0 done: collected=... parsed=... saved_new=...
```

只表示采集/解析/入库完成。脚本随后还会回填 `search_vector` 并重建 GIN 索引，大库可能需要继续等待一段时间。

### RAG 索引

Ask Agent 可以使用邮件 chunk 和向量索引，但这些步骤较重，默认不随普通导入执行。

```bash
# 只构建邮件 chunk
python scripts/index.py --build-chunks --list lkml

# 构建 chunk embedding
python scripts/index.py --build-vector --list lkml

# chunk + vector 一起重建
python scripts/index.py --rebuild-rag-index --list lkml
```

### 其他索引命令

```bash
# 重建全文索引
python scripts/index.py --rebuild-fulltext

# 查看统计
python scripts/index.py --stats

# 小样本测试
python scripts/index.py --list kvm --epoch 0 --limit 100
```

## Ask Agent 与知识草稿

### Ask 如何工作

`GET /api/ask?q=...` 已不是旧的“关键词搜几封邮件再总结”。当前流程是：

1. LLM 生成结构化检索计划。
2. 执行多条 keyword query。
3. 如果向量索引可用，执行 semantic query 的 pgvector 检索。
4. 合并 chunk 命中，必要时回退邮件级搜索。
5. 按 thread 聚合并拉取相关 thread 上下文。
6. LLM 基于证据回答，引用 Message-ID。
7. 返回 `search_plan`、`executed_queries`、`sources`、`threads`、`retrieval_stats`。

### Ask 结果转草稿

Ask 页面可以点击 `Create Drafts`，把一次回答转换成可编辑草稿：

- Knowledge entity 草稿：稳定概念、机制、争议点、问题总结。
- Annotation 草稿：把 Ask 结论和证据挂到 thread/message/knowledge entity。
- Tag assignment 草稿：给已有标签生成候选绑定。

保存前用户可以逐项编辑和取消勾选。系统不会在用户确认前写库。

Tag 草稿有一个保守规则：**只默认绑定已有 tag，不自动创建缺失 tag**。原因是 tag 是全局 taxonomy，AI 生成的近义词、大小写变体或层级不明标签会污染导航和聚合。缺失 tag 会显示为 `missing`，默认不选中；后续可以单独设计 `Suggested new tags` 确认流程。

## Web 功能

- **Search**：邮件全文搜索，支持 channel、sender、date、patch、tag 过滤。
- **Ask**：AI 检索代理问答，展示检索计划、执行 query、来源、相关 thread，并可生成知识草稿。
- **Tags**：层级标签管理、tag target 浏览、邮件/知识实体绑定。
- **Knowledge**：知识实体管理，支持实体说明、标签和批注。
- **Annotations**：统一批注列表，支持邮件/代码/知识实体批注和发布审核。
- **Translations**：线程翻译缓存、批量翻译任务、人工翻译修订。
- **Kernel Code**：本地 kernel git 浏览、版本树、文件查看、符号定位、代码批注。
- **Manual Search / Ask**：芯片手册搜索与问答。
- **Users / Admin**：本地用户、审批、角色和批注发布审核。

## 主要 API

完整交互以 http://localhost:8000/docs 为准。常用接口：

### 邮件与 Ask

- `GET /api/search`：邮件搜索。
- `GET /api/ask`：Agentic Ask。
- `POST /api/ask/draft`：Ask 结果生成草稿，不落库。
- `POST /api/ask/draft/apply`：保存用户确认后的草稿。
- `GET /api/thread/{thread_id}`：邮件线程及批注。
- `GET /api/stats`：邮件统计。

### 标签

- `GET /api/tags`：标签树。
- `POST /api/tags`：创建标签。
- `PATCH /api/tags/{tag_id}`：更新标签。
- `DELETE /api/tags/{tag_id}`：删除标签。
- `GET /api/tags/stats`：标签统计。
- `POST /api/tag-assignments`：创建标签绑定。
- `GET /api/tag-assignments`：查询标签绑定。
- `GET /api/tag-targets/{target_type}/{target_ref}/tags`：目标的直接/继承标签。

### Knowledge / Annotation

- `GET /api/knowledge/entities`：知识实体列表。
- `POST /api/knowledge/entities`：创建知识实体。
- `GET /api/knowledge/entities/{entity_id}`：读取知识实体。
- `PATCH /api/knowledge/entities/{entity_id}`：更新知识实体。
- `GET /api/annotations`：批注列表。
- `POST /api/annotations`：创建批注。
- `PUT /api/annotations/{annotation_id}`：更新批注正文。
- `DELETE /api/annotations/{annotation_id}`：删除批注。
- `POST /api/annotations/{annotation_id}/publish-request`：申请公开。
- `POST /api/admin/annotations/{annotation_id}/approve-publication`：管理员批准公开。

### 翻译

- `POST /api/translate`：单条翻译。
- `POST /api/translate/batch`：批量翻译。
- `POST /api/translate/thread`：创建线程翻译任务。
- `GET /api/translate/jobs`：翻译任务列表。
- `GET /api/translate/threads`：已翻译线程。
- `PUT /api/translate/manual`：保存人工翻译。
- `DELETE /api/translate/cache`：清除缓存。

### 手册

- `GET /api/manual/search`：手册全文搜索。
- `GET /api/manual/ask`：手册问答。
- `GET /api/manual/stats`：手册统计。

### Kernel Code

- `GET /api/kernel/versions`：可用 kernel 版本。
- `GET /api/kernel/tree/{version}`：目录树。
- `GET /api/kernel/file/{version}/{path}`：文件内容。
- `GET /api/kernel/symbol/definition`：符号定义。
- `GET /api/kernel/symbol/resolve`：符号解析。
- `GET /api/kernel/annotations`：代码批注列表。
- `POST /api/kernel/annotations`：创建代码批注。

### Auth / Admin

- `POST /api/auth/register`：注册。
- `POST /api/auth/login`：登录。
- `POST /api/auth/logout`：登出。
- `GET /api/me`：当前用户。
- `GET /api/admin/users`：用户管理。
- `POST /api/admin/users/{user_id}/approve`：审批用户。

## 手册导入

```bash
python scripts/ingest_manual.py --pdf ./manuals/intel_sdm/sdm.pdf --store
```

手册使用 `storage.manual.database_url`，和邮件库可以分开。

## 内核源码与符号索引

在 `config/settings.yaml` 里配置：

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

### 重建数据库

会删除并重建邮件库和手册库相关表：

```bash
python scripts/rebuild_db.py
```

注意：这是破坏性操作，会删除数据。

### 查看 PostgreSQL 状态

```sql
SELECT list_name, COUNT(*) FROM emails GROUP BY list_name;

SELECT COUNT(*) FROM emails WHERE search_vector IS NOT NULL;

SELECT pid, state, query
FROM pg_stat_activity
WHERE datname = 'kernel_email'
ORDER BY query_start;

SELECT * FROM pg_stat_progress_create_index;
```

### 备份与恢复

```bash
podman exec -it kernel-pg pg_dump -U kernel kernel_email > kernel_email.sql
podman exec -i kernel-pg psql -U kernel -d kernel_email < kernel_email.sql
```

## 开发与验证

```bash
# Python 语法检查
python -m py_compile src/api/server.py

# 前端构建
cd web
npm run build

# 常用 smoke test
python scripts/index.py --help
python scripts/index.py --list kvm --epoch 0 --limit 100
```

当前仓库没有完整测试目录时，`pytest tests/` 可能不可用；以实际代码状态为准。

## 常见问题

### 导入日志显示 `Epoch done` 后为什么没有退出？

`Epoch done` 表示采集、解析、入库完成。脚本还要回填 `search_vector` 并重建 GIN 索引。大列表如 LKML 可能还需要等待 PostgreSQL 完成索引创建。

### Ask 没有向量召回怎么办？

先确认 RAG 索引已构建：

```bash
python scripts/index.py --build-chunks --list kvm
python scripts/index.py --build-vector --list kvm
```

没有向量时 Ask 仍会使用 chunk 全文检索和邮件级 fallback。

### 为什么 Ask 的缺失 tag 草稿默认不保存？

tag 是全局分类体系。AI 可以建议新标签，但自动创建容易造成重复、层级不清或命名不一致。第一版只自动绑定已有 tag；缺失 tag 需要人工整理后再绑定。

### API key 应该放哪里？

推荐放环境变量：

```bash
export DASHSCOPE_API_KEY=...
```

`settings.yaml` 的 `api_key` 可作为本地开发兜底。当前用户级自定义 API key 还没有实现。

## 相关计划文档

- [plan-ask-agent.md](plan-ask-agent.md)：Ask Agent、RAG 索引、Ask 转知识草稿设计。
- `plan-30000.md` / `plan-31000.md`：历史设计计划。

## 致谢

- Linux 内核邮件列表维护者
- lore.kernel.org
- PostgreSQL / pgvector
- FastAPI、React、Tailwind CSS
