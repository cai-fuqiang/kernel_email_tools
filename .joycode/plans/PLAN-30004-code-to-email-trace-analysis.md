> **Status**: analysis
> **Updated**: 2026-05-09
> **Depends-on**: PLAN-30003, PLAN-30002
> **Priority**: P1 — 在对 PLAN-30002 Phase 8 投入工程之前，先验证核心假设

# PLAN-30004: 代码→邮件追溯链路的可行性分析

## 背景

PLAN-30002 Phase 8 提出了代码→邮件追溯链路：

```
代码行 → git blame → commit → commit message 中的 lore 链接 → 邮件线程 → 全部 patch 版本 + 外链
```

用户进一步提出了"知识时间轴"的想法：

> 知识实体可能对应多个子知识，每个子知识有自己的时间轴，每个时间点对应着 commit + 邮件讨论 + 外链。

本计划对这两个方向进行冷静分析，识别风险点，提出需要先验证的假设。

---

## 一、git blame 追溯链路的真实问题

### 问题 1: git blame 只给你最后一次修改

```
$ git blame -L 100,100 kernel/sched/fair.c
返回: 2024-03-15, commit abc123 "sched/fair: fix whitespace"
有 lore link? 可能有，指向一个 "Applied, thanks" 线程

你真正想找的:
  2007-10-09, commit 789xyz "sched: introduce CFS"  ← 这才是设计意图
  有 lore link? 大概率没有。2007 年的 commit message 普遍不带 Link: 标签。
```

`git blame` 对追踪"这行代码为什么长这样"几乎没有帮助。

应该用 `git log -L <start>,<end>:<file>` 追踪完整历史，但：
- 输出量大，需要 AI 辅助筛选"有意义的" commit
- 格式化/重构/merge/cherry-pick 类 commit 占大多数
- 2015 年前的 commit message 普遍没有 `Link:` 标签

### 问题 2: 大部分重要讨论不产生 commit

用户自己的例子：RSDL 从未合入主线，但深刻影响了 CFS 的设计。

从 CFS 任何一行代码出发，无论是 `git blame` 还是 `git log -L`，都追溯不到 RSDL 讨论。

类似情况：
- **Rejected patches**：讨论激烈但从未合入
- **Alternative proposals**：两个方案竞争，失败者的设计思想可能影响后续开发
- **Design RFCs**：只有讨论没有代码
- **LWN 文章引发的讨论**：设计动机在 LWN，响应在邮件列表，代码在几个月后

这些是"代码→邮件"链路的根本性盲区。

### 问题 3: lore link 指向的是最终版本

```
v1 patch → 激烈的设计讨论，多种方案对比
v2 patch → 修改后讨论集中
v3 patch → 接近共识
v4 patch → Reviewed-by, "Applied, thanks"
                    ↑
               Commit message 里的 Link: 指向这里
```

真正有价值的设计讨论在 v1-v2 的回复里，但 commit message 不引用它们。

---

## 二、知识时间轴的现实约束

### 约束 1: 谁来建？

以调度器演进为例：
- 30 年历史
- 几十个关键 commit（O(1) scheduler → RSDL → CFS → EEVDF → ...）
- 数百个邮件线程
- 大量 LWN 文章、博客、kernel doc

建一条完整时间轴需要内核专家级别的领域知识。AI 可能能辅助，但审核成本很高（回到 PLAN-38002 的问题）。

### 约束 2: 谁来维护？

- 新的 commit 合入后，时间轴要不要更新？
- 一个子系统的时间轴，什么时候算"完整"？
- 如果是个人维护，这些时间轴会不会像 wiki 一样慢慢过时？

### 约束 3: "子知识"是否过早抽象？

当前阶段区分 "Knowledge" 和 "Sub-Knowledge" 可能是过早抽象：

- 你怎么判断一个东西是"子知识"还是"相关知识实体"？
- 如果调度器演进是一个知识实体，CFS 是子知识还是独立实体？RSDL 呢？
- EEVDF 替代 CFS 后，CFS 从"当前实现"变成"历史版本"，知识层级也要改？

建议：先用扁平的 Knowledge Entity + Relation 模型，层级关系从使用中自然浮现，不要提前设计。

