> **Status**: planned
> **Updated**: 2026-05-09
> **Depends-on**: PLAN-38000, PLAN-38002, PLAN-30002
> **Priority**: P0 — 砍掉不可靠的功能，减少误导，降低复杂度

# PLAN-30003: 砍掉邮件到代码的自动跳转

## 背景

PLAN-38000 提出了"设计偏离初衷"的反思。其中一个具体的过度设计是：**从邮件 patch diff
自动跳转到内核源码**。这个功能看起来很美，但实际上不可靠，因为：

### 核心矛盾：Patch Diff 缺少版本锚点

邮件中的 patch diff 是"浮动的"——它不知道自己作用于哪个代码基：

```
问题 1: 版本号不可靠
  - 从邮件标题 [PATCH v6.10] 提取的版本号是 patch 的"目标版本"
  - 但 patch 可能基于 v6.10-rc3、某个 maintainer tree、甚至前一版 patch set
  - 没有可靠的方式从邮件中推断出 patch 的 base

问题 2: 行号不可靠
  - @@ -100,10 +105,8 @@ 里的行号是相对于 patch base 的
  - 如果 base 版本不确定，行号就没有意义
  - 点进去看到的是"某个版本"的代码，大概率不是 patch 讨论时的代码

问题 3: 中间版本问题
  - 邮件列表中的 patch 通常是 v1, v2, v3... 等多个版本
  - 最终合入的是 vN 版本
  - v1 的 diff 和最终合入的代码可能差异很大
  - 在 v1 的 diff 行上标注和跳转毫无意义
```

### 结论

**邮件中的 patch diff 是历史讨论的阅读材料，不是代码导航的入口。**
把 diff 行变成可点击的代码链接，是在假装有一种精确性，实际并不存在。

## 当前涉及的功能模块

### 需要砍掉/大幅简化的

| 模块 | 文件 | 问题 | 处置 |
|------|------|------|------|
| PatchDiffBlock 行号链接 | `web/src/components/PatchDiffBlock.tsx` | diff 行号不可靠，点击后跳转到错误位置 | **砍掉**——diff 行不再可点击跳转源码 |
| Hunk 级标签编辑器 | `web/src/components/PatchDiffBlock.tsx` (EmailTagEditor) | 对不可靠的 `{version, path, line}` 打标签没有意义 | **砍掉**——hunk 区域的标签功能移除 |
| Hunk 级批注 | `web/src/components/PatchDiffBlock.tsx` (Annotation) | 同上，锚定在不可靠的代码位置上 | **简化**——批注锚定在邮件消息上，而非代码行 |
| KernelPathLinkedText | `web/src/components/KernelPathLinkedText.tsx` | 邮件正文中的 `mm/vmscan.c:1234` 没有版本号，无法定位 | **砍掉**——不再自动识别和链接 |
| extractPatchVersion | `web/src/utils/kernelPathRefs.ts` | 从标题提取版本号不可靠 | **砍掉** |
| patch header 路径链接 | `web/src/components/PatchDiffBlock.tsx` (`--- a/path`, `+++ b/path`) | 没有版本号的文件路径链接没有意义 | **简化**——只显示路径文本，不生成链接 |

### 需要保留的

| 模块 | 原因 |
|------|------|
| 用户在 Code Browser 中手动创建的代码批注 | 用户自己选择了确定的 version+path+line |
| 批注中关联的 `message_id` | 用户明确建立的联系，方向是代码→邮件 |
| Code Browser 的 Thread Inspector | 从确定版本的代码查看关联邮件，方向正确 |
| 外部代码跳转（Elixir/git.kernel.org fallback） | 当 version 明确时（如 Code Browser 中），跳转是可靠的 |
| CodeTarget 数据结构 | 作为用户手动创建的批注的存储格式仍然有价值 |
| 油猴脚本（Elixir 页面标注） | 用户在 Elixir 上手动选择行号，版本由 Elixir URL 确定 |

## 简化方案

### PatchDiffBlock 改造

