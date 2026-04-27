# Ask 功能重构计划：AI 邮件检索代理 + 向量 RAG

## Summary
- 将邮件 Ask 从“单次关键词 RAG”重构为“AI 检索代理”：生成检索计划、多 query 检索、向量召回、全文召回、thread 扩展、证据筛选、最终回答。
- 数据库允许重建，因此新增邮件 chunk/embedding 数据层；手册 Ask 暂不上线改造，但抽象出可复用 provider/agent 基础。
- 默认使用 DashScope：LLM 沿用现有 Qwen 配置，embedding 也走 DashScope；回答语言跟随用户问题。
- Ask 页面展示答案、来源邮件、AI 检索计划和命中 query，增强可解释性。

## Key Changes
- 数据层：
  - 新增 `email_chunks` 表，按邮件正文段落/滑窗切分，字段包含 `chunk_id`、`message_id`、`thread_id`、`list_name`、`subject`、`sender`、`date`、`chunk_index`、`content`、`content_hash`、`search_vector`。
  - 新增 `email_chunk_embeddings` 表，字段包含 `chunk_id`、`provider`、`model`、`dimension`、`embedding`、`content_hash`、`created_at`，使用 pgvector HNSW 或 IVFFlat 索引。
  - 保留 `emails` 表作为原始邮件和 thread 来源；重建脚本删除并重建新增表。
- 索引链路：
  - 增加邮件 chunk 构建器：入库后从 `emails` 生成 chunk，跳过 patch 大段内容或将 patch 单独标记低权重。
  - 实现 DashScope embedding provider，支持 batch embedding、失败重试、content hash 幂等更新。
  - 扩展 `scripts/index.py`：支持 `--build-chunks`、`--build-vector`、`--rebuild-rag-index`。
- 检索与 Ask Agent：
  - 新增 `AskAgent`，替代邮件侧 `RagQA`。
  - Agent 第一步调用 LLM 输出结构化检索计划：多个 keyword query、semantic query、可选 list/sender/date/tag 过滤、目标解释。
  - 执行混合召回：PostgreSQL chunk 全文检索 + pgvector chunk 语义检索 + 现有邮件级搜索兜底。
  - 对命中 chunk 去重并按 thread 聚合，拉取相关 thread 上下文，再由 LLM rerank/选择证据。
  - 最终回答只允许基于证据，引用 Message-ID、subject、sender、date、chunk/thread 信息；信息不足时明确说明。
- API/UI：
  - `/api/ask` 保持路径兼容，但响应结构扩展为 `answer`、`sources`、`search_plan`、`executed_queries`、`threads`、`retrieval_stats`。
  - 前端 Ask 页面保留，展示最终回答、来源邮件、检索计划、命中 query 和相关线程；不做 streaming。
  - `/api/search` 保持现有行为，避免影响当前搜索/标签/线程阅读工作流。
- 配置：
  - `qa.email` 保留 DashScope/Qwen LLM 配置。
  - 新增 `rag.embedding` 或扩展 `indexer.vector`：`provider=dashscope`、`model`、`dimension`、`batch_size`、`enabled=true`。
  - API key 优先级：环境变量优先，其次 settings.yaml；不在日志或响应中暴露 key。

## Test Plan
- 单元测试：
  - 邮件 chunk 切分稳定性、content hash 幂等、patch 降权/跳过策略。
  - DashScope embedding provider 使用 mock 响应，覆盖 batch、失败、空结果。
  - 检索计划 JSON 解析，覆盖 LLM 输出 malformed 时的 fallback。
  - 向量检索和全文检索融合去重、thread 聚合、来源引用生成。
- 集成测试：
  - 使用小样本邮件库重建数据库，执行 chunk 构建和 embedding mock 构建。
  - `/api/ask` 在无向量、无 LLM、LLM mock、embedding mock 四种状态下都有可解释 fallback。
  - 前端类型检查和构建通过，Ask 页面能展示 plan、queries、sources。
- 手工验收：
  - 用 KVM/Linux-MM 真实问题验证：AI 能生成多个检索 query，命中相关 thread，并在回答中引用具体邮件。
  - 用关键词式输入验证：比旧 Ask 至少多展示相关 query、thread 和证据来源。
  - 用找不到答案的问题验证：返回“不足以回答”而不是编造。

## Assumptions
- 先实现邮件 Ask；手册 Ask 暂不改 UI/API，但 provider 和 agent 结构按可复用方式组织。
- 数据库可全量重建，所以不写兼容旧表的复杂迁移；更新 `scripts/rebuild_db.py` 覆盖新增 RAG 表。
- 默认 embedding provider 为 DashScope，模型和维度由配置显式指定；实现时若配置缺失则启动/索引阶段报清晰错误。
- 最终回答语言跟随用户问题；邮件原文引用保持原文。
- 第一批实现不做流式输出、不做多轮追问记忆、不做 ask 结果持久化缓存。
- 用户自定义 API key 暂不进入当前计划；模型/key 配置先保持系统级配置，后续单独设计。

## Next Plan: Ask 结果一键转换为 Knowledge / Annotation / Tag 草稿

### Goal
- 将 Ask 从“问答入口”进一步变成“知识库生产入口”。
- 用户在 Ask 得到答案后，可以一键生成可审阅草稿，而不是直接写入稳定知识库。
- 草稿目标包括：
  - Knowledge entity 草稿：沉淀稳定概念、问题、子系统、机制、争议点。
  - Annotation 草稿：把 Ask 结论和证据挂到邮件 thread、message、paragraph/chunk 或 knowledge entity。
  - Tag 草稿：给相关邮件、thread、knowledge entity 生成候选标签绑定。

