# 小步计划 · UI 样式规范（style.md）

> **这是全站 UI 改动的唯一参照标准。**
> 以后任何新组件、新页面的颜色、间距、字号，必须从本文档选取；
> 现有规则不够用时，先在本文档扩展，再动代码。
> 不允许现场发明新 token 或随意使用 Tailwind 原始色板。

---

## 1. 色板

所有颜色已在 `tailwind.config.js` 注册为 token，并在 `src/styles/index.css` 定义为 CSS 变量，全站统一引用 token 名，不写裸色值。

### 主色 / 品牌色

| Token | 色值 | 使用场景 |
|-------|------|---------|
| `primary` | `#6BB089` | 顶栏背景、主按钮填充色、勾选框选中态、进度圆环、"回到今天"文字、链接 |
| `mint` | `#EAF5EC` | 卡片分组背景（bg-mint/40）、按钮 hover 底色（hover:bg-mint）、输入聚焦环、"上课"标签底色 |
| `lavender` | `#ECE6F7` | 底部导航栏背景（bg-lavender/95） |

### 正文 / 文字色

| Token | 色值 | 使用场景 |
|-------|------|---------|
| `ink` | `#2A3B30` | 正文、任务标题、卡片标题（text-ink）；也用于页面大背景字色 |
| `muted` | `#7A8A80` | 次要文字、底部导航未选中态（text-muted）、时间/日期等辅助信息 |

> **铁律**：正文和任务标题只允许用 `ink`。次要信息用 `muted` 或 Tailwind 的 `stone-400/500`。
> 不允许正文使用彩色（primary、mint 等）。

### 功能色

| Token | 色值 | 使用场景 |
|-------|------|---------|
| `alert` | `#E8743B` | 逾期未完成区域的边框、背景（alert/10）、标题文字（text-alert）。**全站只有"逾期"这一处用暖色，不可扩展到其他场景。** |
| `sun` | `#f0bc68` | "未同步到云端"警示标记（`UnsyncedBadge`，`bg-sun/25` + `text-ink`）。区别于 `alert`：`alert` 专用于逾期，`sun` 专用于同步失败提示；两者不可互相替代。 |
| `paper` | `#F8FAF7` | 页面大背景（bg-paper）。不要用纯白做页面背景。 |
| `rose-100/400/500`（Tailwind） | — | 统计页打卡"漏卡"标记专用（月历漏卡日 `bg-rose-100 text-rose-500`、单项格子红叉、图例 `bg-rose-400`），沿用危险操作同族色；与 `alert`（逾期）、`sun`（同步失败）语义互不替代（2026-07-18 补）。 |

### 其他保留 token

| Token | 用途 |
|-------|------|
| `sage-50/100/500/700` | 历史遗留，当前已逐步替换为 primary/mint；新代码不要使用。|

### 学科标签色（inline style，非 Tailwind token）

学科标签用 `SUB_CATEGORY_META`（`src/utils/taskMeta.ts`）提供 `bgColor` + `color`，通过 `style={{ backgroundColor, color }}` 内联写入，不用 Tailwind class。字色 = 深色，背景 = 淡彩，保证可读性。

---

## 2. 间距规律

### 页面级

| 场景 | 值 |
|------|-----|
| 页面水平内边距 | `px-4 sm:px-6` |
| 页面顶部内边距 | `pt-3 sm:pt-5`（今日页）/ `pt-6 sm:pt-6`（其他页） |
| 页面底部内边距（避让底栏）| `pb-28` |
| 主内容最大宽度 | `max-w-7xl`（今日/周/月/任务管理）/ `max-w-4xl`（打印备份） |

### 卡片级

| 场景 | 值 |
|------|-----|
| 主卡片内边距 | `p-4` |
| 卡片间距 | `gap-6`（主内容区）/ `gap-3`（侧边栏、汇总小卡片）|
| 卡片圆角 | `rounded-2xl` |
| 卡片边框 | `border border-stone-100` |
| 卡片阴影 | `shadow-card`（主要卡片）/ `shadow-sm`（次要卡片）|

### 列表项（TaskItem）

| 场景 | 值 |
|------|-----|
| compact 模式内边距 | `px-3 py-2` |
| 普通模式内边距 | `px-4 py-3.5` |
| 项目间分隔线 | `border-b border-stone-100 last:border-0` |

### 分组容器（GroupedTaskGrid）

| 场景 | 值 |
|------|-----|
| 分组圆角 | `rounded-xl` |
| 分组边框 | `border border-mint` |
| 分组背景 | `bg-mint/40` |
| 分组标题内边距 | `px-3 py-2.5` |
| 分组间距 | `space-y-3` |

---

## 3. 字号与字重

### 标题层级

| 层级 | Token 组合 | 典型场景 |
|------|-----------|---------|
| 页面主标题 | `text-3xl sm:text-4xl font-bold` | 今日日期标题 |
| 周/月页标题 | `text-3xl sm:text-4xl font-semibold` | "本周计划"、"本月" |
| 区块标题 | `text-base font-bold text-ink` | 卡片内"今日清单"、"已完成"、侧边汇总标题 |
| 分组标题 | `text-xs font-semibold text-ink` | 语文/数学/英语等分组 label |
| 次要标题 | `text-sm font-semibold` | 设置区小标题 |
| 顶栏品牌名 | `text-lg font-bold text-white` | "小步计划" logo 旁文字 |

### 正文 / 任务内容

