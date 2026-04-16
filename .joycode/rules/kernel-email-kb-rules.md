---
globs: *
alwaysApply: true
---

# Kernel Email Knowledge Base - JoyCode 开发规则

## 项目概览

| 属性 | 说明 |
|------|------|
| **项目名称** | kernel_email_tools |
| **类型** | 全栈 Web 应用（Python 后端 + React 前端）|
| **目标** | Linux 内核邮件列表知识库，支持精确检索和 RAG 语义问答 |
| **数据源** | lore.kernel.org git mirror |
| **架构** | 六层插件化（Collector → Parser → Storage → Indexer → Retriever → QA）|
| **双引擎** | PostgreSQL GIN 全文索引 + pgvector 向量检索 |

---

## 技术栈

### 后端
- **语言**: Python 3.11+
- **框架**: FastAPI, SQLAlchemy 2.0 async
- **数据库**: PostgreSQL 16 + pgvector
- **驱动**: asyncpg
- **数据校验**: Pydantic v2
- **配置**: YAML (settings.yaml)

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
│   └── settings.yaml              # 唯一配置中心
├── src/
│   ├── collector/                 # 数据采集层
│   │   ├── base.py              # BaseCollector 抽象接口
│   │   └── git_collector.py     # GitCollector 实现
│   ├── parser/                   # 邮件解析层
│   │   ├── email_parser.py       # RFC2822 解析
│   │   ├── thread_builder.py     # 线程重建
│   │   └── patch_extractor.py    # 补丁提取
│   ├── storage/                  # 存储层
│   │   ├── base.py              # BaseStorage 抽象接口
│   │   ├── models.py            # EmailORM + Pydantic 模型
│   │   └── postgres.py          # PostgresStorage 实现
│   ├── indexer/                 # 索引层
│   │   ├── fulltext.py          # 全文索引构建
│   │   └── vector.py             # 向量索引构建
│   ├── retriever/                # 检索层
│   │   ├── base.py              # SearchQuery + SearchHit + BaseRetriever
│   │   ├── keyword.py            # KeywordRetriever (GIN 全文)
│   │   ├── semantic.py           # SemanticRetriever (向量)
│   │   └── hybrid.py             # HybridRetriever (混合编排)
│   ├── qa/                       # 问答层
│   │   └── rag_qa.py            # RAG Pipeline
│   └── api/
│       └── server.py            # FastAPI 服务入口
├── scripts/                      # 运维脚本
│   ├── collect.py               # 数据采集入口
│   ├── index.py                 # 索引构建入口
│   └── serve.py                 # 服务启动入口
├── web/                         # React 前端
│   ├── src/
│   │   ├── pages/              # 页面组件
│   │   │   ├── SearchPage.tsx   # 搜索页
│   │   │   └── AskPage.tsx      # 问答页
│   │   ├── components/          # 通用组件
│   │   │   └── ThreadDrawer.tsx # 线程抽屉
│   │   ├── api/                 # API 客户端
│   │   │   ├── client.ts        # fetch 封装 + API 函数
│   │   │   └── types.ts         # TypeScript 类型定义
│   │   └── layouts/             # 布局组件
│   └── dist/                    # 构建产物 (FastAPI 挂载到 /app/)
└── tests/                       # pytest 测试
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
| `search_vector` | TSVECTOR | 全文搜索向量 |

### 索引策略
- GIN 索引: `search_vector` (全文搜索)
- 复合索引: `(list_name, thread_id)`
- 唯一约束: `message_id`

---

## API 接口

### 搜索接口
```
GET /api/search?q={keyword}&sender={sender}&date_from={date}&date_to={date}&has_patch={bool}&list_name={list}&mode={mode}&page={page}&page_size={size}
```

### 问答接口
```
GET /api/ask?q={question}&list_name={list}
```

### 线程接口
```
GET /api/thread/{thread_id}
```

### 统计接口
```
GET /api/stats
```

