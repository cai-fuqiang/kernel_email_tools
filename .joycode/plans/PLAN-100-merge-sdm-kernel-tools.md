# PLAN-100: 两个工程结合

## 任务概述

评估并实现 `kernel_email_tools` 与 `sdm_kernel_tools`（芯片手册知识库）合并。

## 项目对比分析

### 相似点（有利于结合）
- [x] 六层插件化架构一致（Collector → Parser → Storage → Indexer → Retriever → QA）
- [x] 技术栈相同（FastAPI + SQLAlchemy + PostgreSQL + pgvector + Pydantic v2）
- [x] 抽象基类设计模式一致
- [x] 双引擎检索（GIN 全文 + pgvector 语义）
- [x] RAG 问答实现相似

### 差异点（需要适配）
- [x] 数据模型不同：`EmailORM` vs `DocumentChunk`
- [x] Parser 输入不同：Git mirror vs PDF 文件
- [x] 元数据字段不同
- [x] `sdm_kernel_tools` 独有 Chunker 层（L1→L2→L3 分片管线）

## 推荐方案

**模块独立 + API 融合（松耦合）**

### 目标目录结构
```
kernel_email_tools/
├── src/
│   ├── parser/
│   │   ├── email/              # 邮件解析 (原有)
│   │   └── manual/             # 芯片手册 PDF 解析 (合并)
│   ├── chunker/                 # 文档分片 (合并)
│   ├── storage/
│   │   ├── base.py             # 统一抽象基类
│   │   ├── email_store.py      # 邮件存储
│   │   └── document_store.py   # 文档分片存储
│   ├── retriever/              # 共享检索层
│   ├── qa/                     # 共享 RAG 问答
│   └── api/
│       └── server.py           # 统一 API
├── scripts/
│   └── ingest_manual.py        # 手册导入
└── sdm_kernel_tools/           # 合并后移除
```

## 工作量评估

| 任务 | 预计工时 | 状态 |
|------|----------|------|
| 配置文件合并 | 1h | ✅ |
| Chunker 模块合并 | 2h | ✅ |
| Parser 模块合并 | 2h | ✅ |
| Storage 层重构 | 3h | ✅ |
| API 层扩展 | 3-4h | ⏳ |
| 前端页面改造 | 4-6h | ⏳ |
| 脚本整合 | 1h | ⏳ |
| 代码清理 | 1-2h | ⏳ |
| **总计** | **14-23h** | |

## 实施记录

### Phase 1: 基础设施整合 ✅

#### 1.1 配置文件合并
- [x] 统一 `config/settings.yaml` 支持多数据源
- [x] 新增 `email_collector`、`manual_collector`、`manual_parser` 配置
- [x] 分离 `storage.email` 和 `storage.manual` 数据库配置
- [x] 分离 `qa.email` 和 `qa.manual` LLM 配置

#### 1.2 Chunker 模块合并
已复制到 `src/chunker/`:
- [x] `base.py` - DocumentChunk 数据模型 + BaseChunker 接口
- [x] `section_chunker.py` - L1 章节分片器
- [x] `content_type_chunker.py` - L2 内容类型识别
- [x] `sliding_window.py` - L3 滑动窗口补偿
- [x] `instruction_chunker.py` - 指令页专用分片
- [x] `table_chunker.py` - 表格专用分片
- [x] `pipeline.py` - L1→L2→L3 编排管线

#### 1.3 Parser 模块合并
已复制到 `src/parser/`:
- [x] `base.py` - PageContent、TOCEntry、SectionNode + BaseManualParser 接口
- [x] `pdf_extractor.py` - PDF 文本/表格/书签提取
- [x] `intel_sdm/parser.py` - Intel SDM 专用解析器

#### 1.4 Storage 层重构
- [x] 统一 `BaseStorage` 抽象基类
- [x] 新增 `BaseEmailStorage` 邮件存储接口
- [x] 新增 `DocumentChunkModel` 数据模型
- [x] 新增 `DocumentStorage` 文档存储实现

### Phase 2: API 融合 ⏳

#### 2.1 DocumentStorage 实现
- [x] 创建 `DocumentStorage` PostgreSQL 存储实现
- [x] 支持文档分片的 CRUD 操作
- [x] 支持全文搜索
- [x] 支持按手册类型/内容类型过滤

#### 2.2 待完成
- [ ] 实现 `ManualRetriever` 手册检索器
- [ ] 实现 `ManualQA` 手册问答
- [ ] 扩展 API 路由支持芯片手册搜索/问答
- [ ] 创建统一搜索入口

### Phase 3: 前端融合 ⏳
- [ ] 添加芯片手册搜索/问答页面
- [ ] 统一布局和组件
- [ ] 端到端测试

### Phase 4: 收尾 ⏳
- [ ] 清理 sdm_kernel_tools 目录
- [ ] 更新文档和脚本
- [ ] 验证全流程

## 当前目录结构

```
kernel_email_tools/
├── config/
│   └── settings.yaml          # 统一配置
├── src/
│   ├── chunker/               # 文档分片
│   │   ├── base.py
│   │   ├── section_chunker.py
│   │   ├── content_type_chunker.py
│   │   ├── sliding_window.py
│   │   ├── instruction_chunker.py
│   │   ├── table_chunker.py
│   │   └── pipeline.py
│   ├── parser/
│   │   ├── base.py           # PDF 解析接口
│   │   ├── pdf_extractor.py
│   │   └── intel_sdm/
│   │       └── parser.py
│   ├── storage/
│   │   ├── base.py           # 统一存储接口
│   │   ├── models.py         # 邮件模型
│   │   ├── document_models.py # 文档模型
│   │   ├── postgres.py       # 邮件存储
│   │   └── document_store.py # 文档存储
│   └── ...
└── sdm_kernel_tools/          # 待清理
```

## 下一步计划

1. **ManualRetriever** - 实现芯片手册的检索功能
2. **扩展 API 路由** - 添加手册搜索和问答接口
3. **前端页面** - 创建芯片手册的搜索和问答页面
4. **脚本整合** - 将 ingest.py 整合为 scripts/ingest_manual.py

---

*创建时间: 2026-04-17*
*最后更新: 2026-04-17*
*状态: Phase 1-2 进行中*