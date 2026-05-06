> **Status**: future (planned, not started)
> **Updated**: 2026-05-06
> **Depends-on**: PLAN-35000 (LLM 调用基础设施 / Research Agent / Draft Review), PLAN-20000 (通用 tag 体系)
> **Related**: 吸收 `PLAN-36000-survey-style-batch-tagging` 的核心设计，不再把 survey 作为孤立路线
> **Priority**: P2 — 先做单 thread survey PoC + 按需摘要，验证质量、成本和 review 体验后再批量化
> **Cost note**: 禁止一开始对百万邮件全量跑 LLM；所有批量 run 必须先 dry_run 估算成本并有硬上限

# PLAN-35001: AI-Assisted Knowledge Pipeline（实时入库增强 + Survey 批量知识抽取）

## 目标

用 AI 减轻内核邮件知识库构建中的体力劳动：去噪、预分类、线程摘要、实体抽取、标签建议、演化模式统计。

本计划不把 AI 当成“自动写入知识库的专家”，而是把 AI 当成“结构化草稿生成器”。AI 产出的知识、标签、关系、摘要都必须进入 Draft / Review 状态，由人决定是否发布。

最终目标是把当前系统从“能搜索和问答的邮件库”，升级成“能持续生产、审核、沉淀和分析内核知识的工作台”。

## 借鉴 code-survey 的结论

`eunomia-bpf/code-survey` 的核心不是 RAG，也不是聊天机器人，而是一个离线批处理方法：

```
commit/email 原始材料
  -> 人设计 YAML survey 问卷
  -> LLM 按固定 schema 填表
  -> 结构化 CSV/字段
  -> 统计分析和报告
```

它对本项目最有价值的不是 CSV 输出，而是“survey-driven extraction”这个方法论：先让专家定义问题和候选答案，再让 LLM 批量回答，最后用人工审核和统计评估控制质量。

本项目应该吸收它的优势，但不要照搬它的产品形态：

| code-survey | kernel_email_tools 应采用的形态 |
|-------------|--------------------------------|
| 离线 CSV 数据集 | 数据库中的 Draft / TagAssignment / KnowledgeEntity |
| 针对 commit 做批量问卷 | 针对 email thread / message / patch / entity 做问卷 |
| 论文报告和图表 | Knowledge Workbench + Survey Run 结果页 |
| LLM 一次性结构化输出 | 结构化输出 + 校验 + evidence + 人工 review |
| 预设 choice 分类 | 映射到现有 tag，找不到则降级为文本，不自动创建 tag |

核心判断：本计划应采用“双轨流水线”。

- 轨道 A：实时/按需知识增强，用于入库、ThreadDrawer、Ask/Research Agent 的日常体验。
- 轨道 B：survey 批量结构化，用于稳定、可重复、可统计的知识生产。

## 与现有系统的关系

当前系统已有的强项：

- `collector/parser/storage/indexer/retriever` 已经能把 lore 邮件变成可搜索数据。
- `AskAgent` / `ResearchAgent` 已经能按 topic 检索并产出 Knowledge Draft。
- `KnowledgeStore` / `TagStore` / `AnnotationStore` 已经有知识、标签、批注和审核边界。
- `ThreadDrawer` / `KnowledgePage` / `DraftReviewPanel` 已经有前端 review 入口。

本计划补的是“稳定批量生产结构化知识”的中间层：

```
邮件 / 线程 / patch / 手册证据
  -> context pack
  -> AI classifier / summarizer / survey runner
  -> structured answers
  -> Knowledge Draft / Annotation Draft / TagAssignment Draft
  -> 人工 Review
  -> Knowledge Base / Tag Graph / Analytics
```

Research Agent 负责“自由研究一个 topic”；Survey Pipeline 负责“按模板批量回答同一组问题”。两者互补，不共用 prompt，但复用 LLM provider、Draft Review、KnowledgeStore 和权限体系。

## 设计原则