### 约束 4: 一条时间轴到底需要多少数据？

在动手设计数据模型前，建议手工看一个真实话题。以下面的格式列出"理想关联列表"：

| 时间 | 类型 | 内容 | 关联方式 |
|------|------|------|----------|
| 2007-04 | commit | `abc123` 引入 CFS | 直接相关 |
| 2007-03 | 邮件线程 | RSDL 讨论 | 设计思想来源，不产生 commit |
| 2007-06 | 邮件线程 | CFS v1-v8 讨论 | 直接相关 |
| 2007-10 | LWN | "CFS: The Completely Fair Scheduler" | 补充阅读 |
| ... | ... | ... | ... |

如果一条时间轴超过 20 个节点，审核和后续维护就是真实负担了。

---

## 三、哪些是靠谱的

经过分析，以下方向比较务实：

### 3.1 用 `git log -L` 而非 `git blame`

`git log -L` 追踪完整历史，能看到所有碰过这段代码的 commit。然后：
- 筛选出有 `Link:` 标签的 commit（自动可跳转邮件）
- 筛选出有实质变更的 commit（跳过 whitespace/typo 修复）
- 展示 commit 列表，让用户自己判断哪个有意义

### 3.2 代码关联到"已知的邮件线程"

关联方向是手动或半自动的，不是自动推导的：
- 用户在 Code Browser 批注中手动关联 `message_id`
- commit message 解析出的 `Link:` 自动关联
- AI 可以建议关联，但需要人工确认

### 3.3 知识实体附带简单的关联列表

不做时间轴模型，只做简单的关联字段：
- `related_commits`: commit hash 列表
- `related_threads`: message_id 列表
- `related_links`: URL 列表（LWN、kernel doc、博客等）
- `related_entities`: 其他知识实体 ID 列表

这就是够用的第一步。时间轴/子知识等结构化需求，从使用中自然浮现。

### 3.4 外链作为知识实体的附加引用

这个没有争议。Knowledge Entity 可以附带任意 URL 引用，包括 kernel doc、LWN、博客等。

---

## 四、需要先验证的假设

在投入工程资源之前，建议用 10 个真实样本验证以下假设：

### 假设 1: git log -L 能找到有意义的历史

**验证方法：**
1. 选 10 个你熟悉的代码片段（不同子系统、不同年代）
2. 对每个跑 `git log -L`，列出所有 commit
3. 手工标记哪些是"有设计意图的"，哪些是噪音
4. 统计有 `Link:` 标签的比例

**判断标准：**
- 如果 >50% 的"有设计意图"的 commit 有 lore link → Phase 8 可行
- 如果 <20% → Phase 8 需要重新设计，不能以 lore link 为支点

### 假设 2: 一个知识实体的关联数据量是可控的

**验证方法：**
1. 选一个你熟悉的内核话题（如某个 RCU 机制）
2. 手工列出"理想的关联列表"：commit、邮件、外链
3. 数一数总数

**判断标准：**
- 如果 <20 条 → 手工维护可行
- 如果 >50 条 → 需要更好的自动化，否则维护负担太重

---

## 五、与 PLAN-30002 Phase 8 的关系

Phase 8 的 `git blame → commit → lore link → 邮件线程` 链路的自动部分可以保留——它是低成本的（blame 是现成的 git 能力，lore link 解析是正则提取）。但它**不能作为主要的"代码→讨论"路径**，因为：

1. 只能找到最后一次修改
2. 旧 commit 没有 lore link
3. 未合入的讨论完全不可见

Phase 8 的正确定位应该是：

> "从代码行快速跳转到最后一次修改的讨论（如果有的话）"，而不是"追溯完整的核知识演进"。

更完整的追溯需要以知识实体为枢纽，手工或半自动地关联 commit、邮件、外链。

---

## 六、建议的实施顺序

1. **先做样本验证**（假设 1 和假设 2）
2. **实现 git log -L + commit 列表展示**（比 git blame 更有用）
3. **实现 commit message 中的 lore link 自动关联**（低成本，有就显示，没有就算了）
4. **实现知识实体的简单关联列表**（related_commits / related_threads / related_links）
5. **验证 1-2 个月使用情况后，再决定要不要做时间轴模型**
