# PLAN-003: 高级搜索过滤功能

## 需求概述
为邮件搜索功能添加额外的搜索约束条件，提升搜索精确度。

## 新增筛选条件
1. **sender** - 发件人（部分匹配）
2. **date_from** - 开始日期（ISO 格式，如 2024-01-01）
3. **date_to** - 结束日期（ISO 格式，如 2024-12-31）
4. **has_patch** - 是否包含补丁（布尔值）

## 实施步骤

### 阶段 1: 后端接口更新
- [x] 更新 SearchQuery 数据类 (`src/retriever/base.py`)
- [x] 更新 BaseStorage.search_fulltext 接口 (`src/storage/base.py`)
- [x] 更新 PostgresStorage.search_fulltext 实现 (`src/storage/postgres.py`)

### 阶段 2: API 层更新
- [x] 更新 /api/search 端点 (`src/api/server.py`)

### 阶段 3: 前端更新
- [x] 更新前端 API 类型定义
- [x] 更新 searchEmails 客户端函数
- [x] 添加高级搜索 UI 组件到 SearchPage

## 技术约束
- 所有新参数必须保持可选性（向后兼容）
- 日期处理需考虑时区问题
- 遵循项目架构规范（先更新 base.py 接口）