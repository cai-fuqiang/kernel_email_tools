# Plans Index

> Last reorganized: **2026-05-09** (direction adjusted: feature/topic-centric human Knowledge first; keep AI/skill automation as later assistance)

本目录维护项目的规约文档（PLAN-xxx）。已完成的计划归档到 `done/`，被取代的计划归档到 `done/superseded/`。每个活跃 PLAN 顶部应当带元数据头：

```text
> **Status**: planned | in-progress | done | future | superseded
> **Updated**: YYYY-MM-DD
> **Depends-on**: PLAN-xxx, PLAN-yyy
> **Priority**: P0 | P1 | P2 | P3
```

---

## 活跃 / 后续计划（6）

| PLAN | 主题 | Status | Priority | 备注 |
|------|------|--------|----------|------|
| [PLAN-30002](PLAN-30002-external-code-jump.md) | 代码跳转与 local-first resolver | in-progress | **P1** | 外链闭环已完成；下一步把 Elixir 降级为 fallback，建立本地代码 resolver |
| [PLAN-31005](PLAN-31005.md) | 统一信息工作台（Workspace） | done / staged follow-up | **P0 cleanup**, then P2 | Stage 1 主流程已收口，真实写数据与 LLM 联调降为后续低优先级 |
| [PLAN-31002](PLAN-31002-knowledge-workbench-roadmap.md) | Knowledge Workbench 路线图 | in-progress | P2 | 范围过大，新工作请新建独立 PLAN 引用 |
| [PLAN-35001](PLAN-35001-FUTURE-ai-assisted-knowledge-pipeline.md) | AI 辅助草稿 / Survey helper | future | P3 | 后置为人工工作流助手；不作为自动邮件入库主线 |
| [PLAN-38000](PLAN-38000-my-future.md) | Evidence-driven kernel knowledge production | planned | P0/P1 | 方向性计划；按 2026-05-09 修正优先人工知识沉淀 |
| [PLAN-39000](PLAN-39000-kernel-knowledge-research-skill.md) | Kernel knowledge research skill | future | P3 | 后续把内核知识点研究方法固化成 skill；当前不实施 |

---

## 2026-05-09 方向修正：人工知识库优先

当前阶段的重点不是让 AI 自动研究邮件，也不是让 agent 独立构建知识主线。更重要的是，系统不应该以“邮件”为知识组织中心，而应该以 **功能点 / 机制 / 设计主题** 为中心。Linux 内核知识点往往横跨邮件讨论、patch revision、commit、代码位置、外部文章和后续修正；AI 可以做摘要、找线索和生成候选草稿，但不能可靠替代人从一个功能点出发完成取舍、串联和结论维护。

近期产品主线应调整为 **人工构建知识库，AI 降低体力成本**：

1. 人选择研究主题和功能点，例如 RSDL scheduler、CFS introduction、EEVDF scheduler。
2. 人围绕该主题收集并确认邮件、patch、code、commit、annotation、link 等证据。
3. 人维护时间线、关系、争议点和当前结论。
4. AI 只生成候选摘要、证据摘录、关联建议和待审核草稿。
5. Skill / Agent 自动化等人工流程稳定后再推进。

这意味着 PLAN-35001、Survey、Research Skill 等方向都应作为辅助层或后续工具化能力，不应挤占当前人工 Knowledge Workbench 和证据闭环建设。

### 方法论：Feature / Topic 优先

邮件是证据载体，不是知识中心。新的人工知识工作流应优先围绕 `Feature / Topic` 建模：

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

以 RSDL scheduler 为例，即使 patch 没有进入主线，它仍可能影响后续 CFS 讨论。仅从最终 commit 或某封邮件出发会漏掉这类历史设计脉络；从功能点出发，才能把 rejected patch、邮件争议、后续 commit 和外部解释串到同一条时间轴上。

---

## 2026-05-08 项目评估结论

当前项目已经具备邮件导入、全文/语义检索、Ask/Research Agent、Knowledge Workbench、Draft Review、批注、标签、翻译、手册和内核代码浏览等能力。代码健康度尚可：`pytest -q` 135 个测试通过，`web npm run lint` 和 `web npm run build` 通过。

主要风险已经从“缺功能”转为“功能面过宽、计划状态滞后、关键闭环尚未完全验收”。后续优先级应按 **丰富人工知识库 > 稳定证据链 > 小步验证新方向 > 批量 AI/插件/导出** 排列。

