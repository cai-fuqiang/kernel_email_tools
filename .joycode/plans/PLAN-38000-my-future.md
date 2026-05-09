> **Status**: planned
> **Updated**: 2026-05-09
> **Depends-on**: PLAN-35001, PLAN-31002, PLAN-30002
> **Priority**: P0 hypothesis validation, P1 architecture alignment

# PLAN-38000: Evidence-Driven Kernel Knowledge Production

## 重新思考项目初衷

学习 Linux 内核的困难不只是代码复杂，而是关键知识分散在大量异构材料中：

1. 内核知识面非常广
   - 操作系统知识
   - 硬件 API
   - 数据结构与算法
   - 架构、编译器、性能和并发细节
2. 内核历史非常长
   - 30 多年的演化
   - 大量 commit、patch revision 和邮件列表讨论
3. 代码本身无法解释全部背景
   - 重要设计原因常常隐藏在 commit message 和 mailing list review 中
   - 模块多次重构后，当前代码只能说明“现在是什么”，很难说明“为什么变成这样”
4. 知识来源非常分散
   - commit message
   - mailing list
   - patch hunk
   - LWN
   - kernel docs
   - 架构和厂商手册
   - 书籍、博客、个人笔记

知识在于积累，而积累需要工具。在 AI 浪潮下，AI 可以成为分析邮件、代码和 commit
的重要助手。但真正关键的问题不是“是否使用 AI”，而是：

> 以什么方式驱使 AI 参与内核知识生产，才能降低学习和审核成本，而不是制造更多噪音？

## 核心目标

本项目不应被定位为“内核邮件搜索系统”，也不应被定位为普通 RAG。更准确的定位是：

> 构建一个证据驱动的 Linux 内核知识生产系统。AI 负责帮助收集、连接、总结和生成草稿；人负责审核、修正、合并和维护长期知识。

项目中心不是 `email`，而是 `feature/topic knowledge with evidence`。邮件是最重要的第一类语料，但它只是证据载体之一。知识组织的起点应当是一个功能点、机制或设计主题，例如 RSDL scheduler、CFS introduction、EEVDF scheduler、mmap locking 或 KVM dirty logging。

整体工作流应当是：

```text
raw kernel material
  -> feature/topic selection
  -> retrieval and context packing
  -> AI-assisted analysis and draft generation
  -> human review and merge
  -> durable topic timeline and knowledge graph with evidence links
```

## Feature / Topic 优先的方法论

当前设计如果从邮件出发，很容易把知识拆成碎片：一封邮件可能只是某个 patch revision 的局部 review，也可能只是多年争议中的一个侧面。用户真正需要理解的是“这个功能为什么出现、经历过哪些方案、哪些 patch 被拒、哪些 commit 合入、当前代码为什么长这样”。

因此后续 Knowledge Workbench 应把 `Feature / Topic` 作为第一等对象：

```text
Feature / Topic
  -> Timeline
  -> Evidence nodes
       - mail thread
       - patch revision
       - commit
       - code location
       - external link
       - human annotation
  -> Conclusions
  -> Open questions
```

### 方法论 1: 时间轴

时间轴用于串联同一功能点在不同阶段的状态：

- RFC / early proposal
- patch v1/v2/v3
- review 分歧和 maintainer 观点
- rejected alternative
- merged commit
- follow-up fix / regression / replacement

每个时间点都必须能挂证据。证据不足时标记为 `unknown` 或 `needs human review`，不让 AI 或系统自动补全历史。

### 方法论 2: 证据节点

邮件、patch、commit、代码位置和外部文章都应作为 evidence node 被挂到同一个 topic 下，而不是彼此孤立。邮件搜索、代码浏览和 commit 追踪的作用是帮助人找到 evidence node，不是决定知识结构。

### 方法论 3: 人工结论

最终结论由人维护。AI 可以建议“RSDL 可能影响 CFS 的公平性讨论”，但只有在人确认邮件、patch 和后续设计证据后，才能把它写成正式结论。

