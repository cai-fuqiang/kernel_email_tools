# PLAN-30002: 外链代码跳转与外部站点标注闭环

> **Status**: reoriented (Phase 1-5 保留；Phase 3 邮件→代码路径识别砍掉；新增 Phase 8 代码→邮件追溯链路)
> **Updated**: 2026-05-09
> **Depends-on**: PLAN-30003 (砍掉邮件→代码自动跳转)
> **Supersedes**: PLAN-30000-code-definition-navigation, PLAN-10001-code-navigation
> **Priority**: P0 — 从确定版本的代码出发，沿 git blame → commit → lore link → 邮件线程追溯

## 决策背景

放弃自建符号索引（ctags / tree-sitter / cscope），改为利用外部站点 + 油猴脚本注入完成代码跳转和反向标注闭环。原因：

- Elixir Bootlin 已经投入多年解决符号歧义、宏、条件编译、跨版本索引问题，自建重写不会赢
- 单版本 ctags 50~80MB，全版本数 GB；多版本独立索引随版本数线性膨胀
- 项目核心是邮件知识库，代码跳转是辅助阅读功能而非主路径
- 已有更轻量的方案：油猴脚本把本系统的标注/标签能力注入到 Elixir 页面

### 2026-05-06 决策修正：外链保留，但不再作为主路径

当前代码跳转极度依赖 `elixir.bootlin.com`。这对早期验证很高效，但不适合作为后续 AI-assisted code understanding / Contextual Ask 的地基：

- 外部站点可用性、速度、URL 结构和版本覆盖不可控。
- AI 解释代码时需要稳定拿到本地文件、版本、行号、邻近函数、patch hunk 和邮件 evidence；外链页面只能作为展示入口。
- 本项目的核心价值是可引用、可审核、可沉淀的 kernel knowledge base，代码证据也应优先来自本系统可控数据源。
- 如果直接在 Elixir 依赖上叠加 GILT-like 功能，只会变成“外链阅读增强器”，无法成为知识库闭环的一部分。

因此本计划后续方向调整为：

1. **本地代码导航优先**：`/api/kernel/file/{version}/{path}` 和本地 kernel git repo 是主事实源。
2. **Elixir / git.kernel.org 作为 fallback 外链**：保留外链按钮和油猴脚本反向标注闭环，但不再把 Elixir 当成唯一代码导航能力。
3. **新增统一 Code Resolver**：前端不直接拼 Elixir URL，而是先解析到本地 code target；本地不可用时再退回外部站点。
4. **先做最小符号索引，不做完整 LSP**：优先支持路径、行号、函数/宏/struct 定义和 patch header 到文件的跳转；暂不追求完整跨版本引用分析。
5. **Contextual Ask 依赖本地 resolver**：只有当本地代码上下文稳定后，再做”解释选中代码 / 找相关邮件 / 关联手册 / 生成 Knowledge Draft”。

### 2026-05-09 方向修正：砍掉邮件→代码，改为代码→邮件追溯

**原有设计的问题**（详见 PLAN-30003）：

从邮件 patch diff 自动跳转到代码，这条路在根本上不可靠：

- 邮件的 patch 缺少版本锚点——不知道 patch 基于哪个内核版本
- `@@` hunk 行号是相对 patch base 的，base 不确定则行号无意义
- 邮件标题的 `[PATCH v6.10]` 是目标版本而非 base 版本
- 邮件中的 `mm/vmscan.c:1234` 文字引用没有版本号

**修正方向：反转链路**

```
旧方向（不可靠）：邮件 patch diff → 猜测版本 + 行号 → 代码
新方向（可靠）：  代码行 → git blame → commit → commit message 中的 lore 链接 → 邮件线程
```

新链路每一步都有明确依据：

| 步骤 | 依据 | 可靠性 |
|------|------|--------|
| 代码行 → commit | `git blame` 精确到 commit hash | 100% |
| commit → 邮件 | commit message 中的 `Link: https://lore.kernel.org/...` | 内核社区强惯例，绝大多数 mainline commit 都有 |
| 邮件 → 各版本 patch | lore 的 `In-Reply-To` 线程模型 + 相同 subject 前缀搜索 | lore 线程模型完整 |
| 邮件 → 外链 | 邮件正文中的 URL/Message-ID 提取 | 直接文本提取 |
| 邮件 → 相关 commit | commit message 中的 `Fixes:` / `Reviewed-by:` / `Closes:` 等 tag | 结构化，可解析 |

**对现有计划的影响：**

