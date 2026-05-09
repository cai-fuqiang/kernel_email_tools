# PLAN-39001: Code History To Knowledge

> **Status**: in-progress
> **Updated**: 2026-05-09
> **Depends-on**: PLAN-30002, PLAN-30004, PLAN-31002
> **Priority**: P1 — 在 Code Browser 中把代码选区、提交历史和人工 Knowledge 沉淀连成闭环

## Summary

在 Code Browser 中，用户选中某一行或一段代码后，系统展示该代码范围相关的 commit 历史，并允许用户选择 commit、代码片段、邮件线程或外链保存到 Knowledge。这个能力的定位不是自动解释所有代码历史，而是把“读代码时发现的重要历史上下文”低摩擦地沉淀为可复用、可追溯的知识证据。

核心闭环：

```text
Code Browser 选中代码
  -> 查看 line history / blame / related commits
  -> 打开 commit 详情和 lore/thread 线索
  -> 用户挑选有价值的证据
  -> 保存到已有 Knowledge 或创建新 Feature / Topic
  -> Knowledge 中保留 code range + commit + thread + human note
```

## Implementation Status

2026-05-09 已完成一大步 MVP：

- 后端新增 `GET /api/kernel/blame`、`GET /api/kernel/line-history`、`GET /api/kernel/commit`。
- 前端新增 `CodeHistoryPanel`，接入 Code Browser Inspector。
- 用户选中代码行/区块后，可以查看最后修改 commit、`git log -L` 历史 commit、展开 commit 详情、勾选 evidence。
- Evidence Basket 支持 code range、commit、lore/link，并可保存为 Knowledge Draft。
- Knowledge Draft payload 保留 code range snapshot、selected commits、links、human note 和 target topic 信息。
- 当前仍未完成：commit → 本地邮件线程自动命中、线程导入、Knowledge Evidence active 写入视图。

## Design Judgment

这个设计合理，但需要控制边界。

### 合理之处

- 内核代码的设计意图常常藏在 commit message、patch revision 和邮件讨论里，单看当前代码不够。
- 从 Code Browser 发起保存动作符合阅读流：用户正在看到具体代码，最容易判断这段代码是否值得沉淀。
- Knowledge Workbench 已经支持 evidence、timeline、manual notes 和 feature/topic 组织方式，适合作为承接层。
- commit / code range / thread 都是可审计证据，比纯 AI 摘要更可靠。

### 需要避免的误区

- 不把 `git blame` 当成“设计来源”。blame 只能给最后一次修改，可能只是格式调整或重构。
- 不默认把所有 commit 写入 Knowledge。系统只提供候选，用户确认后保存。
- 不要求一次性建完整历史时间轴。MVP 先做“相关证据列表”，时间轴可以从真实使用中升级。
- 不把 AI 生成内容直接写入正式知识。AI 只能生成草稿摘要和关联建议。

## Product Scope

### MVP

1. Code Browser 支持代码行/区块选择。
2. 右侧 Inspector 展示选区上下文：
   - 文件、版本、起止行。
   - 代码片段预览。
   - `git blame` 最后修改 commit。
   - `git log -L` 历史 commit 列表。
3. 用户可展开 commit 卡片：
   - commit hash、subject、作者、日期。
   - commit message 摘要。
   - `Link:` / lore URL / `Fixes:` 等 trailer。
   - 若已有邮件库命中，显示 thread 入口。
4. 用户可选择以下证据保存到 Knowledge：
   - 当前代码选区。
   - 一个或多个 commit。
   - commit message 中解析出的 lore/thread。
   - 用户人工备注。
5. 保存目标：
   - 添加到已有 Knowledge entity。
   - 创建新的 `feature_topic` Knowledge entity。
   - 暂存为 Knowledge Draft，等待后续审核。

### Non-goals

- 不做完整 Git 历史挖掘或自动生成完整演进史。
- 不做全局符号引用分析。
- 不替代 Elixir、LXR、IDE 或 LSP。
- 不自动导入所有 lore 线程。
- 不从代码推断 rejected patch 或设计争议；只能把它作为后续人工/AI 研究入口。

