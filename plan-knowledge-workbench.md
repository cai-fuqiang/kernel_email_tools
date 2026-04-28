# Knowledge Workbench 后续计划

## Summary
- 目标是把知识库从“实体管理页面”升级为“内核知识沉淀工作台”。
- Ask、Search、Thread 阅读产生的是候选材料；Knowledge 负责承载经过人工确认、可复用、可追溯的结论。
- 当前阶段先改善页面可理解性：左侧浏览知识项，右侧编辑解释、查看来源邮件、记录人工笔记。
- 后续重点是让 Ask 结果、邮件证据、人工 annotation、tag 形成稳定闭环。

## Implemented So Far
- Knowledge 页面已经改为工作台式布局，按“解释、来源邮件、人工笔记”组织。
- Ask 和 Search 的草稿审核已共享同一个 `DraftReviewPanel`：
  - 保存前展示 knowledge、notes、tags、sources 的数量。
  - 支持批量选择/取消选择。
  - 支持编辑知识草稿、人工笔记草稿和 tag assignment 草稿。
  - 缺失 tag 默认不可保存，避免 AI 自动创建未审核标签。
  - 保存后提供跳转到新 Knowledge item 的入口。
- 这些改动仍是前端临时审核流，草稿还没有持久化到数据库。

## Current Problems
- 页面术语过多：entity、annotation、meta、id 等内部概念直接暴露，用户难以判断下一步该做什么。
- 信息层级不清：摘要、详情、来源邮件、人工笔记、标签都在同一视觉层级，缺少“先看结论，再看证据”的阅读路径。
- Ask 到 Knowledge 的流转还不够强：Ask 可以生成草稿，但缺少统一的审核入口、重复实体处理、证据完整性提示。
- 证据不是一等模型：目前来源主要保存在 `meta.ask` 中，能用，但后续难以做证据质量、覆盖率、引用复用和审计。
- 知识项之间缺少关系：内核知识经常是机制、子系统、历史问题、patch discussion 互相解释，单个实体不足以组织复杂主题。

## Product Model
- Ask Agent：负责从邮件中找证据、生成临时回答和候选草稿。
- Knowledge Workbench：负责人工确认、归纳、编辑、去重、建立长期知识。
- Annotation：负责保存人的判断、疑问、修正和 review 记录。
- Tag：负责轻量分类和跨对象检索，不替代知识实体。
- Evidence：负责把知识项中的关键 claim 连接回邮件、thread、搜索 query 或 Ask run。

## UX Direction
- 首页以“知识工作流”解释用途：Ask/Search -> Review evidence -> Save knowledge。
- 列表项展示人能理解的信息：名称、类型、状态、摘要、证据数量、更新时间，而不是优先展示内部 id。
- 详情页按阅读顺序组织：
  - Header：知识项名称、类型、状态、标签。
  - At a glance：来源数量、人工笔记数量、类型、审核状态。
  - Explanation：短结论和详细笔记。
  - Source emails：可跳转邮件证据。
  - Human notes：人工修正、疑问和 review 记录。
- 空状态要告诉用户如何开始，而不是只显示“没有数据”。

## Roadmap

### Phase 1: Humanized Workbench
- 重排 Knowledge 页面信息架构。
- 隐藏或弱化内部 id。
- 强化 evidence 和 notes 的语义。
- 保留现有 API，避免影响 Ask/Search/Thread 工作流。
- 增加后续文档，明确 Knowledge 的产品边界。

### Phase 2: Draft Inbox
- 增加 Knowledge Drafts 页面或右侧队列，集中接收 Ask/Search 生成的草稿。
- 当前已有共享草稿审核组件，可作为 Draft Inbox 的编辑表单基础。
- 草稿状态：
  - `new`: AI 刚生成，未读。
  - `reviewing`: 用户正在编辑或核查证据。
  - `accepted`: 已保存为知识项。
  - `rejected`: 不保存，但保留原因用于调试 Ask。
- 每个草稿展示：
  - 原始问题。
  - AI 生成的知识项、annotation、tag 草稿。
  - 来源邮件列表。
  - 可能重复的现有知识项。
  - 一键保存、合并到已有知识项、丢弃。