- Phase 3 的”邮件正文路径识别 → 代码跳转”——砍掉，方向本身就是反的
- Phase 6 的”patch header 优先打开本地文件”——砍掉 patch header 部分
- Phase 6 的 local-first code resolver——保留，用于 Code Browser（版本确定时）的本地/外链 fallback
- 新增 Phase 8：代码→邮件追溯链路

## 当前已实现的能力

### ✅ 后端 Elixir 适配器
- `src/kernel_source/elixir.py`：`ElixirSource` 通过 httpx 抓取 elixir.bootlin.com
- `src/kernel_source/fallback.py`：本地 git 找不到 tag 时自动回退到 Elixir
- 用于补全本地 git 仓库未覆盖的历史版本

### ✅ 反向闭环：Elixir → 本系统标注（油猴脚本方案）
- `userscripts/elixir-annotate.user.js`：Tampermonkey/Greasemonkey 用户脚本
  - 匹配 `https://elixir.bootlin.com/linux/*`
  - 解析当前 URL 的 version + filePath
  - 在 Elixir 代码页注入交互：选中行号范围 → 弹面板 → 调用 `/api/kernel/annotations` 创建标注、绑定标签
  - 通过 `GM_xmlhttpRequest` 跨域调用本系统 API
  - 携带 session cookie，复用现有认证体系
- `KernelCodePage.tsx` "Copy Script" 按钮：
  - 从 `/app/userscripts/elixir-annotate.user.js` 拉取脚本
  - 自动注入当前部署的 `API_BASE` 和 session cookie
  - 复制到剪贴板，用户粘贴到 Tampermonkey 即可启用
- 已发布到 `web/public/userscripts/`，FastAPI 静态挂载

**这是核心闭环：用户在 Elixir 任意版本任意文件选中行 → 直接打标签/写批注 → 数据落到本系统的 `code_annotations` 表，完全复用现有标注 / 标签 / 知识图谱体系。**

---

## 待实现：本系统 → 外部站点的正向跳转

### Phase 1: 工具函数集中 ✅

- [x] 新增 `web/src/utils/externalLinks.ts`：统一存放各种 URL 构建函数
  - `elixirSourceUrl(version, path, line?)` ← 替代 `KernelCodePage.tsx` 中原有的 `elixirUrl()` 私有函数
  - `elixirIdentUrl(version, symbol)` — 符号搜索
  - `gitKernelOrgUrl(version, path, line?)` — Elixir 不覆盖的版本 fallback（cgit `?h=<tag>#n<line>`）
  - `loreUrl(messageId)` — 自动剥离尖括号 + URL 编码
  - `pickKernelSourceUrl(version, path, line?)` — 根据 `elixirSupportsVersion` 启发式自动选择 Elixir / git.kernel.org，返回 `{ url, source }`
  - `setExternalLinksConfig({ elixir_base, git_base, lore_base })` — 运行时基地址覆盖入口
- [x] 后端 `external_links` 配置：通过 `GET /api/system/config` 暴露（`src/api/routers/system.py::system_config`），前端 `main.tsx` 启动时拉取并注入 `setExternalLinksConfig`
  ```yaml
  external_links:
    elixir_base: "https://elixir.bootlin.com/linux"
    git_base: "https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git"
    lore_base: "https://lore.kernel.org/all"
  ```

### Phase 2: KernelCodePage 接入正向跳转 ✅（核心已完成）

- [x] 文件视图工具栏：移除本地 `elixirUrl()` 函数，改用 `pickKernelSourceUrl`，按钮根据版本自动显示 "在 Elixir 查看" / "在 git.kernel.org 查看"，附 `lucide-react` 的 `ExternalLink` 图标 + URL tooltip
- [x] 代码行 hover 时行尾出现外链图标（`opacity-0 group-hover:opacity-100`），点击直接跳到 Elixir/git.kernel.org 对应行号；`stopPropagation` 避免触发选中
- [x] 文件树条目（文件类型）hover 时尾部显示 ExternalLink 图标，点击跳转外链
- [x] 选中文本（标识符）后增加 "在 Elixir 搜索符号" 浮动按钮 → 调用 `elixirIdentUrl`（`KernelCodePage.tsx` 监听代码视图 `mouseup`，用 `isLikelyCIdentifier` 过滤，按 Esc / 点击外部关闭）

### Phase 3: ~~ThreadDrawer 邮件正文路径识别~~ ❌ 废弃 (2026-05-09)