| 层级 | Token 组合 | 典型场景 |
|------|-----------|---------|
| 任务标题（普通） | `text-base font-semibold leading-relaxed` | TaskItem 非 compact 模式 |
| 任务标题（紧凑） | `text-sm font-semibold leading-relaxed` | TaskItem compact 模式（今日/周计划列表） |
| checklist 子项 | `text-sm` | TaskItem 内 checklist 行 |
| 正文 | `text-sm` | 按钮文字、筛选标签、列表普通行 |
| 次要文字 | `text-xs` | 日期、备注、标签文字、辅助信息 |
| 超小文字 | `text-[11px]` / `text-[10px]` / `text-[9px]` | 状态徽章、学科标签、上课标签等角标 |

### 任务标题展示规则

> **只展示任务的实际名称（`task.title`），分类信息完全由彩色标签承担，不在标题文字中重复。**

- 展示层使用 `taskShortName(task)`（`src/utils/taskMeta.ts`），仅返回 `task.title`
- 无标题时回退：兴趣班 → 学科名，课外阅读 → "阅读"，其余 → 学科名
- **保留** `taskDisplayName(task)` 用于无配套标签的场景（任务池行、打印）
- 数据结构不变，这是纯展示层的处理

### 字重规则

| 权重 | 使用场景 |
|------|---------|
| `font-bold` | 页面日期主标题、卡片级标题（今日清单、已完成、本周计划）、顶栏品牌名 |
| `font-semibold` | 任务标题、分组标题、按钮主操作、周/月页标题 |
| `font-medium` | 导航标签文字、次级按钮、辅助数字 |
| `font-normal` | 备注、辅助说明文字 |

---

## 4. 圆角

| 大小 | 使用场景 |
|------|---------|
| `rounded-2xl` | 主卡片、导航栏、toast、模态框 |
| `rounded-xl` | 按钮（主操作）、分组容器、下拉菜单 |
| `rounded-lg` | 小按钮、输入框、标签 |
| `rounded-md` | 任务内标签（学科标签、上课标签、checklist 行） |
| `rounded-full` | 状态徽章、筛选 pill 按钮 |

---

## 5. 阴影

| Token | 值 | 使用场景 |
|-------|-----|---------|
| `shadow-card` | `0 12px 35px rgba(45,61,52,0.08)` | 主要内容卡片（今日清单、任务管理分组） |
| `shadow-sm` | Tailwind 默认 | 侧边汇总卡片、设置区、次要面板 |
| `shadow-xl` | Tailwind 默认 | toast 浮层 |

---

## 6. 按钮规范

### 主操作按钮（CTA）

```
bg-primary text-white font-semibold rounded-xl px-4~6 py-2~2.5 text-sm
```
示例：打印今日、导出备份、保存任务、添加假期

### 次操作按钮（轻量）

```
border bg-white text-stone-500/600 rounded-xl px-4 py-2 text-sm
```
示例：取消编辑、选择备份文件

### 选中态（筛选 tab）

```
bg-primary text-white rounded-full px-3 py-1.5 text-xs
```
未选中：`bg-white text-stone-500`

### 链接式按钮

```
text-primary text-xs（无底色，hover 可加 hover:bg-mint）
```
示例："查看"、"刷新"

### 危险操作

```
bg-rose-600 text-white rounded-xl（批量删除）
text-rose-600（列表内删除按钮，无底色）
```

---

## 7. 特殊状态样式

### 逾期区

```
border border-alert/30  bg-alert/10  →  标题 text-alert font-semibold
```

### 已完成任务

```
text-stone-400 line-through
```

### 上课标签（未完成）

```
bg-mint text-primary text-[10px] font-semibold rounded-md px-2 py-0.5
```

### 上课标签（已完成/取消）

```
bg-stone-200 text-stone-400（随任务灰化）
```

### 标签 / 小按钮颜色铁律

> **教训来自"上课"标签在四处颜色不统一的事故（TASK_05 返工）。**

- **标签和非 CTA 小按钮**（内容类型标签、筛选 pill、状态徽章、学科标签等）：
  统一用 **浅底 + 深字** 组合。首选 `bg-mint text-primary`，次选各学科淡彩底 + 深色字。
- **禁止用实心深色填充**（`bg-ink`、`bg-primary` 实心、`bg-sage-700` 等）做标签或小按钮。
  实心深色只允许出现在：① 顶栏背景（`bg-primary`）② 主 CTA 按钮（`bg-primary text-white`）。
- 新增任何标签/badge/pill 时，先查本节，不允许自己发明配色。

---

## 8. 动画规范

| 场景 | 规格 |
|------|------|
| 勾选完成（checkbox） | scale-110 + bg-primary，duration-300，延迟 400ms 后切换状态 |
| 取消勾选 | scale-95 + bg-stone-100，duration-300，延迟 250ms 后切换状态 |
| 折叠展开（chevron） | `transition rotate-180`，duration 默认 |
| 进度条填充 | `transition-all`，duration 默认 |
| 进度圆环 | `transition-all duration-500` |

---

## 9. 总则

> **以后任何新组件/新页面的颜色、间距、字号必须从本文档选取，不允许现场发明；现有规则不够用时先在本文档扩展，确认后再改代码。**

具体原则：

1. 颜色只用 token 名（`text-primary`、`bg-mint`、`text-alert`），不写裸色值。
2. 正文字一律 `text-ink`，次要信息 `text-muted` 或 `stone-400`，不允许彩色正文。
3. 间距从"卡片内边距 p-4、卡片间距 gap-6"两个基准向上下扩展，不随意发明中间值。
4. 按钮颜色统一用 `bg-primary text-white`（主操作）/ 边框白底（次操作）/ `text-primary`（链接），不用 `bg-ink` 或其他颜色。
5. `sage-*` 系列 token 是历史遗留，新代码中禁用，存量代码遇到时顺手替换。
