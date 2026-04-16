---
globs: *
alwaysApply: true
---
# 内核邮件列表知识库 — Claude Code v1 Rules

## 项目概览
- **类型**：全栈 Web 应用（Python 后端 + React 前端）
- **目标**：构建 Linux 内核邮件列表知识库，支持精确检索和 RAG 语义问答
- **数据源**：lore.kernel.org git mirror（bare repo，epoch 分段）
- **架构**：六层插件化（Collector → Parser → Storage → Indexer → Retriever → QA）
- **双引擎**：PostgreSQL GIN 全文索引 + pgvector 向量检索（MVP 阶段仅启用全文）

## 技术栈
- **后端**：Python 3.11+, FastAPI, SQLAlchemy 2.0 async, asyncpg, PostgreSQL 16 + pgvector
- **前端**：React 18 + TypeScript, Vite, Tailwind CSS 3, React Router v7
- **ORM/模型**：SQLAlchemy（ORM）+ Pydantic v2（数据校验）
- **构建**：Vite（前端）+ setuptools（后端）
- **部署**：FastAPI 静态文件挂载前端 dist，CORS 全开，统一端口 8000

## 目录结构
```
kernel_email_tools/
├── config/settings.yaml          # 唯一配置中心
├── src/                          # Python 后端
│   ├── collector/                # 数据采集（git_collector）
│   ├── parser/                   # 邮件解析（email_parser, thread_builder, patch_extractor）
│   ├── storage/                  # 存储层（PostgresStorage + models）
│   ├── indexer/                  # 索引层（FulltextIndexer, VectorIndexer）
│   ├── retriever/                # 检索层（Keyword, Semantic, Hybrid）
│   ├── qa/                       # 问答层（RagQA）
│   └── api/                      # FastAPI 服务（server.py）
├── scripts/                      # 运维入口（collect.py, index.py, serve.py）
├── web/                          # React + Vite + Tailwind 前端
│   ├── src/pages/SearchPage.tsx  # 搜索页
│   ├── src/pages/AskPage.tsx     # 问答页
│   ├── src/components/ThreadDrawer.tsx  # 线程抽屉
│   ├── src/api/client.ts         # API 客户端 + TypeScript 类型
│   └── dist/                     # 构建产物（由 FastAPI 挂载到 /app/）
└── tests/                        # pytest 测试（待扩展）
```

## 代码风格与命名
- **Python**：PEP 8，snake_case 文件/函数，PascalCase 类，Base 前缀抽象类
- **TypeScript/React**：camelCase 变量/函数，PascalCase 组件/类型，kebab-case CSS
- **抽象基类**：每层 `base.py` 定义接口，实现类同级目录，不硬编码具体实现
- **类型注解**：Python 全程类型注解，TypeScript 严格模式
- **日志**：Python 标准 `logging`，不使用 print；前端 console 仅开发环境

## 架构原则
1. **插件化**：每层通过抽象基类定义契约，实现可替换（如新增数据源只需实现 BaseCollector）
2. **配置外置**：所有连接串、模型名、路径均在 `settings.yaml`，代码零硬编码
3. **幂等性**：采集和索引支持重复执行不重复入库（基于 message_id 去重）
4. **批量操作**：邮件写入数据库和向量索引必须分批（500 条），避免逐条
5. **异步优先**：FastAPI 路由、数据库操作、LLM 调用均使用 async/await
6. **双引擎检索**：
   - 精确引擎：PostgreSQL GIN 全文索引，关键词精确匹配 + 分页返回全量
   - 语义引擎：pgvector 向量相似度，top-K 召回（MVP 阶段骨架，后续接入 OpenAI/BGE）
   - 混合编排：HybridRetriever 自动路由（问句→语义+关键词，关键词→仅关键词）+ RRF 融合

## 数据模型核心字段
- **EmailORM**：message_id（唯一）, subject, sender, date, in_reply_to, references, body, patch_content, has_patch, list_name, thread_id, epoch, search_vector（TSVECTOR）
- **索引**：GIN(search_vector), 复合(list_name, thread_id), 唯一(message_id)
- **触发器**：BEFORE INSERT/UPDATE 自动维护 search_vector（加权：subject:A + sender:B + body:C）

## 前端规范
- **路由**：/（搜索）, /ask（问答）, /app/（静态前端挂载）
- **状态管理**：React hooks（useState/useEffect），无 Redux
- **样式**：Tailwind CSS 3，无自定义 CSS 文件
- **图标**：inline SVG，无外部图标库
- **构建**：Vite base='/app/'，proxy '/api' → localhost:8000，开发/生产统一

## 常用命令
```bash
# 后端
pip install -e ".[dev]"              # 安装依赖
python scripts/collect.py --list linux-mm --epoch 0 --limit 100  # 采集
python scripts/index.py --list linux-mm --all-epochs             # 入库+索引
python scripts/serve.py              # 启动 API（端口 8000）
pytest tests/ -v                     # 运行测试

# 前端
cd web && npm install                # 安装依赖
npm run dev                          # 开发服务器（带代理）
npm run build                        # 构建到 dist/
npm run preview                      # 预览构建产物
```

## 开发约束
1. **不要跳过抽象层**：任何新功能先定义/更新 `base.py` 接口，再写实现
2. **配置外置**：数据库连接、API Key、模型名称全部通过 `settings.yaml` 注入
3. **错误处理**：网络请求、数据库操作、LLM 调用必须有 try/except + 重试机制
4. **批量操作**：写入数据库和向量索引时必须分批，禁止逐条 for 循环 insert
5. **幂等性**：采集和索引构建必须支持重复执行不产生重复数据（基于 message_id 去重）
6. **增量友好**：设计时考虑增量更新场景，采集和索引都支持只处理新增数据
7. **类型安全**：Python 全程类型注解，TypeScript 严格模式，禁止 any
8. **日志规范**：使用 Python `logging` 模块，格式 `%(asctime)s [%(levelname)s] %(name)s: %(message)s`
9. **前端规范**：React 组件默认导出，Props 接口定义，Tailwind 原子类优先
10. **构建产出**：前端 `web/dist/` 由 FastAPI 挂载到 `/app/`，无需额外 Web 服务器

## 测试与验证
- 单元测试：pytest + pytest-asyncio，测试文件 `test_<模块>.py`
- 端到端：使用 `scripts/` 入口脚本验证全流程（采集→解析→入库→搜索→问答）
- 数据验证：MVP 阶段使用 linux-mm 小列表（epoch 0-2）验证，避免直接跑 LKML 全量

## 扩展点（后续迭代）
- 新数据源：实现 BaseCollector（NNTP、RSS、mbox 文件导入）
- 新存储后端：实现 BaseStorage（Elasticsearch、Milvus）
- 主题聚类：新增 TopicClusterer 模块（BERTopic）
- 前端增强：时间线视图、线程可视化、响应式优化
- 向量检索：接入 OpenAI/BGE embedding，启用 semantic 模式
- LLM 接入：配置 API key 启用真实 RAG 回答（当前为 fallback 摘要）