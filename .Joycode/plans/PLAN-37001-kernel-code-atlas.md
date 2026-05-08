> **Status**: in-progress
> **Updated**: 2026-05-08
> **Depends-on**: PLAN-30002, PLAN-31002, PLAN-36000
> **Priority**: P1

# Kernel Code Atlas：多版本内核代码地图与标注工作台

## Implementation Status

- Phase 1 已部分落地：Web Code Browser 的文案和页面主结构已经重定位为 `Kernel Code Atlas`。
- Phase 2 正在落地：已新增统一 `code_target` payload helper，并接入 code annotation / tag target / Workspace 跳转的主路径，开始收敛散落的 `version + file_path + line range` 解析逻辑。
- 下一步继续把 ThreadDrawer patch hunk、Knowledge evidence 和更多 tag/annotation 入口切到同一 payload。

## Summary

本计划重新定义当前 Code Browser 的产品边界：它不应该演进成 Web IDE，也不应该重做 VS Code / Neovim 已经成熟支持的文件搜索、符号跳转、引用查找和编辑体验。

Code Browser 的核心价值应当是 **多版本内核代码对照、标注、tag、邮件/patch/知识关联**。更准确的产品定位是 Kernel Code Atlas：一个面向内核研究和长期知识沉淀的代码地图，而不是一个通用代码浏览器。

## Decision

- Web 端保留代码浏览能力，但只服务于跨版本阅读、证据定位、标注和 tag。
- 不在 Web 中建设完整 IDE 能力：
  - 不做通用文件搜索体验。
  - 不做完整符号跳转 / Find References。
  - 不做编辑器级快捷键、buffer 管理、diagnostics、LSP UI。
  - 不做复杂本地工作区同步。
- 本地开发、日常跳转和改代码优先交给 VS Code / Neovim 插件。
- Web Atlas 负责保存多人可共享、可追溯、可复用的阅读结论。

## Why

最初做 Code Browser 的目的不是替代编辑器，而是希望能在一个页面中浏览多个版本的内核代码，并对代码片段做标注和 tag。这个目标本身成立，而且是 VS Code / Neovim 不天然擅长的场景。

VS Code / Neovim 擅长：

- 当前 workspace 内的文件搜索。
- LSP definition / references / workspace symbols。
- buffer、selection、diagnostics、git diff。
- 快速编辑、运行命令和本地调试。

Web Atlas 擅长：

- 同一个文件、函数、代码片段在多个 kernel version / vendor branch 中的演化对照。
- 把代码行、patch、邮件 thread、知识项、人工 annotation 和 tag 关联起来。
- 保存团队共享的阅读路径、结论、疑问和历史上下文。
- 面向研究、review、backport、regression 分析的长期知识沉淀。

因此项目应该避免在 Web 中重建编辑器基础设施，把精力放到编辑器无法直接提供的知识层。

## Product Scope

### In Scope

- 多版本代码阅读：
  - 同一路径跨版本打开。
  - 同一函数或代码区域跨版本对照。
  - 版本切换时尽量保持文件、行号、选区或 symbol 上下文。
- 代码 annotation：
  - 对文件、行范围、函数、patch hunk 创建人工批注。
  - 支持问题、结论、review note、backport note 等不同 annotation 类型。
  - 支持 annotation reply / history，复用现有批注模型能力。
- Code tag：
  - 对代码片段、函数、文件、commit/patch、邮件 thread 打 tag。
  - 支持手动 tag、批量 tag、survey-style tag workflow。
  - tag 可以绑定到 subsystem、issue、regression、stable-backport、vendor branch 等主题。
- 代码与知识库闭环：
  - 代码 annotation 可以关联 Knowledge entity。
  - Knowledge evidence 可以引用代码位置。
  - Ask/Search/Thread 中发现的代码证据可以保存为 draft，进入人工审核。
- 邮件 / patch / code 关联：
  - 邮件正文中的路径、patch header、hunk 定位到 Atlas 中的代码位置。
  - 代码位置可以反查相关邮件、patch、annotation、tag、knowledge evidence。
- 跨版本演化视图：
  - 文件级 diff timeline。
  - 函数级变更列表。
  - tag/annotation 在不同版本中的分布。

### Out Of Scope

- Web IDE。
- 在线编辑内核代码。
- 完整 LSP。
- 完整 Find References。
- 完整语义索引替代 Elixir / cscope / clangd。
- 通用文件搜索产品化。
- 复杂本地开发环境管理。

## Architecture Direction

```text
VS Code / Neovim Plugin
  ├─ 使用编辑器原生能力：LSP / rg / git / buffer / diagnostics
  ├─ 收集本地上下文：当前文件、选区、diff、错误、引用链
  └─ 调用 Kernel Email Tools：保存 annotation、tag、knowledge draft

Kernel Code Atlas (Web)
  ├─ 多版本代码阅读和对照
  ├─ annotation/tag layer
  ├─ code <-> mail <-> patch <-> knowledge 关联
  ├─ investigation notes / saved views
  └─ 团队共享知识沉淀

Core Backend
  ├─ local-first kernel source resolver
  ├─ code annotation / tag persistence
  ├─ version metadata and diff helpers
  ├─ knowledge/evidence/relation APIs
  └─ AI-assisted draft generation and review workflow
```

