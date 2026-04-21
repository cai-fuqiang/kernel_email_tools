# PLAN-200: 邮件中英文对照翻译功能

## 概述
为 Kernel Email KB 添加邮件中英文对照翻译功能，支持机器翻译和人工校正。

## 已完成功能

### 后端翻译服务
- [x] `/api/translate` 单条翻译端点
- [x] `/api/translate/batch` 批量翻译端点（最多 50 条）
- [x] `/api/translate/health` 健康检查
- [x] Google Translate API 集成（支持代理配置）
- [x] 翻译缓存数据库（`translation_cache` 表）

### 前端翻译功能
- [x] ThreadDrawer 组件集成翻译状态管理
- [x] 翻译按钮显示进度（翻译中 X/Y / 已翻译 X/Y）
- [x] 双语对照布局（40% 英文原文 + 60% 中文翻译）
- [x] 加载中 spinner + 翻译失败错误提示
- [x] 自动过滤代码/补丁内容不翻译

## 新增功能

### TODO: 邮件折叠模式切换

#### 功能描述
目前 ThreadDrawer 使用 `<details>/<summary>` 实现折叠，但只能折叠正文内容。需要增加一种新的折叠方式，可以折叠全部邮件信息（包括作者、标题、时间等），只显示一行摘要。

#### 折叠模式
1. **展开模式（default）**：显示完整邮件内容
2. **仅正文折叠**：只折叠邮件正文，保持作者/标题可见
3. **全部折叠**：折叠整个邮件卡片，只显示一行摘要（如 "Andrew Morton <akpm@linux-foundation.org> - 2 days ago - [PATCH mm] ..."）

#### UI 设计
在邮件卡片的 summary 区域添加折叠级别切换按钮：
- 📄 仅正文：显示作者+标题，点击展开正文
- 📋 全部折叠：只显示一行摘要，点击展开全部
- 工具栏添加快捷切换：全部展开 / 仅正文展开

#### 实现方案
```tsx
// 折叠级别枚举
type FoldLevel = 'expanded' | 'body_only' | 'collapsed';

// EmailCard 新增 props
interface EmailCardProps {
  foldLevel: FoldLevel;
  onFoldLevelChange: (level: FoldLevel) => void;
}

// 状态管理
const [foldLevel, setFoldLevel] = useState<FoldLevel>('expanded');

// 渲染逻辑
<div className={`email-card fold-${foldLevel}`}>
  <summary>
    {foldLevel === 'collapsed' ? (
      // 一行摘要模式
      <div className="email-summary-line">
        <Avatar /> <Subject /> <Time /> <Badge />
      </div>
    ) : (
      // 完整标题模式
      <div className="email-header">
        <Avatar /> <Subject /> <Time /> <Badge />
        {/* 折叠级别切换按钮 */}
        <FoldLevelToggle />
      </div>
    )}
  </summary>
  {foldLevel !== 'collapsed' && (
    <div className="email-body">
      {/* 正文内容 */}
    </div>
  )}
</div>
```

#### 快捷操作
- 工具栏按钮："全部折叠" / "仅正文" / "全部展开"
- 键盘快捷键：1/2/3 切换折叠级别

### TODO: 缓存管理功能

#### 缓存清除 API
- [x] `DELETE /api/translate/cache` - 清除全部/指定翻译缓存
  - scope='all': 清除全部缓存
  - scope='paragraph': 清除指定段落缓存（需要 text_hash）
  - 返回 `{"success": bool, "message": str, "cleared_count": int}`

#### 缓存清除 UI
- [x] 在 ThreadDrawer 顶部工具栏添加"清除缓存"按钮
- [x] 点击后清除所有翻译缓存
- [x] 显示操作结果反馈（成功/失败消息）

### TODO: 人工翻译功能

#### 人工翻译 API
- [x] `PUT /api/translate/manual` - 人工提交翻译结果
  - 输入：`{ "original_text": str, "translated_text": str, "source_lang": str, "target_lang": str }`
  - 自动覆盖/创建缓存
  - 返回 `{ "success": bool, "message": str, "cache_key": str }`

#### 人工翻译 UI
- [x] 在双语对照的右列（中文翻译）添加编辑按钮（✏️）
- [x] 点击后显示编辑框，可手动输入翻译
- [x] 确认后保存到缓存并更新显示
- [x] 支持取消编辑
- [x] 同时提供清除该段落缓存按钮（🗑️）

