# PLAN-31004: UI 信息层次与首屏引导优化（Workbench Refresh 第二轮）

> **Status**: in-progress
> **Updated**: 2026-05-07
> **Depends-on**: PLAN-31003 (done), PLAN-34000 (Phase 4/5 ThreadDrawer 拆分)
> **Priority**: P1

## 背景与问题

PLAN-31003 已完成第一轮统一（PageShell / PageHeader / SectionPanel / 侧边栏分组），全站视觉收敛。但用户反馈仍存在两类核心可用性问题：

1. **首屏没有引导**：登录后落到 `/`（SearchPage），看到的是空搜索框 + 空结果区。新用户不知道"先点哪里"，老用户也不清楚"今天有什么待办"（待 review 的 draft、待审批的批注、未读的 agent 结果）。
2. **信息层次扁平**：
   - `KnowledgePage` 1588 行、`SearchPage` 841 行、`AskPage` 656 行、`ThreadDrawer` 1995 行——长页面把 filter / 主体 / 详情 / 引用 / 翻译堆在一根滚动条上。
   - 关键信息（搜索 hit 计数、当前 channel、被选中的 thread、当前 draft 状态）没有"sticky 摘要条"，滚动后失去定位。
   - 同等权重的 secondary 信息（metadata、quoted 文本、diff、批注 history）抢占视觉，主信息（subject / 答案 / 实体名）反而不突出。

## 是否要"大改"——结论

**不必推倒重来**，但需要中等规模的"信息架构重排"。理由：
- 设计语言、组件库、路由、权限模型已稳定，没有问题。
- 痛点集中在"首屏引导"与"长页面层级"两点，可用 ~3 个 Phase 解决，无需换框架或重写页面。
- ThreadDrawer / KnowledgePage 拆分来就在 PLAN-34000 backlog 里，本 PLAN 与之协同推进，不重复造轮子。

## 目标

- 登录后 5 秒内用户能识别"我现在能干什么、有什么待办"。
- 任意长页面在滚动时保留 ≥ 1 行 sticky 摘要（当前上下文 + 主操作）。
- 主信息字号 / 颜色 / 间距与 secondary 信息形成 ≥ 2 级视觉层级。
- 不新增框架、不改路由、不改 API、不改权限模型。

## Phase 1 — 首屏 Dashboard（路由 `/`）

**改动**：把 `/` 从 SearchPage 改为新建的 `DashboardPage`，搜索保留在 `/search`（在侧边栏改为指向 `/search`，并把 `/` 加默认重定向兜底）。

**Dashboard 内容**（自上而下，每块一个 SectionPanel）：

1. **Welcome strip**：`你好，{display_name}` + role badge + 当前 channel 数 / 邮件总数 / 已 accepted Knowledge 数（MetricCard 组）。
2. **My inbox（个人待办）**：
   - 待我 review 的 KnowledgeDraft 数（路由到 Knowledge → Draft Inbox）
   - 我创建但未发布的 private annotation 数
   - 我发起且未完成的 AgentResearchRun 数
   - admin 额外显示：待审批 annotation 数 / 待审批用户注册数
3. **Quick actions（4–6 个大按钮）**：New search / Ask agent / New agent research / Browse knowledge / Open code / Manuals。
4. **Recent activity（最近 10 条）**：最近 accept 的 Knowledge、最近 commit 的 annotation、最近 agent run。
5. **Index health**：邮件总数、chunk 数、embedding 数、最后一次 collect / index 时间，提示 semantic 是否可用。

**实现要点**：
- 新文件 `web/src/pages/DashboardPage.tsx`（目标 ≤ 350 行）。
- 复用 `MetricCard` / `SectionPanel` / `EmptyState`。
- 数据并行拉取，单卡片自带 skeleton + 错误隔离（一卡失败不影响其他）。
- 首批接口尽量复用现有：`getStats`、`listKnowledgeDrafts`、`listAnnotations`、`listAgentRuns`；如缺 `mine=true` 过滤，作为子任务在后端补可选 query。