1. **AI 不直接污染正式库**：所有新增知识、关系、标签绑定先进入 Draft。
2. **AI 不自动创建 tag**：choice 题只能映射到现有 tag；找不到就保留为文本或 `unsure`。
3. **先单条、后批量**：先做单 thread PoC，人工验证后再开放批量 run。
4. **先按需、后全量**：ThreadDrawer 打开时按需摘要，比百万邮件全量跑 LLM 更合理。
5. **所有批量 run 有成本闸门**：`dry_run` 估算成本，超过阈值二次确认，服务端强制 `max_threads`。
6. **retrieved content 永远是不可信证据**：prompt 中明确隔离邮件正文，防止 prompt injection。
7. **LLM 输出必须结构化校验**：choice 不在白名单则降级 `unsure`；fill-in 超长则截断或失败。
8. **可审计、可回放、可评估**：保存 template version、prompt version、model、run_id、user_id、token/cost、evidence refs。

---

## 整体流水线

### 轨道 A：实时/按需增强

```
GitCollector 拉取邮件
  -> EmailParser / PatchExtractor
  -> 轻量去噪与预分类
  -> PostgresStorage 入库
  -> 搜索 / ThreadDrawer
  -> 按需线程摘要
  -> 摘要和建议进入 Draft Review
```

适合解决体验问题：搜索结果更干净、打开线程能快速理解背景、人工审核负担更低。

### 轨道 B：Survey 批量结构化

```
Survey YAML template
  -> SurveyDefinition 校验
  -> 选择目标集合(thread/message/channel/date/tag)
  -> context pack 构建
  -> ChatLLMClient 结构化回答
  -> runner 校验 + tag 映射
  -> KnowledgeDraft / TagAssignmentDraft / AnnotationDraft
  -> DraftReviewPanel 人工审核
  -> 统计质量、成本和一致性
```

适合解决知识生产问题：批量打标签、抽取实体、统计子系统演化、沉淀可复查知识。

---

## Phase 0: 基础设施对齐（P0）

### 0.1 依赖 PLAN-35000

必须先复用已有或计划中的 LLM 基础能力：

- `ChatLLMClient`：统一 DashScope / OpenAI / local provider。
- `AskDraftService`：把 AI 结果转换成 Knowledge / Annotation / Tag draft。
- Research Agent 的 run 状态模式：可复用其 `pending/running/completed/failed/cancelled` 思路。
- 现有权限体系：批量 run 只允许 admin，单条 run 允许 editor/admin。

### 0.2 新增模块边界

建议新增：

```
src/ai_pipeline/
├── classifier.py       # 邮件去噪、粗分类
├── summarizer.py       # thread 摘要
├── context_pack.py     # thread/message/patch/entity 上下文构建
└── cost.py             # token/cost 估算

src/survey/
├── base.py             # SurveyDefinition / Question / Answer
├── loader.py           # YAML 加载 + schema 校验
├── runner.py           # LLM 调用、结构化输出、自我修正、校验
├── tag_mapper.py       # choice -> existing tag_id
└── quality.py          # golden set / consistency metrics
```

`ai_pipeline` 处理通用能力，`survey` 处理 code-survey 式问卷机制。两者都不直接写正式知识库。

---

## Phase 1: 轻量去噪与预分类（P1）

### 1.1 问题

lore.kernel.org 的邮件列表中混有广告、自动回复、重复抄送、低价值争论和无关内容。当前系统全部入库，搜索和标签页面会被噪音拖累。

### 1.2 策略调整

原方案把“去噪 + 8 类分类”都放在入库前 LLM 处理，成本和误伤风险偏高。更稳妥的做法是分层：

1. 规则/本地模型先做 `noise_score`，例如广告关键词、异常 sender、重复模板、极短自动回复。
2. LLM 只处理不确定样本，或者只在人工触发时补充分类。
3. 默认不丢弃邮件，只把 `visibility_state` 标记为 `active/noise_suspect/hidden`。
4. `noise_suspect` 默认从普通搜索中隐藏，但可通过 `include_noise=true` 查看。

### 1.3 数据结构

`emails` 表建议新增：

