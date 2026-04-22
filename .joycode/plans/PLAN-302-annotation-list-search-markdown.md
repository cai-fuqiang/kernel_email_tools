# PLAN-302: 批注列表页面 + 搜索 + Markdown 渲染

## 目标

为批注功能增加独立管理页面，支持全量浏览和关键词搜索，同时将批注正文升级为 Markdown 渲染。

---

## 任务列表

### 1. 后端: AnnotationStore 新增 list_all + search 方法

**文件**: `src/storage/annotation_store.py`

- `list_all(page, page_size) -> (list[dict], total)`
  - 全量批注分页列表，按 created_at 倒序
  - 关联 emails 表（通过 in_reply_to 匹配 message_id）获取 subject / sender
  - 返回每条批注 + 关联邮件信息
- `search(keyword, page, page_size) -> (list[dict], total)`
  - 按批注 body 内容模糊搜索（ILIKE `%keyword%`）
  - 同样关联 emails 表返回上下文信息
  - 支持分页

### 2. 后端: API 新增批注列表+搜索端点

**文件**: `src/api/server.py`

- `GET /api/annotations?page=&page_size=&q=`
  - 合并列表与搜索为一个端点
  - 无 `q` 参数 → 调用 `list_all`，返回全部批注分页
  - 有 `q` 参数 → 调用 `search`，按关键词搜索
  - 响应格式:
    ```json
    {
      "annotations": [
        {
          "annotation_id": "annotation-xxxx",
          "thread_id": "...",
          "in_reply_to": "...",
          "author": "me",
          "body": "批注正文...",
          "created_at": "2026-04-22T...",
          "updated_at": "2026-04-22T...",
          "email_subject": "Re: [PATCH] ...",
          "email_sender": "Name <email>"
        }
      ],
      "total": 42,
      "page": 1,
      "page_size": 20
    }
    ```

> **注意**: 现有 `GET /api/annotations/{thread_id:path}` 是按线程查询，新端点无路径参数，不会冲突。需确认路由优先级（无参数的 GET 放在 path 参数之前注册）。

### 3. 前端: TypeScript 类型 + API 客户端

**文件**: `web/src/api/types.ts`, `web/src/api/client.ts`

- 新增类型:
  ```typescript
  interface AnnotationListItem {
    annotation_id: string;
    thread_id: string;
    in_reply_to: string;
    author: string;
    body: string;
    created_at: string;
    updated_at: string;
    email_subject: string;
    email_sender: string;
  }

  interface AnnotationListResponse {
    annotations: AnnotationListItem[];
    total: number;
    page: number;
    page_size: number;
  }
  ```

- 新增 API 函数:
  ```typescript
  listAnnotations(opts?: { q?: string; page?: number; page_size?: number }): Promise<AnnotationListResponse>
  ```

### 4. 前端: 安装 Markdown 依赖

```bash
cd web && npm install react-markdown remark-gfm
```

- `react-markdown` — React Markdown 渲染组件
- `remark-gfm` — GFM 扩展（表格、删除线、任务列表等）

### 5. 前端: 创建 AnnotationsPage.tsx 批注管理页面

**文件**: `web/src/pages/AnnotationsPage.tsx`

页面结构:
- **搜索栏**: 关键词输入框 + 搜索按钮
- **统计信息**: 显示总批注数
- **批注卡片列表**:
  - 每张卡片显示: 批注正文 (Markdown 渲染)、作者、创建时间
  - 关联信息: 邮件主题 + 发件人（来自 email_subject / email_sender）
  - 点击 → 打开 ThreadDrawer 跳转到对应线程
- **分页器**: 页码导航

### 6. 前端: 路由 + 导航

**文件**: `web/src/App.tsx`, `web/src/layouts/MainLayout.tsx`

- App.tsx: 添加 `<Route path="/annotations" element={<AnnotationsPage />} />`
- MainLayout.tsx: Kernel Emails 分组下添加 "Annotations" 导航项（位于 Tags 和 Translations 之间）

### 7. 前端: ThreadDrawer 批注 Markdown 渲染

**文件**: `web/src/components/ThreadDrawer.tsx`

- AnnotationCard 组件中将 `<pre>` 替换为 `<ReactMarkdown remarkPlugins={[remarkGfm]}>`
- 添加 Markdown 内容的基础样式（标题、列表、代码块、链接等）
- AnnotationInput 保持纯文本输入（placeholder 提示支持 Markdown）

### 8. 构建验证

```bash
cd web && npm run build
```

确保 TypeScript 编译无错误，构建产物正常。

---

## 技术要点

- 路由优先级: FastAPI 按注册顺序匹配，`GET /api/annotations` (无路径参数) 需在 `GET /api/annotations/{thread_id:path}` 之前注册
- SQL 关联: AnnotationORM.in_reply_to 可能指向 message_id（邮件）或 annotation_id（批注），关联 emails 用 LEFT JOIN
- Markdown 安全: react-markdown 默认不执行 HTML，安全性足够
- 搜索性能: 初期 ILIKE 足够（批注量不会很大），后续可加 GIN trigram 索引