## Data Model Direction

优先复用现有模型，避免新增过重结构。

### Code Range Evidence

建议作为 `knowledge_evidence` 的一种 source：

```text
source_type: code_range
source_ref:
  version: v6.6
  path: mm/mmap.c
  start_line: 123
  end_line: 156
  code_sha: optional file blob hash
  selected_text_snapshot: optional
claim: 用户或 AI 说明这段代码支持什么结论
```

### Commit Evidence

```text
source_type: commit
source_ref:
  repo: linux
  commit_hash: <sha>
  subject: ...
  author: ...
  author_time: ...
  trailers:
    Link: ...
    Fixes: ...
    Reviewed-by: ...
claim: 该提交说明/改变了什么
```

### Thread Evidence

已有邮件证据继续复用：

```text
source_type: email | thread | patch
message_id: ...
thread_id: ...
source_ref:
  lore_url: ...
  subject: ...
```

### Knowledge Meta

Knowledge entity 可以保留轻量关联字段，便于前端展示：

```text
meta.related_code_ranges[]
meta.related_commits[]
meta.related_threads[]
meta.related_links[]
```

长期如果使用频繁，再考虑把这些全部正规化为单独 evidence rows。

## Backend Plan

### Phase 1: Code History API

- [ ] 新增 `GET /api/kernel/blame`
  - 输入：`version`, `path`, `line`
  - 返回最后修改该行的 commit 摘要。
- [ ] 新增 `GET /api/kernel/line-history`
  - 输入：`version`, `path`, `start_line`, `end_line`
  - 执行 `git log -L <start>,<end>:<path>`。
  - 返回 commit 列表，不返回无限原始 diff。
  - 支持 `limit`，默认 30。
- [ ] 新增 `GET /api/kernel/commit`
  - 输入：`version`, `commit_hash`
  - 返回 commit metadata、message、trailers、changed files、可选 diff stat。
- [ ] 解析 commit trailers：
  - `Link:`
  - `Fixes:`
  - `Closes:`
  - `Reported-by:`
  - `Reviewed-by:`
  - `Suggested-by:`
  - `Signed-off-by:`
- [ ] 从 lore URL 提取 message id 或可检索 token。

### Phase 2: Knowledge Capture API

- [ ] 扩展现有 evidence 创建接口，支持 `code_range` 和 `commit`。
- [ ] 支持从 Code Browser 发起 `Knowledge Draft`：
  - draft title 自动建议。
  - evidence bundle 包含 code range + selected commits + links。
  - 用户备注作为 human note draft。
- [ ] 如果 lore/thread 已存在本地邮件库，自动建立 evidence 关联。
- [ ] 如果本地没有该 thread，只保存 lore 外链，不阻塞保存。

### Phase 3: Optional Thread Import

- [ ] 在 commit detail 中出现 lore 链接但本地无邮件时，显示“导入线程”动作。
- [ ] 导入应有明确确认和进度状态。
- [ ] 导入完成后自动把 thread evidence 追加到 draft 或 Knowledge。

## Frontend Plan

前端目标是让用户在不离开 Code Browser 的情况下完成“发现历史 -> 挑选证据 -> 写入 Knowledge”。

### Interaction Model

1. 用户点击行号或拖拽选择代码块。
2. 右侧 Inspector 自动切到 `History` tab。
3. 顶部展示当前选区摘要和主要动作。
4. commit 列表默认按时间倒序，支持筛选：
   - All
   - Has lore link
   - Fixes
   - Touches selected range
   - Likely semantic change
5. 用户勾选 commit 和 links。
6. 点击 `Add to Knowledge`。
7. 弹出保存面板，选择已有知识或新建主题，填写 claim/note。
8. 保存后显示 Knowledge backlink。

## 具体前端图

以下是需要设计/实现的具体前端图。每张图都应该覆盖 desktop 和 narrow viewport 两种状态；MVP 可以先实现 desktop，移动端以抽屉降级。