| 字段 | 说明 |
|------|------|
| `category` | patch / design_discuss / bug_report / question / announcement / noise / auto_reply / unsure |
| `category_confidence` | 0~1 |
| `category_rationale` | 简短说明，供审核 |
| `classified_by` | rule / local_model / llm / human |
| `visibility_state` | active / noise_suspect / hidden |

可选新增 `email_noise_queue`，用于集中审核被标记为噪音的邮件。保留期默认 30 天。

### 1.4 配置

```yaml
email_classifier:
  enabled: false
  mode: rule_first          # rule_first | llm_only | disabled
  provider: dashscope
  batch_size: 20
  auto_hide_noise: true
  auto_drop_noise: false
  llm_only_when_uncertain: true
```

### 1.5 验收

- 抽样 200 封邮件，人工标注 noise / non-noise。
- `noise` precision 目标 > 95%，避免误伤高价值邮件。
- 被标记为 `noise_suspect` 的邮件可恢复。
- LLM 不可用时，采集和入库不受影响。

---

## Phase 2: 按需线程摘要与 Context Pack（P1）

### 2.1 问题

一个内核邮件线程可能有几十到几百封邮件。当前 ThreadDrawer 能阅读原文，但用户仍要自己梳理“这个线程在争什么、最终有没有结论、关键证据在哪”。

### 2.2 ThreadSummarizer

```python
class ThreadSummarizer:
    async def summarize(self, thread_id: str) -> ThreadSummary:
        summary: str
        key_decision: str
        open_questions: list[str]
        participants: list[str]
        timeline: list[ThreadEvent]
        evidence_refs: list[EvidenceRef]
        tags_suggested: list[TagSuggestion]
```

触发方式：

- 用户打开 ThreadDrawer 时，如果没有摘要缓存，后台生成。
- editor/admin 可手动重新生成。
- 批量脚本只用于小样本验证，不做默认全量。

### 2.3 Context Pack

Survey、摘要、实体抽取都需要稳定的上下文输入，因此要先做 `ContextPackBuilder`：

```python
class ContextPackBuilder:
    async def build_thread_pack(self, thread_id: str) -> ContextPack:
        # 包含首封邮件、patch diff 摘要、关键 review、版本演进、最后结论
```

Context Pack 不等于向量检索结果。它是对一个已知目标的上下文压缩，主要用于防止 prompt 过长和证据遗漏。

### 2.4 存储与 UI

新增 `thread_summaries` 表：

| 字段 | 说明 |
|------|------|
| `thread_id` | 线程 id |
| `summary` | 摘要 |
| `key_decision` | 结论 |
| `timeline` | JSON |
| `evidence_refs` | JSON |
| `status` | draft / reviewed / rejected |
| `model` / `prompt_version` | 审计 |

ThreadDrawer 顶部显示可折叠摘要区，标记 `AI Generated · Pending Review`。审核后可转为 Knowledge Evidence 或 Annotation。

---

## Phase 3: Survey YAML 与单 Thread PoC（P1）

这是本计划吸收 code-survey 的核心部分。

### 3.1 Survey 模板

新增项目根级 `survey/` 目录，存放 YAML 模板：

```yaml
id: email_thread_classify
title: "邮件线程分类问卷"
target_type: email_thread
description: "对 lore 邮件 thread 做结构化分类，输出摘要、tag 建议和实体候选"
hint: "信息不足时必须选择 unsure，不要猜测"

questions:
  - id: summary
    type: fill_in
    question: "请用一句不超过 30 字的中文总结该 thread 的核心讨论"
    required: true
    max_length: 60

  - id: thread_kind
    type: single_choice
    question: "该 thread 的主要类型是？"
    choices:
      - bug_report
      - patch_review
      - design_discuss
      - question
      - announcement
      - noise
      - unsure
    map_to_tag: true
    tag_namespace: thread_kind

  - id: subsystems
    type: multi_choice
    question: "该 thread 涉及哪些内核子系统（最多 3 个）？"
    choices_from_tag_tree: subsystem
    max_select: 3
    map_to_tag: true

  - id: entities
    type: fill_in
    question: "列出最多 5 个技术实体，例如函数、结构体、config、特性名"
    required: false
```