### RSDL scheduler 示例

RSDL scheduler 这类历史主题说明了为什么不能只从 commit 或邮件出发。它可能没有直接合入主线，但 rejected patch 和邮件讨论仍可能影响后续 CFS 设计。正确的知识入口应是 “scheduler fairness design” 或 “RSDL scheduler” 这样的 topic，然后把 RSDL patch thread、CFS announcement、相关 review、后续 commit 和 LWN / kernel doc 串成时间线。

## 为什么传统 RAG 不够

传统 RAG 可以帮助从百万邮件中找出相关片段，但它不能独立解决内核知识积累问题：

- 一个设计主题可能跨多年、多个版本、多个 patch revision 和多个邮件列表。
- 关键问题常常是历史性的：为什么引入、谁反对、接受了什么 tradeoff、后来是否被替代。
- 证据可能来自邮件正文、patch hunk、代码行、commit message、manual section 或外部文章。
- 单次 top-k 检索容易断章取义，无法可靠恢复完整讨论脉络。
- AI 输出如果直接进入正式知识库，会带来 hallucination、错误标签和错误关系污染。

因此 AI 不应被当成自动写入知识库的专家，而应被当成结构化草稿生成器和研究助手。
所有影响长期知识库的 AI 输出都必须进入 Draft Review。

## P0: 先诊断 AI 分析能力

在投入大量工程资源做 EvidenceRef、ContextPack、Survey 和 Draft Review 重构之前，必须先回答：

> AI 在获得足够好的上下文后，到底能不能产出有审核价值的内核知识分析？

如果答案是“能”，ContextPack、EvidenceRef 等抽象就是正确的下一步。如果答案是“不能”，架构重构再多也无法解决核心问题，应降低 AI 任务范围，或者改变产品形态。

### 可能失败原因

| 序号 | 可能原因 | 严重程度 | 对应方向 |
|------|----------|----------|----------|
| 1 | 上下文不足：线程太长，相关补丁、提交、代码没有被正确打包进 prompt | 最可能 | ContextPack |
| 2 | 检索不准：找不到相关历史讨论和代码 | 很可能 | 改进检索，或先人工构造上下文验证 |
| 3 | Prompt 任务定义不清晰 | 可能 | 固定输出模板和结构化约束 |
| 4 | 模型能力不足：内核知识太专业，幻觉严重 | 有可能 | 缩小任务范围 |
| 5 | 任务本身过难：需要专家级背景 | 对特定话题成立 | 识别 AI 能力边界 |

### 诊断实验

先做人工构造上下文的诊断实验，不依赖自动检索。

1. 选择 3 个自己已经充分理解的邮件线程
   - 一个简单明确结论的线程
   - 一个中等复杂的设计讨论线程
   - 一个有争议或无明确结论的线程
2. 手工构造理想上下文
   - 完整线程消息或关键原文
   - 相关 patch 代码片段
   - 相关内核源码上下文
   - 相关前置讨论或引用
   - 不依赖自动检索
3. 定义固定分析任务
   - 这个线程讨论的问题是什么？
   - 提出了哪些方案？各自 tradeoff 是什么？
   - 最终采纳了什么方案？为什么？
   - 有哪些反对意见？为什么被 reject 或搁置？
   - 对后续版本有什么影响？
   - 哪些结论有明确证据，哪些仍不确定？
4. 要求 AI 输出固定结构
   - 问题背景
   - 方案对比
   - 最终结论
   - 反对意见
   - 证据列表
   - 不确定点
   - 可沉淀的 Knowledge 草稿
5. 对比已知答案并评估
   - 事实准确度
   - 完整性
   - 洞察深度
   - 证据可定位性
   - 审核成本

### 成功标准

