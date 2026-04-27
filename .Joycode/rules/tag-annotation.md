# Tag & Annotation 模块 — 设计模式与约束

## 设计原则

**标签是全局 taxonomy。** 标签名称代表领域分类体系，AI 可以建议但默认不自动创建（防近义词、层级不一致污染）。

**批注是附着于目标的评论。** 统一 target + anchor 模式支持邮件线程、内核文件、手册页、知识实体等多种目标类型。

## 数据模型

### 标签三表结构
- `tags` — 本体：slug/name（唯一）、层级（parent_tag_id→self FK）、tag_kind、visibility、status
- `tag_aliases` — 别名：别名名（唯一）
- `tag_assignments` — 绑定：(tag_id, target_type, target_ref, anchor_hash) 联合唯一

### 批注统一表
- `annotations` — `annotation_id` 为外部标识（UUID 前缀），`target_type`+`target_ref`+`anchor` 为通用定位
- 工作流：`private` → request → `pending` → admin approve/reject → `public`
- 发布审核状态：`none` | `pending` | `approved` | `rejected`

## API 模式

### 标签路由
- `GET /api/tags` (+`?flat=true`) — 树形或平铺标签列表
- `POST /api/tags` — 创建（需 admin/editor）
- `PATCH /api/tags/{id}` — 更新（admin 或创建者）
- `DELETE /api/tags/{id}` — 级联删除子标签和绑定
- `POST /api/tag-assignments` — 创建绑定（upsert on conflict）
- `GET /api/tag-targets/{type}/{ref:path}/tags` — 获取目标的 tag bundle

### 批注路由
- `GET /api/annotations` — 列表+搜索（支持 q/type/target/publish_status 过滤）
- `GET /api/annotations/stats` — 各类型批注全库计数
- `POST /api/annotations` — 创建（admin 可设为 public）
- `POST /api/annotations/{id}/publish-request` — 申请公开
- `POST /api/annotations/{id}/publish-withdraw` — 撤回申请
- `POST /api/admin/annotations/{id}/approve-publication` — 管理员审批通过
- `POST /api/admin/annotations/{id}/reject-publication` — 管理员驳回

## 前端组件

### Tag 相关
- `TagManager.tsx` — 标签管理页（创建、删除、查看 targets）
- `TagFilter.tsx` — 搜索页标签筛选（any/all 模式，最多 12 个）
- `EmailTagEditor.tsx` — 行内标签编辑（显示 direct/aggregated 标签，+添加弹窗）

### Annotation 相关
- `AnnotationTree.tsx` — 树形批注列表（折叠、跳转定位、发布操作）
- `AnnotationCard.tsx` — 单条批注卡片（编辑/删除/回复/审批按钮）
- `AnnotationActions.tsx` — 共享操作按钮（编辑/删除/回复/preview）
- `ThreadDrawer.tsx` — 线程阅读中内嵌批注（内部 `AnnotationCard`）

## 关键约束

- 标签草稿只允许绑定已有 tag，不自动创建新 tag（`POST /api/search/summarize/draft/apply` 中检查）
- 批注的 `in_reply_to` 可能是 `annotation_id` 也可能是 `message_id`，查询时需注意
- `_resolve_tag` 找不到 tag 时返回 None（不静默创建），调用方需显式处理
- Tag tree 每次 API 调用完整拉取，在前端解析为树结构；`get_targets_by_tag` 使用批量查询
- 前端 ConfirmModal + Toast 替代原生弹窗，但 ThreadDrawer 内部 AnnotationCard 暂保留 `window.prompt`
- `TagBundle.inherited_tags` 字段已移除（从未实现，死代码）

## 存储层

- `TagStore` — 标签 CRUD、绑定管理、target bundle（direct + aggregated）
- `UnifiedAnnotationStore` (alias `AnnotationStore`) — 统一批注存储（email/code/sdm_spec）
- 聚合逻辑：thread → 继承 message/paragraph/annotation 的标签；message → 继承 paragraph/annotation 的标签