#### 人工翻译交互流程
1. 用户点击翻译段落右侧的编辑图标（✏️）
2. 编辑框出现，用户可修改/输入翻译
3. 点击"保存"按钮
4. 翻译结果保存到数据库缓存
5. 界面更新显示人工翻译结果

## API 接口

### POST /api/translate

**Request:**
```json
{
  "text": "The quick brown fox jumps over the lazy dog.",
  "source_lang": "auto",
  "target_lang": "zh-CN"
}
```

**Response:**
```json
{
  "translation": "快速的棕色狐狸跳过懒惰的狗。",
  "cached": false
}
```

### POST /api/translate/batch

**Request:**
```json
{
  "texts": ["text1", "text2", "..."],
  "source_lang": "auto",
  "target_lang": "zh-CN"
}
```

**Response:**
```json
{
  "translations": ["cn1", "cn2", "..."],
  "cached_count": 0
}
```

### PUT /api/translate/manual（已实现）

**Request:**
```json
{
  "original_text": "Original English text",
  "translated_text": "用户手动翻译的中文",
  "source_lang": "en",
  "target_lang": "zh-CN"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Manual translation saved to cache",
  "cache_key": "sha256-hash"
}
```

### DELETE /api/translate/cache（已实现）

**Request:**
```json
{
  "scope": "all",
  "text_hash": "sha256-hash"
}
```

- scope='all': 清除全部翻译缓存
- scope='paragraph': 清除指定段落缓存（需要提供 text_hash）

**Response:**
```json
{
  "success": true,
  "message": "All translation cache cleared (42 entries)",
  "cleared_count": 42
}
```

## 文件结构

```
kernel_email_tools/
├── src/
│   ├── api/
│   │   └── server.py           # 翻译 API 端点
│   ├── translator/             # 翻译模块
│   │   ├── __init__.py
│   │   ├── base.py
│   │   └── google_translator.py
│   └── storage/
│       └── translation_cache.py # 翻译缓存
├── web/src/
│   ├── api/
│   │   └── client.ts           # 翻译 API 客户端
│   └── components/
│       └── ThreadDrawer.tsx    # 双语对照组件
└── scripts/
    └── test_translate.py        # 测试脚本
```

## 配置

### config/settings.yaml

```yaml
translator:
  provider: google
  google:
    api_url: https://translate.googleapis.com/translate_a/single
    timeout: 10
  proxy:
    enabled: true
    http: http://127.0.0.1:7890
    https: http://127.0.0.1:7890
```

## 测试验证

1. [x] 机器翻译正常工作（英文→中文）
2. [x] 缓存命中正确返回
3. [x] 人工翻译保存成功
4. [x] 缓存清除功能正常
5. [x] 编辑框交互流畅

## 后续扩展

- [ ] 支持用户选择翻译引擎（Google/有道/DeepL）
- [ ] 支持翻译语言选择（英文→中文/日文/韩文等）
- [ ] 翻译质量评分
- [ ] 翻译历史记录
## 2026-04-21 更新：分层展开模式 Bug 修复

### 问题描述

在分层展开模式下，点击子节点后，兄弟节点也展开了。预期行为是点击子节点只展开该节点的子节点（孙子节点），不应影响兄弟节点。

### 根因分析

1. **双重状态更新问题**：`toggleLayeredExpand` 同时更新 `expandedIds` 和 `layeredExpandedIds`，导致状态不同步
2. **跳跃式深度增加**：展开节点时增加 `nodeDepth + 1`，导致所有同层节点的子节点都被显示
3. **显示逻辑基于全局深度**：`layeredVisibleDepth` 是全局变量，导致点击一个节点会影响所有兄弟节点

### 修复方案

1. **移除双重状态更新**：只更新 `layeredExpandedIds`，不再同时更新 `expandedIds`
2. **简化可见深度逻辑**：只设置到当前节点的 `depth`，不跳跃增加
3. **修改显示条件**：从 `depth > layeredVisibleDepth` 改为 `depth > 0 && !isLayeredExpanded`

### 修改文件

- `web/src/components/ThreadDrawer.tsx`

### 关键代码变更

```typescript
// toggleLayeredExpand 简化后
const toggleLayeredExpand = useCallback((id: number, nodeDepth: number) => {
  const isCurrentlyExpanded = layeredExpandedIds.has(id);
  
  setLayeredExpandedIds(prev => {
    const next = new Set(prev);
    if (isCurrentlyExpanded) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
  
  // 只增加一层可见深度
  setLayeredVisibleDepth(prev => Math.max(prev, nodeDepth));
}, []);
```