## Phase 2 — 长页面 Sticky 上下文条

**改动**：为以下 4 个页面/组件加 sticky 顶部条（`top-0` + 模糊背景），滚动时常驻：

| 页面 | sticky 内容 |
|------|-------------|
| `SearchPage` | 当前 query + 命中数 + 当前 channel/tag 过滤 + 「保存为 draft」按钮 |
| `AskPage` | 当前问题 + 引用条数 + 「转 draft」按钮 |
| `KnowledgePage` | 当前选中实体名 + 类型 badge + 「编辑/删除/查看图谱」 |
| `ThreadDrawer` | 当前 thread subject + 邮件数 / 批注数 + 「翻译开关」「展开/折叠全部」 |

**实现要点**：
- 新建 `web/src/components/StickyContextBar.tsx` 复用组件（ ≤ 80 行）。
- 与 PageHeader 区分：PageHeader 是页面静态标题；StickyContextBar 是"当前上下文 + 高频操作"。
- 滚动时 backdrop-blur + 底部 1px border，避免与下方内容混叠。

## Phase 3 — 信息密度与视觉层级

**SearchPage / AskPage 结果卡**：
- 主行：subject（text-base font-semibold）+ tag chips。
- 次行：sender · date · channel（text-xs text-slate-500）。
- 第三行：snippet 限 2 行 + `line-clamp-2`，hover 才显示 source badge / score。
- 移除当前每条结果侧大块的 metadata 区，用 hover popover 替代。

**ThreadDrawer**：
- 把"邮件正文 / quoted / patch diff / 批注"统一为可折叠 section，默认状态：
  - 第一封邮件 body：展开
  - quoted 段落：折叠（显示行数预览）
  - patch diff：折叠（已是现状，保留）
  - 后续邮件：折叠 + 一键全展开
- 翻译开关从行级移到 sticky bar，作用范围"当前 thread"。

**KnowledgePage**：
- 把 DraftInbox / EntityList / EntityDetail / Graph / Evidence 5 块从单页堆叠改为"左 nav 列 + 主内容区"双栏（在 ≥ lg 屏）。
- 移动端保留单列堆叠，但加锚点跳转 + 顶部 tabs。
- 本 phase 与 PLAN-34000 Phase 4/5（KnowledgePage 拆分）合并执行：拆出 `DraftInboxPanel.tsx`、`EntityListPanel.tsx`、`EntityDetailPanel.tsx`、`GraphPanel.tsx`、`EvidencePanel.tsx` 5 个独立文件，每个 ≤ 400 行。

**AnnotationsPage / TranslationsPage**：
- 卡片改为两栏 grid（≥ lg），减少纵向滚动。
- 列表项的次要信息（创建时间、长度、关联 thread）合并到一行 meta 栏。

> 2026-05-07：Annotations 列表通过 `AnnotationTree layout="grid"` 接入两栏；Translations completed threads 从 table 改为两栏 thread card，并合并 sender/date/email/cache meta。待移动端截图复核。

## Phase 4 — 导航微调（小改动）

- 侧边栏顶部加一个固定的「Home」入口指向 `/dashboard`，图标 `LayoutDashboard`。
- `Search Emails` 的 `to` 改为 `/search`，`end` 去掉。
- `/` 路由的 element 从 `<SearchPage />` 改为 `<DashboardPage />`。
- 不改其他路由，避免破坏外链与历史书签。

## 不在本 PLAN 范围

