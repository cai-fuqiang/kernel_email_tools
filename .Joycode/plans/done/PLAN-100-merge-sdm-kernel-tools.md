# PLAN-100: 两个工程结合 ✅

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

## 工作量评估

| 任务 | 预计工时 | 实际工时 | 状态 |
|------|----------|----------|------|
| 配置文件合并 | 1h | ~0.5h | ✅ |
| Chunker 模块合并 | 2h | ~1h | ✅ |
| Parser 模块合并 | 2h | ~1h | ✅ |
| Storage 层重构 | 3h | ~2h | ✅ |
| API 层扩展 | 3-4h | ~2h | ✅ |
| 前端页面改造 | 4-6h | ~3h | ✅ |
| 脚本整合 | 1h | ~0.5h | ✅ |
| 代码清理 | 1-2h | ~0.5h | ✅ |
| **总计** | **14-23h** | **~10h** | ✅ |

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

### Phase 2: API 融合 ✅

#### 2.1 ManualRetriever 实现
- [x] 创建 `ManualRetriever` 手册检索器
- [x] 支持文档分片的全文搜索
- [x] 支持按手册类型、内容类型过滤

#### 2.2 ManualQA 实现
- [x] 创建 `ManualQA` 手册问答 (RAG Pipeline)
- [x] 支持 OpenAI/Anthropic/DashScope/MiniMax 多 LLM 提供商
- [x] LLM 不可用时 fallback 到检索摘要

#### 2.3 API 路由扩展
- [x] `/api/manual/search` - 手册文档搜索
- [x] `/api/manual/ask` - 手册 RAG 问答
- [x] `/api/manual/stats` - 手册统计信息
- [x] 更新 `server.py` 支持多数据源存储初始化

### Phase 3: 前端融合 ✅
- [x] 创建芯片手册搜索页面 `ManualSearchPage`
- [x] 创建芯片手册问答页面 `ManualAskPage`
- [x] 更新前端 API 客户端支持手册接口
- [x] 更新 MainLayout 添加手册导航

### Phase 4: 收尾 ✅
- [x] 清理 sdm_kernel_tools 目录
- [x] 更新 README 文档
- [x] 创建 ingest_manual.py 脚本

## Git Commits

| Commit | 描述 |
|--------|------|
| `71c95b2` | feat: Phase 1 - 合并 sdm_kernel_tools 基础设施 |
| `af70531` | feat: Phase 2 - 实现 ManualRetriever 和 ManualQA |
| `e550179` | feat: Phase 3 - 前端融合 |
| `d34ceeb` | chore: Phase 4 - 收尾工作 |

## 最终目录结构

```
kernel_email_tools/
├── config/
│   └── settings.yaml          # 统一配置（多数据源）
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
│   ├── retriever/
│   │   └── manual.py         # 手册检索器
│   ├── qa/
│   │   └── manual_qa.py      # 手册问答
│   └── api/
│       └── server.py         # 统一 API
├── scripts/
│   ├── collect.py             # 邮件采集
│   ├── index.py               # 邮件索引
│   ├── serve.py               # 服务启动
│   └── ingest_manual.py       # 手册导入
└── web/
    └── src/
        ├── pages/
        │   ├── SearchPage.tsx
        │   ├── AskPage.tsx
        │   ├── ManualSearchPage.tsx
        │   └── ManualAskPage.tsx
        ├── layouts/
        │   └── MainLayout.tsx
        └── api/
            ├── client.ts
            └── types.ts
```

## 技术亮点

1. **模块独立 + API 融合** - 双数据源独立演进，统一用户体验
2. **三层分片策略** - L1 章节→L2 内容类型→L3 滑动窗口，针对芯片手册优化
3. **多 LLM 支持** - OpenAI/Anthropic/DashScope/MiniMax
4. **Fallback 机制** - LLM 不可用时自动降级到检索摘要

---

*创建时间: 2026-04-17*
*完成时间: 2026-04-17*
*状态: ✅ 全部完成*