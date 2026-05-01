# PLAN-30002: 外链代码跳转与外部站点标注闭环

> **Status**: in-progress (Phase 1-5 核心已完成，仅剩 external_links 真实内网镜像验证)
> **Updated**: 2026-05-01
> **Depends-on**: 无
> **Supersedes**: PLAN-30000-code-definition-navigation, PLAN-10001-code-navigation
> **Priority**: P1

## 决策背景

放弃自建符号索引（ctags / tree-sitter / cscope），改为利用外部站点 + 油猴脚本注入完成代码跳转和反向标注闭环。原因：

- Elixir Bootlin 已经投入多年解决符号歧义、宏、条件编译、跨版本索引问题，自建重写不会赢
- 单版本 ctags 50~80MB，全版本数 GB；多版本独立索引随版本数线性膨胀
- 项目核心是邮件知识库，代码跳转是辅助阅读功能而非主路径
- 已有更轻量的方案：油猴脚本把本系统的标注/标签能力注入到 Elixir 页面

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

### Phase 3: ThreadDrawer 邮件正文路径识别 ✅

- [x] 新增 `web/src/utils/kernelPathRefs.ts`：
  - `parseKernelPathRefs(text)` — 用正则识别形如 `mm/vmscan.c`、`fs/ext4/inode.c:1234`、`include/linux/sched.h` 的内核路径（白名单顶级目录）
  - `extractPatchHeaderPath(line)` — 从 `--- a/path` / `+++ b/path` 提取路径，自动剥离 `a/` `b/` 前缀，处� `/dev/null`
  - `extractPatchVersion(subject)` — 从邮件主题 `[PATCH v6.10]` 提取版本号
- [x] 新增 `web/src/components/KernelPathLinkedText.tsx`：在 `<pre>`/`<span>` 中渲染带路径链接的纯文本（保留空白/换行）
- [x] ThreadDrawer 的 LayeredEmailCard 和 TreeEmailCard 段落渲染接入 KernelPathLinkedText
- [x] PatchDiffBlock 支持 `version` prop；`diff --git a/X b/Y`、`--- a/path`、`+++ b/path` 渲染为可点击链接
- [x] 链接版本来源优先级：邮件主题 PATCH 版本（`extractPatchVersion`）> `latest`

### Phase 4: Knowledge entity 文件链接 ✅

- [x] 实体 `meta.source_files` / `meta.symbols` 字段渲染时直接生成 Elixir 链接（已在 `KnowledgeEntityMetaPanel.tsx` 实现）
- [x] 不引入新 schema，仅做前端渲染

### Phase 5: lore.kernel.org 邮件原文链接 ✅

- [x] ThreadDrawer LayeredEmailCard 和 TreeEmailCard 头部在"复制消息链接"按钮旁增加 "在 lore 查看原文" 按钮（ExternalLink 图标）
- [x] Knowledge evidence 列表（直接证据 `evidenceRows` + 生成证据 `evidence.sources`）中每条邮件 message_id 旁加 lore 链接

---

## UI 规范

- 外链按钮统一使用 lucide-react 的 `ExternalLink` 图标
- `target="_blank" rel="noopener noreferrer"`
- 不做跳转跟踪、不上报 referrer
- hover 显示完整 URL tooltip

## 不做

- ❌ 不自建 symbol index、ctags、tree-sitter、cscope
- ❌ 不做 hover 预览定义内容（依赖外部站点）
- ❌ 不做 Find References，外部站点已支持
- ❌ 不缓存外部页面
- ❌ 不为 lore 邮件正文做镜像

## 测试

- 不同版本（`v6.8`、`v5.10`、`v2.6.32`、`master`）跳转正确
- 文件路径含特殊字符（空格、`%`、中文）URL 转义正确
- 邮件正文路径识别误识率（`foo/bar.txt` 等非内核路径不应匹配）
- PATCH 头部 `a/`/`b/` 剥离正确
- Elixir 不覆盖的版本（如 `v0.01`）自动 fallback
- 油猴脚本在 Elixir 各种页面布局下行号注入仍然有效

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Elixir 站点版本覆盖不全 | fallback 到 git.kernel.org，UI 提示 |
| Elixir 站点宕机 | 链接被动跳转，本系统功能不依赖 |
| URL 模板变更 | 集中在 `externalLinks.ts` |
| 内网部署无外网 | `external_links` 配置允许指向内网镜像 |
| 油猴脚本兼容性 | 已限制 `@match https://elixir.bootlin.com/linux/*`；URL 结构变更需同步修复 |
| 油猴脚本认证过期 | 用户重新打开 KernelCodePage "Copy Script" 重新生成即可 |

## 验收标准

- ✅ 用户能在 Elixir 任意页面选中行 → 在本系统打标签/批注（已实现）
- [x] 用户在本系统 Code Browser 一键打开 Elixir 对应位置
- [x] ThreadDrawer 邮件正文中的文件路径自动变成可点击 Elixir 链接
- [x] Knowledge 详情页关联文件可一键跳到 Elixir
- [x] 切换内核版本时所有外链 URL 正确反映当前版本（邮件主题里的 `[PATCH vX.Y]` 驱动；fallback 到 `latest`）
- [x] 配置 `external_links` 镜像后所有外链改用镜像（通过 `/api/system/config` 运行时注入）