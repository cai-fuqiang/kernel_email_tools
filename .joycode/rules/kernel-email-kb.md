---
globs: *
alwaysApply: true
---

# 项目规则要求如下

## 项目概览

| 属性 | 说明 |
|------|------|
| **项目名称** | kernel_email_tools |
| **类型** | 全栈 Web 应用（Python 后端 + React 前端）|
| **目标** | Linux 内核邮件列表知识库 + 芯片手册知识库，支持精确检索和 RAG 语义问答 |
| **数据源** | lore.kernel.org（git mirror）+ Intel SDM PDF |
| **架构** | 六层插件化（Collector → Parser → Storage → Indexer → Retriever → QA）|
| **双引擎** | PostgreSQL GIN 全文索引 + pgvector 向量检索 |

---

## 技术栈

### 后端
- **语言**: Python 3.11+
- **框架**: FastAPI, Uvicorn
- **数据库**: PostgreSQL 16 + pgvector 扩展
- **ORM**: SQLAlchemy 2.0 async
- **驱动**: asyncpg
- **数据校验**: Pydantic v2
- **配置**: YAML (config/settings.yaml)
- **Embedding**: OpenAI text-embedding-3-small
- **LLM**: OpenAI GPT-4 / Anthropic Claude / 阿里千问 / MiniMax 海螺

### 前端
- **框架**: React 18 + TypeScript
- **构建**: Vite
- **样式**: Tailwind CSS 3
- **路由**: React Router v7

---

## 目录结构

```
kernel_email_tools/
├── config/
│   └── settings.yaml              # 唯一配置中心（所有连接串、API Key、开关）
├── src/                           # Python 后端
│   ├── collector/                 # 数据采集层
│   │   ├── base.py              # BaseCollector 抽象接口
│   │   └── git_collector.py     # GitCollector 实现
│   ├── parser/                    # 解析层
│   │   ├── base.py              # BaseParser 抽象接口
│   │   ├── email_parser.py       # RFC2822 邮件解析
│   │   ├── patch_extractor.py    # 补丁提取
│   │   ├── thread_builder.py     # 线程重建
│   │   ├── pdf_extractor.py      # PDF 解析
│   │   └── intel_sdm/            # Intel SDM 专用解析器
│   ├── chunker/                   # 文档分片层
│   │   ├── base.py              # BaseChunker
│   │   ├── section_chunker.py    # 按章节分片
│   │   ├── sliding_window.py     # 滑动窗口分片
│   │   └── pipeline.py           # 分片管道
│   ├── storage/                   # 存储层
│   │   ├── base.py              # BaseStorage
│   │   ├── models.py            # EmailORM + TagORM + Pydantic 模型
│   │   ├── postgres.py           # PostgresStorage
│   │   ├── tag_store.py         # TagStore 标签管理
│   │   ├── document_models.py    # ManualChunk ORM
│   │   └── document_store.py     # DocumentStorage
│   ├── indexer/                  # 索引层
│   │   ├── base.py              # BaseIndexer
│   │   ├── fulltext.py          # 全文索引构建
│   │   └── vector.py             # 向量索引构建
│   ├── retriever/                # 检索层
│   │   ├── base.py              # SearchQuery + SearchHit + BaseRetriever
│   │   ├── keyword.py            # KeywordRetriever (GIN 全文)
│   │   ├── semantic.py           # SemanticRetriever (向量)
│   │   ├── hybrid.py             # HybridRetriever (混合编排)
│   │   └── manual.py             # ManualRetriever (手册检索)
│   ├── qa/                       # 问答层
│   │   ├── base.py              # Answer + SourceReference + BaseQA
│   │   ├── rag_qa.py            # RAG Pipeline
│   │   └── manual_qa.py          # 手册 RAG Pipeline
│   └── api/
│       └── server.py            # FastAPI 服务入口
├── scripts/                       # 运维脚本
│   ├── collect.py               # 数据采集入口
│   ├── index.py                 # 索引构建入口
│   ├── ingest_manual.py          # 手册导入入口
│   └── serve.py                 # 服务启动入口
├── web/                          # React 前端
│   ├── src/
│   │   ├── pages/               # 页面组件
│   │   │   ├── SearchPage.tsx  # 搜索页（含标签筛选）
│   │   │   ├── AskPage.tsx     # 问答页（含标签筛选）
│   │   │   ├── ManualSearchPage.tsx  # 手册搜索页
│   │   │   └── ManualAskPage.tsx     # 手册问答页
│   │   ├── components/          # 通用组件
│   │   │   ├── ThreadDrawer.tsx # 线程抽屉
│   │   │   └── TagFilter.tsx    # 标签筛选组件
│   │   ├── layouts/            # 布局组件
│   │   │   └── MainLayout.tsx
│   │   └── api/                # API 客户端
│   │       ├── client.ts       # fetch 封装 + API 函数
│   │       └── types.ts        # TypeScript 类型定义
│   └── dist/                   # 构建产物 (FastAPI 挂载到 /app/)
├── tests/                        # pytest 测试
└── manuals/                      # 芯片手册 PDF
```

