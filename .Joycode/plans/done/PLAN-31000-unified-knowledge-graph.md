# PLAN-31000: 多类型 Tag / 标注整合为统一知识库与知识图谱

## Summary
当前系统已经具备较好的统一抽象基础：
- `Tag` 负责知识标签本体
- `TagAssignment` 负责标签与目标对象的绑定
- `Annotation` 负责人类撰写的解释、评论、回复
- `target_type + target_ref + anchor` 已经能够统一表达多种目标对象

这意味着系统距离“统一知识库”已经不远。下一步不建议直接将全部数据硬转为图谱，而应先建立一个稳定的知识对象层，再在其上投影出知识图谱视图。

整体策略应为：
1. 保留现有 tag / annotation / target 体系作为基础能力
2. 增加“逻辑知识对象”层，承接跨邮件、跨代码、跨文档的稳定知识
3. 增加“结构化事实/关系”层，用于表达可计算、可推理的知识
4. 最终将知识对象、事实、来源之间的连接投影为知识图谱

## Current Status
- 已实现：统一 `Tag` / `TagAssignment`、邮件/段落/代码/annotation/knowledge entity 目标打标、`knowledge_entities` CRUD。
- 已实现：`knowledge_relations` CRUD、关系方向展示、局部知识图谱 API/UI。
- 已实现：Ask/Search 可生成 knowledge、annotation、tag 草稿，缺失 tag 默认不保存。
- 已实现：将 `meta.ask.sources` 升级为一等 `knowledge_evidence`，增加持久化 Draft Inbox 和实体合并 MVP。
- 后续未实现：Ask 使用 Knowledge/关系作为检索上下文、relation 草稿推荐、质量指标与全局图谱。

## Design Goals
- 不推翻现有 `TagAssignment` / `Annotation` 设计
- 支持多种 target 类型持续扩展
- 支持“知识归类、知识讨论、知识事实”三种不同语义
- 所有沉淀出的知识尽量可追溯到来源对象
- 先做可运营、可维护的知识库，再演进到图谱查询与可视化

## Core Model
### 1. 明确三类知识载体
- `Tag`
  - 表示分类、属性、主题、状态
  - 适合做筛选、聚合、导航
- `Annotation`
  - 表示人类写下的解释、观察、争议、总结
  - 保留非结构化知识表达能力
- `KnowledgeFact`
  - 表示结构化命题或关系
  - 用于跨源聚合、图谱查询、后续推理

### 2. 明确两类 target
- 原始对象型 target
  - `email_thread`
  - `email_message`
  - `email_paragraph`
  - `kernel_file`
  - `kernel_line_range`
  - `annotation`
  - 后续可扩展 `manual_section`、`manual_paragraph`
- 逻辑知识对象型 target
  - `topic`
  - `concept`
  - `issue`
  - `feature`
  - `subsystem`
  - `kernel_symbol`
  - `person`
  - `organization`
  - `patch_series`

关键原则：
- 不仅允许“邮件/代码/批注”被打 tag
- 也允许“概念/问题/子系统/符号”等逻辑知识对象本身成为 target

## Key Changes
### 1. 引入统一知识对象层
建议新增表：
- `knowledge_entities`

建议字段：
- `entity_id`
- `entity_type`
- `canonical_name`
- `slug`
- `aliases`
- `summary`
- `description`
- `status`
- `meta`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

用途：
- 承接稳定知识对象
- 为跨来源聚合提供“落点”
- 允许邮件、代码、文档、批注共同指向同一知识实体

示例：
- `concept:mmu-tlb-shootdown`
- `subsystem:mm`
- `kernel_symbol:v6.1:mm/mmap.c:do_mmap`
- `issue:gup-race-condition`

### 2. 引入结构化事实层
建议新增表：
- `knowledge_facts`

建议字段：
- `fact_id`
- `subject_entity_id`
- `predicate`
- `object_entity_id`
- `object_literal`
- `confidence`
- `review_status`
- `source_type`
- `source_ref`
- `evidence`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

设计说明：
- 当 object 是另一个实体时，使用 `object_entity_id`
- 当 object 是文本、数值、状态时，使用 `object_literal`
- 每条 fact 尽量保留来源和证据

建议首批谓词：
- `belongs_to`
- `affects`
- `implements`
- `discusses`
- `mentions`
- `introduced_by`
- `fixed_by`
- `related_to`

### 3. 保留 Tag 作为分类层，而不是强行图谱化
建议继续保留 `Tag` / `TagAssignment`，并明确两类 tag：

- 知识实体型 tag
  - 例如：`mm`、`tlb`、`scheduler`、`gup`
  - 这类 tag 可以逐步提升为 `knowledge_entity`
- 工作流/状态型 tag
  - 例如：`important`、`todo`、`needs-review`、`resolved`
  - 继续作为普通 tag 使用，不强制进入图谱

原则：
- 不是所有 tag 都应该转化为图谱节点
- 只有稳定、可复用、跨对象存在的知识性 tag 才适合上升为实体

### 4. 保留 Annotation 作为非结构化知识层
`Annotation` 不应被替代，而应作为知识沉淀的重要来源。

