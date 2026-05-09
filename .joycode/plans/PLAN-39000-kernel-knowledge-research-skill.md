> **Status**: future
> **Updated**: 2026-05-09
> **Depends-on**: PLAN-31002
> **Priority**: P3

# PLAN-39000: Kernel Knowledge Research Skill（后续）

## 背景

当前项目方向需要先回到人工知识库建设本身。Linux 内核知识点通常不会被单封邮件、单个 patch 或单次 RAG 检索完整解释：一个功能点可能跨多个 patch version、邮件线程、commit、代码位置、外部文章和后续修正。

AI 可以帮助摘要、找线索、整理候选证据，但不适合独立从一个点自动扩展出完整知识链。真正有价值的知识主线仍应由人选择主题、确认证据、维护时间线并形成结论。

因此，本计划只记录一个后续方向：未来创建 `kernel-knowledge-research` skill，把“如何分析一个内核知识点”的方法论固化下来，供 AI agent 在人工主导的研究流程中使用。

## 当前判断

- 现阶段重点不是让 AI 自动研究邮件，而是先丰富人工知识库。
- 人应负责选择研究主题、收集邮件 / patch / code / commit 证据、维护时间线、形成结论。
- AI 只负责降低体力成本：候选摘要、证据摘录、关联建议、草稿生成和不确定点提示。
- Skill 是后续工具化人工研究方法的手段，不是当前产品主线。

## 目标

未来创建一个项目内或全局 skill，指导 AI agent 按固定方法分析内核知识点，并输出两层结果：

1. 面向人的研究报告，用于理解一个功能点的历史、争议、代码和当前结论。
2. 面向系统的待审核草稿，用于生成 Knowledge Draft、Evidence、Relation 和 Tag 建议。

第一版 skill 应优先服务人工研究者，而不是批量自动入库。

## 预期工作流

```text
研究对象确认
  -> 证据收集
  -> 时间线整理
  -> 争议点和方案对比
  -> 当前结论
  -> 待确认项
  -> Knowledge Draft 建议
```

### 研究对象确认

明确主题名称、相关子系统、关键词、代码路径、函数 / 结构体 / config、时间范围和已知入口材料。

### 证据收集

收集并区分以下证据：

- 邮件 thread 和关键 message
- patch version 和 patch hunk
- commit message、`Link:` 标签和相关 git history
- 代码位置和版本
- 已有 Knowledge、annotation、tag
- 外部链接，如 kernel docs、LWN、博客和手册

### 时间线整理

按时间排列 RFC、patch v1/v2、review 分歧、方案调整、合入 / 拒绝、后续修正和当前状态。证据不足时必须标记为 `unknown` 或 `needs human review`。

### 争议点和方案对比

总结各方案的 tradeoff、maintainer 观点、被拒原因、性能 / 兼容性 / 维护性约束，以及是否存在未合入但影响后续设计的重要讨论。

### 当前结论和待确认项

区分：

- 已有明确证据支撑的结论
- AI 基于证据做出的推断
- 需要人工继续确认的空白

## 输出要求

研究报告建议固定包含：

- `Research Target`
- `Short Conclusion`
- `Timeline`
- `Code / Patch Evidence`
- `Mail Discussion Evidence`
- `Important Disagreements`
- `Current State`
- `Open Questions`
- `Suggested Knowledge Drafts`

待审核草稿建议固定包含：

- candidate entity title / type / status
- claim-level evidence
- related threads / commits / code targets / links
- suggested relations
- suggested tags，且只能引用已有 taxonomy
- confidence 和 review notes

## 非目标

- 不自动创建 accepted Knowledge。
- 不自动创建 tag。
- 不自动构建完整历史。
- 不把单封邮件摘要当成知识结论。
- 不把 `git blame` 或最终 commit 的 lore link 当作完整设计来源。
- 不让 AI 隐藏不确定性；证据不足时必须显式输出待确认项。

## 启动条件

满足以下条件后再考虑实施 skill：

- Knowledge Workbench 已经积累足够真实人工知识案例。
- 人工证据关联、人工时间线和结论维护的产品模型稳定。
- 已经能从真实案例中总结出可复用的研究模板。
- AI 输出的审核成本明显低于从头研究成本。

## 与当前工作的关系

当前阶段应优先推进人工知识库丰富：手动选择主题、整理 evidence、维护 relation / timeline、写清楚结论和 caveat。`kernel-knowledge-research` skill 只作为后续计划保留，避免在人工流程尚未稳定前把注意力转回 AI 自动化。
