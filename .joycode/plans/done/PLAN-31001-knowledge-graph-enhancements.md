> **Status**: done (Phase 1 + 2 + 3 + 4 + 5 全部落地，2026-05-06)
> **Updated**: 2026-05-06
> **Depends-on**: PLAN-31000 (done), PLAN-30002 (external code links — Phase 1 done)
> **Priority**: P1

# PLAN-31001: 知识图谱功能增强

## Summary
当前 PLAN-31000 Phase 1 已完成知识实体和关系的 CRUD 基础能力（实体类型/生命周期/关系类型、AI 草稿生成、证据追踪、标注和标签），但在功能完整性、图谱化体验、领域特性等方面仍有提升空间。本计划整理改进建议，按优先级分为三个层级。

---

## 高优先级：核心功能缺口

### 1. 实体删除 ✅
- **状态**: 已完成
- `KnowledgeStore.delete_entity(entity_id, force)` 检查关联关系，`force=false` 阻止删除并返回引用列表；`force=true` 级联清理。
- `DELETE /api/knowledge/entities/{entity_id}` 路由需 admin/editor。
- 前端 `KnowledgePage` 详情侧边栏 "Delete entity" 按钮 + 二次确认弹窗，存在关系时提供 "Force delete"。

### 2. 图谱可视化 ✅
- **状态**: 已完成
- [`KnowledgeGraphView`](web/src/components/KnowledgeGraphView.tsx:1) 使用 d3-force 渲染力导向图。
- 节点按 `entity_type` 着色，边标注 `relation_type`，点击节点导航，中心节点高亮。
- 详情页右上角 "List / Graph" 视图切换按钮，Graph 视图带邻域深度选择（1/2/3 跳）。

### 3. 图谱遍历 API ✅
- **状态**: 已完成
- `GET /api/knowledge/entities/{entity_id}/graph?depth=N&relation_type=...` 返回 `{ nodes, edges, center, depth }`。
- 前端 `getKnowledgeGraph(entityId, depth, relationType?)` 对应调用。

### 4. 内核版本关联 ✅
- **状态**: 已完成 (Phase 2)
- 标准化 `meta.kernel_versions: Array<{ version, relationship, note? }>`，不需要 schema 迁移。
- 新关系类型：`introduced_in` / `removed_in` / `affects_version` 加入 `RELATION_TYPES`。
- 详情页 "Kernel references" 区展示版本时间线，支持增删条目；关系标签：`introduced / last_seen / removed / affected / fixed / note`。

### 5. 文件/符号链接 ✅
- **状态**: 已完成 (Phase 2)
- 标准化 `meta.source_files: string[]` 与 `meta.symbols: string[]`。
- 文件条目通过 `pickKernelSourceUrl` 自动选择 Elixir / git.kernel.org；符号走 `elixirIdentUrl`，一键跳外链。
- "Primary version" 取第一个 `introduced` 条目或首条版本，fallback `latest`。
- 组件：[`KnowledgeEntityMetaPanel.tsx`](web/src/components/KnowledgeEntityMetaPanel.tsx:1)，工具：[`knowledgeMeta.ts`](web/src/utils/knowledgeMeta.ts:1)。
- 反向发现（"哪些实体引用了这个文件？"）未做，留待后续。

---

## 中优先级：用户体验与数据质量

### 6. 导入 / 导出
- **现状**: 无备份或外部导入能力。
- **方案**:
  - `POST /api/knowledge/export`: 导出为 JSON（实体 + 关系），支持按 `entity_type` / `status` 筛选。
  - `POST /api/knowledge/import`: 接收 JSON，支持 `upsert` 策略（按 `entity_id` 匹配，不存在则创建，存在则更新）。

### 7. 概览仪表板 / 统计
- **现状**: 无全局视角。
- **方案**:
  - `GET /api/knowledge/stats`: 返回按类型/状态的实体计数、关系总数、最近更新列表。
  - 在知识页面空状态或顶部添加统计卡片行。

### 8. 关联建议 / 去重提示
- **现状**: 创建实体时不检查是否已存在相似实体。
- **方案**:
  - 在 `POST /api/knowledge/entities` 创建前，用 `canonical_name` 和 `aliases` 做模糊匹配（`difflib` 或 ILIKE 相似度），返回可能重复的实体列表。
  - 创建实体 API 响应中添加 `suggestions.dedup` 和 `suggestions.related` 字段。
  - 前端展示"可能重复"和"建议关联"提示，用户可选择忽略或跳转。

