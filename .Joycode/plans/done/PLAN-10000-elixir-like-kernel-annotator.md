# PLAN-10000: Elixir 风格多版本内核代码浏览与注释

## Task Summary
在前端新增一个类似 Elixir Cross Reference 的代码浏览 Tab，支持多内核版本切换、文件树浏览、代码高亮与行级定位，并提供跨版本代码注释能力；同时提供独立注释总览页用于聚合查看与快速跳转。

**数据源方案（已确认）**：使用本地 git 仓库，需合并两个仓库：
- **master 仓库**: `git.kernel.org/torvalds/linux.git`（v2.6.x ~ 最新 v7.0+）
- **history 仓库**: `git.kernel.org/history/history.git`（v0.01 ~ v2.6.x）
- 通过 `git replace --graft` 将两个仓库历史接合为统一视图
- 版本列表通过 `git tag` 获取，目录树和文件内容通过 `git ls-tree` / `git show` 读取
- 仓库路径在 `config/settings.yaml` 中配置，支持自定义

## TODO: 本地仓库准备与配置
- [ ] settings.yaml 新增 `kernel_source` 配置段：repo_path、history_repo_path、graft 开关
- [ ] 编写 `scripts/init_kernel_repo.sh`：clone master + history，执行 graft 接合
- [ ] 验证 graft 后 `git tag -l "v*"` 可覆盖 v0.01 ~ v7.0 全版本
- [ ] 验证 `git ls-tree <tag> <path>` 和 `git show <tag>:<path>` 在 graft 后正常工作

## TODO: 后端 — KernelSourceService（git 命令封装）
- [ ] 新增 `src/kernel_source/base.py`：BaseKernelSource 抽象接口
  - `list_versions() -> list[VersionInfo]`（从 git tag 解析，按版本号排序）
  - `list_tree(version, path) -> list[TreeEntry]`（目录/文件列表）
  - `get_file(version, path) -> FileContent`（文件内容 + 行数 + 大小）
- [ ] 新增 `src/kernel_source/git_local.py`：GitLocalSource 实现
  - 通过 `asyncio.create_subprocess_exec` 调用 git 命令
  - 内存缓存热门版本的 tag 列表与目录树（LRU，可配置 TTL）
  - 大文件保护：超过阈值（如 1MB）返回截断提示
- [ ] 版本过滤：只展示正式 release（vX.Y），过滤 rc 版本（可配置）

## TODO: 后端 — CodeAnnotation 数据模型与存储
- [ ] 新增 `src/storage/code_annotation_models.py`：CodeAnnotationORM
  - 字段：id, annotation_id(uuid), version, file_path, start_line, end_line,
    anchor_context(上下文哈希), body(Markdown), author, created_at, updated_at
  - 索引：(version, file_path), (author), 唯一(annotation_id)
- [ ] 新增 `src/storage/code_annotation_store.py`：CodeAnnotationStore
  - CRUD + 按文件查询 + 按版本聚合 + 全文搜索 + 分页
  - 遵循 session_factory 模式（请求级 session）

## TODO: 后端 — API 路由
- [ ] `GET /api/kernel/versions` — 版本列表（支持 ?filter=release|all）
- [ ] `GET /api/kernel/tree/{version}/{path:path}` — 目录树
- [ ] `GET /api/kernel/file/{version}/{path:path}` — 文件内容
- [ ] `GET /api/kernel/annotations` — 注释总览（分页 + 过滤 + 搜索）
- [ ] `GET /api/kernel/annotations/{version}/{path:path}` — 文件注释列表
- [ ] `POST /api/kernel/annotations` — 创建注释
- [ ] `PUT /api/kernel/annotations/{annotation_id}` — 编辑注释
- [ ] `DELETE /api/kernel/annotations/{annotation_id}` — 删除注释

## TODO: 前端 — Kernel Code Tab（Elixir 风格三栏布局）
- [ ] 新增 `web/src/pages/KernelCodePage.tsx`：三栏布局
  - 左栏：版本选择下拉 + 文件树（懒加载子目录）
  - 中栏：代码视图（行号 + 语法高亮 + 注释标记）
  - 右栏/弹窗：注释详情与编辑
- [ ] 版本选择器：下拉分组（Latest / LTS / History），支持搜索过滤
- [ ] 文件树组件：点击目录展开/折叠，点击文件加载代码
- [ ] 代码视图：行号点击/拖选触发注释弹窗，已有注释行高亮标记
- [ ] URL 深链：`/kernel-code/:version?path=&line=`，支持分享定位

## TODO: 前端 — Code Annotations Explorer 总览页
- [ ] 新增 `web/src/pages/CodeAnnotationsPage.tsx`
- [ ] 过滤栏：版本、路径前缀、作者、时间范围
- [ ] 注释卡片列表：显示文件路径、行范围、摘要、版本、时间
- [ ] 点击卡片跳转到 KernelCodePage 并定位到目标行
- [ ] 支持关键词搜索注释内容

## TODO: 前端 — 路由与导航
- [ ] App.tsx 新增路由：`/kernel-code/*` 和 `/kernel-code/annotations`
- [ ] MainLayout.tsx 新增 "Kernel Code" 导航分组（Code Browser + Code Annotations）
- [ ] API client 新增 kernel source 和 code annotation 相关函数
- [ ] types.ts 新增 VersionInfo / TreeEntry / FileContent / CodeAnnotation 类型

## TODO: DB 迁移
- [ ] 新增 `scripts/migrate_code_annotations.py`：创建 code_annotations 表

## TODO: 增量验证计划
- [ ] V1：单版本文件浏览 + 行号深链可用（git ls-tree/show 正常）
- [ ] V2：单文件注释 CRUD + 行号高亮 + 定位跳转
- [ ] V3：多版本切换 + history 仓库 graft 后老版本可浏览
- [ ] V4：注释总览页筛选与搜索 + 跳转定位
- [ ] V5：前端构建无错误 + 后端启动正常

## TODO: 实施顺序
- [ ] Phase A：本地仓库初始化 + 后端 git 封装 + 版本/目录/文件 API + 前端代码浏览
- [ ] Phase B：注释数据模型 + CRUD API + 前端注释交互（行选择/弹窗/高亮）
- [ ] Phase C：注释总览页 + 跨版本浏览 + history graft + 性能优化