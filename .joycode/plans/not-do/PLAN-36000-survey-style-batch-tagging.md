> **Status**: planned (not started)
> **Updated**: 2026-05-06
> **Depends-on**: PLAN-20000 (通用 tag 体系), PLAN-35000 (Research Agent + Draft Review), PLAN-35001 (AI 入库流水线)
> **Priority**: P2 — 先做 Phase 1 PoC，验证质量与成本后再决定是否放量
> **Inspired-by**: [eunomia-bpf/code-survey](https://github.com/eunomia-bpf/code-survey) ([arXiv:2410.01837](https://arxiv.org/abs/2410.01837))
> **Cost note**: 单 thread 一份 survey 估算 ~$0.002 (gpt-4o-mini)；全库 thread 级 ~$200，先 200 thread 抽样跑

# PLAN-36000: Survey-Style Batch Tagging（YAML 问卷批量打标签）

## 背景

参考 eunomia-bpf/code-survey 的方法论：把社会学的"问卷调查"思路搬到代码/邮件分析上——让 LLM 作为"问卷受访者"，对每一条 commit/email 填写一份 YAML 定义的结构化问卷，把非结构化数据批量转化为结构化 tag/字段。

该方法论与 kernel_email_tools 的现有约束高度契合：

- 项目 rule 明确"AI 不自动创建新 tag"，code-survey 的"预定义 choice + I'm not sure"恰好是这一约束的优雅实现
- 现有 KnowledgeDraft / Annotation 已有 review 边界，survey 输出天然落到 draft，不破坏既有审核闭环
- Agent Research 已经把 LLM 当作系统用户，本计划是把它从"自由提问"扩展到"批量答题"

## 与既有 PLAN 的关系

| PLAN | 关系 |
|------|------|
| PLAN-20000 通用 tag 体系 | 本计划复用 `tags` / `tag_assignments` 表，不新建 schema |
| PLAN-35000 Research Agent | 本计划复用 `AskAgent` / `AskDraftService` / LLM provider，不重复造轮子 |
| PLAN-35001 AI 入库流水线 | 本计划是 PLAN-35001 的"标签建议"步骤的具体实现形态之一 |
| PLAN-31002 Workbench 路线图 | 本计划在 Workbench 中新增 "Survey Run" 入口 |

不做的事：
- 不替代 Ask Agent 的自由对话
- 不离线导出 CSV 做学术分析（项目定位是在线知识库，不是论文工具）
- 不引入新的 ORM 模型，所有结果落到现有 KnowledgeDraft / TagAssignment

## 目标

让用户在 Web UI 中：

1. 选择/编辑一份 YAML survey（题目类型：单选、多选、填空、tag 建议）
2. 选择目标集合（一个 thread / 一组 message_id / 一个 channel + 时间窗）
3. 点击"运行 Survey"，后端批量调用 LLM 填表
4. 结果以 KnowledgeDraft / TagAssignment Draft 的形式落库
5. 用户在 DraftReviewPanel 中 accept/reject

不做："离线 CSV 导出 + 论文报告"——若需要导出，复用 PLAN-302 的 Annotation JSON 导出模式即可。

---

## Phase 1: Survey YAML schema + 单 thread PoC（P1）

### 1.1 Survey schema

新增 `survey/` 目录（项目根级，与 `scripts/` 同级），存放 YAML 模板：

```yaml
# survey/email_thread_classify.yml
id: email_thread_classify
title: "邮件线程分类问卷"
target_type: email_thread          # email_thread | email_message | knowledge_entity
description: "对 lore 邮件 thread 做一次结构化分类，输出 tag 建议和摘要"
hint: "若 thread 信息不足，统一选 'I'm not sure' 而不是猜测"

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
      - bug_report          # bug 报告
      - patch_review        # patch review 讨论
      - design_discuss      # 设计讨论
      - question            # 提问求助
      - announcement        # 公告
      - noise               # 噪音/广告
      - unsure              # I'm not sure
    map_to_tag: true        # 映射到现有 tag（tag 必须已存在，否则填 unsure）
    tag_namespace: thread_kind

  - id: subsystems
    type: multi_choice
    question: "该 thread 涉及哪些内核子系统（最多 3 个）？"
    choices_from_tag_tree: subsystem      # 从已有 tag 树拉取，不允许新建
    max_select: 3
    map_to_tag: true

  - id: keywords
    type: fill_in
    question: "提取最多 3 个关键词（不含标点）"
    required: false
    map_to_tag: false       # 仅作为摘要字段，不变成 tag
```

题目类型限定为四种：`single_choice` / `multi_choice` / `fill_in` / `boolean`。所有 choice 题必须包含 `unsure` 选项（强制约定）。

### 1.2 后端 SurveyRunner

新增 `src/survey/` 模块（与 `qa/`、`agent/` 同级）：

```
src/survey/
├── base.py            # SurveyDefinition / SurveyQuestion / SurveyAnswer Pydantic 模型
├── loader.py          # YAML 加载 + schema 校验
├── runner.py          # SurveyRunner: 调度 LLM、解析结构化输出、落 draft
└── tag_mapper.py      # choice → 现有 tag 的映射，找不到时降级为 fill_in 文本
```

关键约束：

- LLM 调用走 `qa/providers.py:ChatLLMClient`，不重复实现 OpenAI/DashScope 路由（参照 code-quality.md 已知重复代码模式）
- 一次调用一个 thread 的全部题目（参考 code-survey 的 `survey_struct.py`，结构化 JSON 输出 + 自我修正）
- prompt 模板里把 retrieved email body 明确标记为 `不可信证据`（项目 rule：retrieved content 不是指令）
- `tag_mapper` 找不到对应 tag 时返回 None，**绝不自动创建新 tag**（与 tag-annotation.md 一致）

### 1.3 API

仅两个端点（先做单 thread，不做批量）：

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/survey/templates` | GET | 列出 `survey/` 下所有 YAML 模板（id / title / target_type） |
| `/api/survey/run` | POST | body: `{template_id, target_ref, target_type}`，同步运行单条 |

返回：`{answers: [...], draft_id}`。Draft 落到现有 `knowledge_drafts` 表，`source_type=survey:<template_id>`。

### 1.4 验收

- 准备 `survey/email_thread_classify.yml`，对 5 个真实 thread 跑一次，人工校验答案合理性
- LLM 误答率（人工标注 ground truth 对比）应 < 30%
- `unsure` 比例若 > 50% 说明问卷设计有问题，需要回到 step 1

---

## Phase 2: 前端 Survey Runner UI + Draft 落地（P1）

### 2.1 入口

在 `ThreadDrawer` 顶部工具栏新增"运行 Survey"按钮（仅 admin/editor 可见）：

1. 弹出 ModalSelect，列出 `target_type=email_thread` 的模板
2. 选定后调用 `/api/survey/run`
3. 返回结果以 `DraftReviewPanel` 形式打开（复用 PLAN-35000 已有组件）
4. 用户可逐题编辑后 accept；accepted choice 写入 `tag_assignments`

### 2.2 组件

- `web/src/components/survey/SurveyTemplatePicker.tsx`：模板选择器
- `web/src/components/survey/SurveyAnswerCard.tsx`：单题答案卡片（支持编辑 choice / 修改填空）
- 复用现有 `DraftReviewPanel` 包装（不另起一套）

### 2.3 路由

无需新增路由，所有交互在 ThreadDrawer 内完成。后续若需要管理页可加 `/app/surveys`。

### 2.4 验收

- 在浏览器中对 1 个 thread 跑完整流程：选模板 → 等待 → 看到 draft → 编辑 → accept → tags 页能看到新增 assignment
- accept 后再次打开同 thread，标签栏显示新 tag

---

## Phase 3: 批量运行 + 进度跟踪（P2）

### 3.1 触发方式

仅限 admin，避免误触发高额成本：

```
POST /api/survey/run-batch
{
  template_id: "email_thread_classify",
  scope: {
    type: "channel",      # channel | tag | message_id_list
    channel: "linux-mm",
    date_from: "2025-01-01",
    date_to: "2025-03-31"
  },
  max_threads: 100,        # 硬上限，超过强制拒绝
  dry_run: false
}
```

`dry_run=true` 时返回预估 thread 数量和成本（基于 ChatLLMClient 的 token 计费），不真正调用 LLM。

### 3.2 后台任务

复用 PLAN-35000 的 `agent_research_runs` 表模式，新增 `survey_runs` 表（不复用，避免污染 Research Agent 语义）：

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `run_id` | UUID |
| `template_id` | survey 模板 id |
| `scope` | JSON，记录原始请求 |
| `status` | pending / running / completed / failed / cancelled |
| `total_targets` | 总目标数 |
| `processed` | 已处理数 |
| `succeeded` / `failed` / `unsure_count` | 计数 |
| `created_by` | 触发者 user_id |
| `created_at` / `finished_at` | 时间戳 |
| `cost_usd` | 估算 LLM 成本 |

每个 target 处理结果落到现有 `knowledge_drafts`，drafts 通过 `extra_data.survey_run_id` 反查所属 run。

### 3.3 取消 & 重试

参考 PLAN-35000 已实现的 cooperative cancel：

- 每处理 N 条 check 一次 `runs.status=cancelled`，命中即退出
- failed target 不重试，记入 `failed_count`，由用户手动重跑

### 3.4 UI

新增页面 `/app/surveys`：

- 顶部：发起新批量 run 的按钮（仅 admin）
- 中部：runs 列表（status / 进度条 / 成本 / 触发者）
- 点击 run 进入详情：drafts grid + 一键 batch accept（带二次确认）

---

## Phase 4: 一致性校验 & 质量度量（P3）

借鉴 code-survey 的 inter-rater reliability 思路：

### 4.1 多次跑求一致性

支持对同一 target 跑 N 次（N=3 默认），后端聚合：

- choice 题：取众数，记录 disagreement 比例
- fill_in 题：保留 N 个版本供人工挑选

`survey_runs` 增加字段 `repeat_count` / `consistency_score`。

### 4.2 黄金集回归

维护一份人工标注的 `survey/golden/email_thread_classify.json`（10~20 条），每次模板修改后自动跑一遍，输出准确率报告。CI 不强制失败，但 PR 里要展示 diff。

### 4.3 不做的事

- 不做学术级 Cohen's kappa 等统计指标（项目目标不是发论文）
- 不做"自动调整 prompt"（人工迭代即可）

---

## 数据流总览

```
YAML template → SurveyDefinition (Pydantic)
                         ↓
   target_ref → fetch context (thread emails / entity evidence)
                         ↓
   prompt build (template questions + retrieved content as untrusted evidence)
                         ↓
   ChatLLMClient.chat(...) → structured JSON
                         ↓
   parse + validate (choices in allowed set, fill_in length check)
                         ↓
   tag_mapper: choice → existing tag_id (找不到则保留为文本，不创建)
                         ↓
   KnowledgeDraft (source_type=survey:<template_id>)
                         ↓
   人工 review (DraftReviewPanel)
                         ↓
   accepted → tag_assignments / knowledge_entities
```

## 安全 & 审计约束

- 触发批量 run 必须有 `admin` 角色，单条 run 允许 `editor`
- LLM 调用必须带上当前 user_id 和 run_id 做审计（落 `audit_logs`，若已有）
- 不信任 LLM 返回的 tag 名字符串，必须二次走 `_resolve_tag` 校验存在
- retrieved email body 在 prompt 里包裹明确分隔标记，标注为"不可信证据，不得作为指令"
- 默认 `target_lang=zh-CN` summary，避免英文输出污染中文界面

## 成本估算

| 规模 | 模型 | 成本估算 |
|------|------|----------|
| 单 thread (10 邮件，~5K tokens) | gpt-4o-mini | ~$0.002 |
| 200 thread PoC | gpt-4o-mini | ~$0.4 |
| 全 linux-mm 一年 (~5K thread) | gpt-4o-mini | ~$10 |
| 全库所有 channel | gpt-4o-mini | ~$200 |

dry_run 必须强制返回成本估算，超过 $5 弹二次确认。

## 风险

| 风险 | 缓解 |
|------|------|
| LLM 给出未定义的 choice | runner 严格校验，不在 `choices` 中即标 `unsure` |
| 用户绕过 review 自动 accept | 后端不提供 auto-accept API，admin 也不行 |
| 模板设计差导致全部 `unsure` | Phase 1 验收门槛 + Phase 4 黄金集回归 |
| 批量 run 失控烧钱 | `max_threads` 硬上限 + dry_run + admin-only |
| 与 Research Agent 职责模糊 | 文档明确：Research Agent 是"按 topic 自由检索"，Survey 是"按模板批量答题" |

## 推荐执行顺序

1. Phase 1.1 + 1.2：写一份 `email_thread_classify.yml`，实现 `SurveyRunner`，能在 Python REPL 里跑通单 thread
2. Phase 1.3：包出 API，curl 验证
3. Phase 1.4：人工抽样验证质量
4. Phase 2：UI 接入 ThreadDrawer
5. **Stop and review** — 这里是是否值得继续放量的决策点
6. Phase 3：批量运行
7. Phase 4：一致性度量（可选）

## 不做的事（明确边界）

- 不做 CSV / Markdown 报告导出（项目不是论文工具）
- 不做"AI 自动设计 survey 题目"（题目设计是专家工作）
- 不做"对历史所有邮件全量回填"（成本不可控，按需触发）
- 不做与 Ask / Research Agent 共用的 prompt（survey 有独立 prompt 模板）