---

## 数据模型

### EmailORM 核心字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 主键，自增 |
| `message_id` | str | 唯一约束，邮件标识 |
| `subject` | str | 邮件主题 |
| `sender` | str | 发件人（格式: "Name <email>"）|
| `date` | datetime | 发送时间，带时区 |
| `in_reply_to` | str | 回复目标 |
| `references` | list[str] | 线程引用链 |
| `body` | str | 邮件正文 |
| `body_raw` | str | 原始正文 |
| `patch_content` | str | 补丁内容 |
| `has_patch` | bool | 是否包含补丁 |
| `list_name` | str | 邮件列表名 |
| `thread_id` | str | 线程根 ID |
| `epoch` | int | 时间段编号 |
| `tags` | list[str] | 标签列表（最多 16 个）|
| `search_vector` | TSVECTOR | 全文搜索向量 |

### TagORM 核心字段（标签管理）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 主键，自增 |
| `name` | str | 标签名称（唯一）|
| `parent_id` | int | 父标签 ID（支持层级标签，NULL 表示顶级）|
| `color` | str | 标签颜色（十六进制，如 #6366f1）|
| `created_at` | datetime | 创建时间 |

### DocumentChunk ORM 核心字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 主键 |
| `chunk_id` | str | 分片唯一 ID |
| `manual_type` | str | 手册类型 (intel_sdm) |
| `manual_version` | str | 手册版本 |
| `volume` | str | 卷号 |
| `chapter` | str | 章号 |
| `section` | str | 节号 |
| `section_title` | str | 节标题 |
| `content_type` | str | 内容类型 (instruction/table/figure/description) |
| `content` | str | 分片正文 |
| `page_start` | int | 起始页 (0-based) |
| `page_end` | int | 结束页 (0-based) |
| `embedding` | VECTOR | 向量嵌入 |

### 索引策略
- 邮件: GIN(search_vector), GIN(tags), 复合(list_name, thread_id), 唯一(message_id)
- 标签: name 唯一约束, parent_id 索引
- 手册: GIN(content_vector), 复合(manual_type, content_type)

---

## API 接口

### 邮件搜索与问答

```
GET /api/search?q={keyword}&sender={sender}&date_from={date}&date_to={date}&has_patch={bool}&list_name={list}&tags={tags}&tag_mode={mode}&page={page}&page_size={size}&mode={mode}

GET /api/ask?q={question}&sender={sender}&date_from={date}&date_to={date}&list_name={list}&tags={tags}

GET /api/thread/{thread_id}

GET /api/stats
```

### 标签管理 API

```
POST   /api/tags              # 创建标签 Body: {"name": str, "parent_id": int?, "color": str?}
GET    /api/tags              # 获取标签树（树形结构）
GET    /api/tags/stats        # 获取标签统计 [{"name": str, "count": int}]
DELETE /api/tags/{tag_id}     # 删除标签（级联删除子标签）
```

### 邮件标签 API

```
GET    /api/email/{message_id}/tags     # 获取邮件标签
POST   /api/email/{message_id}/tags     # 添加标签 Body: {"tag_name": str}（最多 16 个）
DELETE /api/email/{message_id}/tags/{tag_name}  # 删除标签
```

### 手册搜索与问答

```
GET /api/manual/search?q={keyword}&manual_type={type}&content_type={type}&page={page}&page_size={size}

GET /api/manual/ask?q={question}&manual_type={type}&content_type={type}

GET /api/manual/stats
```

---

## 代码风格

### Python 规范

| 类型 | 规则 | 示例 |
|------|------|------|
| 文件 | snake_case | `git_collector.py` |
| 类 | PascalCase | `GitCollector`, `BaseRetriever` |
| 函数/方法 | snake_case | `build_thread_tree()` |
| 常量 | UPPER_SNAKE_CASE | `DEFAULT_EMBEDDING_MODEL` |
| 抽象基类 | Base 前缀 | `BaseCollector`, `BaseStorage` |

- 所有抽象基类使用 `abc.ABC` + `@abstractmethod`
- 类型注解必须完整，包括函数签名和返回值
- 使用 Pydantic `BaseModel` 做数据校验和序列化
- 异步优先：FastAPI 路由和数据库操作用 async/await
- 日志使用 Python `logging` 模块，格式: `%(asctime)s [%(levelname)s] %(name)s: %(message)s`

### TypeScript/React 规范

| 类型 | 规则 | 示例 |
|------|------|------|
| 变量/函数 | camelCase | `askQuestion` |
| 组件/类型 | PascalCase | `AskPage`, `AskResponse` |
| 文件 | camelCase 或 kebab-case | `client.ts`, `types.ts` |
| 样式 | Tailwind 原子类 | `className="px-4 py-2"` |

- 组件默认导出
- Props 定义接口
- 严格模式，禁止 `any`

---

## 架构原则

