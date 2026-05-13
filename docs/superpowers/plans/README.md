# Superpowers Plans Index

这个目录保存当前工程的重要演进计划。新窗口接手时，优先从这里开始。

## 当前主线

1. `2026-05-13-kernel-knowledge-network.md`
   - 目标：把工程演进为以内核代码为锚点、以证据为基础的知识网络。
   - 核心链路：`SourceDocument -> SourceSegment -> KnowledgeClaim -> Evidence -> Entity/Relation -> KnowledgeBrief`。
   - 适合处理：mail list、kernel commit、LWN、芯片手册、博客、论文如何互联。

2. `2026-05-13-product-slimming-plan.md`
   - 目标：删除或降级与证据型内核知识网络主线关系弱的功能。
   - 第一批建议：Workspace、独立 Translations 工作台、Contribution Chips。
   - 第二批建议：隐藏 Agent Research、降级 Tags、隐藏 Annotation Review。
   - 第三批建议：合并 Manual Ask、删除过渡性的 Kernel Symbol Preview / Elixir userscript。

## 快速恢复上下文

```bash
sed -n '1,220p' docs/superpowers/plans/2026-05-13-kernel-knowledge-network.md
sed -n '1,220p' docs/superpowers/plans/2026-05-13-product-slimming-plan.md
```

## 当前建议执行顺序

1. 先完成 `product-slimming-plan` 的 Task 1 到 Task 4，减少界面和维护负担。
2. 再实现 `kernel-knowledge-network` 的 SourceDocument/SourceSegment。
3. 然后实现 KnowledgeClaim、ThreadEpisode、KnowledgeBrief。
4. 最后把 Ask/Agent/Manual/Search 的输出统一收敛到 claim/evidence/brief。
