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