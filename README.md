# Kernel Email Knowledge Base

一个基于 Linux 内核邮件列表和芯片手册构建的知识库系统，支持精确全文检索和 RAG 语义问答。采用双引擎架构（PostgreSQL GIN 全文索引 + pgvector 向量检索），提供 Web 界面和 REST API。

## 🎯 项目目标

- **双数据源**：Linux 内核邮件列表 + 芯片手册（Intel SDM/ARM/AMD）
- **双引擎检索**：PostgreSQL 全文索引（精确）+ pgvector 向量检索（语义）
- **RAG 问答**：基于检索结果自动生成带来源引用的回答
- **插件化架构**：六层解耦（采集→解析→存储→索引→检索→问答），每层可替换
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
├── pages/         # 页面组件（SearchPage, AskPage, ManualSearchPage, ManualAskPage）
├── components/    # 通用组件（ThreadDrawer）
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

### 4. 采集数据（示例：linux-mm epoch 0，限 100 条测试）
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

## 🌐 使用方式

### Web 界面
打开浏览器访问：http://localhost:8000/app/

#### 搜索功能
- 输入关键词搜索邮件（如 "shmem mount"）
- 支持三种检索模式：Hybrid（混合）、Keyword（关键词）、Semantic（语义）
- 结果包含邮件主题、发件人、时间、相关性分数和高亮片段
- 点击 "Thread" 查看完整邮件线程对话

#### 问答功能  
- 用自然语言提问（如 "Why was the shmem mount behavior changed?"）
- 系统会检索相关邮件并生成带来源引用的回答
- MVP 阶段使用检索摘要作为 fallback，可配置 OpenAI API 启用 LLM 回答

### API 接口
### API 接口（邮件）
- `GET /api/` - 健康检查
- `GET /api/search?q=关键词` - 邮件搜索
- `GET /api/ask?q=问题` - 智能问答  
- `GET /api/thread/{id}` - 获取邮件线程
- `GET /api/stats` - 数据库统计

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
collector:
  base_url: https://lore.kernel.org     # 数据源
  data_dir: ~/workspace/kernel_email    # 本地仓库存储

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
