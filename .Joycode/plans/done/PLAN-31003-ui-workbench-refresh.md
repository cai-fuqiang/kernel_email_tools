# PLAN-31003: 全站 UI 统一与知识沉淀工作流优化

## Summary
- 目标是把全站 UI 从“各页面独立堆 Tailwind”收敛为一致的知识工作台。
- 第一轮覆盖全站，但优先强化 Search/Ask -> Evidence -> Draft Inbox -> Knowledge 的知识沉淀主链路。
- 不引入新 UI 框架，不改变后端 API、路由、权限或数据库。

## Implementation Status
- [x] 新增共享 UI 组件：PageShell、PageHeader、SectionPanel、EmptyState、StatusBadge、按钮与 MetricCard。
- [x] 重构 MainLayout，按 Research、Knowledge Workbench、Code、Admin、Manuals 分组。
- [x] 优化 Ask/Search/Knowledge 的页面层级、主要动作、证据与草稿入口。
- [x] 为 Tags、Manual Ask/Search、Users 套用统一 header/panel/button/badge。
- [x] README 增加本计划链接。
- [ ] Annotation、Translation、Kernel Code 和 ThreadDrawer 仍需第二轮深度整理。

## Design Rules
- 页面先呈现“当前任务”和“下一步动作”，再呈现底层数据。
- 证据、草稿、审核状态是知识库 UI 的一等信息。
- 保持安静、工作台式界面，不做营销式 hero 或装饰背景。
- 使用 lucide-react 图标，避免继续新增手写 SVG。

## Test Plan
- `npm run build` 必须通过。
- 登录后主要页面可正常打开：Search、Ask、Knowledge、Annotations、Tags、Translations、Kernel Code、Manuals、Users。
- Ask 引用跳转、Search draft 保存、Knowledge Draft Inbox/Evidence/Merge/Graph 不回归。

## Follow-up Backlog
- 抽出 SourceLink、EvidenceCard、DraftInboxCard 等更专用组件。
- 为 ThreadDrawer 做第二轮信息密度和翻译控件整理。
- 评估图谱、代码浏览和批注树的局部交互一致性。