### Product Flow
- Ask 页面在答案区域新增 `Create Drafts` 操作。
- 点击后打开草稿预览面板，展示 AI 从当前 Ask 结果提取出的候选项：
  - 1 个主 Knowledge entity 草稿，包含 `entity_type`、`canonical_name`、`aliases`、`summary`、`description`、`meta.ask`。
  - 多条 Annotation 草稿，默认包括一条挂到主 thread 或主 knowledge entity 的总结批注，以及可选的来源邮件/chunk 证据批注。
  - 多条 Tag assignment 草稿，目标可以是 `email_message`、`email_thread`、`knowledge_entity`。
- 用户可以逐项编辑、取消勾选，然后点击 `Save Drafts` 批量创建。
- 创建成功后返回创建结果，并提供跳转：
  - 跳到 Knowledge 页面查看实体。
  - 跳到对应 thread 查看 annotation。
  - 跳到 Tags/targets 查看 tag 绑定。

### API Design
- 新增 `POST /api/ask/draft`：只生成草稿，不写数据库。
  - 输入：`question`、`answer`、`sources`、`search_plan`、`threads`、可选 `preferred_entity_type`。
  - 输出：
    - `knowledge_drafts`
    - `annotation_drafts`
    - `tag_assignment_drafts`
    - `warnings`
- 新增 `POST /api/ask/draft/apply`：保存用户确认后的草稿。
  - 输入：用户编辑后的草稿列表。
  - 行为：复用现有 `createKnowledgeEntity`、`createAnnotation`、`createTagAssignment` 的后端能力，批量执行，允许部分成功。
  - 输出：`created_entities`、`created_annotations`、`created_tag_assignments`、`errors`。
- 不要求新增持久化 draft 表；第一版草稿只在前端会话中存在。后续如需要审核流，再设计 `ask_drafts` 表。

### Draft Mapping Rules
- Knowledge entity：
  - `entity_type` 默认由 AI 在 `topic | subsystem | mechanism | issue | patch_discussion | symbol` 中选择。
  - `canonical_name` 必须短、稳定、可复用，不能直接使用完整问题句。
  - `summary` 是 1-3 句结论。
  - `description` 使用 Markdown，包含“背景 / 关键结论 / 证据邮件 / 未确认点”。
  - `meta.ask` 保存 `question`、`answer_excerpt`、`source_message_ids`、`thread_ids`、`generated_at`。
- Annotation：
  - 如果 Ask 命中单一主 thread，创建 `target_type=email_thread` 的总结批注。
  - 如果用户选择已有或新建 Knowledge entity，创建 `target_type=knowledge_entity` 的知识批注。
  - 证据批注可以锚定 `email_message` 或未来的 `email_chunk`；第一版优先锚定 `email_message`，在 `anchor` 中保存 `chunk_id`、`chunk_index`、`snippet`。
  - `body` 必须包含 Ask 结论和 Message-ID 引用，保留“AI draft”标记，便于人工审阅。
- Tag assignment：
  - 标签名优先复用现有 tag；如果不存在，第一版不自动创建新 tag，只作为 `missing_tags` warning 返回。
  - `source_type=ask_agent`。
  - `evidence` 保存 `question`、`source_message_ids`、`source_chunks`、`confidence`。
  - 设计目的：tag 是全局 taxonomy，而不是一次 Ask 的局部文本。AI 可能生成近义、大小写不同或层级不明的标签；如果自动创建，会污染标签体系并造成后续聚合噪声。因此第一版只允许自动绑定已有 tag；缺失 tag 默认取消选中，作为显式待处理建议。后续可单独增加 `Suggested new tags` 区域，让用户确认 tag kind、父标签、alias、visibility 后再创建。

### UI Design
- Ask 页面新增三个操作：
  - `Draft Knowledge`
  - `Draft Annotation`
  - `Draft Tags`
- 默认推荐一个主按钮 `Create Drafts`，进入统一预览面板。
- 预览面板包含三个 tab：`Knowledge`、`Annotations`、`Tags`。
- 每条草稿都有 checkbox、编辑区和目标说明。
- 保存按钮文案使用 `Save Selected Drafts`，避免误以为未经确认就固化。
- 保存后在 Ask 页面保留结果摘要，并给出跳转链接。

### Implementation Notes
- 新增 `AskDraftService`，负责：
  - 从 AskResponse 生成草稿 prompt。
  - 调 LLM 输出结构化 JSON。
  - 校验/规范化 entity、annotation、tag assignment 草稿。
  - 应用草稿时调用现有 store/API 逻辑，避免复制创建逻辑。
- 前端新增 `AskDraftPanel`，不复用 KnowledgePage 的大表单，但字段命名与现有 API 类型保持一致。
- 先不做自动发布；创建出的 annotation 默认遵循当前用户权限和默认 visibility。
- 所有 AI 生成内容都作为草稿展示，用户确认前不写入数据库。

### Test Plan
- 后端：
  - AskResponse 转草稿：覆盖有 sources、无 sources、多个 thread、已有 tag 不存在等情况。
  - LLM JSON malformed 时返回可编辑 fallback 草稿，而不是 500。
  - apply 草稿时验证部分成功、错误聚合、权限沿用现有创建接口。
- 前端：
  - Ask 后能打开草稿预览。
  - 用户可取消勾选、编辑字段、保存选中项。
  - 保存成功后显示 created counts 和跳转链接。
- 手工验收：
  - 用一个真实 KVM/linux-mm Ask 结果生成 Knowledge entity，并创建 thread annotation 和邮件 tag assignments。
  - 检查 Knowledge 页面、Annotations 页面、Tag targets 都能看到新内容。
