> **Status**: done
> **Updated**: 2026-05-06
> **Depends-on**: PLAN-34000（Phase 2 派生）
> **Priority**: P1

# PLAN-34001: Search/Ask 结果贡献度标记

## Summary

PLAN-34000 Phase 2 中提到："Surface whether an email/thread already contributed to saved Knowledge, an annotation, or a draft."

这一项是独立的端到端特性，从 PLAN-34000 派生为单独 PLAN，避免主 PLAN 范围膨胀。

目标：在 Search 命中卡片、Ask 答案的 Sources 列表、ThreadDrawer 标题栏，向用户清晰展示该邮件 / 线程已经在知识库中留下了哪些痕迹（knowledge entity 数量、annotation 数量、knowledge draft 是否存在），帮助研究者快速识别「我已研究过 / 这是新材料」。

## 现状分析

### 已有数据源
- `knowledge_evidence` 表：`message_id` / `thread_id` 是 indexed 列。可统计某邮件被作为多少个知识实体的证据
- `annotations` 表：`target_type=email_thread/email_message/email_paragraph` + `target_ref` 关联邮件
- `knowledge_drafts` 表：`source_ref` 可能包含 thread_id

### 已有但不够
- `SearchHit.tags` 只反映标签状态，不区分 knowledge/annotation
- 后端没有批量 lookup endpoint，前端无法异步丰富 hits

## 设计

### 后端新增

`POST /api/contributions/lookup`

```jsonc
// Request
{
  "message_ids": ["<msg-1>", "<msg-2>"],
  "thread_ids":  ["<thread-1>"]
}

// Response
{
  "by_message_id": {
    "<msg-1>": {
      "knowledge_evidence_count": 2,
      "annotation_count": 1
    }
  },
  "by_thread_id": {
    "<thread-1>": {
      "knowledge_evidence_count": 5,
      "annotation_count": 3,
      "draft_count": 1
    }
  }
}
```

实现要点：

- 单次请求最多 200 个 message_id + 100 个 thread_id（防滥用）
- 三条 SQL 一次返回（按 message_id / thread_id GROUP BY）
- 不需要鉴权升级，但要遵守 visibility（用户只能看到自己可见的 evidence/annotation/draft 计数）
- 添加 router `src/api/routers/contributions.py`

### 前端集成

新增 `web/src/api/contributions.ts`：

```ts
export interface ContributionStats {
  knowledge_evidence_count: number;
  annotation_count: number;
  draft_count?: number; // 仅 thread 级
}

export async function lookupContributions(
  messageIds: string[],
  threadIds: string[],
): Promise<{
  by_message_id: Record<string, ContributionStats>;
  by_thread_id: Record<string, ContributionStats>;
}>;
```

UI 集成位置：

1. `components/search/ResultCard.tsx` — 在主标题旁增加小 chip
   - 蓝色 K3 表示该邮件被引用为 3 条 knowledge evidence
   - 紫色 A2 表示该 thread 有 2 条 annotation
   - 灰色 D1 表示有 1 条 pending draft
2. `components/ask/ConversationCard.tsx` Sources 列表 — 同样的 chip
3. `components/ThreadDrawer.tsx` 标题栏 — 显示完整文字「3 个知识引用 · 2 条批注 · 1 个待审 draft」

### 数据流

```text
SearchPage 拿到 hits[]
  -> 提取 messageIds[] + threadIds[]（去重）
  -> useEffect 调用 lookupContributions()
  -> 把结果 merge 到 ResultCard props 里
  -> ResultCard 看到非 0 计数则显示 chip
```

## Phase

### Phase 1 — 后端
- 新建 `src/api/routers/contributions.py`，注册到 `server.py`
- 实现单条 SQL 聚合查询（按 visibility 过滤）
- 单测：空请求 / 正常 / 大请求被截断 / visibility 过滤生效

### Phase 2 — 前端 hook
- `web/src/hooks/useContributions.ts`：接受 hits[]，自动 batch 拉取
- 共享缓存（避免 Ask + Search 双重请求）

### Phase 3 — UI 渲染
- ResultCard / ConversationCard.Sources / ThreadDrawer 标题栏接入
- chip 颜色和缩写约定写到 `code-quality.md`

### Phase 4 — 文档与发布
- README 更新到「已完成」清单
- PLAN-34001 状态标记 done

## Test Plan

后端：

- 空 message_ids + 空 thread_ids 返回空字典
- 单 message_id 命中多条 evidence 时计数正确
- visibility=private 的 evidence/annotation 对其他用户不可见
- 超出最大数量限制返回 400

前端：

- hooks 测试：相同 ids 不重复调用
- ResultCard 截图测试：有 chip / 无 chip 两种状态

## 假设与限制

- 计数是「轻提示」，不要阻塞 search 渲染。即使 lookup 失败也要保留主流程
- 计数是 stale 的，不实时反映用户刚保存的 draft；首次进入页面时刷新即可
- 不引入 WebSocket，不做 realtime 推送

## 实现摘要 (2026-05-06)

### Backend
- 新增 `src/api/routers/contributions.py`，注册到 `server.py`
- `POST /api/contributions/lookup` 单次 SQL 聚合查询 evidence / annotation / draft
- 沿用 `UnifiedAnnotationStore._visibility_filters` 的 visibility 规则
- 上限：message_ids ≤ 200, thread_ids ≤ 100
- 计数失败返回 500 但前端容错降级，主流程不阻塞

### Frontend
- `web/src/api/contributions.ts`：lookup 客户端，失败静默返回空
- `web/src/hooks/useContributions.ts`：60s 进程内缓存的批量 hook
- `web/src/components/ContributionChips.tsx`：K/A/D 三色 chip（compact / 文字两种模式）
- 接入点：
  - `ResultCard`：标题旁 compact chip（消费 messageStats / threadStats）
  - `ConversationCard` Source 列表：每个 source 行 compact chip
  - `ThreadDrawer` 头部统计栏：完整文字 chip（"3 知识引用 · 2 批注 · 1 待审 draft"）

### Tests
- `tests/test_contributions.py` (12 cases)：
  - request schema 默认 / 显式列表
  - response schema 默认空字典
  - ContributionStats default 全 0
  - 匿名 vs 已登录 visibility filter 表达式区分
  - `MAX_MESSAGE_IDS` / `MAX_THREAD_IDS` 上限常量
  - `AnnotationORM` 字段烟雾测试