# Kernel Email Knowledge Base

一个基于 Linux 内核邮件列表和芯片手册构建的知识库系统，支持精确全文检索和 RAG 语义问答。采用双引擎架构（PostgreSQL GIN 全文索引 + pgvector 向量检索），提供 Web 界面和 REST API。

## 🎯 项目目标

- **双数据源**：Linux 内核邮件列表 + 芯片手册（Intel SDM/ARM/AMD）
- **双引擎检索**：PostgreSQL 全文索引（精确）+ pgvector 向量检索（语义）
- **RAG 问答**：基于检索结果自动生成带来源引用的回答
- **插件化架构**：七层解耦（采集→解析→分片→存储→索引→检索→问答），每层可替换
- **MVP 优先**：先跑通单列表全流程，再横向扩展

## 🏗️ 架构设计

### 后端架构（Python）
```
src/
├── collector/     # 数据采集层（GitCollector）
├── parser/        # 解析层（邮件 RFC2822 + PDF 手册）
├── chunker/       # 文档分片层（L1→L2→L3 智能分片）
├── storage/       # 存储层（PostgreSQL + 模型定义）
├── indexer/       # 索引层（GIN 全文 + pgvector 向量）
├── retriever/     # 检索层（Keyword/Semantic/Hybrid + Manual）
├── qa/           # 问答层（RAG Pipeline + ManualQA）
└── api/          # FastAPI 服务层
```

### 前端架构（React）
```
web/src/
├── pages/         # 页面组件
│   ├── SearchPage.tsx        # 邮件搜索页（含标签筛选）
│   ├── AskPage.tsx           # 邮件问答页（含标签筛选）
│   ├── TagsPage.tsx          # 标签管理页
│   ├── AnnotationsPage.tsx   # 批注管理页（全量列表+搜索+Markdown渲染）
│   ├── TranslationsPage.tsx  # 翻译管理页（已缓存线程+标签+自动轮询）
│   ├── ManualSearchPage.tsx  # 手册搜索页
│   └── ManualAskPage.tsx     # 手册问答页
├── components/    # 通用组件
│   ├── ThreadDrawer.tsx      # 线程抽屉（含翻译、引用行渲染、PatchDiffBlock、Markdown批注）
│   ├── TagFilter.tsx         # 标签筛选组件
│   ├── TagManager.tsx        # 标签管理组件
│   └── EmailTagEditor.tsx    # 邮件标签编辑器
├── layouts/       # 布局组件（MainLayout）
├── api/          # API 客户端 + TypeScript 类型
└── assets/       # 静态资源
```

## 🚀 快速开始

### 环境要求
- Python 3.11+
- Node.js 18+
- PostgreSQL 16 + pgvector 扩展

### 1. 安装后端依赖
```bash
pip install -e ".[dev]"
```

### 2. 启动 PostgreSQL（带 pgvector）
```bash
# 使用 Docker/Podman（推荐）
podman run -d --name kernel-pg -p 5432:5432 \
  -e POSTGRES_USER=kernel -e POSTGRES_PASSWORD=kernel \
  -e POSTGRES_DB=kernel_email \
  docker.io/postgres:16-alpine

# 进入容器安装 pgvector
podman exec -it kernel-pg psql -U kernel -d kernel_email -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 3. 配置数据库连接
编辑 `config/settings.yaml`：
```yaml
storage:
  database_url: "postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email"
```

### 4. 采集数据

#### 方式一：从本地目录采集（已下载的数据）
本地已有 `~/workspace/kernel_email/` 下的 channel 数据时：
```bash
# 采集所有 channel
python scripts/collect.py --all-channels --local

# 只采集指定 channel（如 kvm）
python scripts/collect.py --list kvm --local --all-epochs

# 只采集 linux-mm 的 epoch 0
python scripts/collect.py --list linux-mm --local --epoch 0
```

支持的 channel：kvm、linux-mm、lkml

#### 方式二：从远端采集
```bash
python scripts/collect.py --list linux-mm --epoch 0 --limit 100
```

### 5. 构建索引
```bash
python scripts/index.py --list linux-mm --epoch 0
```

### 6. 启动服务
```bash
python scripts/serve.py
# 服务运行在 http://localhost:8000
```

### 7. 导入芯片手册（可选）
```bash
# 下载 Intel SDM PDF 到 manuals/intel_sdm/
python scripts/ingest_manual.py --pdf ./manuals/intel_sdm/sdm.pdf --store
```

### 7. 启动前端开发服务器（可选）
```bash
cd web && npm install
npm run dev
# 前端开发服务器：http://localhost:5173/app/
```

## 🗄️ 数据库运维命令

### 初始化数据库

```bash
# 初始化邮件数据库（创建表、索引、触发器）
python -c "
import asyncio
from src.storage.postgres import PostgresStorage
from src.storage.models import EmailORM

