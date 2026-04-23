# PLAN-004: Annotation 组件与页面统一设计

## 任务概述
将邮件批注（Annotation）和代码标注（CodeAnnotation）的通用功能抽取为共享组件，同时将前端页面合并为统一的批注管理页面，最后将后端存储统一为单一数据库表。

## Phase 1: 前端统一（已完成）

### 组件结构

```
components/
├── AnnotationMarkdown.tsx    # 共享 Markdown 渲染组件
├── AnnotationActions.tsx     # 共享操作按钮组件
└── AnnotationCard.tsx        # 统一卡片组件（通过 variant 区分样式）
```

### 前端页面合并

**目标结构（1 个页面 + 下拉筛选）：**
```
批注管理 (/annotations)
├── 筛选器: [▼ 全部 ]  ← 下拉菜单
│              全部
│              邮件批注
│              代码标注
└── 列表
    ├── [邮件批注] Subject: xxx    ← 类型标签
    ├── [代码标注] mm/vmscan.c:100 ← 类型标签
    └── ...
```

## Phase 2: 后端存储统一

### 统一表设计

将 `annotations`（邮件批注）和 `code_annotations`（代码标注）合并为单一 `annotations` 表：

```sql
-- 统一批注表
CREATE TABLE annotations (
    id SERIAL PRIMARY KEY,
    annotation_id VARCHAR(64) UNIQUE NOT NULL,
    
    -- 类型标识
    annotation_type VARCHAR(20) NOT NULL,  -- 'email' | 'code'
    
    -- 公共字段
    author VARCHAR(128) NOT NULL DEFAULT 'me',
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- 邮件批注字段（annotation_type='email' 时使用）
    thread_id VARCHAR(512),
    in_reply_to VARCHAR(512),
    
    -- 代码标注字段（annotation_type='code' 时使用）
    version VARCHAR(32),
    file_path VARCHAR(512),
    start_line INT,
    end_line INT,
    anchor_context VARCHAR(128),  -- 上下文哈希，检测版本漂移
    
    -- 类型特定元数据（JSONB 扩展用）
    meta JSONB DEFAULT '{}',
    
    -- 全文搜索
    search_vector TSVECTOR,
    
    -- 约束
    CONSTRAINT valid_type CHECK (annotation_type IN ('email', 'code'))
);

-- 索引
CREATE INDEX idx_annotations_type ON annotations(annotation_type);
CREATE INDEX idx_annotations_thread ON annotations(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_annotations_code ON annotations(version, file_path) WHERE version IS NOT NULL;
CREATE INDEX idx_annotations_search ON annotations USING GIN(search_vector);
CREATE UNIQUE INDEX idx_annotations_code_unique ON annotations(version, file_path, start_line, end_line, body) WHERE version IS NOT NULL;
```

### Meta JSON 字段用途

```json
// 邮件批注的 meta 示例
{ "email_subject": "RE: mm: memory management", "email_sender": "Andrew Morton" }

// 代码标注的 meta 示例
{ "anchor_context": "abc123...", "preview_lines": 10 }
```

### API 统一设计

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/annotations` | GET | 批注列表 + 搜索（支持 `type` 过滤）|
| `/api/annotations` | POST | 创建批注 |
| `/api/annotations/{id}` | PUT | 更新批注 |
| `/api/annotations/{id}` | DELETE | 删除批注 |
| `/api/annotations/export` | POST | 导出（支持 `type` 过滤）|
| `/api/annotations/import` | POST | 导入 |

**查询参数：**
- `type`: `'email' | 'code' | 'all'`（默认 `'all'`）
- `q`: 搜索关键词
- `version`: 代码版本过滤（type='code' 时）
- `page`, `page_size`: 分页

### 统一存储类设计

```python
# annotation_store.py
class UnifiedAnnotationStore:
    """统一的批注存储，支持邮件批注和代码标注"""
    
    async def create(self, data: AnnotationCreate) -> Annotation:
        """创建批注，自动根据 type 选择字段"""
        
    async def list_all(self, type: str, page: int, page_size: int) -> AnnotationListResponse:
        """列出批注，支持按类型过滤"""
        
    async def search(self, keyword: str, type: str, page: int, page_size: int) -> AnnotationListResponse:
        """搜索批注"""
        
    async def get_by_thread(self, thread_id: str) -> list[Annotation]:
        """获取线程的所有批注（type='email'）"""
        
    async def get_by_code(self, version: str, file_path: str) -> list[Annotation]:
        """获取代码文件的所有标注（type='code'）"""
```

## 实现步骤

### Phase 1: 前端统一（已完成）

## TODO: 创建共享组件
- [x] 创建 `components/AnnotationMarkdown.tsx`
- [x] 创建 `components/AnnotationActions.tsx`
- [x] 创建 `components/AnnotationCard.tsx`

## TODO: 重构 AnnotationsPage（合并页面）
- [x] 添加 `filter` state：`'all' | 'email' | 'code'`
- [x] 添加下拉筛选器 UI
- [x] 实现统一列表渲染（根据 filter 展示不同数据）
- [x] 添加类型标签显示（全部模式时区分邮件/代码）

## TODO: 组件引用更新
- [x] 更新 `PreviewModal.tsx` → 使用共享 `AnnotationMarkdown`
- [x] ThreadDrawer 保持内嵌 AnnotationCard（因树形结构复杂性）

## TODO: 路由更新
- [x] 更新 `App.tsx`：删除 `/code-annotations` 路由
- [x] 更新 `MainLayout.tsx`：删除"代码标注"导航链接

## TODO: 样式统一
- [x] 统一 `.annotation-markdown` 和 `.markdown-content` CSS
- [x] 添加 `.annotation-card-email` 和 `.annotation-card-code` 主题类

---

### Phase 2: 后端存储统一

## TODO: 数据库迁移
- [ ] 修改 `annotations` 表：添加 `annotation_type`, `version`, `file_path`, `start_line`, `end_line`, `anchor_context`, `meta` 字段
- [ ] 删除独立的 `code_annotations` 表（或保留作为向后兼容）
- [ ] 创建迁移脚本

## TODO: 重构后端模型
- [ ] 修改 `AnnotationORM` 模型支持统一表结构
- [ ] 删除 `CodeAnnotationORM`（或保留别名）
- [ ] 更新 Pydantic 模型支持 `annotation_type`

## TODO: 重构存储层
- [ ] 重构 `AnnotationStore` → `UnifiedAnnotationStore`
- [ ] 合并 `CodeAnnotationStore` 逻辑到统一存储
- [ ] 实现按类型过滤的列表和搜索

## TODO: 统一 API 路由
- [ ] 合并 `/api/annotations` 和 `/api/kernel/annotations` 路由
- [ ] 保留 `/api/kernel/annotations` 作为别名（向后兼容）
- [ ] 更新前端 API client

## TODO: 数据迁移脚本
- [ ] 创建迁移脚本：将 `code_annotations` 数据迁移到 `annotations` 表
- [ ] 添加回滚支持

## TODO: 测试验证
- [ ] 邮件批注 CRUD 正常
- [ ] 代码标注 CRUD 正常
- [ ] 统一列表查询正常
- [ ] 类型过滤正常
- [ ] 导出/导入功能正常