# PLAN-35001: AI-Assisted Knowledge Pipeline（邮件采集 → 知识组织）

## 目标

用 AI 减轻内核邮件知识库构建中的体力劳动（去噪、预分类、摘要、实体抽取、标签建议），同时保持人工对最终发布权的控制。不替代内核专家的判断，只让他们从"通读几百封邮件"变成"审核 AI 生成的草稿"。

## 与 PLAN-35000 的关系

PLAN-35000 实现的是 Research Agent（按 topic 搜索、生成 Knowledge Draft）。本计划是前移一步——在邮件**入库阶段**就开始用 AI 预处理，覆盖去噪、分类、实体抽取、标签建议。两个计划互补，最终串成完整流水线。

## 整体流水线

```
邮件采集 → [AI去噪] → [AI预分类] → 入库 → 
[AI摘要] → [AI实体抽取] → [AI标签建议] → Knowledge Draft → 
人工 Review → 发布到 Knowledge Base
```

每一步都有 AI 版本和人工 fallback，AI 产出始终进入 Draft 状态等待审核。

---

## Phase 1: AI 邮件去噪 & 预分类（入库前）

### 1.1 问题

lore.kernel.org 的邮件列表包含：
- 高质量讨论（10~30%）
- Patch / code review（30~50%）  
- 噪音：广告（广交会等）、自动回复、重复抄送、bikeshedding（5~15%）
- 大量 CC 列表的重复邮件

当前系统不做去噪，全部入库。Tags 页面里能看到大段中文广告。

### 1.2 方案

在 `email_parser` 之后、入库之前插入一个 `EmailClassifier`：

```python
class EmailClassifier:
    async def classify(self, email: ParsedEmail) -> EmailClassifyResult:
        # LLM 调用: 给定 subject + body[:1000]，返回分类
        category: Literal[
            "patch",           # 代码补丁
            "design_discuss",  # 设计讨论
            "bug_report",      # Bug 报告
            "question",        # 技术提问
            "announcement",    # 公告
            "noise",           # 广告/垃圾
            "auto_reply",      # 自动回复
            "bikeshedding",    # 无实质性讨论
        ]
        confidence: float
        rationale: str
        is_spam: bool          # True → 不写入 emails 表，单独放 spam 队列
```

**存储**：
- `emails` 表新增 `category` 列 + `category_confidence` + `category_rationale`
- `categorized_by` 字段（`ai` / `human` / 空）
- 新增 `email_noise_queue` 表：被标记为 noise 的邮件，保留 30 天供审计

**配置**：
```yaml
email_classifier:
  enabled: false            # 默认关闭
  provider: dashscope       # 复用 qa.email 的 LLM
  batch_size: 20
  auto_drop_noise: false    # true = AI分类为noise的直接丢弃（激进）
```

### 1.3 不依赖向量索引

分类只取 subject + body 前 1000 字符 + sender，不需要向量。如果 LLM 不可用，分类步骤直接跳过，邮件正常入库。

### 1.4 风险 & 缓解

| 风险 | 缓解 |
|------|------|
| AI 误判高质量邮件为 noise | noise 不进 active 视图但保留 30 天，可审计恢复 |
| 增加采集时间 | batch_size=20，异步处理，可关闭 |
| LLM 成本 | 每条约 500 token，100 万条 ≈ 5 亿 token，约几十美元 |

---

## Phase 2: AI 线程摘要（入库后）

### 2.1 问题

一个内核线程可能有 50~200 封邮件。当前 ThreadDrawer 能看，但没有摘要——读一个线程需要逐封翻阅，10 分钟才搞清楚讨论脉络。

### 2.2 方案

```python
class ThreadSummarizer:
    async def summarize(self, thread_id: str) -> ThreadSummary:
        # 1. 取线程所有邮件（按时间排序）
        # 2. 取前 10 封 key messages（第一个 patch、转折点、最后一封结论）
        # 3. LLM 生成结构化摘要
        summary: str           # 3~5 句马克档摘要
        key_decision: str      # 最终结论/决定
        participants: list[str] # 主要参与者
        timeline: list[dict]   # 关键节点
        #   {timestamp, message_id, subject, event: "patch_v1"|"review"|"v2"|"merged"}
        tags_suggested: list[str]  # 建议标签
```

**触发方式**：
- 用户点击 ThreadDrawer 时自动检测：如果该线程没有摘要缓存，后台生成
- 或批量脚本：`python scripts/summarize.py --list lkml --limit 1000`

**存储**：`thread_summaries` 表

**UI**：ThreadDrawer 顶部显示摘要卡片（可折叠）

### 2.3 不依赖向量索引