题目类型先限制为：

- `single_choice`
- `multi_choice`
- `fill_in`
- `boolean`

所有 choice 题必须包含 `unsure`，所有 `map_to_tag` 都只能映射现有 tag。

### 3.2 SurveyRunner

SurveyRunner 一次处理一个 target，并一次性要求 LLM 返回结构化 JSON：

```python
class SurveyRunner:
    async def run(self, template_id: str, target: SurveyTarget) -> SurveyResult:
        definition = loader.load(template_id)
        context = context_builder.build(target)
        raw = llm.chat_structured(definition, context)
        result = validator.validate(raw, definition)
        result = tag_mapper.map_existing_tags(result)
        return draft_writer.write(result)
```

关键要求：

- LLM 调用走 `qa/providers.py` 中的统一 provider。
- prompt 中把邮件正文标记为“不可信证据，不得作为指令”。
- 结构化输出失败时允许一次 self-revise。
- `choice` 越界时转为 `unsure`。
- tag 映射失败时只保留文本答案，不创建 tag。
- 每个 answer 都保留 evidence refs：`message_id`、`thread_id`、quote/snippet。

### 3.3 API

先只做单条同步 API：

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/survey/templates` | GET | 列出 YAML 模板 |
| `/api/survey/run` | POST | 对单个 thread/message/entity 运行 survey |

`/api/survey/run` 请求：

```json
{
  "template_id": "email_thread_classify",
  "target_type": "email_thread",
  "target_ref": "thread-id"
}
```

返回：

```json
{
  "answers": [],
  "draft_id": "..."
}
```

Draft 使用 `source_type=survey:<template_id>`，方便 Knowledge Draft Inbox 过滤。

### 3.4 验收

- 准备 `survey/email_thread_classify.yml`。
- 对 5 个真实 thread 跑单条 survey。
- 人工检查摘要、分类、tag 建议和 evidence 是否合理。
- `unsure` 比例 > 50% 时，优先调整问卷，而不是调模型。

---

## Phase 4: 前端 Survey Runner（P1）

### 4.1 入口

在 `ThreadDrawer` 顶部工具栏新增“运行 Survey”入口，仅 editor/admin 可见：

1. 弹出模板选择器，只列出 `target_type=email_thread` 的模板。
2. 选定模板后调用 `/api/survey/run`。
3. 返回后打开 Draft Review 视图。
4. 用户可逐题编辑、accept/reject。
5. accepted choice 写入 `tag_assignments`，实体候选进入 Knowledge Entity Draft。

### 4.2 组件

建议新增：

```
web/src/components/survey/SurveyTemplatePicker.tsx
web/src/components/survey/SurveyAnswerCard.tsx
web/src/components/survey/SurveyRunButton.tsx
```

尽量复用已有 `DraftReviewPanel`，不要另起一套审核系统。

### 4.3 验收

- 在浏览器中对 1 个 thread 完成：选模板 -> 运行 -> 看到 draft -> 编辑 -> accept。
- accept 后重新打开该 thread，标签栏能看到新增 assignment。
- 非 editor/admin 看不到运行入口。

---

## Phase 5: 批量 Survey Run（P2）

### 5.1 触发方式

批量 run 只允许 admin，且必须支持 `dry_run`：

```json
{
  "template_id": "email_thread_classify",
  "scope": {
    "type": "channel",
    "channel": "linux-mm",
    "date_from": "2025-01-01",
    "date_to": "2025-03-31"
  },
  "max_threads": 100,
  "dry_run": true
}
```

服务端硬约束：

- `max_threads` 默认 100，超过上限拒绝。
- `dry_run=true` 返回目标数量、预估 token、预估费用。
- 预估费用超过阈值时，前端必须二次确认。
- 不提供 auto-accept API。

### 5.2 survey_runs 表

新增 `survey_runs` 表，避免污染 Research Agent 的语义：

| 字段 | 说明 |
|------|------|
| `run_id` | UUID |
| `template_id` | 模板 id |
| `template_version` | 模板 hash |
| `scope` | JSON |
| `status` | pending / running / completed / failed / cancelled |
| `total_targets` | 总数 |
| `processed` | 已处理 |
| `succeeded` / `failed` / `unsure_count` | 计数 |
| `created_by_user_id` | 触发者 |
| `model` / `prompt_version` | 审计 |
| `estimated_cost_usd` / `actual_cost_usd` | 成本 |
| `created_at` / `finished_at` | 时间 |

每个 target 的结果仍落现有 `knowledge_drafts`，通过 `payload.survey_run_id` 反查。

### 5.3 取消与重试

- 每处理 N 个 target 检查一次 `status=cancelled`。
- failed target 不自动无限重试，记录错误原因。
- 支持对 failed targets 手动重跑。

### 5.4 UI

新增 `/app/surveys`：

- runs 列表：状态、进度、模板、目标范围、成本、触发者。
- run 详情：answers/drafts grid、失败原因、`unsure` 分布。
- 支持跳转到 Knowledge Draft Inbox 过滤该 run 产物。

---

## Phase 6: 实体抽取、标签建议与知识沉淀（P2）

### 6.1 EntityExtractor 作为 Survey 的一种题型

原方案里独立的 `EntityExtractor` 应该收敛到 Survey Pipeline 中。实体抽取本质也是一个结构化问卷：

```yaml
id: email_thread_entity_extract
target_type: email_thread
questions:
  - id: technical_entities
    type: entity_list
    max_items: 8
    allowed_entity_types:
      - subsystem
      - feature
      - api
      - function
      - config
      - bug