### 近期优先级

1. **P0/P1：丰富 feature-centric 人工 Knowledge Workbench**
   - 原因：长期价值来自人维护的功能点知识、证据、关系、时间线和结论，而不是 AI 自动摘要堆积。
   - 完成标准：用户可以围绕一个功能点 / 机制 / 设计主题手工组织邮件、patch、代码、commit、annotation 和外链，并维护清晰时间轴、结论与待确认项。
2. **P1：邮件 patch ↔ 代码位置 ↔ annotation/tag ↔ knowledge 闭环**
   - 原因：这是项目最有差异化的主线，比完整符号索引、编辑器插件和批量 AI 更先。
   - 完成标准：从 ThreadDrawer patch hunk 或 Code view 选区创建 annotation/tag，并能从代码页、邮件页、Knowledge evidence 互相跳转。
3. **P1/P2：人工主题时间线 MVP**
   - 原因：知识点演进需要人确认哪些邮件、patch version、commit 和外部链接真正重要。
   - 完成标准：先支持人工维护关联列表和时间线，不做自动推断完整历史。
4. **P2：Survey / AI 草稿的小样本辅助**
   - 原因：Survey-style 和 AI draft 有辅助价值，但必须服务人工 review，不作为自动入库主线。
   - 完成标准：只做单 thread / 单 topic PoC，验证质量、成本和审核体验，不开放批量 run。

### 暂缓事项

- VS Code / Neovim 插件：等 Code Target 稳定后再做 editor-native bridge。
- 完整 Kernel Code Atlas：先做 code target 和 annotation/tag 闭环，不先做跨版本函数级对照。
- 完整符号索引 / Find References：不替代编辑器和 Elixir，除非后续有明确证据链需求。
- AI 邮件入库流水线批量化：后置为人工工作流助手；禁止从百万邮件全量 LLM 起步，所有批量 run 必须 dry_run 和硬上限。
- Kernel knowledge research skill：作为 PLAN-39000 后续方向保留；等人工证据、时间线和结论模型稳定后再实施。
- Markdown Wiki Export：低优先级，等知识模型和证据链稳定后再做。

---

## 推荐执行顺序

1. ~~**P1** PLAN-30002 Phase 1+2（externalLinks 工具 + Code Browser 接入 Elixir）~~ ✅ 2026-05-01
2. ~~**P1** PLAN-34000 Phase 4 组件拆分（ThreadDrawer / KnowledgePage / SearchPage / KernelCodePage / AskPage）~~ ✅ 2026-05-06
3. ~~**P1** PLAN-34000 Phase 1/3/5 收尾（SemanticRetriever 测试 2→6、confirm/prompt → ConfirmModal、KnowledgePage chunk 500→54 KB）~~ ✅ 2026-05-06
4. ~~**P1** PLAN-34001 贡献度标记（后端 `/api/contributions/lookup` + 前端 chip）~~ ✅ 2026-05-06
5. ~~**P1** PLAN-31001 Phase 3+4+5 收尾（fulltext search / import-export / history / direction switch / load more）~~ ✅ 2026-05-06
6. ~~**P0** PLAN-31004 Pending Verification（浏览器尺寸、移动端、Knowledge/ThreadDrawer/Search/Ask 核心冒烟）~~ ✅ 2026-05-08
7. ~~**P0** PLAN-31005 状态校准与 Workspace 冒烟（旧路由兼容、email/tag/annotation 三个 view 主流程）~~ ✅ 2026-05-08
8. ~~**P1** PLAN-37001 Phase 1+2+3+4（产品边界清理 + Code Target Normalization + code/mail/knowledge 闭环 + cross-version context）~~ ✅ 2026-05-08
9. **P1** 人工 Knowledge Workbench 丰富（主题、证据、关系、结论、待确认项）
10. **P1** 人工主题时间线 MVP（先手动关联邮件 / patch / commit / code / links）
11. **P1** PLAN-30002 Phase 6 剩余项（local-first resolver 的最小符号索引仅在闭环需要时推进）
12. **P2** 单 thread / 单 topic Survey 或 AI 草稿 PoC（验证质量、成本和人工 review 体验）
13. **P3** PLAN-39000 Kernel knowledge research skill（等人工研究流程稳定后再固化为 skill）
14. **P3** VS Code / Neovim bridge、批量 Survey、AI 入库流水线、Markdown Wiki Export