- 不更换 UI 框架（保持 Tailwind + 自有组件）。
- 不改后端 API 契约（仅允许新增可选 `mine=true` 类的过滤参数）。
- 不重写 ThreadDrawer 的翻译核心逻辑（仅控件位置调整）。
- 不引入图表库。Dashboard 的 metric 用纯 MetricCard，不画 chart（如有需求另起 PLAN）。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Dashboard 拉接口多，首屏慢 | 并行 + 单卡 skeleton + 失败隔离；每个接口超时 3s 退化为 EmptyState |
| Sticky bar 与移动端顶部 header 冲突 | lg 以下屏 sticky bar 简化为单行；测 iOS Safari 100vh 行为 |
| KnowledgePage 拆分量大 | 拆分作为独立 PR，可分阶段 merge；每次只拆一个 panel |
| 用户改 `/` 路由后书签失效 | `/search` 与 `/` 同时可用一段时间；侧边栏标签改为 Search |

## 验收标准

- [x] 登录后 `/` 显示 Dashboard，5 秒内可识别"待办 + 主操作"。（2026-05-07：`DashboardPage` + `/search` 路由切换）
- [x] `/dashboard` 作为 Home 入口，`/` 重定向到 Dashboard，Search 保留 `/search`。（2026-05-07）
- [x] SearchPage / AskPage / KnowledgePage / ThreadDrawer 滚动 500px 仍可见 sticky 上下文条。（2026-05-07：新增 `StickyContextBar`，四处接入；视觉待浏览器截图复核）
- [ ] SearchPage 单条结果默认垂直高度 ≤ 84px（2026-05-07：`ResultCard` 已改为紧凑主次行 + hover metadata；待浏览器像素复核）。
- [x] KnowledgePage 拆分为 ≤ 5 个独立组件文件，主页面 ≤ 400 行。（2026-05-07：`KnowledgePage.tsx` 缩为 wrapper，详情区接入桌面左 nav + 移动端 tabs）
- [ ] `npm run build` 通过；现有 e2e/功能：搜索、Ask 引用跳转、Draft 保存、批注审批、agent run 创建均不回归。（2026-05-07：Phase 1/2/3.Search 前端 build + lint 通过；功能回归待人工冒烟）
- [ ] 移动端（≤ md）所有改动页面无横向滚动、无元素遮挡。

> Verification note 2026-05-07：`npm run lint` / `npm run build` 均通过；FastAPI 冒烟因本机 PostgreSQL 5432 未运行而阻塞（`Connect call failed 127.0.0.1:5432`）。浏览器像素复核和功能回归需在 DB 可用后继续。

## 实施顺序

1. Phase 1（DashboardPage） — 1 PR，独立可上线
2. Phase 4（路由切换） — 跟 Phase 1 同 PR
3. Phase 2（StickyContextBar 组件 + 4 个页面接入） — 1 PR
4. Phase 3.SearchPage/AskPage 卡片密度 — 1 PR
5. Phase 3.ThreadDrawer 折叠默认态 — 1 PR
6. Phase 3.KnowledgePage 拆分 — 多 PR，每个 panel 一次

## Test Plan

- 每个 Phase 单独冒烟：登录、点主入口、看 sticky bar 是否常驻。
- Phase 1 验证：制造 1 个待 review draft / 1 个 private annotation / 1 个 agent run，Dashboard 计数应为 1/1/1。
- Phase 3 ThreadDrawer：打开含引用回复和 patch 的 thread，确认第一封邮件正文默认展开、quoted 文本默认折叠且显示行数、patch diff 默认折叠、展开/收起全部仍正常。
- Phase 3 KnowledgePage 拆分后跑现有人工回归：Draft Inbox accept/reject、实体编辑、图谱遍历、Evidence 展开。
- 视觉层级人工 review：在 1440 / 1024 / 768 / 375 四档宽度下截图对比。

## Follow-up（不在本 PLAN）

- Dashboard 加可配置 widget（用户自定义关心哪些 metric）。
- 首页"今日摘要"接 LLM 生成，作为独立 PLAN（参考 PLAN-35001）。
- ThreadDrawer 完全拆出 `LayeredEmailCard` / `TreeEmailCard` / `AnnotationCard`（PLAN-34000 P4 已规划）。
