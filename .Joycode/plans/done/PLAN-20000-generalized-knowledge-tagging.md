# PLAN-20000: 通用知识标签系统重构

## Summary
当前 `tags` 设计只适用于 `emails.tags text[]`，不适合做内核知识库的统一标签底座。更好的方案是拆成三层：

1. `Tag`：知识标签本体，带层级、定义、别名、状态。
2. `TaggableTarget`：任何可被打标的对象，用统一的 `target_type + target_ref + anchor` 表示。
3. `TagAssignment`：标签和目标之间的绑定关系，承载来源、证据、创建者等上下文。

第一版支持：邮件线程、单封邮件、邮件段落、代码行范围、邮件/代码批注，并允许重建当前 tag 相关数据库结构。

## Current Status
- 已实现统一 `tags`、`tag_aliases`、`tag_assignments` 模型。
- 已实现 thread/message/paragraph/kernel line range/annotation/knowledge entity 的统一 target 打标。
- 已实现搜索按 tag 过滤、Thread/Code/Annotation/Knowledge 页面标签编辑。
- Ask/Search 草稿可建议 tag assignment；缺失 tag 默认取消选中并在保存时拒绝自动创建，避免污染全局 taxonomy。

## Key Changes
### 1. 统一数据模型
- `tags`
  - `slug`, `name`, `description`, `color`
  - `status`, `tag_kind`, `created_by`, `updated_by`
  - `parent_tag_id`
- `tag_aliases`
  - 一个 tag 可有多个别名
- `tag_assignments`
  - `assignment_id`
  - `tag_id`
  - `target_type`
  - `target_ref`
  - `anchor`
  - `anchor_hash`
  - `assignment_scope`
  - `source_type`
  - `evidence`
  - `created_by`, `created_at`

### 2. 统一目标标识规范
- `email_thread`
  - `target_ref = thread_id`
- `email_message`
  - `target_ref = message_id`
- `email_paragraph`
  - `target_ref = message_id`
  - `anchor = { paragraph_index, paragraph_hash }`
- `kernel_line_range`
  - `target_ref = "{version}:{file_path}"`
  - `anchor = { start_line, end_line }`
- `annotation`
  - `target_ref = annotation_id`

### 3. 标签继承与聚合规则
- 线程视图聚合其下 message / paragraph / annotation 标签
- 邮件视图聚合 paragraph / annotation 标签
- 代码文件视图聚合 line-range 标签
- 第一版不做异步物化继承写回，只做查询时聚合

### 4. 后端接口重构
- `POST /api/tags`
- `GET /api/tags`
- `PATCH /api/tags/{tag_id}`
- `POST /api/tag-assignments`
- `GET /api/tag-assignments`
- `DELETE /api/tag-assignments/{assignment_id}`
- `GET /api/tag-targets`
- `GET /api/tag-summary`
- `GET /api/tag-targets/{target_type}/{target_ref}/tags`

兼容层：
- 现有邮件搜索 `tags` / `tag_mode` 保留
- `/api/email/{message_id}/tags` 保留为兼容包装层

### 5. 检索与知识库集成
- 搜索过滤统一走 `tag_assignments`
- 邮件搜索可命中 message/thread/paragraph/annotation 标签
- 线程详情、代码页、批注节点接入统一标签编辑

## Test Plan
- 创建 tag、子 tag、别名，校验唯一性
- 同一 target 重复绑定同一 tag 不生成重复 assignment
- 重建数据库后初始化成功
- 对 thread / message / paragraph / kernel_line_range / annotation 各创建至少 1 条 assignment
- 邮件搜索 `tags=...&tag_mode=any/all` 正常
- 线程页、代码页能查看并编辑 direct / aggregated tags

## Assumptions
- 第一版允许重建 tag 相关表
- 第一版采用分层知识本体，不做完全自由标签
- 第一版不引入关系图谱表
- 第一版默认单用户、可信内部环境