---

## 已完成（done/，25）

按时间顺序从早到晚：

- 基础设施与早期能力
  - PLAN-001 邮件知识库基础
  - PLAN-002 可扩展架构
  - PLAN-003 高级搜索过滤
  - PLAN-003 邮件标签
- 批注与翻译
  - PLAN-004 批注前后端统一（含 `UnifiedAnnotationStore` 与 annotations 表合并）
  - PLAN-004-code-annotation-reply（mostly-done，剩 UI 细节）
  - PLAN-200 邮件中英文对照翻译
  - PLAN-201 分层模式 BUG 修复
  - PLAN-202 线程回复总数显示
  - PLAN-300 标签邮件列表
  - PLAN-301 邮件批注回复
  - PLAN-302 批注列表搜索 + Markdown
- 多模块整合
  - PLAN-100 邮件库 + 手册库合并
  - PLAN-303 多用户模式
  - PLAN-10000 Elixir 风格内核代码浏览
- 知识图谱与标签底座
  - PLAN-20000 通用知识标签系统
  - PLAN-31000 统一知识图谱 Phase 1~Graph projection
  - PLAN-31001 知识图谱功能增强（Phase 1 实体删除/图谱可视化/遍历 API；Phase 2 内核版本+文件/符号链接；Phase 3 fulltext search GIN+tsvector；Phase 4 import/export + 变更历史 knowledge_entity_versions；Phase 5 反向引用 KnowledgeBackRefs + 关系方向切换 + relation_type 过滤 + load-more 分页；新增 15 项后端测试，2026-05-06 收尾）
  - PLAN-31003 UI Workbench 第一轮整理
  - PLAN-31004 UI 信息层次与首屏引导（Workbench 第二轮，Dashboard / StickyContextBar / 紧凑结果卡 / Knowledge 拆分 / ThreadDrawer 与移动端收口，2026-05-08 远端冒烟后关闭）
  - PLAN-37001 Kernel Code Atlas（产品边界重定位、code_target normalization、patch/tag/annotation/knowledge/thread 最小闭环、跨版本上下文保持与 patch backlink hunk 导航，2026-05-08 收尾）
  - PLAN-32000 安全/稳定性修复（API key、密码环境变量化）
  - PLAN-33000 Ask ↔ Knowledge 双向闭环 P0
- AI Agent
  - PLAN-35000 AI Research Agent（多轮 loop + cooperative cancel + service 抽离 + prompt 加固，2026-05-01 收尾）
- Semantic Search & Product Quality
  - PLAN-34000 Semantic Search & Quality（Phase 1 真实 pgvector semantic；Phase 3 confirm/prompt → ConfirmModal 清零；Phase 4 组件拆分 5 个主页面合计 -25%~-65%；Phase 5 KnowledgePage chunk 500→54 KB cytoscape 延迟加载；Phase 2 派生为 PLAN-34001；SemanticRetriever 测试 2→6，pagination / date forwarding / missing provider / disabled 均覆盖，2026-05-06 收尾）
  - PLAN-34001 Search/Ask 结果贡献度标记（后端 `/api/contributions/lookup` 单 SQL 聚合 + visibility 过滤；前端 `useContributions` hook 60s 缓存 + `ContributionChips` K/A/D 三色 chip；接入 ResultCard / ConversationCard / ThreadDrawer；12 项后端测试，2026-05-06 收尾）

## 已废弃 / 取代（done/superseded/，2）

- PLAN-10001 code-navigation — 被 PLAN-30002 取代（外链方案）
- PLAN-30000 code-definition-navigation — 被 PLAN-30002 取代（不自建符号索引）

---

## 计划治理规范

1. **新计划命名**：`PLAN-NNNNN-short-slug.md`，编号取下一个未使用的 5 位数
2. **必备元数据头**：见上方模板
3. **完成后处理**：
   - 在 PLAN 顶部更新 `Status: done`，加 "Implementation Status" 段说明落地内容
   - `git mv` 到 `done/`
4. **被取代时**：移到 `done/superseded/`，加 `Superseded by: PLAN-xxx` 说明
5. **依赖声明**：所有跨 PLAN 依赖必须在头部 `Depends-on` 中显式声明
6. **范围控制**：单个 PLAN 超过 5 个 Phase 时建议拆分成多个 PLAN
