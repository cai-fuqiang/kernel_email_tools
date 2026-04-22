# PLAN-202: 线程节点回复总数显示增强

## 概述
当前 ThreadDrawer 中每个邮件节点显示的"X 回复"仅表示**直接子节点**数量（`children.length`）。需要增加**后代总数**显示，让用户直观了解某个节点下面还有多少个递归节点。

## 当前行为
- `LayeredEmailCard` 折叠摘要: `{children.length} 回复`
- `LayeredEmailCard` 展开头部: `{children.length} 回复`
- `TreeEmailCard` 展开头部: `{children.length} 回复`
- 仅显示直接子节点数量，无法知道深层嵌套的总量

## 目标行为
在现有"X 回复"基础上，当后代总数 > 直接子节点数时，额外显示总数：
- 直接子节点数 == 后代总数 → `"3 回复"`（无嵌套，不变）
- 直接子节点数 < 后代总数 → `"3 回复 / 共 12"`（有更深层嵌套）

## TODO: 实现步骤

### Step 1: 添加后代总数计算辅助函数
- [ ] 在 `ThreadDrawer.tsx` 中添加 `countDescendants(node: ThreadNode): number` 函数
  - 递归统计所有后代节点（不含自身）
  - 已有 `collectDescendantIds` 可复用其逻辑

### Step 2: 更新 LayeredEmailCard 回复显示
- [ ] `renderCollapsedSummary()` 中修改回复计数展示
  - 当 `totalDescendants > children.length` 时显示 "X 回复 / 共 Y"
- [ ] `renderFullHeader()` 中修改回复计数展示
  - 同上逻辑

### Step 3: 更新 TreeEmailCard 回复显示
- [ ] `renderFullHeader()` 中修改回复计数展示
  - 与 LayeredEmailCard 保持一致的展示风格

### Step 4: 验证
- [ ] TypeScript 编译通过
- [ ] 无直接嵌套的节点只显示 "X 回复"
- [ ] 有深层嵌套的节点显示 "X 回复 / 共 Y"
- [ ] 叶子节点（无子节点）不显示回复标签

## 修改文件
- `web/src/components/ThreadDrawer.tsx`

## 代码变更细节

### 新增辅助函数
```typescript
function countDescendants(node: ThreadNode): number {
  let count = 0;
  const walk = (n: ThreadNode) => {
    for (const child of n.children) {
      count++;
      walk(child);
    }
  };
  walk(node);
  return count;
}
```

### 回复计数显示组件
```tsx
// 回复计数标签（直接回复数 + 总后代数）
function ReplyCountBadge({ node }: { node: ThreadNode }) {
  const directCount = node.children.length;
  if (directCount === 0) return null;
  
  const totalCount = countDescendants(node);
  
  return (
    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded-full">
      {directCount} 回复{totalCount > directCount && (
        <span className="text-gray-400"> / 共 {totalCount}</span>
      )}
    </span>
  );
}
```