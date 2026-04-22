# PLAN-201: 分层模式(Layered Mode) BUG 修复与重构

## 问题概述
ThreadDrawer.tsx 的分层模式存在多个严重BUG，导致：
1. 点击一个节点展开子层级时，同层级其他节点的子层级也会展开
2. 子层级有时完全点不开

## BUG 根因分析

### BUG 1: 递归渲染 + 可见性判断逻辑矛盾
`EmailCard` 组件在分层模式下递归渲染所有子节点（第592-610行），但可见性控制逻辑（第294-298行）存在严重缺陷：

```tsx
// 第294-298行 - 当前的错误逻辑
if (viewMode === 'layered' && depth > 0) {
  if (depth > 1 && !isLayeredExpanded) {
    return null;  // BUG: 只检查自身是否在展开集合中，不检查父节点
  }
}
```

- **depth=1 的节点**: 永远不会被 return null，无论父节点是否展开都会显示
- **depth>1 的节点**: 只检查自身的 `isLayeredExpanded`（即自身ID是否在集合中），而不是检查**父节点**是否展开

正确的逻辑应该是：**一个子节点是否可见，取决于它的父节点是否被展开**。但当前代码把"父节点是否展开"和"自身是否展开"混淆了。

### BUG 2: 折叠/展开状态判断混乱
```tsx
// 第281-288行
const isCollapsed = viewMode === 'tree'
  ? foldLevel === 'collapsed'
  : (depth === 0 ? false : !isLayeredExpanded);

const shouldShowContent = viewMode === 'tree'
  ? isExpanded
  : isLayeredExpanded;
```

- 对于分层模式，`isCollapsed` 判断 `depth === 0 ? false`，意味着根节点永远不会折叠，即使它未被展开
- `isLayeredExpanded` 同时用于控制"节点是否可见"和"节点内容是否展开"，职责不清

### BUG 3: toggleLayeredExpand 没有处理子节点级联
点击一个节点折叠时，不会同时折叠其所有子节点，导致再次展开时出现状态不一致。

## 重构方案

### 核心思路：分离"可见性"和"展开状态"
将分层模式的逻辑从 EmailCard 递归渲染中提取出来，改为**扁平化渲染**：
1. 父组件 `ThreadDrawer` 计算当前应该可见的节点列表
2. `EmailCard` 只负责渲染单个节点 + 控制自身内容展开

### TODO: 重构实现步骤

- [ ] **Step 1**: 在 ThreadDrawer 中新增 `getVisibleNodes` 函数
  - 遍历线程树，根据 `layeredExpandedIds` 计算可见节点
  - 规则：根节点始终可见；子节点仅在其直接父节点被展开时可见
  
- [ ] **Step 2**: 重写 `toggleLayeredExpand` 逻辑
  - 折叠一个节点时，级联折叠所有后代节点
  - 收集该节点所有后代ID，从 `layeredExpandedIds` 中移除

- [ ] **Step 3**: 修改 EmailCard 的分层模式渲染
  - 删除 EmailCard 内部的可见性判断逻辑（第294-298行）
  - 分层模式下不递归渲染 children，由父组件控制
  - EmailCard 只负责：显示折叠摘要 / 展开内容 / 展开箭头

- [ ] **Step 4**: 修改 ThreadDrawer 渲染分层视图
  - 分层模式：使用 `getVisibleNodes` 获取可见列表，扁平渲染
  - 树形模式：保持原有递归渲染不变

- [ ] **Step 5**: 验证并构建
  - 在 home_pc 上运行 `npm run build` 确认无编译错误