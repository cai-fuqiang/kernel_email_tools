# 代码质量 — 已知问题、模式与规范

## 文件大小警戒线

| 文件 | 行数 | 状态 | 建议 |
|------|------|------|------|
| `src/api/server.py` | 3885 | 严重超标 | 按领域拆为 routers/ (auth, search, tags, annotations, translations, kernel, manual) |
| `web/src/components/ThreadDrawer.tsx` | 1881 | 严重超标 | 提取 LayeredEmailCard, TreeEmailCard, AnnotationCard 为独立文件 |
| `web/src/pages/KernelCodePage.tsx` | 1443 | 严重超标 | 提取 VersionSelector, CodeView, AnnotationModal 等为独立文件 |
| `web/src/pages/SearchPage.tsx` | 653 | 接近警戒 | — |
| `web/src/components/TagManager.tsx` | 512 | 接近警戒 | — |

## 死代码清单

| 文件 | 行数 | 原因 |
|------|------|------|
| `src/storage/code_annotation_store.py` | 129 | 从未被 import，自己的 DeclarativeBase 从未创建表 |
| `src/storage/code_annotation_models.py` | 138 | 同上 |
| `web/src/pages/CodeAnnotationsPage.tsx` | 326 | App.tsx 中无路由，编译但不可达 |
| `src/retriever/semantic.py` (SemanticRetriever) | ~80 | `_get_embedding()` 总是返回 None，search() 永远空 |

## 重复代码模式

### 权限检查——应提取为 `canManageAnnotation(user, annotation): boolean`
出现在以下位置：
- `web/src/components/ThreadDrawer.tsx:428` (AnnotationCard)
- `web/src/pages/KernelCodePage.tsx:522` (AnnotationModal)
- `web/src/components/AnnotationTree.tsx:268`
- `web/src/components/AnnotationCard.tsx:83`
- `web/src/components/EmailTagEditor.tsx:138` (canManageTag)

### 树构建——应提取为泛型 `buildTree<T>(items, idFn, parentIdFn): TreeNode<T>[]`
出现在以下位置：
- `web/src/components/AnnotationTree.tsx:32` — `buildTree(annotations)`
- `web/src/pages/CodeAnnotationsPage.tsx:17` — `buildAnnotationTree(annotations)`，逐行相同
- `web/src/components/ThreadDrawer.tsx:36` — `buildThreadTree(emails, annotations)`

### 日期/发送者格式化——应提取为 `formatDate(date, locale)` 和 `getAuthorName(sender)`
出现在以下位置：
- `web/src/pages/TranslationsPage.tsx:22` — `formatDate`
- `web/src/components/TagManager.tsx:457` — `formatDate`
- `web/src/components/ThreadDrawer.tsx:128` — `getAuthorName`
- `web/src/components/TagManager.tsx:452` — `extractName`

### LLM Provider 路由——应统一使用 ChatLLMClient
- `src/qa/providers.py:ChatLLMClient` — 标准实现
- `src/qa/manual_qa.py:ManualQA._call_llm` — 完整复刻了 OpenAI/DashScope/Anthropic 调用

### Tag 过滤 UNION 子查询——应提取为共享函数
在 `src/storage/postgres.py` 中：
- `search_fulltext` — tag 过滤逻辑
- `search_email_chunks_fulltext` — copy/paste
- `search_email_chunks_vector` — copy/paste  
- `_message_ids_for_tag` — 第四个变体

## 前端组件规范

### 弹窗/确认
- **统一使用 `ConfirmModal`** 替代 `window.confirm` 和 `window.prompt`
- **统一使用 `showToast()`** 替代 `window.alert`
- 仍残留原生弹窗的文件：`KernelCodePage.tsx`(6 处), `UsersPage.tsx`(3 处), `TagManager.tsx`, `ThreadDrawer.tsx`(内部 AnnotationCard 的 approve/reject)

### API 调用
- **优先使用 `fetchJSON` 或 `fetchWithBody`**，不直接 `fetch()`
- `client.ts` 中有 15 个函数使用原始 `fetch()`——需要迁移
- `fetchJSON` 和 `fetchWithBody` 的重复错误处理应合并

### 组件拆分标准
- 页面组件 > 500 行：考虑拆分为子组件
- 组件 > 300 行：检查是否有独立职责可提取
- 内联子组件 (function inside function) > 100 行：提为独立文件

### 类型定义
- 接口和请求类型放在 `web/src/api/types.ts`，不在 `client.ts` 中定义
- 避免 `Record<string, unknown>`，使用 tagged union 或具体接口

## 安全规范

- **绝不** 在 `config/settings.yaml` 中提交真实 API key 或密码（当前存在，需撤销）
- **绝不用** `dangerouslySetInnerHTML` 渲染未转义的用户内容
- Session cookie 生产环境应设 `secure=true`
- 生产环境 CORS 不使用 `*`
- Header-based auth（`X-User-Id` 等）仅限可信代理环境使用

## 运维规范

- 翻译任务需要持久化，不能纯内存
- 数据库变更需要迁移文件版本跟踪，不在 init_db 中 ad-hoc ALTER TABLE
- 清理仓库根目录的临时文件 (api.log, kernel_code.db, nohup.out, config.sh 等)
- 使用 `logging` 而非 `print`
