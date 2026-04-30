# PLAN-32000: 全面稳定性与 UI 改进

## 概述

基于 2026-04-28 代码库审查，识别出 6 大类亟待修复的问题，覆盖安全、功能 Bug、UI/UX、错误处理和代码质量。

---

## 一、安全修复（严重）

### 1.1 硬编码 API 密钥
**位置**: `config/settings.yaml:107`
**问题**: DashScope API 密钥 `sk-ae19a6f47bf94122ae253ded970a6b9d` 以明文硬编码在配置文件中，且该文件已被 git 跟踪。
**修复**: 改为从环境变量 `DASHSCOPE_API_KEY` 读取，settings.yaml 中使用占位符。

### 1.2 硬编码管理员密码
**位置**: `config/settings.yaml` auth 段
**问题**: `username: admin`, `password: admin123456` 硬编码。
**修复**: 改为从环境变量读取，默认值仅用于开发环境。

---

## 二、功能 Bug 修复

### 2.1 ThreadDrawer 分层模式 Bug（PLAN-201）
**位置**: `web/src/components/ThreadDrawer.tsx`
**问题**: 
- Bug 1: 递归渲染可见性逻辑只检查节点自身是否在展开集合中，不检查父节点
- Bug 2: 展开/折叠状态判断混乱，`isLayeredExpanded` 职责不清
- Bug 3: `toggleLayeredExpand` 折叠时不级联处理子节点
**修复**: 已在 PLAN-201 中详细设计，采用扁平化渲染 + 级联折叠方案。

### 2.2 Channel 列表硬编码
**位置**: `SearchPage.tsx:115-120`, `AskPage.tsx:159-164`
**问题**: Channel 选择器选项硬编码在前端，与后端 `settings.yaml` 不同步。
**修复**: 添加 `/api/channels` 端点，前端从 API 动态获取 channel 列表。

---

## 三、错误处理改进

### 3.1 裸露的 except Exception
**位置**: 全代码库 ~22 处
**问题**: 关键路径（向量检索、邮件收集、翻译、标签存储、LLM 调用）使用裸 `except Exception`，吞噬具体错误。
**修复**: 替换为具体异常类型，至少记录异常信息到日志。

---

## 四、UI/UX 改进

### 4.1 加载骨架屏
**问题**: SearchPage、AskPage、KnowledgePage 等主要页面使用简单的 loading spinner 或文本。
**修复**: 添加 SkeletonCard、SkeletonLine 等骨架屏组件，在加载状态中使用。

### 4.2 错误通知统一
**问题**: 部分组件用内联 error div，部分用 Toast。Toast 组件已存在但未统一使用。
**修复**: 在 SearchPage、AskPage、ManualSearchPage、ManualAskPage 中统一使用 Toast 组件显示错误。

### 4.3 ThreadDrawer 错误处理
**位置**: `ThreadDrawer.tsx` 多处
**问题**: 7 处使用 `console.error()` 处理错误，用户看不到任何反馈。
**修复**: 使用 Toast 通知用户可恢复的错误。

---

## 五、测试基础设施

### 5.1 测试目录缺失
**问题**: `pyproject.toml` 配置了 `testpaths = ["tests"]` 但目录不存在，全项目只有一个测试脚本。
**修复**: 创建 `tests/` 目录，添加核心路径的基础测试（认证、搜索、标签 CRUD）。

---

## 六、后续改进（本计划范围外，记录供后续参考）

- **server.py 拆分**: 4565 行单文件需按领域拆分为路由模块
- **ThreadDrawer.tsx 拆分**: 1881 行需拆分为子组件
- **向量检索启用**: 完成 Phase 2/3 的向量索引和语义搜索
- **速率限制**: API 路由缺少 rate limiting
- **session cookie secure**: 生产环境需启用

---

## 实施顺序

1. 安全修复（API 密钥、密码环境变量化）
2. PLAN-201 ThreadDrawer 分层模式 Bug 修复
3. Channel 动态化
4. 错误处理 — 替换裸 except Exception
5. UI — 加载骨架屏
6. UI — Toast 错误通知统一
7. 测试基础设施搭建
8. 验证构建通过