| 维度 | 及格线 | 优秀线 |
|------|--------|--------|
| 事实准确度 | >80% 的事实陈述正确 | >95%，且错误都是次要细节 |
| 完整性 | 覆盖主要讨论分支 | 覆盖边缘讨论和隐含假设 |
| 洞察深度 | 正确总结结论 | 指出未解决问题或后续影响 |
| 证据可定位性 | 关键结论能追到邮件、patch 或代码 | 每个主要 claim 都有明确证据 |
| 审核成本 | 比从头分析节省 >30% 时间 | 比从头分析节省 >70% 时间 |

### 判定逻辑

```text
if 及格线全部达到:
    -> ContextPack + EvidenceRef + Draft Review 值得工程化

elif 事实准确度 < 80%:
    -> 模型能力或 prompt 是核心瓶颈
    -> 缩小 AI 任务范围，例如只做摘要、证据提取或线索发现

elif 完整性不足:
    -> 上下文打包策略需要改进
    -> 尝试多轮 context gap detection

elif 证据可定位性不足:
    -> 不允许生成正式 KnowledgeDraft
    -> 降级为阅读摘要或待核查线索

elif 审核成本太高:
    -> Draft Review 在当前阶段不可持续
    -> 降低 AI 输出形式，建立快速驳回和质量门槛
```

原则：如果一个知识条目的审核时间超过从头研究的时间，Draft Review 就是失败的。

## 目标架构

在 P0 诊断通过后，项目应围绕证据到知识的生产流程调整模块边界。

```text
src/corpus/          # raw source adapters: email, commit, manual, docs, external refs
src/targets/         # stable target references: EmailTarget, CodeTarget, PatchTarget, ManualTarget
src/retrieval/       # keyword, semantic, hybrid, graph expansion
src/context/         # ContextPack builders for thread, patch, code, topic, manual section
src/ai_workflows/    # ask, research, survey, summarize, classify
src/review/          # draft lifecycle, review, accept, reject, merge
src/knowledge/       # entity, claim, relation, evidence, version history
src/notes/           # annotation and human notes
src/api/             # HTTP adapters only
```

这不是要求立即大规模重构，而是作为后续新功能和局部重构的方向约束。

## 关键概念

### EvidenceRef

引入统一证据引用模型，逐步替代新代码中的 email-specific 假设。

```text
EvidenceRef:
  source_type: email_message | email_thread | patch_hunk | code_range | commit | manual_section | external_url | annotation
  source_ref: stable source identifier
  target: structured target payload
  quote: optional quoted evidence
  claim: what this evidence supports
  confidence: human/AI confidence label
  created_by / created_by_user_id
```

现有 `message_id`、`thread_id` 可以保留兼容，但应视为 EvidenceRef 的投影，而不是通用模型本身。

### ContextPack

为 AI 工作流引入稳定上下文对象。Ask、Research Agent、Survey 和未来 thread summarization
不应各自拼一套 prompt 输入格式。

ContextPack 至少应描述：

- 当前研究目标：thread、patch、code range、symbol、topic 或 manual section
- primary evidence refs
- source excerpts
- timeline 或 patch revision history
- 相关已有 knowledge
- caveats、contradictions、open questions
- token/cost estimate

首个 MVP 只需要支持 single email thread 和 patch discussion。

### Draft As The Only AI Write Path

所有 AI 生成且可能影响长期知识库的对象必须先进入 draft：

- KnowledgeDraft
- AnnotationDraft
- TagAssignmentDraft
- RelationDraft
- EvidenceDraft
- ThreadSummaryDraft

Ask、Research Agent、Survey 可以产生不同 draft bundle，但应共用一条 review/apply 路径。

## 当前设计判断

### 应保留

- `AskAgent`：已经具备 search planning、thread context、existing knowledge 和 evidence citation。
- `AgentResearchService`：search、judge、refine、synthesize、draft、review 的 loop 符合目标。
- `KnowledgeEntity`、`KnowledgeRelation`、`KnowledgeEvidence`、`KnowledgeDraft`：方向正确。
- `Annotation` 的 `target_type + target_ref + anchor`：适合作为通用批注基础。
- Draft Review：AI 输出进入长期知识库前的正确边界。