async def init():
    storage = PostgresStorage(database_url='postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email')
    await storage.init_db()
    print('Database initialized')
    await storage.close()

asyncio.run(init())
"

# 初始化手册数据库
python -c "
import asyncio
from src.storage.document_store import DocumentStorage

async def init():
    storage = DocumentStorage(database_url='postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email')
    await storage.init_db()
    print('Manual database initialized')
    await storage.close()

asyncio.run(init())
"
```

### 数据导入与索引

```bash
# 采集邮件数据并入库
python scripts/collect.py --list linux-mm --epoch 0 --limit 100
python scripts/index.py --list linux-mm --epoch 0 --limit 100

# 采集所有 epoch 并入库
python scripts/index.py --list linux-mm --all-epochs

# 从本地目录采集多个 channel
python scripts/collect.py --all-channels --local

# 导入芯片手册
python scripts/ingest_manual.py --pdf ./manuals/intel_sdm/sdm.pdf --store

# 重建全文索引
python scripts/index.py --rebuild-fulltext
```

### 数据库统计

```bash
# 查看邮件数据库统计
python scripts/index.py --stats

# 通过 API 查看
curl http://localhost:8000/api/stats

# 查看手册统计
curl http://localhost:8000/api/manual/stats
```

### 数据库维护

```bash
# 连接数据库（需在容器内或本地有 psql）
psql -U kernel -d kernel_email

# 查看表结构
\dt

# 查看邮件数量
SELECT list_name, COUNT(*) FROM emails GROUP BY list_name;

# 查看索引状态
\d emails

# 查看全文索引统计
SELECT COUNT(*) FROM emails WHERE search_vector IS NOT NULL;

# 手动触发索引更新（单条测试）
UPDATE emails SET search_vector = to_tsvector('english', subject || ' ' || body)
WHERE message_id = '<test@example.com>';

# 清理孤立数据
DELETE FROM emails WHERE thread_id NOT IN (SELECT DISTINCT thread_id FROM emails WHERE thread_id IS NOT NULL);

# 查看数据库大小
SELECT pg_size_pretty(pg_database_size('kernel_email'));

# 查看表大小
SELECT pg_size_pretty(pg_total_relation_size('emails'));
```

### Docker 运维命令

```bash
# 启动 PostgreSQL 容器
podman run -d --name kernel-pg -p 5432:5432 \
  -e POSTGRES_USER=kernel -e POSTGRES_PASSWORD=kernel \
  -e POSTGRES_DB=kernel_email \
  docker.io/postgres:16-alpine

# 启用 pgvector 扩展
podman exec -it kernel-pg psql -U kernel -d kernel_email -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 查看容器日志
podman logs -f kernel-pg

# 重启数据库
podman restart kernel-pg

# 进入容器操作
podman exec -it kernel-pg psql -U kernel -d kernel_email

# 备份数据库
podman exec -it kernel-pg pg_dump -U kernel kernel_email > backup.sql

# 恢复数据库
podman exec -it kernel-pg psql -U kernel -d kernel_email < backup.sql

# 停止并删除容器
podman stop kernel-pg && podman rm kernel-pg
```

### 数据库重建

```bash
# 方法一：使用运维脚本重建（推荐）
# 1. 清理所有表和索引
python scripts/rebuild_db.py

# 2. 重新初始化数据库（创建表、索引、触发器）
python scripts/init_db_fresh.py

# 方法二：使用 psql 重建（删除所有表并重建）
podman exec -it kernel-pg psql -U kernel -d kernel_email -c "
DROP TABLE IF EXISTS email_tags CASCADE;
DROP TABLE IF EXISTS tags CASCADE;
DROP TABLE IF EXISTS emails CASCADE;
"

# 然后重新初始化数据库
python scripts/init_db_fresh.py

# 方法三：使用 Python 脚本重建
python -c "
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def rebuild():
    engine = create_async_engine('postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email')
    async with engine.begin() as conn:
        await conn.execute(text('DROP TABLE IF EXISTS email_tags CASCADE'))
        await conn.execute(text('DROP TABLE IF EXISTS tags CASCADE'))
        await conn.execute(text('DROP TABLE IF EXISTS emails CASCADE'))
    await engine.dispose()
    print('Tables dropped')

