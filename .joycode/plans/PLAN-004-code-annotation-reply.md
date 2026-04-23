# PLAN-004: Code Annotation 回复功能

## 需求背景
现有 Email Annotation 支持回复功能，Code Annotation 也需要支持相同的层级回复能力，用户可以对代码标注进行嵌套回复讨论。

## 功能增强需求
### 1. Goto 按钮独立化
- [ ] 行号文本不再直接可点击跳转
- [ ] 标注卡片增加独立的 "Goto" 按钮
- [ ] 点击按钮跳转到对应的代码行

### 2. Annotation 展开/折叠功能
- [ ] 点击标注卡片标题或展开按钮展开/折叠其回复
- [ ] 折叠状态显示回复数量（如 "3 replies"）
- [ ] 展开状态显示所有回复（带缩进和嵌套边框）
- [ ] 回复层级缩进展示
- [ ] 默认展开顶级标注，折叠嵌套回复

## 后端实现
### 1. 数据模型扩展 (code_annotation_store.py)
- [x] CodeAnnotationORM 添加 `in_reply_to` 字段 (string, nullable, 关联父 annotation_id)
- [x] 数据迁移脚本添加字段
- [ ] 查询接口支持按 `in_reply_to` 过滤

### 2. API 接口
- [x] POST `/api/kernel/annotations` - 创建代码注释（支持 in_reply_to）
- [x] GET `/api/kernel/annotations/{version}/{path}` - 获取文件注释列表（返回 in_reply_to）
- [ ] GET `/api/kernel/annotations/tree/{annotation_id}` - 获取完整回复树

### 3. 业务逻辑
- [x] 回复时自动关联 version, file_path 与父标注相同
- [ ] 支持最多 3 层嵌套回复
- [ ] 删除父标注时级联删除子回复

## 前端实现
### 1. 组件修改 (KernelCodePage.tsx)
- [x] 标注卡片增加 "Reply" 按钮
- [x] 回复编辑框复用现有 AnnotationModal
- [x] 回复标注显示回复层级（绿色边框、"Reply" 标签）
- [ ] 点击标注标题/展开按钮展开/折叠回复
- [ ] Goto 按钮独立，点击跳转到对应行

### 2. 展示效果
- [x] 回复标注左侧增加嵌套边框（绿色）
- [x] Reply 标签显示
- [ ] 回复层级缩进展示
- [ ] 折叠/展开状态指示器
- [ ] 回复者信息和时间显示
- [ ] 回复内容 markdown 渲染

## 交互流程
1. 用户点击标注卡片的 "回复" 按钮
2. 弹出编辑框，输入回复内容
3. 提交后自动刷新标注列表，显示新回复
4. 回复标注嵌套显示在父标注下方，带缩进和边框
5. 点击标注标题或展开按钮可折叠/展开回复

## 兼容性
- [x] 保持现有 API 向后兼容
- [x] 无父标注的顶级标注保持原有展示
- [ ] 移动端适配回复层级

## 测试点
- [x] 新建标注测试回复功能
- [ ] 多层嵌套回复测试
- [ ] 父标注删除测试（级联删除）
- [ ] 回复列表分页查询测试
- [ ] Goto 按钮跳转测试
- [ ] 展开/折叠功能测试