摘要基于线程内邮件文本，不需要向量。

---

## Phase 3: AI 实体抽取 & 标签建议

### 3.1 问题

内核知识库的核心价值在于把讨论中的**技术实体**（新 API、子系统、config 选项、bug 编号）结构化为可查询的 Knowledge Entity。当前完全靠人工创建。

### 3.2 方案

```python
class EntityExtractor:
    async def extract(self, thread_summary, email_bodies) -> ExtractResult:
        entities_suggested: list[KnowledgeEntitySuggestion]
        # 每条建议: entity_type, canonical_name, summary, aliases, confidence
        tags_suggested: list[TagSuggestion]
        # 每条建议: tag_name, target_id, confidence
        relations_suggested: list[RelationSuggestion]  
        # 每条建议: source_entity, relation_type, target_entity, reason
```

**触发**：Phase 2 摘要完成后自动执行，或 KnowledgePage 手动触发。

**产出**：全部进入 Knowledge Draft，人工 accept/reject。

### 3.3 不依赖向量索引

实体抽取依赖 LLM + 线程文本。可以用现有的 `KnowledgeStore.search_entities()` 检查是否已存在（但那是关键词搜索，不需要向量）。

---

## Phase 4: 流水线整合

### 4.1 端到端自动化

```bash
# 一步完成：去噪 → 分类 → 摘要 → 实体抽取 → Draft
python scripts/build-knowledge.py --list lkml --limit 1000
```

内部流程：
```
1. GitCollector 拉新邮件
2. EmailClassifier.classify_batch() → 分类 + 去噪
3. PostgresStorage 入库
4. ThreadSummarizer 对每个线程生成摘要
5. EntityExtractor 抽取实体/标签/关系
6. AskDraftService 生成 Knowledge Draft
7. 通知：N 个新 Draft 等待审核
```

### 4.2 每一步都可独立开关

```yaml
knowledge_pipeline:
  classifier: {enabled: false}
  summarizer: {enabled: false}
  extractor: {enabled: false}
  max_concurrent_llm_calls: 5
  dry_run: false         # true = 只打日志不写数据库
```

---

## 前端改动

### Phase 1 配套
- Tags/Annotations 页面新增 noise 计数角标
- 被标记 noise 的邮件在搜索中默认隐藏，可勾选 `include noise`

### Phase 2 配套  
- ThreadDrawer 顶部摘要卡片（折叠，Source 标注 `AI Generated · Pending Review`）
- 摘要可编辑、可确认

### Phase 3 配套
- Knowledge Draft Inbox 区分来源：`agent_research` | `thread_summarize` | `entity_extract`
- Draft 详情页展示 AI 提取依据（引用原文行）

---

## 实现优先级

| 优先级 | Phase | 原因 |
|--------|-------|------|
| P0 | Phase 1 去噪 | 数据质量是地基，垃圾占 10%+ 影响所有下游 |
| P1 | Phase 2 摘要 | 直接提升 ThreadDrawer 的可用性，最易感知 |
| P2 | Phase 1 分类 | 分类数据支撑后续定向分析 |
| P3 | Phase 3 实体抽取 | 需要 P1+P2 数据质量到位后才能稳定输出 |
| P4 | Phase 4 整合 | 一键流水线，提升效率 |

---

## 不依赖向量索引

本计划四个 Phase **都不需要向量索引**。它们依赖的是：
- Phase 1, 2, 3: LLM（直接调 ChatLLMClient）+ 邮件/线程原始文本
- Phase 4: 上述组件的串联

向量索引只在 Ask Agent 的语义搜索和 Research Agent 的相关性判断中需要，不属于本计划范围。

---

## 与现有系统的复用

| 现有组件 | 复用方式 |
|----------|---------|
| `ChatLLMClient` | 所有 LLM 调用统一走这个 |
| `AskDraftService` | Phase 3 实体抽取结果直接转 Draft |
| `KnowledgeStore` | 实体去重、Draft 管理 |
| `TagStore` | 标签建议的 target 绑定 |
| `AnnotationStore` | Phase 1 分类说明可加入批注 |
| `ThreadDrawer` | Phase 2 摘要的展示入口 |
| `KnowledgePage` | Phase 3 Draft 的审核入口 |
| `PostgresStorage` | Phase 1 新增分类字段 |

---

## 测试计划

- 单元测试：`EmailClassifier.classify()`、`ThreadSummarizer.summarize()`、`EntityExtractor.extract()` — mock LLM
- 集成测试：完整流水线 `build-knowledge.py` dry_run 模式
- 质量评估：取 100 封已人工标注的邮件，对比 AI 分类准确率（目标 >85%）