已生成静态 mockup 和 PNG 截图：

- Mockup HTML: `PLAN-39001-frontend-mockups.html`
- 图 1: `PLAN-39001-fig-1-history-inspector.png`
- 图 2: `PLAN-39001-fig-2-commit-detail.png`
- 图 3: `PLAN-39001-fig-3-evidence-basket.png`
- 图 4: `PLAN-39001-fig-4-add-to-knowledge.png`
- 图 5: `PLAN-39001-fig-5-knowledge-evidence.png`
- 图 6: `PLAN-39001-fig-6-empty-state.png`
- 图 7: `PLAN-39001-fig-7-mobile-inspector.png`

### 图 1: Code Browser With History Inspector

用途：主阅读界面。用户选择代码后，右侧显示历史面板。

```text
+--------------------------------------------------------------------------------+
| Top nav / version selector / path search                                        |
+-----------------------------+--------------------------------------------------+
| File tree                   | mm/mmap.c                                  v6.6  |
|                             |--------------------------------------------------|
| - mm                        | 118  static int ...                              |
| - fs                        | 119                                             |
| - include                   | 120  [selected code block starts]               |
|                             | 121      ...                                    |
|                             | 122  [selected code block ends]                 |
|                             |                                                  |
+-----------------------------+-----------------------------+--------------------+
|                                                           History Inspector     |
| Selection: mm/mmap.c:120-122                                                    |
| Tabs: History | Annotations | Knowledge                                         |
|                                                                                |
| Last touched                                                                   |
|   a1b2c3d mmap: fix ...                  2025-03-12                            |
|                                                                                |
| Line history                                                                    |
|   [ ] e4f5g6h mm: introduce ...         Link: lore                             |
|   [ ] 9a8b7c6 mm: refactor ...                                                |
|   [ ] 1122334 mm: fix regression ...    Fixes: ... Link: lore                  |
|                                                                                |
| [Add selected evidence to Knowledge]                                            |
+--------------------------------------------------------------------------------+
```

关键控件：

- History / Annotations / Knowledge tabs。
- commit checkbox。
- lore/link indicator。
- semantic/noise badge，例如 `behavior`, `refactor`, `formatting`。
- `Add to Knowledge` 主动作。

### 图 2: Commit Detail Drawer

用途：用户展开某个 commit，核查 message、trailers 和相关线程。

```text
+--------------------------------------------------------------+
| Commit e4f5g6h                                                |
| mm: introduce new mmap accounting behavior                    |
| Author: ...                         Date: 2024-11-03          |
+--------------------------------------------------------------+
| Summary                                                       |
|   Commit message first paragraphs...                          |
|                                                              |
| Trailers                                                      |
|   Link        lore.kernel.org/...       [Open] [Use evidence] |
|   Fixes       112233445566              [Open commit]         |
|   Reviewed-by Name <mail>                                      |
|                                                              |
| Changed files                                                 |
|   mm/mmap.c +42 -18                                           |
|   include/linux/mm.h +3 -1                                    |
|                                                              |
| Local mail thread                                             |
|   Found: [PATCH v4] mm: introduce ...                         |
|   Replies: 18                         [Open thread]           |
|                                                              |
| [Select this commit] [Add link only] [Close]                  |
+--------------------------------------------------------------+
```

关键控件：

- `Use evidence` 可把某个 trailer 或 thread 加入待保存篮子。
- 本地已导入邮件显示 `Open thread`。
- 未导入邮件显示 `Import thread` 或 `Save link only`。

### 图 3: Evidence Basket

用途：在保存前暂存用户选择的代码、commit、thread 和 link。

```text
+---------------------------------------------+
| Evidence Basket                              |
+---------------------------------------------+
| Code range                                   |
|   mm/mmap.c:120-122               [Remove]  |
|                                             |
| Commits                                     |
|   e4f5g6h introduce behavior      [Remove]  |
|   1122334 fix regression          [Remove]  |
|                                             |
| Threads / links                             |
|   lore: [PATCH v4] ...            [Remove]  |
|                                             |
| Human note                                  |
|   [This looks like the first semantic ...]  |
|                                             |
| [Add to Knowledge]                          |
+---------------------------------------------+
```