asyncio.run(rebuild())
"

# 方法四：删除手册数据库表
python -c "
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def rebuild_manual():
    engine = create_async_engine('postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email')
    async with engine.begin() as conn:
        await conn.execute(text('DROP TABLE IF EXISTS document_chunks CASCADE'))
        await conn.execute(text('DROP TABLE IF EXISTS manuals CASCADE'))
    await engine.dispose()
    print('Manual tables dropped')

asyncio.run(rebuild_manual())
"

# 方法五：重建全文索引（不删除数据）
python scripts/index.py --rebuild-fulltext

# 方法六：删除并重建索引（需要先删除数据）
podman exec -it kernel-pg psql -U kernel -d kernel_email -c "
DROP INDEX IF EXISTS idx_emails_search_vector;
CREATE INDEX idx_emails_search_vector ON emails USING GIN (search_vector);
"
```

### 环境变量配置

在 `config/settings.yaml` 中配置数据库连接：

```yaml
storage:
  # 邮件数据库
  database_url: "postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email"
  pool_size: 5

# 手册数据库（可复用同一实例或单独配置）
manual:
  database_url: "postgresql+asyncpg://kernel:kernel@localhost:5432/kernel_email"
  pool_size: 3
```

## 🌐 使用方式

### Web 界面
打开浏览器访问：http://localhost:8000/app/

#### 搜索功能
- 输入关键词搜索邮件（如 "shmem mount"）
- 支持三种检索模式：Hybrid（混合）、Keyword（关键词）、Semantic（语义）
- **Channel/channel 过滤**：在下拉框选择要检索的 channel（留空则搜索所有 channel）
- 支持标签过滤、发件人筛选、日期范围过滤
- 结果包含邮件主题、发件人、时间、相关性分数和高亮片段
- 点击 "Thread" 查看完整邮件线程对话

#### 问答功能  
- 用自然语言提问（如 "Why was the shmem mount behavior changed?"）
- 系统会检索相关邮件并生成带来源引用的回答
- MVP 阶段使用检索摘要作为 fallback，可配置 OpenAI API 启用 LLM 回答

#### 标签管理
- 支持父子层级标签（树形结构）
- 为邮件添加/移除标签，单封邮件最多 16 个
- 点击标签查看关联的邮件列表

#### 翻译功能
- Google Translate 自动翻译 + 缓存
- 双语对照展示（原文/译文左右分栏）
- 引用行不翻译，PATCH diff 独立折叠展示
- 支持人工校正翻译

#### 批注管理
- 在邮件线程中添加本地批注（支持 Markdown）
- 独立批注管理页面（`/annotations`）：全量浏览 + 关键词搜索
- 批注在线程树中排在子节点最前面，蓝色卡片区分
- 支持嵌套回复、编辑、删除
- JSON 导出/导入，满足 git 固化版本管理需求

### API 接口
### API 接口（邮件）
- `GET /api/` - 健康检查
- `GET /api/search?q=关键词` - 邮件搜索（支持标签/发件人/日期过滤）
- `GET /api/ask?q=问题` - 智能问答（支持标签/发件人/日期过滤）
- `GET /api/thread/{id}` - 获取邮件线程（含批注）
- `GET /api/stats` - 数据库统计

### API 接口（标签）
- `POST /api/tags` - 创建标签
- `GET /api/tags` - 获取标签树（树形结构）
- `GET /api/tags/stats` - 获取标签统计
- `GET /api/tags/{tag_name}/emails` - 获取标签下的邮件列表（分页）
- `DELETE /api/tags/{tag_id}` - 删除标签（级联删除子标签）
- `GET /api/email/{message_id}/tags` - 获取邮件标签
- `POST /api/email/{message_id}/tags` - 添加标签（最多 16 个）
- `DELETE /api/email/{message_id}/tags/{tag_name}` - 删除邮件标签

### API 接口（翻译）
- `POST /api/translate` - 单条翻译
- `POST /api/translate/batch` - 批量翻译（最多 50 条）
- `GET /api/translate/threads` - 获取已翻译线程列表
- `GET /api/translate/health` - 翻译服务健康检查
- `DELETE /api/translate/cache` - 清除翻译缓存
- `PUT /api/translate/manual` - 保存人工翻译

### API 接口（批注）
- `GET /api/annotations?q=&page=&page_size=` - 批注列表 + 搜索
- `POST /api/annotations` - 创建批注
- `GET /api/annotations/{thread_id}` - 获取线程所有批注
- `PUT /api/annotations/{annotation_id}` - 编辑批注
- `DELETE /api/annotations/{annotation_id}` - 删除批注
- `POST /api/annotations/export` - 导出批注（JSON）
- `POST /api/annotations/import` - 导入批注（JSON）

### API 接口（芯片手册）
- `GET /api/manual/search?q=关键词` - 手册搜索
- `GET /api/manual/ask?q=问题` - 手册问答
- `GET /api/manual/stats` - 手册统计

完整 API 文档：http://localhost:8000/docs

## 📊 数据流程

### 邮件数据流程
1. **采集**：GitCollector 从 lore.kernel.org 拉取 git mirror
2. **解析**：EmailParser 解析 RFC2822 格式，ThreadBuilder 重建对话关系
3. **存储**：PostgresStorage 批量写入，基于 message_id 去重
4. **索引**：PostgreSQL 触发器自动维护全文索引，支持增量更新
5. **检索**：HybridRetriever 智能路由，关键词/语义结果融合
6. **问答**：RagQA 检索上下文 + LLM 生成（或 fallback 摘要）

### 芯片手册数据流程
1. **解析**：IntelSDMParser 从 PDF 提取目录和内容
2. **分片**：ChunkPipeline L1→L2→L3 三层智能分片
3. **存储**：DocumentStorage 批量写入文档分片

## 🔧 配置说明

所有配置集中在 `config/settings.yaml`：

```yaml
email_collector:
  base_url: https://lore.kernel.org     # 远端数据源
  data_dir: ~/workspace/kernel_email    # 远端仓库存储路径
  # 本地多 channel 配置（采集本地已有数据）
  local_channels:
    - name: kvm        # channel 名称，对应 list_name
      path: ~/workspace/kernel_email/kvm
    - name: linux-mm
      path: ~/workspace/kernel_email/linux-mm
    - name: lkml
      path: ~/workspace/kernel_email/lkml

