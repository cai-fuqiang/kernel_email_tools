# Annotation 使用手册

这份文档面向日常使用者，不介绍后端 API，只讲怎么在界面里真正用起来。

## 先理解 3 个核心概念

### 1. Annotation 是什么

Annotation 就是一条可保存、可搜索、可引用的批注。现在主要有三类：

- `email`：挂在线程或邮件上下文上的批注
- `code`：挂在某个代码文件和行号范围上的批注
- `sdm_spec`：挂在 spec / 手册类目标上的批注

### 2. Annotation ID 是什么

每条 annotation 都有一个唯一 ID，比如：

```text
code-annot-fc475b4cbec9
```

这个 ID 很重要，因为它是：

- 最稳定的定位方式
- 建立 annotation 之间关系时要填的目标
- 在 Markdown 里引用别的 annotation 时要用的目标
- 分享给别人时最不容易歧义的标识

### 3. Annotation 之间现在可以有关联

annotation 不再只是孤立备注。现在可以表达：

- 这条在引用哪条
- 这条是在补充 / 细化哪条
- 这条和哪条矛盾
- 某个变量在不同位置如何传递、演化、依赖

这对代码分析尤其重要。

## 从哪里进入

### 统一入口：`/app/annotations`

这是 annotation 的总入口，适合：

- 全局搜索 annotation
- 按类型看所有 annotation
- 用 annotation ID 精确找一条

你会看到：

- 搜索框
- 类型筛选
- 审核筛选
- annotation 列表

### 代码入口：`/app/kernel-code`

这是代码阅读时最常用的入口，适合：

- 边看代码边看 annotation
- 对某几行代码新建 annotation
- 从代码上下文里打开 annotation 详情
- 看某条 code annotation 的关系和变量轨迹

### Workspace / Search / Thread 里的入口

你也会在这些地方看到 annotation：

- Workspace 列表
- 搜索结果里的 annotation 区块
- Thread Drawer 中的 annotation 卡片

这些地方现在也都能直接看到 annotation ID。

## 最推荐的使用顺序

如果你刚上手，建议按下面顺序用。

### 场景 A：我知道代码位置，想先看已有批注

1. 进入 `Code Atlas`
2. 打开目标文件和行号
3. 在右侧 `Notes` 里看该行附近 annotation
4. 打开某条 annotation 的详情或 preview
5. 需要继续追踪时，再看它的 `Relations` 和 `Variable trace`

### 场景 B：我手里只有一个 annotation ID

1. 进入 `统一标注中心`
2. 在搜索框直接输入 annotation ID
3. 搜索后会进入 `Exact ID mode`
4. 精确命中的 annotation 会被提升到最上面
5. 再从结果里进入 preview、详情或跳转到代码位置

这是当前找单条 annotation 最稳的方法。

### 场景 C：我想说明多个 annotation 之间的关系

1. 先找到源 annotation
2. 打开详情
3. 在 `Relations` 面板里填目标 annotation ID
4. 选择关系类型
5. 点击 `Add`

如果是代码变量流，可以再看 `Variable trace` 是否形成了连续链路。

## 怎么看 Annotation ID

现在 annotation ID 已经铺到了多个界面：

- 统一标注中心的结果卡片
- annotation 详情卡
- annotation preview 窗口
- 代码页里的相关 preview / inspector
- 搜索结果里的 annotation 行
- workspace 里的 annotation 列表和详情

一般会显示成一个 `ID` badge。

你可以直接：

- 复制原始 ID
- 复制 annotation 链接

## 怎么用 Annotation ID 搜索

### 最简单的方法

去 `统一标注中心`，在搜索框直接贴入：

```text
code-annot-fc475b4cbec9
```

如果当前页命中，你会看到：

- `Exact ID mode`
- 精确命中提示
- 命中结果自动置顶

### 什么时候用 ID 搜索

这些情况优先用 ID 搜索：

- 别人发给你一个 annotation ID
- 你在别处看到一条 annotation，想回头精确打开
- 你想确认两条 annotation 是否就是同一条
- 你要建立关系，需要先找到目标 annotation