### 9. 关系方向切换
- **现状**: 前端创建关系时，当前实体只能作为 `source`。要创建 incoming 关系必须导航到另一个实体。
- **方案**:
  - 关系创建表单添加方向切换按钮：`当前实体 → 目标实体` / `目标实体 → 当前实体`。
  - 根据方向自动调整 `source_entity_id` 和 `target_entity_id`。

### 10. 全文搜索升级
- **现状**: 仅 ILIKE 模糊搜索，无全文索引。
- **方案**:
  - 添加 PostgreSQL `tsvector` 列，对 `canonical_name`、`summary`、`description` 建立全文索引。
  - API 搜索参数添加 `search_mode: "simple" | "fulltext"`。
  - 可选：利用项目已有的 embedding 能力做语义搜索。

---

## 低优先级：增强与完善

### 11. 变更历史 / 审计日志
- **现状**: `updated_at` 只记录最后修改时间，无变更追踪。
- **方案**:
  - 添加 `knowledge_entity_versions` 表，在每次 update 时写入变更快照（diff 或完整快照）。
  - 实体详情面板添加"变更历史"折叠区域，展示时间线。

### 12. 实体合并
- **现状**: 重复实体无法合并。
- **方案**:
  - `POST /api/knowledge/entities/merge`: 接收 `source_entity_id` + `target_entity_id`，将源的关系/标注重新指向目标，追加别名，然后删除源。

### 13. 反向引用展示
- **现状**: 查看邮件时看不到哪些知识实体引用了它。证据链接单向（实体 → 邮件）。
- **方案**:
  - 在 ThreadDrawer 或邮件详情面板添加"Referenced by knowledge"区域，查询 `meta.ask.sources` 中包含当前 `message_id` 或 `thread_id` 的实体。

### 14. 关系类型过滤
- **现状**: `list_relations` 返回所有关系，不支持按 `relation_type` 过滤。
- **方案**:
  - API 添加 `relation_type` 查询参数（支持逗号分隔的多值）。

### 15. 列表分页
- **现状**: 前端硬编码 `page_size: 100`。
- **方案**:
  - 侧边栏添加"加载更多"按钮或无限滚动，API 分页参数正确传递。

---

## 实施顺序建议

| 阶段 | 功能 | 理由 | 状态 |
|------|------|------|------|
| Phase 1 | 实体删除 + 图谱遍历 API + 图谱可视化 | CRUD 完整性 + 让知识图谱名副其实 | ✅ 完成 |
| Phase 2 | 内核版本关联 + 文件/符号链接 | 领域核心需求，连接知识与代码 | ✅ 完成 |
| Phase 3 | 概览仪表板 + 关联建议 + 全文搜索 | 规模化使用体验 | ✅ 完成 |
| Phase 4 | 导入/导出 + 实体合并 + 变更历史 | 数据治理与长期维护 | ✅ 完成 |
| Phase 5 | 反向引用 + 关系方向切换 + 分页 + 关系类型过滤 | 细节打磨 | ✅ 完成 |

---

## 实现摘要（2026-05-06 补齐 Phase 3/4/5 剩余项）

### 后端

- **全文搜索 (Phase 3)**
  - [`KnowledgeEntityORM`](src/storage/models.py:354) 新增 `search_vector TSVECTOR` 列 + `ix_knowledge_entities_search_vector` GIN 索引
  - [`PostgresStorage._ensure_knowledge_search_vector()`](src/storage/postgres.py:150) 在 `init_db` 幂等地补齐列、索引、触发器、首次回填
  - 触发器把 `canonical_name`(A) / aliases(B) / summary(C) / description(D) 四档权重合并
  - [`KnowledgeStore.list_entities(search_mode=)`](src/storage/knowledge_store.py:201) 支持 `simple` (ILIKE) 和 `fulltext` (pgvector tsquery + ts_rank) 两种模式
  - `GET /api/knowledge/entities?search_mode=fulltext` 新增参数
