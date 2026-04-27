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
