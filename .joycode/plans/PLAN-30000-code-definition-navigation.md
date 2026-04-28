# PLAN-30000: Code Browser 代码跳转能力

## Summary
当前 `code browser` 已具备版本选择、目录树浏览、文件内容展示、行级批注等能力，但还缺少“符号索引 + 定义查询”这一层，因此还不能实现真正的代码跳转。

本计划目标是在不干扰当前正在开发功能的前提下，为后续实现 `Go to Definition` / `Find References` 预留清晰的技术路线。整体思路是先补“版本化 symbol index”，再补查询 API，最后接前端交互。

第一阶段优先实现可落地的 MVP，不直接引入完整 LSP 工作流，而是采用更适合当前架构的“离线索引 + 在线查询”模式。

## Key Changes
### 1. 新增符号索引层
- 新增独立的 symbol index 能力，不复用 annotation/tag 数据结构
- 为每个内核版本建立符号索引，至少覆盖：
  - 函数
  - 宏
  - struct
  - enum
  - typedef
- 每条 symbol 记录至少包含：
  - `version`
  - `file_path`
  - `symbol`
  - `kind`
  - `line`
  - `column`
  - `signature`
  - `scope`

建议新增模块：
- `src/symbol_indexer/base.py`
- `src/symbol_indexer/ctags.py`
- `src/storage/symbol_store.py`
- `scripts/index_symbols.py`

### 2. 采用分阶段解析方案
- 第一版优先使用 `universal-ctags` 建索引
  - 优点：实现快，适合 Linux kernel 大仓库离线扫描
  - 目标：优先跑通定义跳转
- 第二版可引入 `tree-sitter-c` 做增强
  - 用于补充 token 范围、hover 信息、局部作用域识别
- 暂不直接引入 `clangd` / 完整 LSP
  - 原因：kernel 多版本、大仓库、编译配置复杂，首版维护成本过高

### 3. 新增符号查询 API
- `GET /api/kernel/symbol/resolve`
  - 输入：`version + path + line + column`
  - 输出：当前光标位置对应的 symbol 及候选定义
- `GET /api/kernel/symbol/definition`
  - 输入：`version + symbol`
  - 输出：定义位置
- `GET /api/kernel/symbol/references`
  - 后续阶段补充
- 可考虑扩展 `GET /api/kernel/file/{version}/{path}`
  - 附带当前文件的 symbol ranges，便于前端做 hover / click 热区

### 4. 新增符号存储模型
- 建议新增独立表：`kernel_symbols`
- 建议字段：
  - `id`
  - `version`
  - `file_path`
  - `symbol`
  - `kind`
  - `line`
  - `column`
  - `end_line`
  - `end_column`
  - `signature`
  - `scope`
  - `language`
  - `metadata`
- 建议索引：
  - `(version, symbol)`
  - `(version, file_path)`
  - `(version, file_path, line)`

### 5. 前端交互分阶段接入
- 当前 [KernelCodePage.tsx](/Users/wangfuqiang49/workspace/tmp/kernel_email_tools/web/src/pages/KernelCodePage.tsx) 采用 `highlight.js + dangerouslySetInnerHTML` 渲染代码
- 这种方式适合展示，但不利于精确 token 命中，因此建议分两步接入

第一步：
- 支持“选中文字跳转”
- 用户选中标识符后调用 `/api/kernel/symbol/definition`
- 查询成功后切换文件并滚动到目标行

第二步：
- 升级为真正的 token 级交互
- 支持：
  - `Ctrl/Cmd + Click` 跳转定义
  - hover 显示 `kind + signature + file:line`
  - 右键菜单中的 `Go to Definition / Find References`

### 6. 体验层补充
- 跳转后高亮目标行
- 支持返回上一个浏览位置
- 当同名 symbol 存在多个候选定义时，弹出选择面板
- 后续补充 `Find References`

## Implementation Phases
### Phase 1: Definition Jump MVP
- 建立 `kernel_symbols` 表与存储层
- 增加 `scripts/index_symbols.py`
- 使用 `universal-ctags` 为指定版本生成符号索引
- 提供 `/api/kernel/symbol/definition`
- 前端支持“选中文字跳转定义”

### Phase 2: Token-aware Navigation
- 为当前文件返回 symbol ranges
- 前端支持 hover / `Ctrl/Cmd + Click`
- 增加跳转历史与候选列表交互

### Phase 3: References and Precision Improvements
- 增加 `/api/kernel/symbol/references`
- 引入 `tree-sitter-c` 提升 token 定位与局部作用域识别
- 评估是否需要更深层的 LSP 能力

## Risks
- Linux kernel 中同名 symbol 很多，仅按名字查找容易误跳
- 宏、条件编译、头文件展开会导致定义不唯一
- 当前前端代码渲染方式不利于精确 token 点击
- 多版本源码必须严格隔离索引，不能混用 symbol 数据

## Test Plan
- 对同一版本建立 symbol 索引后，可正确查到函数/宏/struct 的定义
- 同名 symbol 在不同版本间查询结果不串版本
- 从代码页选中文本后，可跳转到目标文件与目标行
- 多候选定义时，前端能展示候选列表而不是误跳
- 跳转后目标行高亮、滚动定位正常

## Assumptions
- 当前阶段只写计划，不与正在开发的功能并行落地实现
- 第一版优先支持 Linux kernel 常见 C/C 头文件场景
- 第一版接受“候选定义列表”而非强制单结果
- 第一版目标是 `Go to Definition`，`Find References` 可后置
