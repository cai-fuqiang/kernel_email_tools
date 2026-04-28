# PLAN-31001: 知识图谱功能增强

## Summary
当前 PLAN-31000 Phase 1 已完成知识实体和关系的 CRUD 基础能力（实体类型/生命周期/关系类型、AI 草稿生成、证据追踪、标注和标签），但在功能完整性、图谱化体验、领域特性等方面仍有提升空间。本计划整理改进建议，按优先级分为三个层级。

---

## 高优先级：核心功能缺口

### 1. 实体删除
- **现状**: `KnowledgeStore` 无 `delete_entity()`，API 无 `DELETE /api/knowledge/entities/{entity_id}`。关系可删，实体不行。
- **方案**:
  - `knowledge_store.py`: 添加 `delete_entity()`，删除前检查是否被关联引用；若被引用则阻止删除并返回引用者列表，或级联删除所有关联关系。
  - `server.py`: 添加 `DELETE /api/knowledge/entities/{entity_id}` 路由，需 `admin` 或 `editor` 权限。
  - `KnowledgePage.tsx`: 实体详情面板添加删除按钮，含二次确认对话框。

### 2. 图谱可视化
- **现状**: 关系以两栏平铺列表展示（outgoing / incoming），不是真正的图。随着关系增多，列表难以理解结构。
- **方案**:
  - 新增 `KnowledgeGraphView` 组件，用 D3.js / cytoscape.js 渲染力导向图。
  - 展示选中实体及其邻域（1-2 跳），节点按 `entity_type` 着色，边按 `relation_type` 标注。
  - 节点可点击导航、悬停预览 summary。
  - 在关系区域顶部添加"列表视图 / 图谱视图"切换按钮。

### 3. 图谱遍历 API
- **现状**: `/api/knowledge/entities/{entity_id}/relations` 仅返回直连关系，无多跳查询。
- **方案**:
  - 添加 `GET /api/knowledge/entities/{entity_id}/graph?depth=2`，返回 BFS 遍历的邻域子图：
    ```json
    {
      "nodes": [/* KnowledgeEntityRead 列表 */],
      "edges": [/* KnowledgeRelationRead 列表 */],
      "center": "<entity_id>",
      "depth": 2
    }
    ```
  - `depth` 参数控制遍历深度（默认 2，最大 3）。
  - 可选 `relation_type` 过滤参数，只遍历指定类型的关系。

### 4. 内核版本关联
- **现状**: 实体与内核版本无关联。不知道一个概念在哪个版本引入、一个 bug 影响哪些版本。
- **方案**:
  - 在实体的 `meta` 中标准化 `kernel_versions` 字段：
    ```json
    {
      "kernel_versions": [
        { "version": "v2.6.23", "relationship": "introduced" },
        { "version": "v2.6.35", "relationship": "last_seen" }
      ]
    }
    ```
  - 新增关系类型 `introduced_in` / `removed_in` / `affects_version`，target 为版本号字符串（可链接到代码预览）。
  - 实体详情面板展示版本时间线。

### 5. 文件/符号链接
- **现状**: 实体未与内核源码文件或符号关联。
- **方案**:
  - 在实体的 `meta` 中标准化 `source_files` 和 `symbols` 字段：
    ```json
    {
      "source_files": ["kernel/sched/core.c", "include/linux/sched.h"],
      "symbols": ["schedule()", "struct task_struct"]
    }
    ```
  - 文件和符号渲染为可点击链接，直接打开代码预览页面。
  - 支持通过代码浏览页反向发现关联的知识实体（"哪些实体引用了这个文件？"）。

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

| 阶段 | 功能 | 理由 |
|------|------|------|
| Phase 1 | 实体删除 + 图谱遍历 API + 图谱可视化 | CRUD 完整性 + 让知识图谱名副其实 |
| Phase 2 | 内核版本关联 + 文件/符号链接 | 领域核心需求，连接知识与代码 |
| Phase 3 | 概览仪表板 + 关联建议 + 全文搜索 | 规模化使用体验 |
| Phase 4 | 导入/导出 + 实体合并 + 变更历史 | 数据治理与长期维护 |
| Phase 5 | 反向引用 + 关系方向切换 + 分页 | 细节打磨 |

---

## 风险与约束
- 图谱可视化（D3.js/cytoscape.js）引入新前端依赖，需评估包大小和性能。
- 实体删除的级联策略需与用户确认——阻止删除（安全）vs 级联删除（方便但危险）。
- 全文搜索需要 PostgreSQL 的 `tsvector` 支持，中文分词可能需要 `zhparser` 扩展或应用层分词。
- 导入/导出的 JSON 格式需向后兼容，随字段增加需版本化。