### Phase 3: First-class Evidence Model
- 新增 `knowledge_evidence` 表，避免长期依赖 `meta.ask`。
- 建议字段：
  - `evidence_id`
  - `entity_id`
  - `source_type`: `email`, `thread`, `ask_run`, `search_query`, `manual`
  - `source_ref`
  - `message_id`
  - `thread_id`
  - `quote`
  - `claim`
  - `confidence`
  - `created_by`
  - `created_at`
- UI 支持给某条证据标注“支持什么结论”，而不是只保存一组邮件链接。
- Ask 回答引用 Knowledge 时，应区分“知识库结论”和“原始邮件证据”。

### Phase 4: Entity Review And Merge
- 增加重复检测：canonical name、aliases、tag、source thread 重合都参与候选匹配。
- 支持合并实体：
  - 合并 aliases。
  - 合并 tags。
  - 合并 evidence。
  - 合并 annotations。
  - 旧实体转为 redirect/deprecated。
- 增加审核 checklist：
  - 是否有至少一个 source email。
  - 摘要是否可独立理解。
  - 是否有明确适用范围或 caveat。
  - 是否需要关联到 subsystem/symbol/issue。

### Phase 5: Relationship Graph
- 新增 `knowledge_relations` 表：
  - `source_entity_id`
  - `target_entity_id`
  - `relation_type`: `explains`, `caused_by`, `fixed_by`, `related_to`, `part_of`, `supersedes`
  - `description`
  - `evidence_id`
- 页面上展示“相关知识”：
  - 某机制属于哪个 subsystem。
  - 某 issue 被哪个 patch discussion 解决。
  - 某 symbol 与哪些历史讨论相关。
- Ask 检索时可以沿关系扩展上下文。

### Phase 6: Ask Uses Knowledge
- Ask Agent 检索顺序调整为：
  - 先查已有 Knowledge，判断是否已有稳定结论。
  - 再查邮件证据补充细节。
  - 回答中同时引用知识项和原始邮件。
- 当 Ask 发现邮件证据与已有 Knowledge 冲突时，生成 review warning。
- Ask 结束后提供三个明确动作：
  - 保存为新知识。
  - 合并到已有知识。
  - 只保存人工 annotation/tag。

### Phase 7: Quality Metrics
- 增加知识库健康度指标：
  - 有证据的知识项比例。
  - draft 到 active 的转化率。
  - 重复实体候选数量。
  - Ask 回答命中 Knowledge 的比例。
  - 被引用最多的知识项。
- 增加人工评估入口：
  - 回答是否解决问题。
  - 来源是否相关。
  - 是否应该沉淀为知识。

## API Plan
- 保持 `/api/knowledge/entities` 基础 CRUD。
- 新增 `/api/knowledge/drafts` 管理 Ask/Search 生成的草稿。
- 新增 `/api/knowledge/evidence` 管理证据。
- 新增 `/api/knowledge/relations` 管理实体关系。
- `/api/ask` 响应中继续返回 draft bundle，同时附带候选重复实体和建议动作。

## Data Migration Policy
- 当前项目允许重建数据库，因此可以优先采用清晰模型，不做复杂兼容迁移。
- 短期保留 `meta.ask` 读取能力，用于兼容已经保存的 Ask 草稿。
- 引入 `knowledge_evidence` 后，提供一次性 backfill：从 `meta.ask.sources` 转换为 evidence rows。

## Test Plan
- 前端：
  - Knowledge 页面空状态、列表、详情、证据、笔记都能正常展示。
  - 有/无写权限时编辑控件状态正确。
  - 点击 source email 能打开 thread drawer 并聚焦 message。
- 后端：
  - Draft 创建、接受、拒绝、合并流程。
  - Evidence backfill 幂等。
  - Entity merge 不丢 tags、annotations、evidence。
- 集成：
  - Ask 问题生成草稿 -> 保存 Knowledge -> Knowledge 页面打开来源邮件。
  - 已有 Knowledge 被 Ask 命中并参与回答。
  - 重复实体候选能被发现并合并。

## Non-goals For Now
- 不做公开协作权限模型细分。
- 不做复杂图谱可视化，先做关系列表和反向引用。
- 不把 tag 变成知识实体；tag 仍然保持轻量分类职责。
- 不要求所有 Ask 回答都必须沉淀，只有有长期价值的结论才进入 Knowledge。
