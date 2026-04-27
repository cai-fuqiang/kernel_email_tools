# Kernel Email Knowledge Base — 项目架构

## 定位

面向 Linux 内核邮件列表的本地知识库系统。将 lore.kernel.org 邮件导入、手册文档、内核源码、标签、批注和 AI 辅助检索组织到一个 Web 应用中。目标是把邮件讨论沉淀成可引用、可维护的内核知识库。

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
├── kernel_source/   # 本地 kernel git 浏览、symbol 索引
├── translator/      # Google Translate + 缓存
├── api/             # FastAPI server.py (所有路由)
└── chunker/         # 手册 PDF 分片

web/src/
├── pages/           # SearchPage (含 AI 概括) / KnowledgePage / TagsPage / AnnotationsPage / ManualSearchPage / ManualAskPage / KernelCodePage / UsersPage / LoginPage
├── components/      # ThreadDrawer、TagFilter、EmailTagEditor、Tag/Annotation 组件
├── layouts/         # MainLayout (侧边栏导航)
├── api/             # client.ts (API 函数) / types.ts (TypeScript 类型)
└── auth.tsx         # 前端认证状态
```

## 核心流程

### 邮件采集与索引
采集 (git pull) → 解析 (EmailParser) → 入库 (PostgresStorage) → 全文索引 (GIN trigger) → chunk 切分 (EmailChunkIndexer) → 向量嵌入 (DashScope)

### Search + AI 概括
用户搜索 → HybridRetriever (keyword + optional semantic + RRF) → SearchPage 展示命中列表 → 用户点 "AI 概括" → POST /api/search/summarize → ChatLLMClient 直接基于命中生成引用式概览 → 可点击 [Message-ID] 验证原文 → 可一键生成 Knowledge/Annotation/Tag 草稿

### 知识沉淀
Knowledge entity → 层级 Tag → Annotation (附着于 email/thread/knowledge/code) → 发布审核流

## 关键约束

- 数据库可全量重建 (rebuild_db.py)，不做增量迁移
- API 无流式输出 (第一版不做 streaming)
- Ask 草稿只允许绑定已有 tag，不自动创建新 tag
- 标签是全局 taxonomy，AI 可能生成近义/层级不一的标签，由用户确认
- Manual Ask (手册问答) 是完全独立的代码路径
- API Key 优先级: 环境变量 > settings.yaml