### 应调整

- 项目命名和文档应逐步从 "email knowledge base" 调整为 "kernel knowledge production system"。
- Evidence 存储目前过于 email-centric，新工作应使用 EvidenceRef。
- API router 不应继续膨胀为业务逻辑层，新工作应增加 service-layer 模块。
- 应用启动逻辑初始化过多不相关服务，未来模块应暴露可组合 service factory。
- Tag、Annotation、Knowledge、Evidence 的产品职责需要更清晰：
  - Tag：轻量分类和过滤
  - Annotation：局部人工判断、疑问、修正或 review note
  - KnowledgeEntity：可复用结论或概念
  - Evidence：支撑某个 claim 的来源

### 应避免

- 不要从全量邮件 LLM 处理开始。
- 不要让 AI 自动创建 tag。
- 不要让 Survey 绕过 Draft Review。
- 不要在 CodeTarget 和 EvidenceRef 稳定前建设完整 Kernel Code Atlas。
- 不要把 vector search quality 当成主指标；主指标是 reviewed knowledge 是否可靠积累。

## 实施顺序

### Phase 0: AI 分析能力诊断

- 按上面的 P0 实验选择 3 个线程。
- 手工构造理想上下文。
- 固定 AI 输出格式。
- 记录事实准确度、完整性、洞察深度、证据可定位性、审核成本。
- 决定 AI 输出是进入 KnowledgeDraft，还是降级为 summary / highlight / clue。

### Phase 1: Naming And Design Alignment

- 更新文档，明确 email 是第一语料，不是产品中心。
- 增加 EvidenceRef、ContextPack、Draft Review 的简短架构说明。
- 审视活跃计划，延后不能增强 evidence-to-knowledge loop 的工作。

### Phase 2: EvidenceRef MVP

- 定义 `src/targets/` 或等价模块。
- 支持 email message、email thread、patch hunk、code range、manual section。
- 提供从现有 `message_id`、`thread_id`、`version`、`file_path`、`start_line`、`end_line`
  转换的 helper。
- 新 evidence 写入优先携带 EvidenceRef，同时保留现有字段兼容。

### Phase 3: ContextPack MVP

- 构建 single-thread context builder。
- 包含首封邮件、关键回复、patch excerpts、code target、相关 annotation、tag 和 knowledge。
- 增加 token/cost estimate。
- 先让 AskAgent 或 ResearchAgent 可选消费 ContextPack，不改变公开 API。

### Phase 4: Unified Draft Bundle

- 让 Ask、Research、Survey 共享 draft bundle 语义。
- 支持 knowledge、annotation、tag assignment、relation、evidence draft。
- 统一 review/apply 路径。
- 在 review UI 中显式展示缺失证据和风险点。

### Phase 5: Single-Thread Survey PoC

- 只实现 single-thread survey runner。
- Survey choice 只能映射到现有 tag。
- 未映射 choice 降级为 text answer 或 `unsure`，不自动创建 tag。
- 输出进入 Draft Review，不进入 CSV 或正式表。
- 验证质量、成本和审核负担后再考虑 batch mode。

## 成功标准

- 用户能从一个 thread 或 patch discussion 出发，生成带证据的 reviewed knowledge。
- Knowledge entity 能清楚展示每个 claim 被哪些 email、patch、code、manual 或 external reference 支撑。
- Ask 和 Research 回答能区分 reviewed knowledge 与 raw source evidence。
- AI 生成内容不会绕过 review 写入长期知识库。
- 新模块都能强化这条主线：

```text
source material -> evidence -> context -> AI draft -> human review -> durable knowledge
```

## 参考

- [code-survey](https://github.com/eunomia-bpf/code-survey/tree/main/survey)
- PLAN-35001: AI-Assisted Knowledge Pipeline
- PLAN-31002: Knowledge Workbench Roadmap
- PLAN-30002: External Code Jump / Local-first Resolver