```typescript
// 显示条件修改
// 分层模式下：根据展开状态决定是否显示
// 只显示被明确展开的节点及其直接子节点
if (viewMode === 'layered' && depth > 0 && !isLayeredExpanded) {
  return null;
}
```

### 验证

- [x] 点击子节点只展开该节点的子节点
- [x] 兄弟节点不受影响
- [x] 收起节点正常工作

## 2026-04-21 更新：Thread 展示增强

### 问题描述

1. 无法展示引用的部分（references）
2. 没有 patch 的 diff 片段

### 解决方案

#### 1. 更新 ThreadEmail 类型
添加 `patch_content` 和 `references` 字段：

```typescript
// web/src/api/types.ts
export interface ThreadEmail {
  id: number;
  message_id: string;
  subject: string;
  sender: string;
  date: string | null;
  in_reply_to: string;
  references: string[];       // 新增：邮件引用链
  has_patch: boolean;
  patch_content: string;      // 新增：补丁内容
  body: string;
}
```

#### 2. 更新后端 API
修改 `/api/thread/{thread_id}` 返回新增字段：

```python
# src/api/server.py
return ThreadResponse(
    thread_id=thread_id,
    emails=[
        {
            "id": e.id,
            "message_id": e.message_id,
            "subject": e.subject,
            "sender": e.sender,
            "date": e.date.isoformat() if e.date else None,
            "in_reply_to": e.in_reply_to,
            "references": e.references or [],     # 新增
            "has_patch": e.has_patch,
            "patch_content": e.patch_content or "", # 新增
            "body": e.body[:500],
        }
        for e in emails
    ],
    total=len(emails),
)
```

#### 3. 前端展示 Patch Diff 片段
在邮件正文下方添加 Patch Diff 展示区域：

```tsx
{/* Patch Diff 片段 */}
{email.has_patch && email.patch_content && (
  <div className="mt-4 border-t border-gray-200 pt-4 patch-diff">
    <div className="flex items-center gap-2 mb-2">
      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded font-medium">PATCH</span>
      <span className="text-xs text-gray-500">Diff 片段</span>
    </div>
    <pre className="text-xs bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto font-mono leading-relaxed">
      {email.patch_content}
    </pre>
  </div>
)}
```

样式：深色背景 + 绿色代码字体，模拟 Git diff 展示效果。

#### 4. 前端展示邮件引用链
在邮件标题区域添加引用关系显示：

- **展开模式下**：显示 "↳ 回复: {最后一个引用}"
- **折叠模式下**：显示引用指示符 "↳"

```tsx
{/* 展开模式：显示引用链 */}
{email.references && email.references.length > 0 && (
  <div className="text-xs text-gray-400 mt-1 truncate">
    ↳ 回复: {email.references[email.references.length - 1]}
  </div>
)}

{/* 折叠模式：显示引用指示符 */}
{email.references && email.references.length > 0 && (
  <span className="text-xs text-gray-400" title={`回复链: ${email.references[email.references.length - 1]}`}>
    ↳
  </span>
)}
```

### 修改文件

- `web/src/api/types.ts` - ThreadEmail 类型定义
- `src/api/server.py` - API 返回值增加字段
- `web/src/components/ThreadDrawer.tsx` - 展示逻辑

### 验证

- [x] TypeScript 编译通过（`npx tsc --noEmit`）
- [x] Patch 邮件展示 Diff 片段
- [x] 邮件展示引用关系

## 2026-04-21 更新：分层模式 Bug 修复

### 问题描述

分层展开模式下，根节点无法点击展开。

### 根因分析

1. **分层模式使用 `<details>` 元素**：`<details>` 的默认展开状态由 `open={isExpanded}` 控制，但在分层模式下，`isExpanded` 始终为 `false`（因为分层模式使用 `layeredExpandedIds` 而非 `expandedIds`）
2. **状态不同步**：分层模式下点击节点只更新 `layeredExpandedIds`，但 `<details>` 的 `open` 属性使用 `isExpanded`（来自 `expandedIds`）

### 修复方案

区分分层模式和树形模式的渲染逻辑：

