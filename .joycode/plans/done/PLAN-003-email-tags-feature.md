# PLAN-003: 邮件标签功能实现

## 任务概览

为邮件系统添加标签功能，支持手动打标 + AI 建议、父子层级标签、标签筛选和 RAG 过滤。

## 需求规格

- **标签来源**：手动打标 + AI 建议
- **标签层级**：支持父子标签（树形结构）
- **数量限制**：单封邮件最多 16 个标签

---

## 实现步骤

### Phase 1: 数据模型设计

#### 1.1 Tag 表（标签管理）
- [x] 在 `src/storage/models.py` 添加 `TagORM` 类
- [x] 字段：id, name, parent_id(自关联), color, created_at
- [x] 添加索引：name 唯一约束

#### 1.2 EmailORM 扩展
- [x] 在 `src/storage/models.py` 的 `EmailORM` 添加 `tags` 字段
- [x] 类型：`ARRAY(String)` PostgreSQL
- [x] 标签值存储为 tag name（非 id，便于检索）

#### 1.3 更新数据库迁移
- [x] 添加 `tags` 表（通过 ORM 自动创建）
- [x] 为 `emails` 表添加 `tags` 列（通过 ORM 自动创建）

---

### Phase 2: 存储层实现

#### 2.1 Tag 存储
- [x] 新建 `src/storage/tag_store.py`
- [x] 实现 `TagStore` 类：
  - `create_tag(name, parent_id, color)` - 创建标签
  - `get_tag_tree()` - 获取标签树
  - `delete_tag(tag_id)` - 删除标签
  - `get_or_create_tag(name, parent_id)` - 获取或创建

#### 2.2 邮件标签管理
- [x] 在 `PostgresStorage` 添加方法：
  - `get_email_tags(message_id)` - 获取邮件标签
  - `add_email_tag(message_id, tag_name)` - 添加标签（检查上限 16）
  - `remove_email_tag(message_id, tag_name)` - 删除标签
  - `get_all_tags_with_count()` - 获取所有标签及邮件数

---

### Phase 3: 检索层增强

#### 3.1 SearchQuery 扩展
- [x] 在 `src/retriever/base.py` 的 `SearchQuery` 添加：
  ```python
  tags: Optional[list[str]] = None      # 标签列表
  tag_mode: str = "any"                 # "any" 或 "all"
  ```

#### 3.2 关键词检索支持
- [x] 在 `src/retriever/keyword.py` 的查询中添加：
  - `tags` 过滤条件（contains/overlap）
  - `tag_mode` 逻辑（ANY 或 ALL）

#### 3.3 语义检索支持
- [x] 在 `src/retriever/semantic.py` 添加 `tags` 过滤（骨架预留）

---

### Phase 4: API 层实现

#### 4.1 标签管理接口
- [x] `POST /api/tags` - 创建标签
  - Body: `{ "name": str, "parent_id": int?, "color": str? }`
  - 返回: `{ "id": int, "name": str, ... }`

- [x] `GET /api/tags` - 获取标签树
  - 返回: `[{ "id": int, "name": str, "children": [...] }]`

- [x] `DELETE /api/tags/{tag_id}` - 删除标签
  - 级联删除所有子标签

- [x] `GET /api/tags/stats` - 获取标签统计
  - 返回: `[{ "name": str, "count": int }]`

#### 4.2 邮件标签接口
- [x] `GET /api/email/{id}/tags` - 获取邮件标签

- [x] `POST /api/email/{id}/tags` - 添加标签
  - Body: `{ "tag_name": str }`
  - 检查上限 16 个

- [x] `DELETE /api/email/{id}/tags/{tag_name}` - 删除标签

#### 4.3 搜索/问答接口扩展
- [x] `GET /api/search` 新增参数：
  - `tags`: 逗号分隔的标签列表
  - `tag_mode`: "any"（任一匹配）或 "all"（全部匹配）

- [x] `GET /api/ask` 新增参数：
  - `tags`: 逗号分隔的标签列表

---

### Phase 5: RAG 增强

#### 5.1 RagQA 支持标签过滤
- [x] 更新 `src/qa/base.py` 的 `BaseQA.ask()` 签名
- [x] 更新 `src/qa/rag_qa.py` 将 `tags` 传递给 `SearchQuery`

---

### Phase 6: 前端实现

#### 6.1 标签筛选组件
- [x] `web/src/components/TagFilter.tsx`
  - 标签筛选（支持 any/all 模式）
  - 展示标签使用数量

#### 6.2 搜索页增强
- [x] `web/src/pages/SearchPage.tsx`
  - 标签筛选器集成
  - 结果展示标签 pill
  - 热门标签快捷筛选

#### 6.3 问答页增强
- [x] `web/src/pages/AskPage.tsx`
  - 标签过滤下拉/选择器
  - 热门标签快捷筛选

#### 6.4 API 客户端更新
- [x] `web/src/api/client.ts`
  - 添加 `getTagTree`, `getTagStats`, `createTag`, `deleteTag`
  - 添加 `getEmailTags`, `addEmailTag`, `removeEmailTag`
  - 更新 `searchEmails`, `askQuestion` 函数签名

---

### Phase 7: AI 标签建议（后续扩展）

#### 7.1 标签建议接口
- [ ] `GET /api/ask-tags?message_id={id}` - AI 推荐标签
- [ ] 使用 LLM 分析邮件内容，返回可能的相关标签

---

## 数据库变更

```sql
-- 创建 tags 表
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    color VARCHAR(7) DEFAULT '#6366f1',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX ix_tags_parent_id ON tags(parent_id);

-- 为 emails 表添加 tags 列
ALTER TABLE emails ADD COLUMN tags TEXT[];
CREATE INDEX ix_emails_tags ON emails USING GIN(tags);
```

---

## 目录结构变更

```
src/storage/
├── models.py           # 新增 TagORM, TagCreate, TagRead, TagTree
├── postgres.py          # 新增标签相关方法
└── tag_store.py         # 新增 TagStore 类

src/api/server.py        # 新增标签管理路由

web/src/
├── components/
│   └── TagFilter.tsx    # 新增
├── pages/
│   ├── SearchPage.tsx  # 更新
│   └── AskPage.tsx     # 更新
└── api/
    ├── client.ts       # 更新
    └── types.ts        # 更新
```

---

## 验证计划

1. **单元测试**
   - Tag CRUD 操作
   - 标签数量限制验证
   - 层级标签删除级联

2. **集成测试**
   - API 接口测试
   - 搜索过滤测试
   - RAG 标签过滤测试

3. **手动验证**
   - 前端标签管理
   - 搜索结果筛选
   - RAG 问答标签过滤