- [x] 新增 `web/src/utils/kernelPathRefs.ts`：
  - `parseKernelPathRefs(text)` — 用正则识别形如 `mm/vmscan.c`、`fs/ext4/inode.c:1234`、`include/linux/sched.h` 的内核路径（白名单顶级目录）
  - `extractPatchHeaderPath(line)` — 从 `--- a/path` / `+++ b/path` 提取路径，自动剥离 `a/` `b/` 前缀，处� `/dev/null`
  - `extractPatchVersion(subject)` — 从邮件主题 `[PATCH v6.10]` 提取版本号
- [x] 新增 `web/src/components/KernelPathLinkedText.tsx`：在 `<pre>`/`<span>` 中渲染带路径链接的纯文本（保留空白/换行）
- [x] ThreadDrawer 的 LayeredEmailCard 和 TreeEmailCard 段落渲染接入 KernelPathLinkedText
- [x] PatchDiffBlock 支持 `version` prop；`diff --git a/X b/Y`、`--- a/path`、`+++ b/path` 渲染为可点击链接
- [x] ~~链接版本来源优先级~~ — 废弃，方向反了

**→ Phase 3 整体废弃，详见 PLAN-30003。由 Phase 8 代码→邮件追溯链路替代。**

### Phase 4: Knowledge entity 文件链接 ✅

- [x] 实体 `meta.source_files` / `meta.symbols` 字段渲染时直接生成 Elixir 链接（已在 `KnowledgeEntityMetaPanel.tsx` 实现）
- [x] 不引入新 schema，仅做前端渲染

### Phase 5: lore.kernel.org 邮件原文链接 ✅

- [x] ThreadDrawer LayeredEmailCard 和 TreeEmailCard 头部在"复制消息链接"按钮旁增加 "在 lore 查看原文" 按钮（ExternalLink 图标）
- [x] Knowledge evidence 列表（直接证据 `evidenceRows` + 生成证据 `evidence.sources`）中每条邮件 message_id 旁加 lore 链接

### Phase 6: Local-first Code Resolver（新增，P1）

目标：把 Elixir 从主路径降级为 fallback，让本系统自己拥有稳定的代码上下文解析能力，为后续 Contextual Ask / AI code understanding 做地基。

- [x] 后端新增统一 resolver service：
  - 输入：`version`, `path`, optional `line`, optional `symbol`
  - 输出：`source=local|elixir|git_kernel_org`, `url`, `local_file_available`, `resolved_version`, `path`, `line`, optional `symbol_kind`
  - 优先级：本地 kernel git repo -> Elixir -> git.kernel.org
- [x] 新增 API：
  - `GET /api/kernel/resolve?version=...&path=...&line=...`
  - `GET /api/kernel/resolve-symbol?version=...&symbol=...&path_hint=...`（待最小符号索引阶段实现）
- [x] 前端 `pickKernelSourceUrl` 升级为 resolver client：
  - Code Browser、ThreadDrawer、PatchDiffBlock、Knowledge meta 都走同一 resolver
  - UI 明确区分本地跳转和外部跳转，但交互保持轻量
  - `KernelSourceLink` 共享 `resolveKernelSource` 缓存，避免同一页面重复请求相同 path/line
- [x] 本地文件路径跳转：
  - 邮件正文路径识别优先打开本系统 Code Browser
  - Patch header `diff --git` / `--- a/` / `+++ b/` 优先打开本地对应文件和行号
  - 本地缺失时显示外链 fallback
- [ ] 最小符号索引：
  - 复用已有 `scripts/index_symbols.py`，先覆盖函数、宏、struct/enum 定义
  - 不做完整 Find References，不做跨配置条件编译解析
  - 记录索引版本、kernel tag、生成时间，避免旧索引误导跳转
- [ ] Contextual Ask 前置接口：
  - resolver 能返回选中代码片段、邻近函数范围、文件路径、版本和行号
  - Ask Agent 后续可把这些内容作为 trusted local context，并继续把邮件/手册检索结果标记为 untrusted evidence

#### Phase 6 验收标准

- 用户点击邮件正文或 patch hunk 中的 `mm/foo.c:123`，默认进入本系统 Code Browser 对应版本和行号。
- 本地 repo 没有该版本/文件时，才退回 Elixir 或 git.kernel.org。
- 代码跳转不依赖 `elixir.bootlin.com` 可用性；断网时本地已索引版本仍可浏览。
- resolver 后端覆盖本地命中、外链 fallback、旧版本 git.kernel.org fallback、非法路径拒绝测试。
- 至少覆盖 50 个真实邮件路径引用、20 个 patch header、20 个符号定义跳转样本。
- 所有 fallback 都在 trace/debug 信息中可见，便于定位本地索引缺口。

