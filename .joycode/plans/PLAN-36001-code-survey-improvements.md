> **Status**: draft
> **Created**: 2026-05-08
> **Depends-on**: 无 (独立改进，不影响现有流程)
> **Priority**: P3 — 渐进式质量提升，非紧急
> **Source**: 借鉴 [code-survey/survey](https://github.com/eunomia-bpf/code-survey/tree/main/survey) 的设计

# 借鉴 code-survey 改进 AskDraftService 和分类体系

## Summary

code-survey 和我们的 AskDraftService / AgentResearchService 本质上都是在做"LLM 驱动的内核内容结构化分析"。但 code-survey 在三个方面做得更好：**输出格式约束**（JSON Schema strict mode）、**自校正循环**（Rethink）、**声明式分类体系**（YAML 维度定义）。本计划将这些设计点引入 kernel_email_tools。

## 当前问题

1. **Draft 生成可靠性不足**：`AskDraftService._generate_with_llm()` (`src/qa/ask_drafts.py:118`) 通过 prompt 描述 JSON 格式，LLM 有时输出非标准 JSON，依赖 `parse_json_object()` 容错兜底。
2. **无自校正机制**：Draft 生成后直接使用，没有让 LLM 审视自己的输出是否有遗漏或错误。
3. **标签/分类体系硬编码**：entity_type、tag 候选规则散落在代码中，分类维度不可配置。
4. **结构化输出未启用**：`ChatLLMClient` 没有使用 provider 的 structured output / JSON Schema 能力。

## 改进方案

### Phase 1: AskDraftService 加入 Rethink 自校正

**文件**: `src/qa/ask_drafts.py`

在 `_generate_with_llm()` 调用后，增加一个可选的 rethink 步骤：

```python
async def _generate_with_llm(self, ..., rethink: bool = True):
    # 第一次生成
    raw = await self.llm.complete(...)
    parsed = parse_json_object(raw)
    
    # Rethink: 把第一次结果喂回去让 LLM 修正
    if rethink and parsed:
        rethink_prompt = DRAFT_USER_TEMPLATE.format(...) + \
            "\n\nBackground: Your previous response:\n" + \
            json.dumps(parsed, indent=2) + \
            "\n\nAction: Do you have anything to correct? " + \
            "Check for missing knowledge entities, incorrect classifications, " + \
            "or missed tag assignments. Return the complete corrected JSON."
        raw2 = await self.llm.complete(DRAFT_SYSTEM_PROMPT, rethink_prompt, ...)
        parsed2 = parse_json_object(raw2)
        if parsed2:
            parsed = parsed2
    
    return parsed
```

**改动量**: ~20 行，仅影响 `_generate_with_llm` 方法。

**风险**: 增加一次 LLM 调用，延迟翻倍。通过默认参数控制是否启用。

### Phase 2: ChatLLMClient 支持 Structured Output

**文件**: `src/qa/providers.py`

为 `ChatLLMClient.complete()` 增加可选的 `response_json_schema` 参数：

```python
async def complete(
    self,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.1,
    max_tokens: int = 2048,
    response_json_schema: Optional[dict] = None,  # 新增
) -> str:
```

- DashScope 路径：将 schema 转为 `response_format: {"type": "json_object"}` 或 `"json_schema"` 兼容格式
- OpenAI 路径：使用 SDK 的 `response_format` 参数
- 如果 provider 不支持，降级为当前行为（加 `Return only JSON.` 到 prompt）

**改动量**: ~30 行，向后兼容。

### Phase 3: YAML 声明式分类 Schema

**新文件**: `config/classification.yml`

将 draft 生成的分类维度从代码中抽离为 YAML：

```yaml
# 邮件/补丁分类维度
dimensions:
  patch_type:
    question: "What is the primary type of this patch?"
    type: single_choice
    choices:
      - value: Bug Fix
      - value: New Feature
      - value: Performance Optimization
      - value: Cleanup / Refactoring
      - value: Documentation
      - value: Test
      - value: Security Fix
      - value: Build System / CI

  subsystem:
    question: "Which kernel subsystem does this relate to?"
    type: multiple_choice
    choices:
      - value: Memory Management (mm)
      - value: Networking
      - value: File Systems / VFS
      - value: BPF
      - value: Scheduler
      - value: Architecture / Hardware
      # ...

  complexity:
    question: "What is the estimated complexity?"
    type: single_choice
    choices:
      - value: Simple (1-20 lines, 1-2 files)
      - value: Moderate (21-100 lines, up to 4 files)
      - value: Complex (100+ lines, 5+ files)
```

**新文件**: `src/qa/classification.py`

解析 YAML schema，生成对应的 LLM prompt 和 JSON Schema，供 `AskDraftService` 和 `AgentResearchService` 复用。

**改动量**: 新模块 ~100 行 + YAML 配置，不改现有接口。

### Phase 4: AgentResearchService 批量断点续跑

**文件**: `src/agent/research_service.py`

借鉴 code-survey 的 CSV 批处理模式，增加 `batch_execute(topics: list[str])` 方法：

- 从 `agent_runs` 表查询已完成的 topic（类似 `read_processed_commits`）
- 跳过已处理的 topic
- 批量创建 research run 并依次执行
- API 层增加 `POST /api/agent/research-runs/batch` 端点

**改动量**: ~80 行，新增 API 端点。

## 实施顺序

| Phase | 收益 | 风险 | 建议先做 |
|-------|------|------|----------|
| 1. Rethink 自校正 | 高 — 直接提升 Draft 质量 | 低 — 可选启用 | **YES** |
| 2. Structured Output | 中 — 更可靠的 JSON 输出 | 低 — 向后兼容 | **YES** |
| 3. YAML 分类 Schema | 中 — 可配置性 | 中 — 需要 UI 联动 | 后续 |
| 4. 批量断点续跑 | 低 — 当前用量不大 | 低 | 后续 |

## 不做的

- 完整照搬 code-survey 的 CSV 批处理管道 —— 我们已有 PostgreSQL 持久化，不需要 CSV
- 照搬 code-survey 的交互式 ask_question 循环 —— 我们已有更完善的 Agentic RAG pipeline
- 替换现有 tag 系统 —— 仅增强分类生成，不改变 tag 存储模型