**改造前：**
```
diff --git a/mm/vmscan.c b/mm/vmscan.c    ← 可点击链接
--- a/mm/vmscan.c                          ← 可点击链接
+++ b/mm/vmscan.c                          ← 可点击链接
@@ -2345,10 +2345,8 @@ static int func()    ← 可打标签、可批注
  context line                               ← 行号可点击
- removed line                               ← 行号可点击
+ added line                                 ← 行号可点击
```

**改造后：**
```
diff --git a/mm/vmscan.c b/mm/vmscan.c    ← 纯文本
--- a/mm/vmscan.c                          ← 纯文本
+++ b/mm/vmscan.c                          ← 纯文本
@@ -2345,10 +2345,8 @@ static int func()    ← 纯文本
  context line                               ← 纯文本
- removed line                               ← 纯文本
+ added line                                 ← 纯文本
```

Patch diff 回归它本来的作用：**阅读材料**。语法高亮保留，但所有链接、标签、批注入口移除。

### 邮件正文中的路径处理

`KernelPathLinkedText` 组件不再使用。邮件正文中的 `mm/vmscan.c:1234` 作为纯文本显示。

**例外**：如果未来需要，可以在邮件详情页的顶部加一个"相关文件"区域，列出此邮件涉及的源文件路径（仅路径，不带行号，不带链接）。这只是信息提示，不做跳转。

### 批注锚点调整

代码批注的创建入口收敛到两个地方：
1. **Code Browser 页面**（`KernelCodePage.tsx`）——版本和路径是确定的
2. **Elixir 油猴脚本**——版本由 Elixir URL 确定

邮件页面的批注只锚定在"邮件消息"上，不再锚定在"代码位置"上。

### 删除的代码清单

```
web/src/utils/kernelPathRefs.ts          ← 整个文件删除
web/src/components/KernelPathLinkedText.tsx  ← 整个文件删除
web/src/components/PatchDiffBlock.tsx    ← 重写，去掉所有交互功能

# 相关引用清理
web/src/components/LayeredEmailCard.tsx  ← 移除 KernelPathLinkedText 使用
                                          ← 移除 extractPatchVersion 调用
```

## 为什么这样做

1. **减少误导**：错误的代码跳转比没有代码跳转更糟糕。用户点击后看到不相关的代码，会降低对整个系统数据质量的信任。
2. **降低复杂度**：PatchDiffBlock 目前混合了渲染、解析、跳转、标签、批注五种职责。回归纯渲染后大幅简化。
3. **聚焦核心价值**：项目的核心是"从邮件中提取知识"，不是"从邮件跳转到代码"。代码跳转是 Code Browser 的职责，不是邮件阅读器的职责。
4. **对齐 PLAN-38001**：PLAN-38001 说项目的中心是 knowledge with evidence，不是 email。砍掉不可靠的自动跳转后，剩下的可靠链接（用户手动创建的代码批注 + message_id 关联）反而更有价值。

## 与 PLAN-38001 的关系

PLAN-38001 在 "Current Design Assessment → Rework" 中提到了要降低 email-centric 的设计。
本计划是这一原则的具体执行：**邮件中 patch diff 的行号不应该被当作代码导航的锚点。**

同时，PLAN-38001 说的 "Knowledge entity can clearly show which claims are supported by which email,
patch, code, manual, or external reference" ——这个方向是对的，但证据链是"人工创建"的，不是"自动推断"的。
砍掉自动推断后，剩下的手动关联会更可信。

## 对 PLAN-38002 诊断实验的影响

砍掉自动跳转后，诊断实验的设计不受影响。实验的核心是"给 AI 完整的上下文，看它能不能产出有用的分析"。
砍掉的是前端 UI 的误导功能，不影响后端的数据和分析能力。

## 实施顺序

1. **Phase 1: 砍掉 KernelPathLinkedText** ——最简单，影响面小
2. **Phase 2: 改造 PatchDiffBlock** ——去掉行号链接、hunk 标签、hunk 批注
3. **Phase 3: 清理依赖** ——删除 `kernelPathRefs.ts`，清理 `LayeredEmailCard.tsx` 中的相关引用
