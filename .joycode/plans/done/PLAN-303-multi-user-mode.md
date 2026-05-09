# PLAN-303: 多用户模式（账号版 + 请求头注入 + public/private 可见性）

## 概述

在现有单实例知识库基础上，引入正式的“用户账号 + 角色权限”能力，但首版认证来源不做应用内登录，而是由反向代理或上游网关通过请求头注入用户身份。系统内部负责：

- 统一解析当前用户上下文
- 落库用户账号信息
- 用服务端身份替代前端传入的 `author` / `created_by` / `updated_by`
- 对写操作执行 `admin` / `editor` / `viewer` 三级 RBAC
- 在前端展示当前用户与基于角色的可操作能力
- 支持 tag / annotation 的 `public` / `private` 可见性

---

## 本期目标

- 新增 `users` 表与 `/api/me`
- 新增请求头认证与开发环境 fallback user
- 新增 `GET /api/admin/users` 与 `PATCH /api/admin/users/{user_id}`
- 标签、标签绑定、邮件批注、代码批注的写操作全部改为服务端注入操作者
- 标签页 / 标注页 / 目标标签展示统一遵循“公开可见 + 私有仅自己可见”
- 前端接入当前用户信息，并根据角色隐藏无权限的写操作

---

## public/private 可见性规则

### Tag

- 每个用户都可以创建 tag
- 创建 tag 时可选择 `public` 或 `private`
- `public` tag 对所有用户可见
- `private` tag 仅创建者本人可见
- Tag 页面展示：所有 `public` tag + 当前用户自己的 `private` tag
- 邮件/标注上的 tag 展示也遵循同样规则

### Annotation

- 每个用户都可以创建 annotation / code annotation
- 创建时可选择 `public` 或 `private`
- `public` annotation 对所有用户可见
- `private` annotation 仅作者本人可见
- Annotation 页面展示：所有 `public` annotation + 当前用户自己的 `private` annotation
- 线程视图 / 代码视图中的 annotation 列表同样按此规则过滤

---

## 主要改动

### 后端

- `src/storage/models.py`
  - 新增 `UserORM`
  - 为 `tags` 增加 `visibility` / `owner_user_id` / `created_by_user_id` / `updated_by_user_id`
  - 为 `tag_assignments` 增加 `created_by_user_id`
  - 为 `annotations` 增加 `visibility` / `author_user_id`
- `src/storage/postgres.py`
  - `init_db()` 中补充用户表创建与幂等补列逻辑
- `src/storage/tag_store.py`
  - 标签创建、查询、绑定统一接入用户上下文和可见性过滤
- `src/storage/annotation_store.py`
  - 标注创建、列表、线程查询、代码查询统一接入用户上下文和可见性过滤
- `src/api/server.py`
  - 新增请求头认证解析
  - 新增 `/api/me`
  - 新增 `/api/admin/users`
  - 为写接口增加 RBAC 校验
  - 所有写接口忽略前端传入的操作者字段

### 前端

- `web/src/api/client.ts`
  - 新增当前用户、用户管理相关 API
  - 统一处理 `401 / 403`
- `web/src/layouts/MainLayout.tsx`
  - 展示当前登录用户、角色、认证来源
- `web/src/App.tsx`
  - 新增用户管理页路由
- `web/src/pages/TagsPage.tsx` / `web/src/components/TagManager.tsx`
  - 创建 tag 时增加可见性选择
  - 只展示“公开 + 自己私有”的 tag
- `web/src/pages/AnnotationsPage.tsx` / `web/src/components/AnnotationTree.tsx`
  - 创建回复时增加可见性继承/选择
  - 标注列表展示可见性信息
- `web/src/pages/KernelCodePage.tsx` / `web/src/components/ThreadDrawer.tsx`
  - 创建标注时增加可见性选择
- 新增用户管理页

---

## 验证

- `GET /api/me` 能返回头信息用户并完成自动建档
- `viewer` 无法创建/编辑/删除 tag 与 annotation
- `editor` 可以创建 `public/private` tag 与 annotation
- 不同用户访问标签页和标注页时，只能看到 `public + 自己 private`
- 线程视图与代码标注视图遵循相同过滤规则
- 前端不再发送伪造 `author` / `created_by`
- 管理员可查看和修改用户角色

---

## 高级功能（本期不做）

- 私有 tag 的“按用户独立命名空间”能力
  - 当前版本仍保持 tag 名称全局唯一
  - 这意味着不同用户不能分别创建同名私有 tag
  - 若后续需要支持“每个用户都能拥有自己的同名 private tag”，需要重构唯一约束与标签解析规则