## 怎么从搜索结果跳到代码位置

对 code annotation，在结果卡里可以直接点：

- `跳转定位`

它会直接打开对应文件和目标行号。

适合在“先搜到 annotation，再回到代码现场”这个流程里使用。

## Preview 和 Detail 怎么配合用

### Preview 适合快速确认

适合：

- 先看这条是不是我要的
- 快速核对代码行和正文
- 顺手复制 annotation ID 或链接

Preview 里现在会同时显示：

- 版本
- 行号范围
- annotation ID
- 代码片段
- Markdown 正文

### Detail 适合深入处理

适合：

- 编辑正文
- 看更多元信息
- 建立和删除关系
- 看变量轨迹

如果只是快速看一下，用 Preview 即可；如果要继续操作，用 Detail。

## 怎么在 Markdown 里引用别的 Annotation

正文支持 Markdown。现在还支持一种专门的 annotation 链接写法：

```md
[看这条上游说明](annotation:code-annot-fc475b4cbec9)
```

或者：

```md
[前置分析](annotation:annotation-123)
```

效果是：

- 显示成可点击的内部 annotation 链接
- 点击后会在应用内打开对应 annotation
- 不会跳去外部网站

### 什么时候适合用 Markdown 引用

适合这些场景：

- “这条是对另一条的展开说明”
- “先看上游结论，再看这里”
- “这条批注的上下文在另一处”
- 你不想只靠关系面板表达，而想把阅读顺序写进正文

### 关系面板和 Markdown 引用的区别

- 关系面板：更结构化，适合机器整理和后续可视化
- Markdown 引用：更偏阅读体验，适合写“请先看哪条”

推荐两者一起用：

- 正文里写阅读路径
- 关系里保留结构语义

## 怎么建立 Annotation 关系

打开某条 annotation 详情后，可以在 `Relations` 面板里操作。

你需要填两个东西：

- `Target ID`
- `Type`

然后点 `Add`。

### 常用关系类型怎么选

#### `references`

这条引用了另一条。

适合：

- “这里引用前面的说明”
- “更完整背景在那条”

#### `explains`

这条是在解释另一条。

适合：

- 一条结论，另一条补原理
- 一条现象，另一条讲原因

#### `refines`

这条是在细化另一条。

适合：

- 把一个大结论拆得更具体
- 把模糊描述补成更精确说法

#### `contradicts`

这条和另一条相矛盾。

适合：

- 你修正了之前判断
- 不同分析路径得出冲突结论

#### `evidence_for`

这条给另一条提供证据。

适合：

- 某条是“结论”
- 另一条是“支撑该结论的观测”

## 代码分析时最重要的 4 种变量关系

这些关系会出现在 `Variable trace` 里。

### `same_variable`

两个 annotation 本质上在讨论同一个变量，只是位置不同。

适合：

- 同一变量在函数内不同阶段出现
- 同一变量跨函数继续被使用

### `variable_evolves_to`

一个值或状态在后续变成了另一种形态。

适合：

- 原始值经过变换
- 一个字段在后续被重写、裁剪、偏移

### `value_passed_to`

一个值被传给了下一个位置或函数。

适合：

- 参数传递
- 结构体字段传递
- buffer / offset / len 一路往下传

### `depends_on`

当前 annotation 里的变量意义依赖另一条。

适合：

- 只有先理解上游变量，当前变量才说得通
- 当前值由另一个状态控制

## 怎么读 Variable Trace

`Variable trace` 是给 code annotation 准备的关系视图。

它会把与当前 annotation 有关、且属于变量流关系的边单独提出来。

你可以把它理解成：

- 当前点的上游
- 当前点的下游
- 这个变量在别处的相关说明

推荐读法：

1. 先看当前 annotation 在讲什么
2. 再看 `Variable trace`
3. 先点 `incoming` / “into here” 的项，看它从哪里来
4. 再点 `outgoing` / “from here” 的项，看它往哪里去

