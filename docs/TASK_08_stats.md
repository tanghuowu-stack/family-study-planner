# TASK_08 · 习惯打卡（统计页）

> **本卡是当前实现的规格描述**（2026-07-18 重构定稿），不是改动流水账。
> 数据层：`src/data/statsRepository.ts`；UI：`src/components/HabitSection.tsx`（统计页内）。
> 修改本功能前先读 `PROJECT_GUIDE.md` 6.5 节 R1-R6。

---

## 1. 功能定位

**习惯打卡：若干「打卡项目」各自一张月历，各自独立计连续。**

统计页从上到下三块：打卡区（本卡范围）→ 课程节数统计 → 更多设置。
没有"总打卡"概念——每个项目自己的月历、自己的 🔥连续天数，互不影响。

## 2. 打卡项目的管理方式

- 入口只在统计页：「管理打卡项目」弹窗，勾选/取消即时生效。
  **任务表单里没有打卡设置**（曾有"计入打卡"勾选框，已移除）。
- 候选 = 活跃的**重复类任务**（`isOccurrenceSchedule`，即 timeType=recurring），
  剔除软删、整体 cancelled、readingPlan。列表用分类兜底显示名
  （`taskShortName`：空标题的兴趣班显示"游泳课"等，不显示"(无标题)"）。
- 数据字段：任务本体 `enableStreak: boolean`（云端列 `enable_streak`）。

## 3. 起点规则（streakStartDate）

- 勾选当天（本地日）自动写入 `streakStartDate`（云端列 `streak_start_date`），
  用户不手填、任何表单不暴露。
- **起点前的日子一律 off**，不计漏卡（解决"老任务后来才勾打卡，历史全判漏卡"的欠账问题）。
- 取消勾选：`enableStreak=false`，**起点保留**（历史月历可回看）。
- 重新勾选：起点**更新为重勾当天**。

## 4. 月历口径（getHabitCalendars，三态判定）

对每个勾选项目，某天的状态：

| 状态 | 判定（按此顺序） |
|---|---|
| `off` | 未来日；或**非应做日**（起点前 / 排期未命中 / 该日 occurrence 被单独取消）；或**休息日且未完成**（免罚，不算漏卡） |
| `done` | 应做日且已完成——**休息日当天做完了同样算 done**（完成判定优先于休息日） |
| `missed` | 应做日、未完成、且非休息日（含今天——今天应做未完成显示 missed，但不断连续，见 §5） |

- **应做日** = `scheduleOccursOn` 排期命中 ∧ 日期 ≥ streakStartDate ∧ 当天未被单独取消。
- **完成判定**（沿用完成日归因，R1 权威源）：
  - occurrence 类：当天 `task_occurrence_statuses` 行 `status=done`；
  - 非 occurrence 类：本体 `status=done` 且 `completedAt` 按 `toLocalDateKey`
    归因的本地完成日 ≤ 当天（完成日及其后的排期日视为满足）。
  - 所有 timestamp → 日期转换必须走 `toLocalDateKey`，禁止 UTC 截断。
- UI：绿=done、红=missed（rose 系，见 style.md 功能色）、灰=off；周一起始；
  图例固定三种：完成 / 漏卡 / 休息或无排期。
- 月份切换：所有项目卡共享同一当前月份，切月同步；🔥连续与展示月份无关。

## 5. 🔥单项连续的计算规则

从今天往回逐日走（回看上限 400 天，且不早于该项排期起点 / 打卡起点）：

- 应做日已完成 → +1，继续往前（**休息日完成同样 +1**）；
- 应做日未完成 → **断**，停止——但若该日是休息日则**免罚穿过**（不 +1 也不断）；
- 非应做日 → 穿过（不 +1 也不断）；
- **今天**应做但未完成 → 不算断（当天还没结束），从昨天起算。

## 6. 休息日机制

- 入口：统计页「休息日」弹窗，点某天标记/取消（可切月）。
- 存储：app_settings `stats_rest_days`（string[]，YYYY-MM-DD），云端同步，全家共享。
- 效果：**"免罚"而非"不计"**（2026-07-18 定稿）——休息日没做不算漏卡（off、连续穿过不中断）；
  但当天**实际完成了就正常判 done、计入连续**，完成判定优先于休息日。

## 7. 数据层函数清单

| 函数 | 职责 |
|---|---|
| `getHabitCandidates()` | 候选任务列表（含 enabled 标记），供管理弹窗 |
| `setHabitEnabled(taskId, enabled)` | 勾选/取消，走 `getRepository().update` 同步云端 |
| `getHabitCalendars(month, today?)` | 全部勾选项目该月逐日三态 + currentStreak |
| `getRestDays()` / `toggleRestDay(date)` | 休息日读取/切换 |

## 8. 已废弃、不再实现（不是漏做）

以下功能曾实现过，2026-07-18 重构中**整体废弃删除**。
废弃原因：多项目共用一个"总打卡"导致口径混乱（三态判定、每日覆盖、补卡规则层层叠加），
真实使用中家长和孩子只关心"每个习惯各自坚持了多久"，用不到这些：

- 总连续打卡（所有项目全清才算一天）及总打卡月历
- 复活卡（余额/发卡/3 天补卡/家长长按确认）
- 六档坚持徽章
- 每日打卡项手动覆盖（added/removed）
- 本周完成率、学科对比

app_settings 里的历史键 `stats_revive_cards` / `stats_daily_overrides` 不清理，代码不再读写。
如果未来要做"完成率/趋势"类统计，另起功能设计，不要复活上面这套。
