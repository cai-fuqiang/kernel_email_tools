---
globs: *
alwaysApply: true
---

# 项目规则要求如下

## 项目概览

本项目是 **Linux 内核邮件列表知识库**（kernel_email_tools），从 lore.kernel.org 采集内核邮件列表数据，构建支持精确检索和 RAG 语义问答的双引擎知识库系统。

- 项目类型：Python 后端服务
- 核心架构：六层插件化（Collector → Parser → Storage → Indexer → Retriever → QA）
- 数据源：lore.kernel.org（git mirror / Atom API）
- 参考设计：`.joycode/plans/PLAN-002-kernel-kb-extensible-architecture.md`

## 技术栈

- 语言：Python 3.11+
- Web 框架：FastAPI
- 数据库：PostgreSQL + pgvector 扩展
- ORM/模型：SQLAlchemy（ORM）+ Pydantic（数据校验）
- Embedding：BGE-large 或 OpenAI text-embedding-3
- LLM：通过 API 调用（GPT-4 / Claude），接口需支持替换
- 依赖管理：pyproject.toml（使用 pip 或 uv）
- 测试框架：pytest

## 目录结构规范

```
kernel_email_tools/
├── config/              # 配置文件（settings.yaml）
├── src/
│   ├── collector/       # 数据采集层
│   ├── parser/          # 邮件解析层
│   ├── storage/         # 存储层
│   ├── indexer/         # 索引层（全文 + 向量双引擎）
│   ├── retriever/       # 检索层（关键词 / 语义 / 混合）
│   ├── qa/              # 问答层（RAG Pipeline）
│   └── api/             # FastAPI 服务层
├── scripts/             # 运维脚本（collect/index/serve）
└── tests/               # 测试代码
```

- 每个功能层目录下必须有 `base.py` 定义抽象接口
- 具体实现文件与 `base.py` 同级，继承抽象基类
- 测试文件放在 `tests/` 下，命名为 `test_<模块名>.py`

## 编码规范

### 命名约定
- 文件名：小写 + 下划线（snake_case），如 `git_collector.py`
- 类名：大驼峰（PascalCase），如 `GitCollector`、`BaseRetriever`
- 函数/方法：小写 + 下划线，如 `build_thread_tree()`
- 常量：全大写 + 下划线，如 `DEFAULT_EMBEDDING_MODEL`
- 抽象基类以 `Base` 前缀命名，如 `BaseCollector`、`BaseStorage`

### 代码风格
- 所有抽象基类使用 `abc.ABC` + `@abstractmethod`
- 类型注解必须完整，包括函数签名和返回值
- 使用 Pydantic BaseModel 做数据校验和序列化
- 异步优先：FastAPI 路由和数据库操作使用 async/await
- 日志使用 Python 标准 `logging` 模块，不使用 print

### 文档字符串
- 所有公开类和方法必须有 docstring
- 使用 Google 风格 docstring 格式

## 架构原则

### 插件化设计
- 每层通过抽象基类定义接口契约，实现类可替换
- 新增数据源只需实现 `BaseCollector` 接口
- 新增存储后端只需实现 `BaseStorage` 接口
- 配置文件决定加载哪个实现，代码不硬编码具体实现类

### 双引擎检索
- 精确引擎：PostgreSQL GIN 全文索引，用于关键词精确匹配和全量列表返回
- 语义引擎：pgvector 向量检索，用于语义相似度 top-K 召回
- HybridRetriever 负责查询意图路由和结果融合

### 数据模型核心字段
邮件模型必须包含：message_id、subject、sender、date、in_reply_to、references、body、patch_content、list_name、thread_id

## 开发约束

1. **不要跳过抽象层**：任何新功能必须先定义/更新 base.py 接口，再写实现
2. **配置外置**：数据库连接、API Key、模型名称等全部通过 config/settings.yaml 配置，不硬编码
3. **错误处理**：网络请求、数据库操作、LLM 调用必须有异常捕获和重试机制
4. **批量操作**：邮件写入数据库和向量索引时必须支持批量操作，避免逐条写入
5. **幂等性**：数据采集和索引构建必须支持重复执行不产生重复数据（基于 message_id 去重）
6. **增量友好**：设计时考虑增量更新场景，采集和索引都支持只处理新增数据

## 常用命令

```bash
# 依赖安装
pip install -e ".[dev]"

# 数据采集（指定列表和 epoch）
python scripts/collect.py --list linux-mm --epoch 0

# 构建索引
python scripts/index.py --type fulltext   # 全文索引
python scripts/index.py --type vector     # 向量索引

# 启动 API 服务
python scripts/serve.py
# 或
uvicorn src.api.server:app --reload

# 运行测试
pytest tests/ -v
```

## 开发工作流

1. 按 PLAN-002 的 Phase 顺序执行，每个 Phase 完成后验证
2. 先写 base.py 接口 → 再写实现 → 最后写测试
3. 每完成一个模块，用 scripts/ 下的入口脚本做端到端验证
4. MVP 阶段先用 linux-mm（3 个 epoch，数据量小）做验证，不要一开始就用 LKML