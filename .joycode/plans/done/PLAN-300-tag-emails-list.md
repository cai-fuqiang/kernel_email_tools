# PLAN-300: 标签页面展示关联邮件列表

## 概述

当前 TagsPage 仅支持标签的创建/删除管理，无法查看某个标签下关联了哪些邮件。本计划为标签页面增加「点击标签 → 展开邮件列表」功能，支持分页浏览和跳转线程详情。

---

## TODO: 后端 — 新增按标签查询邮件 API

- [x] 在 `src/storage/postgres.py` 的 `PostgresStorage` 中新增 `get_emails_by_tag(tag_name, page, page_size)` 方法
  - 查询 `emails` 表中 `tags @> ARRAY[tag_name]`
  - 返回 `(list[EmailSearchResult], total_count)`, 按日期倒序, 支持分页
- [x] 在 `src/api/server.py` 新增 `GET /api/tags/{tag_name}/emails` 端点
  - 参数: `tag_name` (path), `page` (query, default=1), `page_size` (query, default=20)
  - 响应: `{ tag: str, emails: [...], total: int, page: int, page_size: int }`

## TODO: 前端 — API 客户端

- [x] 在 `web/src/api/client.ts` 新增 `getEmailsByTag(tagName, page?, pageSize?)` 函数 + `TagEmailItem` / `TagEmailsResponse` 类型

## TODO: 前端 — TagManager 组件改造

- [x] `TagNodeList` 中每个标签行增加可点击交互（点击标签名展开/收起邮件列表）
- [x] 新增 `TagEmailList` 子组件，展示选中标签下的邮件列表
  - 展示字段: subject, sender, date, list_name, has_patch 徽标
  - 支持分页（上一页/下一页）
  - 点击邮件打开 `ThreadDrawer` 查看线程详情
- [x] 在 `TagManager` 中引入 `TagStats` 数据，标签名称旁显示邮件数量角标
- [x] 空状态处理: 标签下无邮件时显示 "No emails with this tag"
- [x] `TagsPage` 容器宽度从 `max-w-3xl` 调整为 `max-w-5xl`

## TODO: 验证

- [ ] 后端: 手动调用 `/api/tags/{tag_name}/emails` 验证返回数据正确
- [ ] 前端: 点击标签展开邮件列表，分页翻页，点击邮件打开 ThreadDrawer