### Phase 7: GILT-like Contextual Ask（新增，P2，依赖 Phase 6）

目标：借鉴 ICSE 2024 GILT 论文的核心思想，但只做适合本项目的 Web 工作台版本：上下文自动注入 + 低 prompt 成本 + evidence-first 输出。

- [ ] 在邮件段落、patch hunk、代码选区上提供固定动作：
  - `解释这段`
  - `找相关邮件`
  - `关联代码/手册`
  - `总结争议点`
  - `生成 Knowledge Draft`
- [ ] 复用现有 `/api/ask`、search、thread、knowledge draft 机制，不新增独立聊天系统。
- [ ] 回答必须带 sources / threads / executed_queries / retrieval_stats。
- [ ] AI 结果只进入 draft/review，不直接写入正式知识库。
- [ ] UI 不做自动弹出式提示，避免打扰阅读流。

#### Phase 7 非目标

- 不优先做 VS Code 插件。
- 不优先接 OpenClaw。
- 不做无证据的纯 LLM 代码解释。
- 不把 Elixir 页面内容作为唯一 evidence。

### Phase 8: 代码→邮件追溯链路（新增，P1）

**2026-05-09 新增**：替代废弃的 Phase 3（邮件→代码）。链路方向反转。

#### 核心链路

```
用户在 Code Browser 选中代码行
  → git blame 获取 commit hash
  → 解析 commit message，提取 lore 链接和关联信息
  → 加载关联的邮件线程
  → 展示：该 commit 对应的邮件讨论 + 历史 patch 版本 + 邮件中的外链
```

#### 每一步的依据

| 步骤 | 数据来源 | 可靠性 |
|------|----------|--------|
| 代码行 → commit | `git blame -L <line>,<line> <file>` | 100%，git 原生能力 |
| commit → 邮件 | commit message 中 `Link: https://lore.kernel.org/...` | 内核社区强惯例，绝大多数 mainline commit 都有 |
| commit → 相关 commit | `Fixes:` / `Reviewed-by:` / `Closes:` / `Signed-off-by:` 等 tag | 结构化文本，可解析 |
| 邮件 → 线程全貌 | lore 的 In-Reply-To / References header，线程重建 | lore 线程模型完整 |
| 邮件 → 各版本 patch | 相同 subject 前缀 + 线程关系搜索 | 同一线程内通常完整 |
| 邮件 → 外链 | 邮件正文中的 URL、Message-ID 提取 | 直接文本提取 |

#### 子阶段

##### 8a: git blame 集成

- [ ] 后端新增 `GET /api/kernel/blame?version=...&path=...&line=...`
  - 在本地 kernel git repo 中执行 `git blame --porcelain -L <line>,<line> <path>`
  - 返回：`commit_hash`, `author`, `author_time`, `committer`, `committer_time`, `summary`
- [ ] Code Browser 选中代码行时，显示 blame 信息（commit hash + summary）
- [ ] commit hash 可点击，展开详情

##### 8b: commit message 解析

- [ ] 后端新增 `GET /api/kernel/commit?version=...&hash=...`
  - 执行 `git show --format=fuller <hash>`
  - 返回完整 commit message
- [ ] 前端解析 commit message，提取结构化信息：
  - `Link: <url>` — lore 链接（核心）
  - `Fixes: <hash>` — 修复的 commit
  - `Reported-by:` / `Suggested-by:` / `Reviewed-by:` 等 tag
  - 其他 URL
- [ ] 渲染为结构化的 commit 信息卡片

##### 8c: lore 链接 → 邮件线程加载

- [ ] 从 commit message 中提取的 lore URL 解析出 message_id
- [ ] 用已有 API 加载该 message_id 对应的邮件线程
- [ ] 在 Code Browser 侧面板中展示关联的邮件线程
- [ ] 如果本系统尚未导入该线程，提供"导入此线程"按钮（调用邮件导入流程）

##### 8d: 关联信息汇总视图

- [ ] 在 Code Browser 中新增"追溯"面板（或扩展现有 Inspector），展示：
  - 当前行所属 commit 信息
  - 关联的邮件线程（如果有 lore 链接）
  - 关联的 Fixes commit（如果有）
  - 关联的其他 commit（Reviewed-by / Reported-by 等）
  - 一个"在 lore 查看原文"按钮