### 1. 插件化设计
每层通过抽象基类定义接口契约，实现类可替换：
- 新增数据源 → 实现 `BaseCollector`
- 新增存储后端 → 实现 `BaseStorage`
- 新增检索策略 → 实现 `BaseRetriever`
- 新增分片策略 → 实现 `BaseChunker`

### 2. 配置外置
所有配置集中在 `config/settings.yaml`：
- 数据库连接 (email, manual)
- API Key / Model 名称
- 功能开关 (vector.enabled, etc.)
- 代码零硬编码

### 3. 双引擎检索
- **精确引擎**: PostgreSQL GIN 全文索引，关键词精确匹配
- **语义引擎**: pgvector 向量检索，语义相似度 top-K 召回
- **混合编排**: HybridRetriever 自动路由 + RRF 融合

### 4. 批量操作
- 邮件写入必须分批（500 条/批）
- 禁止逐条 for 循环 insert

### 5. 幂等性
- 采集和索引基于 `message_id` / `chunk_id` 去重
- 支持重复执行不产生重复数据

### 6. 异步优先
- FastAPI 路由使用 async/await
- 数据库操作用 SQLAlchemy async
- LLM 调用异步化

### 7. 标签系统
- 支持父子层级标签（树形结构）
- 单封邮件最多 16 个标签
- 标签名称全局唯一
- 删除父标签时级联删除所有子标签
- 标签过滤支持 `any`（任一匹配）和 `all`（全部匹配）两种模式

---

## 开发约束

1. **不要跳过抽象层**: 新功能先定义/更新 `base.py` 接口，再写实现
2. **配置外置**: 禁止硬编码数据库连接、API Key 等敏感信息
3. **错误处理**: 网络请求、数据库操作、LLM 调用必须有 try/except
4. **类型安全**: Python 全类型注解，TypeScript 严格模式
5. **文档字符串**: 公开类和方法必须有 Google 风格 docstring
6. **构建产出**: 前端 `web/dist/` 由 FastAPI 挂载到 `/app/`
7. **批量操作**: 写入数据库和向量索引时必须批量，避免逐条
8. **标签上限**: 添加邮件标签时必须检查是否已达上限（16 个）

---

## 搜索过滤功能

### SearchQuery 参数

```python
@dataclass
class SearchQuery:
    text: str                    # 搜索关键词
    list_name: Optional[str]     # 邮件列表
    sender: Optional[str]         # 发件人模糊匹配
    date_from: Optional[datetime]# 起始日期
    date_to: Optional[datetime]   # 结束日期
    has_patch: Optional[bool]     # 包含补丁
    tags: Optional[list[str]]     # 标签列表过滤
    tag_mode: str = "any"        # 标签匹配模式: "any" 或 "all"
    page: int = 1                # 页码
    page_size: int = 50           # 每页数量
    top_k: int = 20              # 语义检索 top-K
```

### SearchHit 字段

```python
@dataclass
class SearchHit:
    message_id: str
    subject: str = ""
    sender: str = ""
    date: str = ""
    list_name: str = ""
    thread_id: str = ""
    has_patch: bool = False
    tags: list[str] = field(default_factory=list)  # 邮件标签列表
    score: float = 0.0
    snippet: str = ""
    source: str = ""
```

### ManualSearchQuery 参数

```python
@dataclass
class ManualSearchQuery:
    text: str                    # 搜索关键词
    manual_type: Optional[str]   # 手册类型
    content_type: Optional[str]  # 内容类型 (instruction/table/figure/description)
    page: int = 1
    page_size: int = 20
```

---

## 常用命令

### 后端

```bash
# 安装依赖
pip install -e ".[dev,embedding]"

# 采集邮件数据
python scripts/collect.py --list linux-mm --epoch 0 --limit 100

# 导入芯片手册
python scripts/ingest_manual.py --source intel_sdm --path ./manuals/intel_sdm/

# 构建索引
python scripts/index.py --type fulltext   # 全文索引
python scripts/index.py --type vector     # 向量索引

# 启动服务
python scripts/serve.py
# 或
uvicorn src.api.server:app --reload --port 8000

# 运行测试
pytest tests/ -v
```

### 前端

```bash
cd web && npm install

# 开发服务器（带代理）
npm run dev

# 构建
npm run build

# 预览
npm run preview
```

---

## 开发工作流

1. **分析需求** → 创建/更新 `.joycode/plans/PLAN-xxx.md` 规约文档
2. **接口设计** → 更新对应模块的 `base.py` 抽象接口
3. **实现代码** → 实现具体功能，遵循架构原则
4. **端到端验证** → 用 scripts/ 入口脚本测试
5. **前端适配** → 更新 API client 和页面组件（如需要）
6. **提交代码** → git commit

---

## 扩展点（后续迭代）

- [ ] 向量检索启用（pgvector）
- [ ] LLM RAG 回答生成（需配置 API Key）
- [ ] 前端时间线/线程可视化
- [ ] 多数据源支持（NNTP/RSS/mbox）
- [ ] 其他存储后端（Elasticsearch、Milvus）
- [ ] AI 标签建议（自动分析邮件内容推荐标签）