- **变更历史 (Phase 4)**
  - 新增表 [`KnowledgeEntityVersionORM`](src/storage/models.py:389) (`knowledge_entity_versions`)，`(entity_id, version)` 唯一约束
  - [`KnowledgeStore.update()`](src/storage/knowledge_store.py:167) 在实际内容变更时先写入旧值快照，`version` 单调递增
  - 新增 [`list_entity_versions()`](src/storage/knowledge_store.py:955) + `GET /api/knowledge/entities/{id}/versions`
- **导入 / 导出 (Phase 4)**
  - [`export_all()`](src/storage/knowledge_store.py:975) 导出可序列化 dict，包含 schema_version / entities / relations，只导出两端都在选中集内的关系以保持一致性
  - [`import_bulk()`](src/storage/knowledge_store.py:1040) 支持 `upsert` / `skip` 两种策略，完整 summary（created / updated / skipped / errors）
  - `GET /api/knowledge/export` (admin/editor), `POST /api/knowledge/import` (admin)
- **关系改进 (Phase 5)**
  - [`list_relations(relation_types=)`](src/storage/knowledge_store.py:823) 支持类型白名单
  - `GET /api/knowledge/entities/{id}/relations?relation_type=foo,bar` 透传过滤

### 前端

- **列表分页 + 全文模式切换 (Phase 3 + Phase 5)**
  - [`EntityListPanel`](web/src/components/knowledge/EntityListPanel.tsx) 新增 `total` / `searchMode` / `onLoadMore` / `onSearchModeChange` props
  - Simple / Full-text 模式切换 chip；分页按钮 "Load more (N remaining)"
  - [`KnowledgePage.loadEntities({ append, page })`](web/src/pages/KnowledgePage.tsx:125) 支持累加，默认 `page_size=50` 从原来硬编码的 100 改为动态
- **变更历史面板 (Phase 4)**
  - 新增 [`EntityHistoryPanel`](web/src/components/knowledge/EntityHistoryPanel.tsx)，按 version 降序展示快照，可展开对比
  - 集成到详情页底部，跟随 `selectedEntityId` 自动刷新
- **反向引用 (Phase 5)**
  - [`KnowledgeBackRefs`](web/src/components/KnowledgeBackRefs.tsx) 已在 `TreeEmailCard` / `LayeredEmailCard` 集成
  - 修复跳转链接从 `?entity=` → `?entity_id=`（与 KnowledgePage 的 searchParams 对齐）
- **关系方向切换 (Phase 5)**
  - [`RelationForm.direction`](web/src/components/knowledge/EntityRelationsPanel.tsx:13) 新增 `outgoing` / `incoming` 选项
  - [`handleCreateRelation`](web/src/pages/KnowledgePage.tsx:495) 按 direction 动态决定 source / target
- **导入 / 导出按钮 (Phase 4, admin only)**
  - EntityListPanel header 右上角新增 Export / Import 小按钮，仅 `isAdmin` 可见
  - Export 下载 `knowledge-export-<timestamp>.json`
  - Import 打开文件选择器 → `importKnowledge()` → 展示 summary toast

### 测试

- [`tests/test_knowledge_enhancements.py`](tests/test_knowledge_enhancements.py) — 15 cases：
  - `KnowledgeEntityVersionORM` 表名/列名/唯一约束
  - `KnowledgeEntityVersionRead` Pydantic 默认值
  - `KnowledgeEntityORM.search_vector` 列 + GIN 索引存在
  - `KnowledgeImportRequest` strategy 校验（upsert / skip / 非法）
  - `normalize_slug` 5 个边界用例
- 完整套件：`pytest tests/` — **128 passed**（原 113 + 新增 15）
- 前端：`tsc --noEmit` — 0 errors

### 未做（保持技术债挂起）

- 反向发现（"哪些实体引用了这个文件？"）—— 需对 meta.source_files 做反向索引，PLAN-30002 Phase 3+5 可能会涉及
- 导入时 evidence / drafts / versions 不随 entity/relation 一起导出，需要时可按 entity_id 二次拉取

## 风险与约束
- 图谱可视化（D3.js/cytoscape.js）引入新前端依赖，需评估包大小和性能。
- 实体删除的级联策略需与用户确认——阻止删除（安全）vs 级联删除（方便但危险）。
- 全文搜索需要 PostgreSQL 的 `tsvector` 支持，中文分词可能需要 `zhparser` 扩展或应用层分词。
- 导入/导出的 JSON 格式需向后兼容，随字段增加需版本化。