```

第一版可以先不用 `entity_list` 题型，直接用 `fill_in` 输出实体候选；等质量稳定后再引入专门 schema。

### 6.2 Draft 输出

Survey 结果可以生成三类草稿：

| 输出 | 落库位置 |
|------|----------|
| 摘要、结论、证据 | Knowledge Draft / Annotation Draft |
| tag choice | TagAssignment Draft |
| 技术实体、关系 | Knowledge Entity Draft / Relation Draft |

重要约束：

- 实体去重先走 `KnowledgeStore.search_entities()`。
- relation 必须带 evidence ref。
- 低 confidence 实体只进入 draft，不在 graph 中展示为正式节点。

---

## Phase 7: 质量度量与演化分析（P3）

这是 code-survey 最值得长期借鉴的部分：不只生成草稿，还要能统计“模型和模板是否可靠”。

### 7.1 Golden Set

维护小规模人工标注集：

```
survey/golden/email_thread_classify.json
survey/golden/email_thread_entity_extract.json
```

每次修改模板或 prompt 后，可运行：

```bash
python scripts/run_survey_golden.py --template email_thread_classify
```

输出准确率、`unsure` 比例、越界 choice 比例、平均成本。

### 7.2 一致性检查

支持同一 target 重复运行 N 次：

- choice 题取众数。
- fill-in 题保留多个版本供人工选择。
- 记录 disagreement ratio。

不要求学术级 Cohen's kappa；当前项目目标是工程质量门禁，不是论文复现实验。

### 7.3 分析视图

Survey Run 聚合后可以形成新的 Knowledge Workbench 视角：

- 某子系统一年内 patch_review / bug_report / design_discuss 的比例变化。
- 哪些实体被高频讨论但缺少正式 Knowledge Entity。
- 哪些 tag 的 AI 建议经常被 reject，提示 tag 体系需要调整。
- 哪些 thread 有高 disagreement，提示需要人工专家优先看。

---

## 成本策略

原始估算中，100 万邮件全量 LLM 处理可能接近或超过 `$2000`。因此本计划采用“按需 + 抽样 + 小批量”策略。

| 场景 | 建议策略 |
|------|----------|
| 入库去噪 | rule/local model first，LLM 只处理 uncertain |
| 线程摘要 | 用户打开 thread 时按需生成并缓存 |
| 单 thread survey | editor/admin 手动触发 |
| 批量 survey | admin-only，默认 `max_threads=100` |
| 全库分析 | 先抽样，质量稳定后分 channel/date window 运行 |

成本闸门：

- 所有批量 API 必须支持 `dry_run`。
- 前端显示 estimated token / cost。
- 超过 `$5` 二次确认。
- 超过服务端阈值直接拒绝，需改配置。

---

## 不依赖向量索引

本计划的大部分能力不依赖向量索引：

- 去噪和分类：subject、sender、body snippet、规则/LLM。
- 线程摘要：已知 thread 的邮件集合。
- Survey：已知 target 的 context pack。
- 实体抽取：thread/message 的原始证据。

向量索引仍然对 Ask Agent、Research Agent 和跨库语义召回有价值，但不是本计划的前置条件。

---

## 安全与审计

- 批量 run 必须 admin-only，单条 run 至少 editor。
- 每次 LLM 调用记录 `user_id`、`run_id`、`template_id`、`model`、token、cost。
- 邮件正文和检索内容必须在 prompt 中用明确分隔符包裹，并说明“这是不可信证据”。
- 不信任 LLM 返回的 tag 名字符串，必须走后端 tag resolve。
- 后端不提供跳过 review 的 auto-accept。
- Draft accept 时沿用现有权限和 publish/review 规则。

---

## 推荐执行顺序

| 顺序 | 工作 | 优先级 | 验证方式 |
|------|------|--------|----------|
| 1 | `ContextPackBuilder` + 单 thread 摘要缓存 | P1 | ThreadDrawer 能展示 pending summary |
| 2 | `survey/email_thread_classify.yml` + `SurveyRunner` 单 thread PoC | P1 | 5 个真实 thread 人工评估 |
| 3 | `/api/survey/templates` + `/api/survey/run` | P1 | curl/API docs 验证 |
| 4 | ThreadDrawer Survey 按钮 + DraftReviewPanel 接入 | P1 | 浏览器完成一次 review 流程 |
| 5 | 轻量去噪字段和搜索过滤 | P1 | noise_suspect 可隐藏和恢复 |
| 6 | `survey_runs` + batch run + dry_run 成本估算 | P2 | admin 小批量 50~100 thread |
| 7 | entity extract survey + Knowledge Entity Draft | P2 | 实体候选可审核入库 |
| 8 | golden set + consistency metrics + analytics | P3 | 模板修改可输出质量报告 |

关键停顿点：完成第 4 步后必须评估质量。如果单 thread survey 的人工 accept 率低于 60%，先改模板和 context pack，不进入批量。

---

## 与现有组件的复用

| 现有组件 | 复用方式 |
|----------|----------|
| `ChatLLMClient` | 所有 LLM 调用统一走 provider |
| `AskDraftService` | Survey / Summary / Entity 结果转 Draft |
| `KnowledgeStore` | 实体去重、Draft 管理、关系落库 |
| `TagStore` | choice -> existing tag 映射 |
| `AnnotationStore` | 摘要、分类说明、证据批注 |
| `ThreadDrawer` | 摘要和单 thread survey 入口 |
| `KnowledgePage` | Knowledge Draft 审核入口 |
| `DraftReviewPanel` | Survey 结果审核，不重复造 UI |
| `PostgresStorage` | 分类字段、summary、survey_runs |
| `ResearchAgent` run 模式 | 批量 run 状态、取消、审计参考 |

---

## 不做的事

- 不做“AI 自动设计 survey 题目”；题目设计是专家工作。
- 不做“AI 自动创建新 tag”；tag 体系必须人工维护。
- 不做“百万邮件一键全量 LLM 回填”；必须按需、抽样、小批量推进。
- 不把 Survey Prompt 和 Ask/Research Prompt 混用；二者目标不同。
- 不优先做 CSV/Markdown 报告导出；项目定位是在线知识库。后续若需要导出，可复用 Annotation JSON 导出模式。

---

## 测试计划

- 单元测试：`SurveyLoader` schema 校验、choice 越界降级、tag 映射失败降级。
- 单元测试：`ContextPackBuilder` 对空 thread、大 thread、patch thread 的截断和排序。
- 单元测试：`EmailClassifier` mock LLM / rule fallback。
- 集成测试：`/api/survey/run` 对 fixture thread 生成 draft。
- 集成测试：batch `dry_run` 只估算成本，不调用 LLM。
- 权限测试：viewer 不能 run survey，editor 只能单条，admin 才能 batch。
- 质量评估：维护 10~20 条 golden thread，记录 accept rate、unsure rate、reject reason。

---

## 附录：两个工程的实现分析备份

本节记录前期对 `eunomia-bpf/code-survey` 与当前 `kernel_email_tools` 的实现分析，作为后续设计决策的背景材料。

### A. code-survey 的实现形态

`code-survey` 的定位更接近“离线研究流水线”，而不是在线知识库。它围绕 eBPF 子系统，把 commit、feature、邮件等开发历史材料转成结构化数据，再通过 LLM 问卷回答、统计脚本和可视化脚本分析“一个子系统如何演化”。

核心链路：

```
git commit / feature / mailing list data
  -> dump / generate CSV
  -> YAML survey 定义问题
  -> survey runner 调用 LLM 填表
  -> 结构化 CSV
  -> timeline / distribution / pie / heatmap 分析
  -> 论文式报告或图表
