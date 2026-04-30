# PLAN-301: 邮件批注（本地回复）功能

## 概述
在 thread 视图中支持对邮件做"本地批注/回复"。批注不是真正发送的邮件，而是用户本地创建的评论，混合显示在线程树中，持久化存储到 PostgreSQL。

## TODO: 后端 — 数据模型 & 存储层
- [ ] `src/storage/models.py` 新增 `AnnotationORM` 模型
  - `id`: 主键
  - `annotation_id`: 唯一标识（UUID）
  - `thread_id`: 所属线程 ID
  - `in_reply_to`: 回复的目标 message_id（关联原邮件或另一条批注）
  - `author`: 批注作者（本地用户名，默认从 config 读取）
  - `body`: 批注正文（Markdown）
  - `created_at`: 创建时间
  - `updated_at`: 更新时间
  - 表名: `annotations`，索引: thread_id, in_reply_to
- [ ] `src/storage/models.py` 新增 `AnnotationCreate` / `AnnotationRead` Pydantic 模型
- [ ] `src/storage/annotation_store.py` 新增 `AnnotationStore` 类
  - `create(annotation: AnnotationCreate) -> AnnotationRead`
  - `list_by_thread(thread_id: str) -> list[AnnotationRead]`
  - `update(annotation_id: str, body: str) -> AnnotationRead`
  - `delete(annotation_id: str) -> bool`
  - 遵循 session_factory 模式（请求级 session）

## TODO: 后端 — API 接口
- [ ] `POST /api/annotations` — 创建批注（body: thread_id, in_reply_to, body, author?）
- [ ] `GET /api/annotations/{thread_id}` — 获取线程所有批注
- [ ] `PUT /api/annotations/{annotation_id}` — 编辑批注
- [ ] `DELETE /api/annotations/{annotation_id}` — 删除批注
- [ ] `GET /api/thread/{thread_id}` 扩展返回 `annotations` 字段，前端可直接合并渲染
- [ ] `POST /api/annotations/export` — 导出批注为 JSON（可选，满足 git 固化需求）

## TODO: 前端 — 类型 & API 客户端
- [ ] `web/src/api/types.ts` 新增 `Annotation` / `AnnotationCreate` 类型
- [ ] `web/src/api/types.ts` 扩展 `ThreadResponse` 增加 `annotations` 字段
- [ ] `web/src/api/client.ts` 新增批注 CRUD API 函数

## TODO: 前端 — ThreadDrawer 集成
- [ ] `ThreadDrawer.tsx` 修改 `buildThreadTree` 将批注节点混入线程树
  - 批注节点用特殊样式（如左侧蓝色边框 + "我的批注" 标签）区分
- [ ] 每封邮件下方添加"添加批注"按钮（轻量入口）
- [ ] 批注输入区（Markdown 输入框 + 提交/取消按钮）
- [ ] 批注展示区（支持编辑/删除，带视觉区分）
- [ ] 批注支持 Markdown 渲染（可选，react-markdown）

## TODO: 配置 & 初始化
- [ ] `config/settings.yaml` 添加 `annotations.default_author` 配置项
- [ ] `src/api/server.py` lifespan 中初始化 `AnnotationStore`
- [ ] DB 迁移：创建 `annotations` 表

## TODO: 验证 & 测试
- [ ] 端到端验证：创建批注 → 线程中显示 → 编辑 → 删除
- [ ] 验证批注正确嵌套到线程树中（回复邮件 / 回复批注）