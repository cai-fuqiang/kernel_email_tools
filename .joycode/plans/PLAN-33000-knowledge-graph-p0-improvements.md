# PLAN-33000: 知识图谱 P0 功能改进

## 概述

打通 Ask ↔ Knowledge 双向闭环（P0-1）和 邮件 ↔ 知识实体双向引用（P0-2）。

---

## P0-1: Ask 查询知识图谱作为检索上下文

### 现状
AskAgent._answer() 仅将邮件 chunks 作为 evidence 注入 LLM，完全不查询知识库。
知识图谱中已沉淀的结构化知识对 Ask 不可见。

### 方案
在 Ask 流程中增加知识图谱检索步骤：

1. **KnowledgeStore 新增 `search_entities()` 方法**
   - 输入：question text
   - 输出：匹配的 KnowledgeEntity 列表（按 ILIKE 匹配 canonical_name / aliases / summary）
   - 位置：`src/storage/knowledge_store.py`

2. **AskAgent 接受可选 `knowledge_store` 参数**
   - 构造函数新增 `knowledge_store: Optional[KnowledgeStore] = None`
   - 位置：`src/qa/ask_agent.py`

3. **AskAgent.ask() 在检索后、回答前查询知识图谱**
   - 用 question 和 plan 中的 keyword_queries 搜索知识实体
   - 将匹配的知识注入 `_answer()` 的 evidence 上下文
   - 在 `ANSWER_USER_TEMPLATE` 中新增 `{knowledge_context}` 段

4. **server.py 初始化时注入 `_knowledge_store`**
   - 将 `_knowledge_store` 传给 `AskAgent(...)`

### 改动文件
- `src/storage/knowledge_store.py` — 新增 `search_entities()` 
- `src/qa/ask_agent.py` — 注入 knowledge_store，新增知识检索步骤
- `src/api/server.py` — 初始化时传入 knowledge_store

---

## P0-2: 邮件 → 知识实体反向引用

### 现状
从邮件可以创建知识实体（通过证据），但查看邮件时看不到「哪些知识实体引用了这封邮件」。
KnowledgeEvidenceORM 有 message_id 字段，但没有反向查询 API。

### 方案

1. **KnowledgeStore 新增 `find_entities_by_message_id()` 方法**
   - 输入：message_id
   - 输出：引用此 message_id 的 KnowledgeEntity 列表
   - 通过 JOIN KnowledgeEvidenceORM.message_id 查询
   - 位置：`src/storage/knowledge_store.py`

2. **server.py 新增 API 端点**
   - `GET /api/knowledge/entities/by-message/{message_id}`
   - 返回引用该邮件的知识实体列表
   - 位置：`src/api/server.py`

3. **ThreadDrawer.tsx 展示反向引用**
   - 在邮件详情区新增 "Referenced by Knowledge" 区块
   - 调用 API 获取引用该邮件的知识实体
   - 点击实体名称跳转到 KnowledgePage 定位该实体
   - 位置：`web/src/components/ThreadDrawer.tsx`

4. **API Client 新增 `getEntitiesByMessageId()`**
   - 位置：`web/src/api/client.ts`

### 改动文件
- `src/storage/knowledge_store.py` — 新增 `find_entities_by_message_id()`
- `src/api/server.py` — 新增 `/api/knowledge/entities/by-message/{message_id}` 端点
- `web/src/api/client.ts` — 新增 `getEntitiesByMessageId()`
- `web/src/api/types.ts` — 如需要，新增类型
- `web/src/components/ThreadDrawer.tsx` — 新增反向引用展示区块

---

## 实施顺序

1. P0-1 KnowledgeStore.search_entities() 
2. P0-1 AskAgent 集成 + 知识上下文注入
3. P0-1 server.py 注入 knowledge_store
4. P0-2 KnowledgeStore.find_entities_by_message_id()
5. P0-2 API 端点 + Client
6. P0-2 ThreadDrawer 反向引用 UI
7. 构建验证