```

它的关键实现点：

- 数据入口是 CSV 和脚本，不是数据库服务。典型脚本负责 dump commit、筛选 BPF commit、生成 feature CSV。
- `survey/commit_survey.yml` 把“要问 LLM 的问题”配置化，例如摘要、关键词、commit 类型、复杂度、影响组件。
- `survey_agent.py` 更像逐题问答 runner；`survey_struct.py` 更像一次性结构化输出 runner，会把 survey schema 转成 JSON Schema，让 LLM 返回可解析字段。
- 它有 self-revise / rethink 的思想：第一次结构化输出后，再让模型检查和修正，提升字段稳定性。
- 下游分析脚本读取 survey 后的结构化结果，做时间线、分布、组件关系、饼图、热力图等研究分析。

它最值得借鉴的不是“导出 CSV”，而是这几个工程思想：

- 由专家先定义问题和候选答案，LLM 只负责批量回答。
- 所有输出是结构化字段，便于统计、比较、回归和复核。
- 对不确定答案保留 `unsure`，不要诱导模型猜测。
- LLM 输出必须经过 schema 校验，不能直接相信自然语言。
- 批量分析前先做小样本质量验证，否则成本和噪声会一起放大。

### B. 当前 kernel_email_tools 的实现形态

当前工程已经是在线知识库产品，而不只是离线分析脚本。它的中心对象是 Linux 内核邮件、patch review、知识实体、标签、批注、手册证据和人工审核工作流。

当前主链路：

```
lore git mirror
  -> collector / parser / patch extractor
  -> PostgreSQL storage
  -> fulltext index + semantic chunk/vector index
  -> keyword / semantic / hybrid retriever
  -> Search / Ask / Research Agent
  -> Knowledge Draft / Annotation / Tag Assignment
  -> Web Workbench 人工审核