- [ ] 从邮件线程可以直接打开 LayeredEmailCard / ThreadDrawer
- [ ] 知识沉淀入口：对这段代码 + commit + 邮件生成 Knowledge Draft

#### 验收标准

- [ ] 在 Code Browser 选中代码行，可以追溯到对应的 git commit
- [ ] 如果 commit message 中有 lore 链接，可以加载关联的邮件线程
- [ ] 邮件线程展示完整，包括所有 patch 版本
- [ ] 邮件中的外链可点击
- [ ] 覆盖不低于 20 个真实内核 commit 的样本测试
- [ ] 对于 commit message 中没有 lore 链接的 commit，明确提示而不是静默失败

#### 非目标

- 不做全自动的"代码行 → 所有历史讨论"（那是 RAG 的事，见 PLAN-38002）
- 不做跨项目/跨仓库的 blame 追溯
- 不对 commit message 做 NLP 解析（只做结构化 tag 提取 + URL 提取）

---

## UI 规范

- 外链按钮统一使用 lucide-react 的 `ExternalLink` 图标
- `target="_blank" rel="noopener noreferrer"`
- 不做跳转跟踪、不上报 referrer
- hover 显示完整 URL tooltip

## 不做

- ❌ 不自建完整 LSP / 全量跨版本引用分析 / 条件编译精确解析
- ❌ 不把 Elixir 作为唯一代码事实源
- ❌ 不做 hover 预览定义内容（Phase 6 前依赖外部站点；Phase 6 后由本地 resolver 另行评估）
- ❌ 不做 Find References，外部站点已支持
- ❌ 不缓存外部页面
- ❌ 不为 lore 邮件正文做镜像

## 测试

**外部跳转：**
- 不同版本（`v6.8`、`v5.10`、`v2.6.32`、`master`）跳转正确
- 文件路径含特殊字符（空格、`%`、中文）URL 转义正确
- Elixir 不覆盖的版本（如 `v0.01`）自动 fallback
- 油猴脚本在 Elixir 各种页面布局下行号注入仍然有效

**Phase 8 追溯链路：**
- git blame 在不同版本/文件上返回正确 commit
- commit message 中 lore 链接提取正确（含不同格式变体）
- 无 lore 链接的 commit 明确提示
- 邮件线程加载后展示完整版本历史
- 邮件中外链可正确提取和点击

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Elixir 站点版本覆盖不全 | fallback 到 git.kernel.org，UI 提示 |
| Elixir 站点宕机 | 链接被动跳转，本系统功能不依赖 |
| URL 模板变更 | 集中在 `externalLinks.ts` |
| 内网部署无外网 | `external_links` 配置允许指向内网镜像 |
| 油猴脚本兼容性 | 已限制 `@match https://elixir.bootlin.com/linux/*`；URL 结构变更需同步修复 |
| 油猴脚本认证过期 | 用户重新打开 KernelCodePage "Copy Script" 重新生成即可 |
| 本地符号索引不完整导致误跳 | Phase 6 只承诺定义跳转最小集；resolver 返回 fallback 和 debug 信息 |
| 本地版本缺失 | resolver 自动 fallback 到 Elixir / git.kernel.org，UI 提示来源 |
| Contextual Ask 过早依赖外链 | Phase 7 明确依赖 Phase 6，本地代码上下文稳定后再做 |

## 验收标准

**已完成（保留）：**
- ✅ 用户能在 Elixir 任意页面选中行 → 在本系统打标签/批注（已实现）
- [x] 用户在本系统 Code Browser 一键打开 Elixir 对应位置
- [x] Knowledge 详情页关联文件可一键跳到 Elixir
- [x] 切换内核版本时所有外链 URL 正确反映当前版本（来自 Code Browser 确定的 version）
- [x] 配置 `external_links` 镜像后所有外链改用镜像（通过 `/api/system/config` 运行时注入）

**已废弃（2026-05-09）：**
- [x] ~~ThreadDrawer 邮件正文中的文件路径自动变成可点击链接~~ → 方向反了，见 PLAN-30003

**待实现：**
- [ ] 本地 resolver 成为代码跳转主路径，Elixir/git.kernel.org 仅作为 fallback（Phase 6）
- [ ] 代码行 → git blame → commit → lore 链接 → 邮件线程追溯链路可用（Phase 8）
- [ ] Code Browser 追溯面板展示：commit 信息 + 关联邮件 + 关联 commit（Phase 8d）
- [ ] Contextual Ask 只在本地代码上下文可解析后进入实现（Phase 7）
