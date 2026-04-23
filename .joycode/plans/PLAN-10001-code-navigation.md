# 代码跳转功能规划 (PLAN-10001)

## 任务概述
为 KernelCodePage 添加代码跳转功能（定义跳转、引用查找），提升内核源码阅读体验。

## 索引方案对比

| 方案 | 单版本大小 | 定义跳转 | 引用查找 | 实现复杂度 |
|------|-----------|---------|---------|-----------|
| cscope.out | ~200-300MB | ✅ | ✅ 完整 | 中 |
| ctags (tags) | ~50-80MB | ✅ | ⚠️ 有限 | 低 |

**决策**：由于每个版本维护 cscope.out 太大，采用 **ctags + 按需生成** 方案
- tags 文件更小（约 50-80MB）
- 按需生成（访问版本时才生成）
- 先实现定义跳转，引用查找后续优化

---

## 实现规划

### Phase 1: 索引生成服务

- [ ] 后端新增 `src/kernel_source/ctags_indexer.py`
  - `generate_ctags(version, repo_path)` → 执行 `ctags -R`
  - `parse_tags_file(tags_path)` → 解析 tags 文件，提取符号元数据
  - `TagSymbol` 数据模型：name, kind, file, line, scope, signature

- [ ] 符号存储方案
  - 方案 A：SQLite 本地文件（轻量，推荐）
  - 方案 B：PostgreSQL 新表（共享，但增加 DB 负担）
  - 推荐方案 A，使用 `data/repos/{version}_ctags.db`

- [ ] 索引管理 API
  - `GET /api/kernel/ctags/status` → 版本索引状态
  - `POST /api/kernel/ctags/reindex` → 触发重新索引

### Phase 2: 跳转 API

- [ ] `GET /api/kernel/ctags/symbols?path=xxx` → 获取文件内所有符号
- [ ] `GET /api/kernel/ctags/definition?path=xxx&symbol=xxx` → 跳转定义
- [ ] `GET /api/kernel/ctags/references?path=xxx&symbol=xxx` → 查找引用

### Phase 3: 前端交互

- [ ] `CodeView` 组件添加点击事件
  - Ctrl+点击符号 → 调用 definition API 跳转
  - 右键符号 → 显示菜单（跳转到定义/查找引用）

- [ ] 符号高亮
  - 识别光标所在位置的符号名
  - 高亮显示同文件中所有引用

- [ ] 跳转头像提示
  - hover 符号 Nms 显示定义位置预览

---

## 数据模型

```python
@dataclass
class TagSymbol:
    name: str           # 符号名称
    kind: str           # kind: function, variable, macro, struct, enum, typedef
    file_path: str      # 文件路径
    line_number: int    # 定义行号
    scope: str          # 作用域（函数名/结构体名）
    signature: str      # 函数签名（参数列表）
    pattern: str        # 匹配模式（用于精确定位）
```

---

## 方案决策

| 功能需求 | 推荐工具 | 说明 |
|----------|----------|------|
| 定义跳转 | ctags | 简单快速 |
| 引用查找 | cscope | 完整交叉引用 |

### ctags vs cscope 功能对比

| 功能 | ctags | cscope |
|------|-------|--------|
| 跳转到定义 | ✅ | ✅ |
| 查找引用 | ⚠️ 有限 | ✅ 完整 |
| 实现复杂度 | 低 | 中 |
| 数据库生成 | 快 | 中 |

**最终选择**：实现 cscope 方案（完整交叉引用支持）