建议支持以下演进能力：
- annotation 可关联一个或多个 `knowledge_entity`
- annotation 可被“提炼”为一个或多个 `knowledge_fact`
- annotation 可带 `claim_status`
  - `note`
  - `hypothesis`
  - `confirmed`
  - `disputed`

这样可以区分：
- 单纯评论
- 推测性结论
- 已确认知识
- 存在争议的结论

### 5. 引入证据与归因模型
知识库必须尽量可追溯，因此建议统一“证据”表达。

建议所有 `TagAssignment` 和 `KnowledgeFact` 统一支持：
- `source_type`
  - `manual`
  - `annotation`
  - `imported`
  - `inferred`
  - `llm_extracted`
- `source_ref`
  - 邮件、批注、代码范围、手册段落等对象引用
- `evidence`
  - 结构化证据 JSON
- `confidence`
  - 置信度
- `review_status`
  - 审核状态

原则：
- 没有来源的知识，尽量只作为草稿，不直接视为高可信知识

### 6. 构建“知识图谱”作为上层投影，而非底层替代
知识图谱建议由以下节点和边投影生成：

节点：
- `Entity`
  - 概念、子系统、问题、符号、人物、组织等
- `Source`
  - 邮件、代码范围、批注、手册段落等

边：
- 实体关系边
  - `belongs_to`
  - `affects`
  - `implements`
  - `related_to`
- 实体到来源的证据边
  - `supported_by`
  - `mentioned_in`
  - `derived_from`
- 标签投影边
  - `tagged_as`

原则：
- 图谱是知识库的查询视图与表达视图
- 不直接拿 `tag_assignments` 冒充完整图谱

## Query Model
### 1. 面向对象查询
- 某个邮件线程有哪些 tags、annotations、facts
- 某个代码文件或行范围有哪些 tags、annotations、facts
- 某个批注沉淀出哪些实体和关系

### 2. 面向实体查询
- 某个 concept / subsystem / symbol 关联哪些来源
- 某个 issue 影响哪些代码位置、哪些讨论线程
- 某个 symbol 在哪些邮件和批注中被讨论过

### 3. 面向图谱查询
- 某实体的一跳/二跳邻居
- 某个主题相关的概念、问题、符号、讨论来源
- 某个知识实体的演化路径与证据链

## API Direction
建议后续新增：
- `POST /api/knowledge/entities`
- `GET /api/knowledge/entities`
- `GET /api/knowledge/entities/{entity_id}`
- `POST /api/knowledge/facts`
- `GET /api/knowledge/facts`
- `POST /api/knowledge/extract`
  - 从 annotation / thread / code range 生成候选 fact
- `GET /api/graph/neighbors`
  - 获取实体的邻接关系

建议扩展现有接口能力：
- `Annotation` 支持关联 `entity_ids`
- `Tag` 支持标记是否已升级为实体
- `TagAssignment` 支持指向 `knowledge_entity`

## Implementation Phases
### Phase 1: Unified Knowledge Base
- 保留现有 tag / annotation / target 体系
- 新增 `knowledge_entities`
- 支持手工创建和维护知识实体
- 允许实体本身成为 target，被 tag / annotation 关联

### Phase 2: Structured Facts
- 新增 `knowledge_facts`
- 支持人工从 annotation 中提炼 fact
- 支持 fact 与来源对象之间的证据关联
- 定义少量高价值谓词并限制输入范围

### Phase 3: Assisted Extraction
- 提供规则抽取或 LLM 辅助抽取候选实体/候选关系
- 候选内容进入待审核池
- 人工确认后写入 `knowledge_entities / knowledge_facts`

### Phase 4: Graph Projection
- 将 entity / fact / source 投影为图谱视图
- 提供邻接查询、关系浏览、证据链展示
- 评估是否需要图数据库；第一版可继续使用 PostgreSQL

## Migration Strategy
- 不删除现有 `Tag` / `TagAssignment` / `Annotation`
- 先新增 `knowledge_entities / knowledge_facts`
- 对已有高价值 tag 做人工筛选，逐步提升为 entity
- 允许 annotation 保持原状，只在需要时提炼为 fact
- 先建立“知识库”，后建立“图谱视图”

## Risks
- 如果过早把全部 tag 强行图谱化，会引入大量低质量节点
- 如果把 annotation 直接当 fact，会混淆“观点”和“确认知识”
- 如果没有证据链，图谱很快会失去可信度
- 如果谓词体系放得太开，后续关系会失控、难以维护
- 如果逻辑知识对象没有稳定命名规则，实体会大量重复

## Test Plan
- 能创建并维护 `knowledge_entity`
- 同一逻辑对象不会因别名不同而重复创建大量实体
- 某个实体可聚合来自邮件、代码、批注、手册等多来源对象
- annotation 可关联实体，并可人工提炼为 fact
- fact 能正确回溯到来源对象和证据
- 图谱邻接查询能返回实体关系和来源支撑信息

## Assumptions
- 当前阶段以 PostgreSQL 继续承载知识库与图谱投影
- 第一版优先做“可维护知识库”，不是追求全自动知识抽取
- 图谱中的关系以人工确认或半自动确认结果为主
- 不是所有 tag 都需要演进为实体节点