```

关键模块现状：

- `src/collector/`：从 lore git mirror 采集邮件。
- `src/parser/`：解析邮件、线程、patch、PDF/SDM 文档。
- `src/storage/`：PostgreSQL ORM、邮件、知识、标签、批注、Ask 对话、Agent run 等持久化。
- `src/indexer/`：全文索引、邮件 chunk、embedding / pgvector。
- `src/retriever/`：keyword、semantic、hybrid、manual 检索。
- `src/qa/`：Ask Agent、ManualQA、LLM/embedding provider、Ask draft。
- `src/agent/`：Research Agent，把 AI 作为系统用户生成 research run 和 Knowledge Draft。
- `src/api/routers/`：Search、Ask、Knowledge、Annotations、Tags、Kernel、Manual、Agent 等服务入口。
- `web/src/`：SearchPage、AskPage、KnowledgePage、AgentResearchPage、ThreadDrawer、DraftReviewPanel、KnowledgeGraphView 等工作台 UI。

当前工程相对 `code-survey` 已经具备的能力：

- 有在线 API 和前端，不只是脚本。
- 有权限、用户、角色和审核边界。
- 有 Knowledge Draft / Draft Review，能防止 AI 直接污染知识库。
- 有 tag、annotation、knowledge entity 和 evidence 的统一存储。
- 有 thread 阅读、翻译、patch 展示、代码批注、手册问答等交互面。
- 有向量检索和 agentic RAG，能按 topic 动态检索证据。

当前工程还缺的，正是 `code-survey` 擅长的那层：

- 缺少“固定问卷 + 结构化字段 + 批量运行”的稳定知识抽取机制。
- 缺少 survey run 的进度、成本、模板版本和质量指标。
- 缺少对一批 thread 的统计视图，例如某子系统一年内讨论类型变化。
- 缺少 golden set / consistency 这类质量回归机制。

### C. 两者能力映射

| 维度 | code-survey | kernel_email_tools |
|------|-------------|--------------------|
| 产品形态 | 离线脚本 + CSV + 报告 | 在线知识库 + API + Web Workbench |
| 核心对象 | commit / feature / survey row | email / thread / patch / knowledge entity / tag |
| LLM 用法 | 按 YAML survey 批量填表 | Ask / Research Agent 自由检索与生成草稿 |
| 输出形态 | 结构化 CSV 字段 | Knowledge Draft / Annotation / TagAssignment |
| 审核方式 | 研究者离线检查 | Draft Review / 权限 / 发布审核 |
| 分析能力 | timeline、分布、组件统计 | 搜索、问答、知识图谱、人工工作台 |
| 最强优势 | 可重复、可统计的结构化抽取 | 证据回溯、交互审核、知识沉淀 |

结论：`code-survey` 可以视作当前工程未来的“离线批量知识抽取内核”；当前工程则是 `code-survey` 方法论更适合落地的产品容器。

### D. 可迁移到当前工程的设计点

优先迁移：

- YAML survey 模板：把 thread 分类、patch review 类型、子系统归属、实体抽取写成可版本化模板。
- Structured output runner：一次性输出 JSON，并做 schema 校验、choice 白名单校验、self-revise。
- `unsure` 策略：所有 choice 题必须允许不确定，避免模型硬猜。
- 批量 run：有 `survey_runs` 表，记录进度、失败、成本、模板版本、模型版本。
- 质量度量：建立 golden set，统计 accept rate、reject reason、unsure rate、越界 choice。
- 分析视图：按 tag、subsystem、thread_kind、date window 聚合，形成演化趋势。

不建议照搬：

- 不建议把结果主要落 CSV；当前系统应该落 Draft 和数据库。
- 不建议绕过现有 tag / knowledge / annotation 模型另建孤岛 schema。
- 不建议从全库批量开始；先单 thread，再小批量，再分 channel/date window。
- 不建议让 LLM 自动创造分类体系；分类体系应该来自专家维护的 tag tree 和 survey YAML。

### E. 落地判断

这两个工程的关系可以概括为：

```
code-survey = 批量结构化分析方法论
kernel_email_tools = 可审核、可检索、可沉淀的知识库平台

最佳融合方式 =
  把 code-survey 的 survey runner
  嵌入 kernel_email_tools 的 Draft Review / Tag / Knowledge / Workbench 闭环
```

因此 PLAN-35001 的优先级不应该是“全量 AI 入库处理”，而应该是：

1. 先做 `ContextPackBuilder`，保证 thread 输入稳定。
2. 再做单 thread `SurveyRunner`，验证结构化输出质量。
3. 接入 Draft Review，让人能编辑、接受、拒绝。
4. 小批量 `survey_runs`，有成本和质量统计。
5. 最后再考虑入库去噪、实体抽取、演化分析的规模化。