storage:
  database_url: postgresql+asyncpg://... # 数据库连接
  pool_size: 5                          # 连接池大小

retriever:
  default_mode: hybrid                  # 默认检索模式
  keyword_page_size: 50                 # 关键词检索分页
  semantic_top_k: 20                    # 语义检索 top-K

qa:
  llm_provider: openai                  # LLM 提供商
  model: gpt-4                          # 模型名称
```

## 🧪 开发指南

### 后端开发
- 每层必须定义 `base.py` 抽象接口，实现类继承 Base 前缀
- 所有数据库操作为异步（async/await）
- 批量写入，避免逐条操作
- 基于 message_id 保证幂等性

### 前端开发
- React + TypeScript + Tailwind CSS
- 组件默认导出，Props 接口明确定义
- API 调用封装在 `src/api/client.ts`
- 开发服务器支持热重载

### 测试
```bash
# 后端测试
pytest tests/ -v

# 端到端验证
python scripts/collect.py --list linux-mm --epoch 0 --limit 10
python scripts/index.py --list linux-mm --epoch 0
```

## 📈 性能特性

- **流式采集**：支持大仓库增量更新，避免内存溢出
- **批量写入**：数据库操作 500 条/批次，提升吞吐量
- **双引擎检索**：精确搜索全量返回，语义搜索 top-K 召回
- **异步架构**：全流程异步处理，高并发支持
- **索引优化**：PostgreSQL GIN 索引 + 复合索引，毫秒级响应

## 🔮 扩展计划

- **多数据源**：NNTP、RSS、mbox 文件导入支持
- **向量检索**：接入 OpenAI/BGE embedding，启用语义模式
- **LLM 集成**：配置 API key 启用真实 RAG 回答
- **主题聚类**：BERTopic 主题发现和聚类
- **可视化**：时间线视图、线程图谱、统计仪表板
- **移动端**：响应式优化，PWA 支持

## 🤝 贡献指南

1. 遵循 PEP 8 和 TypeScript 严格模式
2. 先更新 `base.py` 接口，再实现具体功能
3. 添加完整类型注解和文档字符串
4. 编写对应的单元测试
5. 确保所有检查通过：
   ```bash
   ruff check src/
   tsc --noEmit -p web/tsconfig.json
   pytest tests/
   ```

## 📄 许可证

MIT License - 详见 LICENSE 文件

## 🙏 致谢

- Linux 内核邮件列表维护者
- lore.kernel.org 项目
- PostgreSQL 和 pgvector 社区
- React 和 Tailwind CSS 生态系统
