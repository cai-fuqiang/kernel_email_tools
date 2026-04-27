# Kernel Email Knowledge Base — 项目架构

## 定位

面向 Linux 内核邮件列表的本地知识库系统。将 lore.kernel.org 邮件导入、内核源码注解、标签、批注和 AI 辅助检索组织到一个 Web 应用中。**目标是把邮件讨论沉淀成可引用、可维护的内核知识库。**

## 技术栈

- **后端**: Python 3.11+ / FastAPI / SQLAlchemy / PostgreSQL 16+ / pgvector
- **前端**: React 18+ / TypeScript / Vite / Tailwind CSS
- **AI**: DashScope (Qwen) / OpenAI-compatible API / pgvector + IVFFlat
- **外部数据**: lore.kernel.org git mirrors (KVM, Linux-MM, LKML)

## 目录结构

```
src/
├── collector/       # lore git mirror 采集
├── parser/          # 邮件、patch 解析、thread 构建
├── storage/         # PostgreSQL ORM、Storage、TagStore、AnnotationStore、KnowledgeStore
├── indexer/         # 全文索引、邮件 RAG chunk、向量索引
├── retriever/       # KeywordRetriever (GIN fulltext) / SemanticRetriever (pgvector) / HybridRetriever (RRF fusion)
├── qa/              # ChatLLMClient、AskDraftService、ManualQA、DashScopeEmbeddingProvider
├── kernel_source/   # 内核版本文件读取（供注解模块使用）
├── symbol_indexer/  # [待移除] ctags 符号索引——纯浏览功能，非注解所必需
├── translator/      # Google Translate + 缓存
├── api/             # FastAPI server.py (所有路由)
└── chunker/         # 手册 PDF 分片 [待评估去留]

web/src/
├── pages/           # SearchPage (含 AI 概括) / KnowledgePage / TagsPage / AnnotationsPage / ManualSearchPage / ManualAskPage / KernelCodePage / UsersPage / LoginPage
├── components/      # ThreadDrawer、TagFilter、EmailTagEditor、Tag/Annotation 组件
├── layouts/         # MainLayout (侧边栏导航)
├── api/             # client.ts (API 函数) / types.ts (TypeScript 类型)
└── auth.tsx         # 前端认证状态
```

## 核心流程

### 邮件 → 知识沉淀（主链路）

```
采集 (git pull) → 解析 (EmailParser) → 入库 (PostgresStorage)
  → 全文索引 (GIN trigger)
  → 用户搜索 → 查看命中列表
    → [可选] AI 概括 → 可点击 [Message-ID] 验证原文
    → [可选] 一键生成 Knowledge/Annotation/Tag 草稿 → 用户确认落库
  → Knowledge 消费（按 Tag 浏览、证据链追溯、知识关联）【当前缺失，P0】
```

### 代码注解（辅助链路）

```
内核版本选择 → 文件查看 → 行级注解 → Annotation 落库
  → 与邮件注解共享 publish workflow + Tag 体系
  【注解核心正确，浏览功能（文件树、symbol）待精简】
```

## 模块状态

| 模块 | 状态 | 说明 |
|------|------|------|
| 邮件采集/解析/检索 | 稳定 | 定位正确，继续维护 |
| AI 概括 | 稳定 | Search-first 模型，设计干净 |
| Tag / Annotation | 稳定 | 沉淀机制正确，渐进优化 |
| Knowledge | **薄弱** | 全工程最大短板——需重点投入 |
| 内核源码注解 | 需精简 | 定位正确但 40% 代码冗余 |
| 翻译 | 可接受 | 实现偏重但无紧急问题 |
| 芯片手册 | **待评估** | 独立 RAG 应用，与邮件知识库无关 |

## 关键约束

- 数据库可全量重建 (rebuild_db.py)，不做增量迁移
- API 无流式输出
- Ask 草稿只允许绑定已有 tag，不自动创建新 tag
- 标签是全局 taxonomy，AI 可能生成近义/层级不一的标签，由用户确认
- API Key 优先级: 环境变量 > settings.yaml
- **Knowledge 模块是项目的最终产品形态，当前严重不足——所有功能开发应围绕"如何让用户消费和引用知识"展开**
