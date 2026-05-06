# Plans Index

> Last reorganized: **2026-05-06**

本目录维护项目的规约文档（PLAN-xxx）。已完成的计划归档到 `done/`，被取代的计划归档到 `done/superseded/`。每个活跃 PLAN 顶部应当带元数据头：

```text
> **Status**: planned | in-progress | done | future | superseded
> **Updated**: YYYY-MM-DD
> **Depends-on**: PLAN-xxx, PLAN-yyy
> **Priority**: P0 | P1 | P2 | P3
```

---

## 活跃计划（6）

| PLAN | 主题 | Status | Priority | 备注 |
|------|------|--------|----------|------|
| [PLAN-30002](PLAN-30002-external-code-jump.md) | 外链代码跳转（Elixir/lore） | in-progress | **P1** | 反向闭环 + Phase 1+2+3+4+5 已完成；仅剩 external_links 内网镜像验证 |
| [PLAN-31001](PLAN-31001-knowledge-graph-enhancements.md) | 知识图谱功能增强 | in-progress | P1 | 实体删除 / 图谱遍历 / 内核版本关联未做 |
| [PLAN-31004](PLAN-31004-ui-information-hierarchy.md) | UI 信息层次与首屏引导（Workbench 第二轮） | planned | **P1** | Dashboard + Sticky 上下文条 + 信息密度 |
| [PLAN-34001](PLAN-34001-evidence-contribution-badges.md) | Search/Ask 结果贡献度标记 | planned | **P1** | 从 PLAN-34000 Phase 2 派生，后端 lookup + 前端 chip |
| [PLAN-31002](PLAN-31002-knowledge-workbench-roadmap.md) | Knowledge Workbench 路线图 | in-progress | P2 | 范围过大，新工作请新建独立 PLAN 引用 |
| [PLAN-35001](PLAN-35001-FUTURE-ai-assisted-knowledge-pipeline.md) | AI 邮件入库流水线 | future | P3 | 100 万邮件 LLM 成本 ~$2000，先验证再放量 |

---

## 推荐执行顺序

1. ~~**P1** PLAN-30002 Phase 1+2（externalLinks 工具 + Code Browser 接入 Elixir）~~ ✅ 2026-05-01
2. ~~**P1** PLAN-34000 Phase 4 组件拆分（ThreadDrawer / KnowledgePage / SearchPage / KernelCodePage / AskPage）~~ ✅ 2026-05-06
3. ~~**P1** PLAN-34000 Phase 1/3/5 收尾（SemanticRetriever 测试 2→6、confirm/prompt → ConfirmModal、KnowledgePage chunk 500→54 KB）~~ ✅ 2026-05-06
4. **P1** PLAN-34001 贡献度标记（后端 `/api/contributions/lookup` + 前端 chip）
5. **P1** PLAN-31001 Phase 1（实体删除 API + 图谱遍历 API + 简单可视化）
6. **P1** PLAN-30002 Phase 3+5（ThreadDrawer 邮件正文路径识别 + lore 链接）
7. **P3** PLAN-35001 P1 起步（本地小模型去噪，零 API 成本）

---

## 已完成（done/，21）

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
  - PLAN-31003 UI Workbench 第一轮整理
  - PLAN-32000 安全/稳定性修复（API key、密码环境变量化）
  - PLAN-33000 Ask ↔ Knowledge 双向闭环 P0
- AI Agent
  - PLAN-35000 AI Research Agent（多轮 loop + cooperative cancel + service 抽离 + prompt 加固，2026-05-01 收尾）
- Semantic Search & Product Quality
  - PLAN-34000 Semantic Search & Quality（Phase 1 真实 pgvector semantic；Phase 3 confirm/prompt → ConfirmModal 清零；Phase 4 组件拆分 5 个主页面合计 -25%~-65%；Phase 5 KnowledgePage chunk 500→54 KB cytoscape 延迟加载；Phase 2 派生为 PLAN-34001；SemanticRetriever 测试 2→6，pagination / date forwarding / missing provider / disabled 均覆盖，2026-05-06 收尾）

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