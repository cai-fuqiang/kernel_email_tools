# PLAN-004: Code Annotation 回复功能

## 需求背景
现有 Email Annotation 支持回复功能，Code Annotation 也需要支持相同的层级回复能力，用户可以对代码标注进行嵌套回复讨论。

## 后端实现
### 1. 数据模型扩展 (code_annotation_store.py)
- [ ] CodeAnnotationORM 添加 `in_reply_to` 字段 (string, nullable, 关联父 annotation_id)
- [ ] 数据迁移脚本添加字段
- [ ] 查询接口支持按 `in_reply_to` 过滤

### 2. API 接口
- [ ] POST `/api/kernel/annotations/{annotation_id}/reply` - 创建回复
- [ ] GET `/api/kernel/annotations/tree/{annotation_id}` - 获取完整回复树
- [ ] 现有 list 接口返回 `in_reply_to` 字段

### 3. 业务逻辑
- [ ] 回复时自动关联 version, file_path 与父标注相同
- [ ] 支持最多 3 层嵌套回复
- [ ] 删除父标注时级联删除子回复

## 前端实现
### 1. 组件修改 (KernelCodePage.tsx)
- [ ] 标注卡片增加 "回复" 按钮
- [ ] 回复编辑框复用现有 AnnotationModal
- [ ] 回复标注显示回复层级（缩进、父标注引用）
- [ ] 支持点击回复查看完整上下文

### 2. 展示效果
- [ ] 回复标注左侧增加嵌套边框
- [ ] 回复层级缩进展示
- [ ] 回复者信息和时间显示
- [ ] 回复内容 markdown 渲染

## 交互流程
1. 用户点击标注卡片的 "回复" 按钮
2. 弹出编辑框，输入回复内容
3. 提交后自动刷新标注列表，显示新回复
4. 回复标注嵌套显示在父标注下方

## 兼容性
- [ ] 保持现有 API 向后兼容
- [ ] 无父标注的顶级标注保持原有展示
- [ ] 移动端适配回复层级

## 测试点
- [ ] 新建标注测试回复功能
- [ ] 多层嵌套回复测试
- [ ] 父标注删除测试
- [ ] 回复列表分页查询测试