# 内核邮件列表知识库 — 可扩展架构设计 V1

## 设计原则
- **插件化**：数据源、解析器、索引引擎、检索策略均可替换
- **双引擎**：结构化精确检索 + RAG 语义问答并行
- **分层解耦**：采集/存储/索引/检索/展示各层独立，单独可替换
- **MVP 优先**：先跑通单列表全流程，再横向扩展

## 项目结构

```
kernel_email_tools/
├── config/                    # 配置中心（数据源、模型、数据库连接）
│   └── settings.yaml
├── src/
│   ├── collector/             # 数据采集层（插件化）
│   │   ├── base.py            # BaseCollector 抽象接口
│   │   ├── git_collector.py   # git clone lore.kernel.org
│   │   └── lore_api.py        # lore 搜索 API 采集（轻量补充）
│   ├── parser/                # 邮件解析层（插件化）
│   │   ├── base.py            # BaseParser 抽象接口
│   │   ├── email_parser.py    # 标准邮件头/体解析
│   │   ├── thread_builder.py  # In-Reply-To 线程树重建
│   │   └── patch_extractor.py # diff/patch 内容分离
│   ├── storage/               # 存储层（可替换后端）
│   │   ├── base.py            # BaseStorage 抽象接口
│   │   ├── postgres.py        # PostgreSQL + 全文索引
│   │   └── models.py          # 邮件数据模型（SQLAlchemy/Pydantic）
│   ├── indexer/               # 索引层（双引擎）
│   │   ├── base.py            # BaseIndexer 抽象接口
│   │   ├── fulltext.py        # PostgreSQL GIN 全文索引
│   │   └── vector.py          # pgvector / 外部向量库 嵌入索引
│   ├── retriever/             # 检索层（策略可组合）
│   │   ├── base.py            # BaseRetriever 抽象接口
│   │   ├── keyword.py         # 精确关键词检索 → 返回全量列表
│   │   ├── semantic.py        # 向量语义检索 → 返回 top-K
│   │   └── hybrid.py          # 混合编排：路由判断 + 结果融合
│   ├── qa/                    # 问答层（可选 LLM）
│   │   ├── base.py            # BaseQA 抽象接口
│   │   └── rag_qa.py          # RAG Pipeline：检索 + LLM 生成
│   └── api/                   # API 服务层
│       └── server.py          # FastAPI 路由
├── scripts/                   # 运维脚本
│   ├── collect.py             # 数据采集入口
│   ├── index.py               # 索引构建入口
│   └── serve.py               # 服务启动入口
├── tests/
├── pyproject.toml
└── README.md
```

## 核心抽象接口

每层一个 `base.py`，定义接口契约，实现可替换：
- `BaseCollector.collect(list_name, date_range) → List[RawEmail]`
- `BaseParser.parse(raw) → Email`（含线程关系、补丁分离）
- `BaseStorage.save(emails) / query(filters) → List[Email]`
- `BaseIndexer.build(emails) / update(email)`
- `BaseRetriever.search(query, mode) → SearchResult`
- `BaseQA.answer(question) → Answer`（带来源引用）

## TODO: MVP 实施步骤（按顺序执行）

### Phase 1 — 项目骨架 + 数据采集
- [ ] 初始化项目结构、pyproject.toml、settings.yaml
- [ ] 实现 BaseCollector 接口 + GitCollector（clone 单个 epoch）
- [ ] 实现 BaseParser + EmailParser（解析 git 对象为邮件）
- [ ] 实现 ThreadBuilder（重建线程树）
- [ ] 验证：采集 linux-mm epoch 0，解析出邮件列表，打印统计

### Phase 2 — 存储 + 双引擎索引
- [ ] 实现 models.py（Email/Thread Pydantic + SQLAlchemy 模型）
- [ ] 实现 PostgresStorage（写入/查询/全文搜索）
- [ ] 实现 FulltextIndexer（GIN 索引构建）
- [ ] 实现 VectorIndexer（pgvector 嵌入写入）
- [ ] 验证：搜索 "RSDL" 能返回全部匹配邮件 + 语义近似结果

### Phase 3 — 检索 + 问答
- [ ] 实现 KeywordRetriever（精确检索，支持分页返回全量）
- [ ] 实现 SemanticRetriever（向量 top-K）
- [ ] 实现 HybridRetriever（查询意图路由 + 结果融合）
- [ ] 实现 RagQA（检索结果 → LLM 总结 + 来源引用）
- [ ] 验证："RSDL 调度器的所有邮件" → 列表 + "RSDL 为什么被替代" → 总结

### Phase 4 — API 服务
- [ ] FastAPI 路由：/search、/ask、/thread/{id}
- [ ] 返回格式统一：{answer, sources[], total_count, page}
- [ ] 验证：curl 测试所有接口

## 扩展点（后续迭代）
- 新数据源：实现新的 Collector（NNTP、RSS、mbox 文件导入）
- 新存储：切换到 Milvus、Elasticsearch
- 主题聚类：新增 TopicClusterer 模块（BERTopic）
- 前端：React 界面、时间线视图、线程可视化
- 增量更新：git fetch + 增量解析索引