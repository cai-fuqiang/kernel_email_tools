# 代码质量 — 已知问题、模式与规范

## 文件大小警戒线

| 文件 | 行数 | 状态 | 建议 |
|------|------|------|------|
| `src/api/server.py` | 4845 | 严重超标 | 按领域拆为 routers/services (auth, search, ask, agent, tags, annotations, translations, kernel, manual, knowledge) |
| `web/src/components/ThreadDrawer.tsx` | 1997 | 严重超标 | 提取 LayeredEmailCard, TreeEmailCard, AnnotationCard 为独立文件 |
| `web/src/pages/KnowledgePage.tsx` | 1588 | 严重超标 | 提取 DraftInbox、EntityList、EntityDetail、GraphPanel、EvidencePanel |
| `web/src/pages/SearchPage.tsx` | 770 | 接近警戒 | — |
| `web/src/pages/KernelCodePage.tsx` | 579 | 正常 | — |
| `web/src/pages/AgentResearchPage.tsx` | 450+ | 接近警戒 | 后续多轮 agent UI 需要先拆组件 |

## 死代码清单

| 文件 | 行数 | 原因 |
|------|------|------|
| `src/symbol_indexer/` | 多文件 | 符号索引脚本存在，但 UI 定义跳转仍未完成 |

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

### Agent orchestration——已提取 service
- Agent Research orchestration 已提取 `AgentResearchService`，负责 capability check、trace、search loop、draft creation
- API 层只做 request validation、auth 和 response shaping

## 前端组件规范

### 弹窗/确认
- **统一使用 `ConfirmModal`** 替代 `window.confirm` 和 `window.prompt`（已全部完成，零原生弹窗残留）
- **统一使用 `showToast()`** 替代内联 error div 和 `window.alert`（已全部完成）

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

## Search / Index 规范

- `mode=semantic` 不能假设有结果，必须确认 `email_chunks` 和 `email_chunk_embeddings` 已构建
- 新导入邮件后，semantic 索引不是自动更新；需要额外执行 `--build-chunks` 和 `--build-vector`
- 短缩写、宏名、函数名、Message-ID 片段优先走 keyword/hybrid
- Semantic 结果必须以 `message_id` 去重，同一邮件保留最高分 chunk
- `has_patch`、list、sender、date、tags 等过滤要在 vector query 层透传

## 安全规范

- **绝不** 在 `config/settings.yaml` 中提交真实 API key 或密码（已修复：API key 改为环境变量 `DASHSCOPE_API_KEY`，admin password 已用 `KERNEL_ADMIN_PASSWORD`）
- **绝不用** `dangerouslySetInnerHTML` 渲染未转义的用户内容
- Retrieved email/manual/code/knowledge text 一律视为不可信证据，不能作为 system/developer/tool 指令
- Agent 写入必须带 `created_by` / `updated_by` / user_id 审计字段
- Session cookie 生产环境应设 `secure=true`
- 生产环境 CORS 不使用 `*`
- Header-based auth（`X-User-Id` 等）仅限可信代理环境使用

## 运维规范

- 翻译任务需要持久化，不能纯内存
- 数据库变更需要迁移文件版本跟踪，不在 init_db 中 ad-hoc ALTER TABLE
- 根目录临时文件已通过 .gitignore 管理（api.log, log*.txt, tags, nohup.out, check_*.py, run_import.py, config.sh, *.db）
- 使用 `logging` 而非 `print`
- `except Exception: pass` 已修复 5 处静默吞异常，剩余均有 logger.error/warning/debug 记录
- README 和 `.joycode/rules` 需要随架构变化同步更新，避免误导后续实现
- 新增测试文件：`tests/test_core_utils.py`（34 个测试，覆盖 resolve_api_key / slugify_tag / normalize_anchor / parse_json_object 等纯函数）