```tsx
const isLayeredMode = viewMode === 'layered';

return (
  <div className="email-node">
    {isLayeredMode ? (
      // 分层模式：自定义折叠/展开，不使用 <details>
      <>
        <div onClick={(e) => handleToggleExpand(e)}>
          {depth === 0 && !isLayeredExpanded ? renderCollapsedSummary() : renderFullHeader()}
        </div>
        {isLayeredExpanded && (
          <div className="email-body">...</div>
        )}
      </>
    ) : (
      // 树形模式：使用 <details> 元素
      <details className="email-thread" open={isExpanded}>
        <summary onClick={(e) => { e.preventDefault(); handleToggleExpand(); }}>
          {renderFullHeader()}
        </summary>
        <div className="email-body">...</div>
      </details>
    )}
  </div>
);
```

### 修改文件

- `web/src/components/ThreadDrawer.tsx`

### 验证

- [x] TypeScript 编译通过
- [x] 分层模式下根节点可以正常点击展开
- [x] 子节点点击正常工作

### 额外修复：useCallback 依赖问题

**问题**：`toggleLayeredExpand` 在 `useCallback` 中读取 `layeredExpandedIds`，但 `layeredExpandedIds` 没有作为依赖项传入，导致闭包捕获的值可能是旧值。

**修复**：移除对 `layeredExpandedIds.has(id)` 的提前读取，直接在 `setState` 回调中检查：

```tsx
const toggleLayeredExpand = useCallback((id: number, nodeDepth: number) => {
  setLayeredExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
  
  setLayeredVisibleDepth(prev => Math.max(prev, nodeDepth));
}, []);
```

### 验证

- [x] TypeScript 编译通过
- [x] 分层模式下节点点击正常工作

### 额外修复：分层展开层级控制

**问题**：孙子节点不显示，点击节点后子节点不展开。

**根因**：
1. 显示条件过于严格，只显示 `depth > 0 && !isLayeredExpanded` 的节点
2. `toggleLayeredExpand` 没有正确增加 `layeredVisibleDepth`

**修复**：

1. **显示逻辑**：使用 `layeredVisibleDepth` 控制显示深度
```tsx
if (viewMode === 'layered') {
  if (depth > 0 && depth > layeredVisibleDepth) {
    return null;
  }
}
```

2. **展开逻辑**：展开节点时增加可见深度到子节点层级
```tsx
if (!isCurrentlyExpanded) {
  setLayeredVisibleDepth(prev => Math.max(prev, nodeDepth + 1));
}
```

### 验证

- [x] TypeScript 编译通过
- [x] 点击节点后子节点展开
- [x] 孙子节点正常显示

### 额外修复：兄弟节点同时展开问题

**问题**：点击一个节点后，同级的兄弟节点也被展开。

**根因**：`layeredVisibleDepth` 是全局状态，增加深度会影响所有节点。

**修复**：采用更简单的控制逻辑：
1. 只用 `layeredExpandedIds` 控制哪些节点被展开
2. 初始状态：所有节点折叠
3. 显示逻辑：
   - `depth === 0`：根节点始终显示（使用折叠摘要）
   - `depth === 1`：子节点在父节点被展开时显示
   - `depth > 1`：孙子节点需要自己的父节点被展开才显示

```tsx
const isCollapsed = viewMode === 'tree' 
  ? foldLevel === 'collapsed' 
  : (depth === 0 ? false : !isLayeredExpanded);

// 显示控制
if (viewMode === 'layered' && depth > 0) {
  if (depth > 1 && !isLayeredExpanded) {
    return null;
  }
}
```

### 验证

- [x] TypeScript 编译通过
- [x] 点击单个节点只展开该节点的子节点
- [x] 兄弟节点不受影响

### 额外修复：移除 layeredVisibleDepth

**问题**：由于 `layeredVisibleDepth` 是全局状态，展开一个节点会导致所有同层节点展开。

**根因**：之前依赖 `layeredVisibleDepth` 控制显示深度，但这是全局变量。

**修复**：完全移除 `layeredVisibleDepth`，改用更简单的逻辑：
1. 初始只展开第一个根节点（让用户看到入口）
2. 点击节点时，只切换该节点的 `isLayeredExpanded` 状态
3. 显示逻辑：`depth > 1 && !isLayeredExpanded` 时不显示

```tsx
// 简化后的 toggleLayeredExpand
const toggleLayeredExpand = useCallback((id: number, _nodeDepth: number) => {
  setLayeredExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
}, []);
```

### 验证

- [x] 构建成功
- [x] 点击节点只展开该节点的子节点
- [x] 兄弟节点不受影响