## Relationship With Existing Plans

- PLAN-30002 继续负责 local-first resolver、外链 fallback、路径识别和基础代码定位。
- 本计划限制 PLAN-30002 后续演化方向：resolver 是 Atlas 的事实源和证据定位能力，不是 Web IDE 的起点。
- PLAN-31002 提供 Knowledge Workbench 的 evidence、relation、draft review 底座。
- PLAN-36000 的 survey-style 批量打标签可扩展到 code selection / patch hunk / symbol 粒度。

## Data Model Direction

优先复用现有 annotations、tags、knowledge_entities、knowledge_evidence。必要时新增轻量 code target 模型，避免把版本、路径、行号散落在各个 `meta` 字段里。

建议抽象：

```text
code_target
  version
  repo
  path
  start_line
  end_line
  symbol
  symbol_kind
  commit
  patch_id
```

可被以下对象引用：

- code annotations。
- tag assignments。
- knowledge evidence。
- saved views。
- Ask/Search generated drafts。

短期可以先用结构化 JSON 字段承载，等引用关系稳定后再建表。

## UX Direction

### Atlas Home

- 以 kernel versions / repositories / saved investigations 进入，而不是以通用搜索框为中心。
- 展示最近标注、最近 tag、最近查看的代码位置。
- 展示需要 review 的 code-related drafts。

### Code View

- 左侧：版本、文件路径、相关 annotation/tag/knowledge 摘要。
- 中间：只读代码视图，支持行范围选择。
- 右侧：当前代码位置的 annotations、tags、related mails、knowledge evidence。
- 顶部：版本切换和对照入口。

### Cross-Version View

- 支持选择两个或多个版本。
- 默认按文件路径和行范围对照。
- 后续可扩展到函数级对照。
- annotation/tag 应能显示其适用版本范围，避免误以为所有版本都成立。

### Annotation Flow

- 用户选中代码行或 patch hunk。
- 选择 annotation 类型和 tag。
- 可选关联邮件、patch、knowledge item。
- 保存后该 annotation 在对应代码位置、邮件 thread 和 Knowledge evidence 中都能被看到。

## Phases

### Phase 1: Product Boundary Cleanup

- 在代码和文档中把 Web Code Browser 的定位改为 Kernel Code Atlas。
- 明确 UI copy：避免暗示它是通用 IDE 或完整代码搜索工具。
- 梳理已有 Code Browser 功能，标记哪些属于 Atlas 核心，哪些应停止扩展。
- 更新 README / plan index / developer notes 中相关描述。

### Phase 2: Code Target Normalization

- 统一代码位置结构：version、repo、path、line range、symbol、commit/patch。
- 梳理现有 code annotations、knowledge meta、patch links、ThreadDrawer path refs 中的代码引用。
- 新增后端 helper，把散落引用规范化为同一种 code target payload。
- 为后续 annotation/tag/evidence 共用打基础。

### Phase 3: Annotation And Tag Layer

- 强化代码行范围选择后的 annotation/tag 创建体验。
- 支持对同一个 code target 展示已有 annotations、tags、knowledge links。
- 支持从邮件 patch hunk 创建 code annotation。
- 支持 code target 反向查看相关邮件和知识项。

### Phase 4: Cross-Version Reading

- 增加同一路径跨版本切换，保持上下文。
- 增加两版本 diff view。
- 记录 annotation/tag 的适用版本范围。
- 对同一 code target 在不同版本中的差异给出清晰提示。

### Phase 5: Editor-Native Bridge

- 先做最小 VS Code 插件或命令入口：
  - 从当前文件/选区创建 Atlas annotation。
  - 打开当前代码位置对应的 Atlas 页面。
  - 拉取当前 code target 的 tags/annotations 摘要。
- Neovim 后续以命令或 Telescope picker 形式补齐。
- 插件只桥接编辑器原生上下文，不重做 Web Atlas UI。

## Acceptance Criteria

- 用户可以在 Web 中打开同一内核文件的多个版本，并保留代码位置上下文。
- 用户可以对代码行范围创建 annotation 和 tag，并在后续回到同一代码位置时看到它们。
- 邮件 patch hunk、Knowledge evidence、Code Atlas 之间可以互相跳转。
- Web 不再新增通用 IDE 功能；相关需求进入 VS Code / Neovim 插件路线。
- 新增代码引用都使用统一 code target payload，避免后续迁移成本继续扩大。

## Non-Goals

- 不追求替代 Elixir 的完整符号能力。
- 不追求替代 VS Code / Neovim。
- 不做在线编辑。
- 不做多人实时协作编辑。
- 不做全量跨版本语义理解。

## Open Questions

- `code_target` 是否需要立即建表，还是先以结构化 JSON 过渡？
- 多版本对照优先支持两个版本，还是直接支持 N 个版本？
- annotation 的适用范围如何表达：单版本、版本区间、branch family、或人工标签？
- VS Code 插件是否应作为 Phase 5，还是提前用很薄的命令桥接验证？