关键控件：

- 可移除每类 evidence。
- Human note 直接进入 draft。
- 空状态提示用户先勾选 commit 或 link。

### 图 4: Add To Knowledge Modal

用途：选择保存目标，并把 evidence 变成可审核的 Knowledge 资料。

```text
+------------------------------------------------------------------+
| Add to Knowledge                                                  |
+------------------------------------------------------------------+
| Save target                                                       |
| ( ) Existing topic  [ Search topic...                         ]   |
| ( ) New topic       [ mmap VMA merge behavior                 ]   |
|                                                                  |
| Claim                                                            |
| [ This code path was introduced to ...                         ] |
|                                                                  |
| Evidence to attach                                                |
| [x] Code range: mm/mmap.c:120-122                                 |
| [x] Commit: e4f5g6h mm: introduce ...                             |
| [x] Thread: [PATCH v4] mm: introduce ...                          |
|                                                                  |
| Save as                                                          |
| ( ) Draft for review                                              |
| ( ) Direct evidence on active Knowledge                           |
|                                                                  |
| [Cancel]                                      [Save evidence]     |
+------------------------------------------------------------------+
```

关键控件：

- 默认选 `Draft for review`。
- 只有用户明确选择时才写 active Knowledge。
- Claim 必填，避免无意义收藏。

### 图 5: Knowledge Evidence View

用途：在 Knowledge 详情页查看从 Code Browser 保存来的证据。

```text
+--------------------------------------------------------------------------------+
| Knowledge: mmap VMA merge behavior                                              |
+--------------------------------------------------------------------------------+
| Timeline | Explanation | Evidence | Notes | Relations                           |
|                                                                                |
| Evidence                                                                       |
|   Claim: This path changed VMA merge behavior for ...                           |
|                                                                                |
|   Code range                                                                    |
|     mm/mmap.c:120-122 @ v6.6                         [Open in Code Browser]     |
|                                                                                |
|   Commit                                                                        |
|     e4f5g6h mm: introduce new mmap accounting behavior [Open commit]            |
|                                                                                |
|   Mail thread                                                                   |
|     [PATCH v4] mm: introduce ...                     [Open thread] [Lore]       |
|                                                                                |
|   Human note                                                                    |
|     User-written note preserved here.                                           |
+--------------------------------------------------------------------------------+
```

关键控件：

- 从 Knowledge 回跳 Code Browser 并恢复选区。
- 从 commit 回跳 commit drawer。
- 从 thread 打开 ThreadDrawer。

### 图 6: Empty / No History State

用途：处理本地 repo 不存在、文件未命中、旧版本无 line history、commit 无 lore 链接等情况。

```text
+---------------------------------------------+
| History unavailable                          |
+---------------------------------------------+
| Local kernel repo does not contain v2.6.12,  |
| or this file/range cannot be resolved.       |
|                                             |
| Available actions                           |
| [Open external source] [Save code range]     |
| [Configure local repo]                       |
+---------------------------------------------+
```

关键控件：

- 不阻塞保存代码选区。
- 明确区分 `no local repo`、`git command failed`、`no lore link`、`no commits found`。

### 图 7: Mobile / Narrow Inspector

用途：窄屏下不做三栏，历史面板改为底部抽屉。

```text
+-----------------------------------+
| path / version                    |
+-----------------------------------+
| code view                         |
| 120 selected ...                  |
| 121 selected ...                  |
+-----------------------------------+
| Bottom sheet: History             |
| Selection mm/mmap.c:120-122       |
| [History] [Basket] [Knowledge]    |
| e4f5g6h introduce ...             |
| 1122334 fix ...                   |
| [Add to Knowledge]                |
+-----------------------------------+
```

关键控件：

- Bottom sheet 可展开/收起。
- 选区摘要固定在 sheet 顶部。
- 主动作始终可达。