这样比较像顺着数据流走。

## 代码 annotation 的推荐写法

为了让后续关系更容易建立，建议每条 code annotation 尽量写清楚：

- 在讲哪个变量 / 字段 / buffer
- 当前阶段它的值或语义是什么
- 是“来源”“变换”“传递”还是“结果”
- 依赖哪条上游理解

### 一个好例子

```md
这里的 `dst_offset` 表示当前 page 进入 dst sg 时需要丢弃的前缀长度。

它不是新的 offset 来源，而是承接上游对 page 切分后的剩余偏移。

[上游来源说明](annotation:code-annot-xxxx)
```

这样的写法后面更容易补：

- `depends_on`
- `value_passed_to`
- `variable_evolves_to`

## 什么时候该用“关系”，什么时候只写正文

### 只写正文就够

适合：

- 单点解释
- 只是给当前行加注释
- 没有明显上下游关系

### 应该补关系

适合：

- 你想串起多个代码位置
- 某个变量跨函数传递
- 一条是结论，一条是证据
- 你以后还想从当前 annotation 继续顺藤摸瓜

经验上，只要你脑子里已经出现“这条和那条有关系”，就值得建关系。

## 推荐工作流

### 工作流 1：分析某个变量在函数内如何变化

1. 对关键位置分别建 code annotation
2. 每条都写清楚该变量在该点的含义
3. 用 `same_variable` 串同一个变量
4. 用 `variable_evolves_to` 串发生变换的节点
5. 用 `value_passed_to` 串参数 / 值传递
6. 最后从某一条进入 `Variable trace` 顺链检查

### 工作流 2：分析跨函数的数据流

1. 每到一个关键函数入口或出口就落一条 annotation
2. 先用正文记录“这里拿到了什么”
3. 再用 `value_passed_to` 或 `depends_on` 连接上下游
4. 如果某一步只是复述同一变量语义，用 `same_variable`

### 工作流 3：写给别人看的阅读链路

1. 当前 annotation 正文里放 `annotation:...` 链接
2. 关系面板里再补 `references` 或 `explains`
3. 这样别人既能顺着正文读，也能从结构上看图谱

## 常见问题

### 1. 我只知道 annotation ID，最快怎么打开

去 `统一标注中心`，直接搜 ID。

### 2. 为什么我已经有关系了，但页面上没那么明显

先确认：

- 你打开的是 annotation 详情，不只是列表卡片
- 目标 annotation ID 填对了
- 关系是不是建在你预期的这条 annotation 上

如果是 code annotation，再看 `Variable trace`，只有变量类关系会进这个面板。

### 3. Markdown 里的 annotation 链接和关系是不是重复

不是重复，作用不同：

- 链接更像“给人看的阅读路径”
- 关系更像“给系统和结构化视图看的语义边”

### 4. 为什么有些地方能看到 ID，有些地方以前看不到

现在主要详情面、preview 面、搜索结果、workspace 列表都已经补了 ID。以后如果还有漏点，优先参考 `统一标注中心` 和详情卡。

### 5. 搜索时输入 ID，为什么没命中

先检查：

- 是否完整复制了 annotation ID
- 当前权限是否能看到该 annotation
- 当前结果页里是否刚好没包含它

最可靠的入口还是：

- `统一标注中心`
- 直接搜完整 ID

## 一页版速记

- 想全局找 annotation：去 `统一标注中心`
- 想精确找一条：直接搜 annotation ID
- 想回到代码现场：点 `跳转定位`
- 想快速确认：用 `Preview`
- 想编辑、建关系、看轨迹：开详情
- 想在正文里引用别的 annotation：`[文字](annotation:<annotation-id>)`
- 想表达代码变量流：优先用 `same_variable` / `variable_evolves_to` / `value_passed_to` / `depends_on`

如果你是第一次上手，最值得先记住的只有两件事：

1. annotation ID 是第一定位方式
2. 代码分析要同时用“正文 + 关系”，不要只写孤立备注