---

## 代码风格

### Python 规范
- **文件**: snake_case (如 `git_collector.py`)
- **类**: PascalCase，抽象类用 `Base` 前缀
- **函数/方法**: snake_case
- **常量**: UPPER_SNAKE_CASE
- **类型注解**: 必须完整
- **日志**: `logging` 模块，格式 `%(asctime)s [%(levelname)s] %(name)s: %(message)s`

### TypeScript/React 规范
- **变量/函数**: camelCase
- **组件/类型**: PascalCase
- **样式**: Tailwind 原子类，无自定义 CSS
- **组件**: 默认导出
- **Props**: 接口定义

---

## 架构原则

### 1. 插件化设计
每层通过抽象基类定义接口契约，实现类可替换：
- 新增数据源 → 实现 `BaseCollector`
- 新增存储后端 → 实现 `BaseStorage`
- 新增检索策略 → 实现 `BaseRetriever`

### 2. 配置外置
所有配置集中在 `config/settings.yaml`：
- 数据库连接
- API Key / Model 名称
- 功能开关

### 3. 批量操作
- 邮件写入必须分批（500 条/批）
- 禁止逐条 for 循环 insert

### 4. 幂等性
- 采集和索引基于 `message_id` 去重
- 支持重复执行不产生重复数据

### 5. 异步优先
- FastAPI 路由使用 async/await
- 数据库操作用 SQLAlchemy async
- LLM 调用异步化

---

## 开发约束

1. **不要跳过抽象层**: 新功能先定义/更新 `base.py`，再写实现
2. **配置外置**: 禁止硬编码数据库连接、API Key 等
3. **错误处理**: 网络、数据库、LLM 调用必须有 try/except
4. **类型安全**: Python 全类型注解，TypeScript 严格模式
5. **文档字符串**: 公开类和方法必须有 Google 风格 docstring
6. **构建产出**: 前端 `web/dist/` 由 FastAPI 挂载到 `/app/`

---

## 常用命令

### 后端
```bash
# 安装依赖
pip install -e ".[dev]"

# 采集数据
python scripts/collect.py --list linux-mm --epoch 0 --limit 100

# 构建索引
python scripts/index.py --list linux-mm --epoch 0

# 启动服务
python scripts/serve.py
# 或
uvicorn src.api.server:app --reload

# 运行测试
pytest tests/ -v
```

### 前端
```bash
cd web && npm install

# 开发服务器
npm run dev

# 构建
npm run build

# 预览
npm run preview
```

---

## 开发工作流

1. **分析需求** → 创建/更新 `.joycode/plans/PLAN-xxx.md` 规约文档
2. **接口设计** → 更新 `base.py` 抽象接口
3. **实现代码** → 实现具体功能
4. **端到端验证** → 用 scripts/ 入口脚本测试
5. **提交代码** → git commit

---

## 搜索过滤功能

### 支持的过滤参数
- `sender`: 发件人模糊匹配（ILIKE）
- `date_from`: 起始日期（ISO 格式）
- `date_to`: 结束日期（ISO 格式）
- `has_patch`: 是否包含补丁
- `list_name`: 限定邮件列表

### SearchQuery 参数
```python
@dataclass
class SearchQuery:
    text: str                    # 搜索关键词
    list_name: Optional[str]     # 邮件列表
    sender: Optional[str]        # 发件人
    date_from: Optional[datetime]# 起始日期
    date_to: Optional[datetime]  # 结束日期
    has_patch: Optional[bool]    # 包含补丁
    page: int = 1               # 页码
    page_size: int = 50          # 每页数量
```

---

## 扩展点（后续迭代）

- [ ] NNTP/RSS/mbox 数据源
- [ ] Elasticsearch 存储后端
- [ ] pgvector 向量检索启用
- [ ] OpenAI/BGE embedding 接入
- [ ] LLM RAG 回答生成
- [ ] 前端时间线/线程可视化