## Frontend Component Plan

建议新增或拆分组件：

- `CodeHistoryInspector`
  - 管理 tabs、选区摘要、history loading state。
- `LineHistoryList`
  - 展示 `git log -L` commit 列表。
- `CommitCard`
  - 简短 commit 行，支持勾选、展开。
- `CommitDetailDrawer`
  - commit message、trailers、changed files、thread match。
- `EvidenceBasket`
  - 暂存 code range / commit / thread / link。
- `AddToKnowledgeModal`
  - 选择目标 Knowledge、填写 claim、保存 draft。
- `KnowledgeEvidenceCodeRange`
  - Knowledge 页中的 code range evidence 展示和回跳。

## UX Rules

- 默认只展示 10 条历史，用户点击加载更多。
- commit 列表要清楚标记“最后修改”和“历史修改”，避免用户把 blame 当成完整来源。
- `Has lore link` 是信号，不是价值判断。
- AI 摘要只显示为 draft 文案，并标注需要人工确认。
- 保存动作必须保留原始证据引用，不只保存摘要。
- 失败状态必须可继续：即使拿不到 commit 历史，也允许保存 code range + 人工 note。

## AI Assistance

AI 可以做三件事：

1. 给 commit 列表打候选标签：
   - semantic change
   - refactor
   - formatting
   - bug fix
   - revert
2. 为 evidence basket 生成 claim 草稿。
3. 推荐可能的已有 Knowledge entity。

AI 不应该做三件事：

1. 自动选择哪些 commit 入库。
2. 自动判定某个 commit 是设计根因。
3. 无人工确认地写入 active Knowledge。

## Validation Plan

先做 10 个真实样本验证：

| 样本 | 子系统 | 代码范围 | 预期验证 |
|------|--------|----------|----------|
| 1 | mm | `mm/mmap.c` 选区 | `git log -L` 噪音比例 |
| 2 | sched | `kernel/sched/fair.c` 选区 | 老 commit 是否有 lore link |
| 3 | fs | `fs/ext4/*` 选区 | commit/thread 关联质量 |
| 4 | net | `net/core/*` 选区 | 多文件变更展示 |
| 5 | rcu | `kernel/rcu/*` 选区 | 设计讨论是否在 commit 外部 |
| 6 | arch/x86 | arch-specific 选区 | 版本和路径可解析性 |
| 7 | include | header 选区 | 宏/inline 函数历史 |
| 8 | drivers | driver 选区 | 噪音 commit 比例 |
| 9 | security | fix commit 选区 | `Fixes:` / `Closes:` trailer |
| 10 | old version | 早期内核选区 | 无 lore link 时体验 |

判断标准：

- 至少 70% 样本能正常展示 line history。
- 至少 50% 样本能找到一个用户认为有价值的 commit 或 link。
- 保存到 Knowledge 的流程不超过 3 个主要动作：选择 evidence -> Add to Knowledge -> Save。
- 无 lore/link 时，UI 不显得像失败，而是允许保存代码和人工判断。

## Implementation Order

1. 后端只做 `blame`、`line-history`、`commit` 三个读接口。
2. 前端 Code Browser 接入 `History Inspector`，只展示历史，不保存。
3. 增加 Evidence Basket，本地状态即可。
4. 接入 Knowledge Draft 保存。
5. Knowledge 页面展示 code range / commit evidence。
6. 增加 lore/thread 命中和可选导入。
7. 再考虑 AI claim 草稿和 commit 噪音分类。

## Open Questions

- `git log -L` 对大选区的性能上限如何设置？建议 MVP 限制 1-80 行。
- commit detail 是否需要展示 diff？MVP 可以只展示 diff stat 和 changed files。
- 保存到 active Knowledge 是否需要权限或二次确认？建议默认写 draft。
- lore URL 到本地 message/thread 的匹配规则是否足够稳定？需要先用样本验证。
- code range 保存 snapshot 还是只保存 path + line？建议两者都保存：line 用于回跳，snapshot 用于历史可审计。
