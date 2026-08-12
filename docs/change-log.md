# 项目变更记录

此文件只记录简短变更摘要。以后每次完成项目修改后，在顶部日期下追加一条记录，不需要复制完整需求或实现细节。

## 2026-08-12

- 「最近操作记录」加撤回：按用户要求改为直接在现有 100 条记录列表里逐条加「撤回」按钮，不做 toast+"最近删除"分组的方案。
  1. `taskRepository.ts` 新增 `restoreSnapshot(id, snapshot)`——撤回专用的整体覆盖写入，不走 `update()` 的"改 status 顺带联动 completedAt"智能推断（那是给表单编辑用的默认规则，会覆盖掉快照里要精确复原的原始 completedAt，两种语义冲突）。`cloudRepository.ts` 加对应云端包装。
  2. 新模块 `activityUndo.ts`（`canUndoActivityLog`/`undoActivityLog`）：只支持有明确安全撤回语义的动作——task 类的 create/delete/restore/edit/complete/uncomplete，taskOccurrence 类的 complete/uncomplete/cancelOccurrence/postponeOccurrence，以及 batchDelete；拖拽排序（edit 但无 entityId）、假期/课程/阅读旧记录/导入导出一律不可撤回，不强行兼容。occurrence 类撤回的 completedAt 用近似值（`setOccurrence` 不支持精确覆盖），但完成判定只看 status 不看 completedAt，不影响任何读取路径。
  3. `StatsPage.tsx`「最近操作记录」每行按钮内联，点击弹确认框、执行撤回、成功后触发 `onImported`（联动今日页/任务管理页刷新）+ 重新加载日志列表。
  4. 测试 +10（`activityUndo.test.ts`：拖拽排序/非任务类不可撤回、新建撤回=软删、删除撤回=恢复、恢复撤回=重新软删、编辑撤回精确复原字段、完成撤回退回 todo 且不残留 completedAt、**取消完成撤回精确复原原始 completedAt 而非联动逻辑生成的 now**、occurrence 撤回保留 override 字段、批量删除撤回全部恢复），134 例全绿，tsc 通过。
  5. 真实数据端到端验证：登录态下造测试任务、完成、在真实 UI 里点"撤回"按钮——确认框弹出、撤回后 status 退回 todo 且 completedAt 清空、toast 正确显示、云端同步确认；删除操作的日志条目正确显示"撤回"按钮。测试任务已清理。
  - 顺带说明用户截图疑问"为什么完成记录全是 Mac Chrome"：`activity_logs` 本地表不自动同步云端（只有手动批量上传才会），这次截图里的记录混入了本次会话在自动化预览浏览器（识别为 Mac Chrome）里做的诊断/测试操作，不代表家庭真实设备的操作记录异常；真实 iPad/Mac 各自的本地记录不受影响。
- 打卡分组补齐：单次课（`singleDate`）现在能自动纳入已启用的打卡分组（用户反馈"打卡页面没显示上钢琴课的打卡"）。
  1. **根因**：钢琴课在库里是 8 条 `singleDate` 任务（每次上课单独建一条），而 `getHabitCandidates`/`getHabitCalendars` 都限制 `isOccurrenceSchedule`（只认 recurring），钢琴课既进不了候选也进不了月历——上一轮按 subCategory 分组时误以为两者都是重复任务，只合并到了"钢琴练习"一条。
  2. **修复**：命中 `HABIT_GROUPS` 的分组改为「组内任一任务被勾选即启用整组」，成员按 subCategory 全量收集、**不限排期类型**——单次课无需（也无法）逐条勾选，将来新建的同类课自动纳入。组级打卡起点取组内已勾选任务的最早起点，统一用于组内所有成员（避免起点前的历史单次课倒灌成打卡）。未命中分组的任务口径不变（仍要求自身 recurring + 已勾选，防孤儿卡）。
  3. 测试 +3（单次课自动纳入且当天上课即算打卡、组内无勾选时分组不出现、组级起点统一生效），124 例全绿。
  4. 真实数据验证：08-10/08-11/08-12 钢琴练习无记录或被取消（当天上课不练琴），因上课任务已完成而正确判为打卡成功；08-08 既没练也没课仍正确判漏卡；连续天数 4 天。
- 确认「作业窗口」类任务（布置后一个月内任意天做完、小项跨天累积、做完当天算完成）**现有 `dateRange` 类型已完整支持，无需新功能**：窗口内每天都出现、checklistItems 跨天保持、全部小项完成即在当天判 done、完成日当天仍显示（进已完成区）之后不再出现、全程不产生 occurrence 欠账。补回归用例 11b 固化该行为，并注明这类作业不可用 `dailyRecurring`（那是"每天各欠一次"的语义，会积压逐日欠账）。
- 恢复被软删的真实任务「暑假作业-趣味练习题3页」（用户反馈"任务整个消失"）：诊断确认 `deletedAt=2026-08-11T14:56:16`（iPad Safari），与当天 13:31 完成打卡相隔 1h25min，非同一操作；全库代码审计确认 `setOccurrence`/`setDisplayStatus`/`toggleChecklistItem` 均无隐藏的"完成后自动删除"逻辑，排除该可能。27 条 occurrence（14 条完成）、`recurrence` 排期规则均完整保留，走 `getRepository().restore()` 正规路径恢复，本地+云端 `deletedAt` 确认清空，今日页验证正常出现。备注：该任务今年 7 月已因 `recurrence.endDate` 与 `task.endDate` 不一致"消失"过一次（见 08-04 记录），本次是独立的软删事件；`activity_logs` 默认不自动同步云端（只有手动上传才批量同步），故删除操作的设备端具体触发路径无法从云端还原，已建议用户直接查看 iPad 本地"最近操作记录"确认。
- 打卡分组：钢琴课（`piano`）+ 钢琴练习（`pianoPractice`）合并为一张"钢琴"打卡月历卡，组内任一任务当天完成即算打卡成功（用户确认两者不会同一天出现）。方案选型：按 subCategory 聚合（而非新增任务级 `habitGroupId` 字段）——这一分组是分类体系本身的稳定属性，新建的同类任务自动归组、零维护成本，且零 schema/迁移/表单改动；灵活性更高的任务级字段方案留作未来真正出现跨分类临时分组需求时的备选。
  1. `statsRepository.ts` 新增 `HABIT_GROUPS` 映射表（`piano`/`pianoPractice` → `{groupKey: "piano", label: "钢琴"}`），`getHabitCalendars` 按 `habitGroupKey` 聚合已勾选任务；`computeItemStreak` 泛化为 `computeGroupStreak(tasks[], ...)`（单任务/多任务同一套逻辑，`.some()` 语义天然兼容），新增 `groupApplicable`/`groupSatisfied` 分组版应做/完成判定。`getHabitCandidates`（管理弹窗）不变，仍按任务逐条勾选。
  2. 测试 +4（两任务合并一张卡、互斥排期下任一完成即算打卡成功、只勾选其中一个仍显示分组标签、未命中分组表的任务不受影响），120 例全绿，tsc 通过。
  3. 真实数据验证：家庭现有"钢琴练习"单独一条也正确显示为"钢琴"；临时加一条"钢琴课"测试任务与真实任务合并——仍只 1 张卡、当天状态因测试任务完成从 missed 转 done；意外发现当天真实"钢琴练习" occurrence 被标记 cancelled（大概率当天上钢琴课），验证了"off"正确排除 cancelled 日，也印证了两者互斥的真实场景。测试任务已清理（云端确认软删）。

## 2026-08-04

- 新增「延长周期」操作，与「结束」对称，解决"任务到期后用户手动新建同名任务续期"（导致重复打卡任务）的根源：
  1. `utils/taskMeta.ts` 新增 `canExtendRecurring`，与 `canEndRecurring` 严格互斥（同一任务只可能出现其中一个入口）：只对已设定 `recurrence.endDate` 且已过期的 dailyRecurring/weeklyRecurring 任务开放；无 endDate（本就不限期）或未过期一律不显示。
  2. `taskRepository`/`cloudRepository` 新增 `extendRecurring(id, newEndDate | undefined)`：只改 `recurrence.endDate`（连带镜像的 `task.endDate`），新日期非空时必须 ≥ 今天；不创建任何新任务，任务本体、`streakStartDate`、历史 occurrence 完全不动，排期自然延续。
  3. 新组件 `ExtendRecurringDialog`：日期选择（默认今天+30天，`min` 锁今天）+「不限期」单选。入口接入今日页任务「...」菜单（`TaskItem`）与任务管理页「已结束的重复任务」分组行（`TaskManagementPage`），均与「结束」按钮互斥展示。
  4. 测试 +9（`canExtendRecurring` 边界互斥 6 例、`extendRecurring` 数据层 3 例：延长生效且历史/起点不受影响、改不限期、新日期早于今天与非重复任务两种拒绝），116 例全绿，tsc 通过。
  5. 真实数据验证：家庭现有「公文计算」（已过期）在任务管理页正确显示"延长"（无"结束"）；用临时测试任务走完整链路——延长后自动从"已结束"移入"待办"、今日页菜单同步切换为"结束"、5 条历史 occurrence 与 streakStartDate 分毫未动、打卡月历连续天数正确（今天未完成不算断）。手机 375px / 平板 768px 双尺寸检查对话框布局正常，日期输入唤起原生选择器。测试数据已清理（本地+云端确认软删）。

- 修复两个打卡数据层 bug + 处理两组重复打卡任务（用户反馈：统计页出现同名重复打卡卡片）：
  1. **bug 1**：`copyToDate`（`taskRepository.ts`）复制任务时会原样继承源任务的 `enableStreak`/`streakStartDate`，但副本被强制成 `singleDate`，不再是 recurring 类——继承来的打卡身份成了孤儿（月历有卡、「管理打卡项目」弹窗却看不到、也无法取消）。修复：复制清单里补上这两个字段清空。
  2. **bug 2**：`getHabitCalendars` 未像 `getHabitCandidates` 一样限制 `isOccurrenceSchedule`，导致非 recurring 类任务只要 `enableStreak=true` 也会生成月历卡（管理弹窗管不到）。修复：两处过滤口径对齐。
  3. 测试 +3（复制打卡任务不继承打卡身份且不进月历；非 recurring 任务即使打了 enableStreak 也不出现在月历），107 例全绿，tsc 通过。
  4. **诊断+数据修复**（登录态，走 `getRepository()` 正规路径，逐步核对本地+云端）：
     - 「阅读并记录」两条确认是无缝续期（06-25~07-31 与 08-01~08-31 首尾相接，起点均为 07-02）：老任务 `recurrence.endDate` 改为不限期（长期习惯不该有固定结束日）、新任务 3 条 occurrence 记录迁移到老任务名下、软删新任务。合并后老任务月历完整覆盖 06-26~08-03，共 33 条记录。
     - 「钢琴练习」诊断出不是续期问题，而是"删除+复制 bug"两个问题叠加：原始 recurring 任务（9/20 完成的真实历史）被误删，同时通过 `copyToDate` 复制出的两个 singleDate 孤儿副本因 bug 1 被打上了打卡身份。处理：restore 原始任务，软删两个孤儿副本，无关的旧一次性任务原样不动。
     - UI 验证：统计页「阅读并记录」「钢琴练习」各只剩一张卡，历史/连续天数与真实数据吻合（钢琴练习 🔥1 精确对应 08-02 完成、08-01 漏卡、08-04 非应做日的真实排期）。

- 任务管理页新增「已结束的重复任务」分组（用户反馈：`公文计算`结束后一直卡在待办列表里）：
  1. **根因**：「结束」≠「完成」——结束只改 `recurrence.endDate`，R1 铁律下 occurrence 类任务本体 `status` 恒为 `todo`/`cancelled`，永远不会变成 `done`。任务管理页原先只按 `status` 区分"待办"/"已完成"两个分组，已结束的重复任务 status 仍是 `todo`，自然一直留在待办列表，视觉上和真正待办的任务没有区别。
  2. **修复**：`utils/taskMeta.ts` 新增 `isEndedRecurring`（与 `canEndRecurring` 边界互斥：`recurrence.endDate < today` 才算已结束，等于今天仍算"可结束/未结束"）。`TaskManagementPage` 把 `pending` 拆成"待办"（未结束）与"已结束的重复任务"（新分组，折叠展示，样式复用"已完成任务"区块的 `opacity-75` 卡片），已结束任务不再显示「结束」按钮（`canEndRecurring` 本就返回 false），仍保留编辑/复制/删除。
  3. 测试 +4（`taskMeta.test.ts`：`canEndRecurring`/`isEndedRecurring` 边界互斥——长期/等于今天/早于今天/非长期重复类型四种情况）。97 例全绿，tsc 通过。
  4. 真实验证（本地模式）：造一条已结束（`endDate` 早于今天）+一条仍在排期的 dailyRecurring 任务，任务管理页"全部"筛选下确认：待办分组只剩仍在排期的那条；新增的"已结束的重复任务 · 1"折叠区展开后显示已结束的那条，只有编辑/复制/删除，无「结束」按钮。
- **同一个 bug 换 schedulePattern 又冒出来一次，二次修复**：用户反馈"大增背诵：24课内容+卷子40-41"（`07-04～07-25 每天`）结束多日仍卡在待办列表。
  1. **根因**：上一版 `isEndedRecurring` 只覆盖了 `dailyRecurring`/`weeklyRecurring`（判 `recurrence.endDate`），漏了 `dateRangeDaily`/`dateRangeWeekdays`（真正governing 字段是 `task.endDate`，不是 `recurrence.endDate`）和 `specificDates`（governing 是日期列表最大值）——这条任务是 `dateRangeDaily` 模式，压根没进上一版的判定范围，状态和上次"公文计算"的 bug 本质相同，只是排期字段来源不同。
  2. **修复**：`isEndedRecurring` 改为统一走新增的 `scheduleEndBound(task)`，按 `schedulePattern` 分别取正确的终点字段（dailyRecurring/weeklyRecurring→`recurrence.endDate`，dateRangeDaily/dateRangeWeekdays→`task.endDate`，specificDates→日期列表最大值），逐一对齐 `taskRepository.ts` 的 `scheduleOccursOn` 判定口径，覆盖全部 5 种 recurring 排期模式；`canEndRecurring`（手动「结束」按钮的显示条件）维持只覆盖 dailyRecurring/weeklyRecurring 不变——有界排期模式本来就有终点，不需要手动结束。
  3. 测试重写为按 schedulePattern 分组，新增 dateRangeDaily/dateRangeWeekdays/specificDates 三种模式的已结束/未结束边界用例（含精确复现本次 bug 的 07-04~07-25 场景），以及"dateRangeDaily 只认 task.endDate、不被同名的 recurrence.endDate 干扰"的字段来源测试防混淆。105 例全绿，tsc 通过。
  4. 真实验证（本地模式，构造与线上"大增背诵"完全相同字段的任务：dateRangeDaily，07-04~07-25，验证时系统日期已到 07-31）：任务管理页确认该任务不再出现在待办列表，正确归入"已结束的重复任务"分组，标签与线上截图一致，只有编辑/复制/删除、无「结束」按钮。

## 2026-07-20

- 今日页三项改动：清空时间保存不生效的数据 bug 修复、任务操作菜单加「结束」、顶部常驻显示今天日期：
  1. **数据 bug（优先级最高）——清空时间保存后旧时间复活**：根因是遗留字段 `Task.time`（`startTime` 上线前的历史字段）。`TaskForm` 只编辑 `startTime`，从不碰 `time`；多处展示/排序读 `task.startTime ?? task.time` 兜底。编辑旧任务清空"开始时间"时，`draft.time` 由 `strip()` 原样继承旧值、随表单一起提交，`startTime` 被正确清空但 `time` 仍是旧值，`??` 兜底把旧时间复活——今日页因此"清不掉"。修复：`sanitizeTaskWrite`（唯一写入口）新增 `clean.time = clean.startTime` 强制镜像（含清空），令 `time` 彻底降级为纯镜像字段，不会再独立发散。`taskToRow`/`rowToTask` 云端映射本就走同一个 `start_time` 列，无需改动。
  2. **配套 UI——时间选择器加显式清除按钮**：原生 `<input type="time">` 在部分移动端浏览器（尤其 iPad Safari）打开过选择器后不提供明确的清空方式。`TaskForm` 抽出 `TimeField` 组件（开始/结束时间共用），值非空时在输入框下方显示"清除，不设置时间"按钮，一并解决"新建任务时间选择器要有不设置时间的退出方式"的历史反馈。
  3. **今日页任务操作菜单加「结束」**：复用 `canEndRecurring` 判定（从 `TaskManagementPage.tsx` 抽到 `utils/taskMeta.ts` 共享，两处不再各写一套条件）和 App.tsx 已有的 `endTask` 动作（未重新实现），`TaskItem.tsx` 的"···"菜单在"删除任务"上方加分隔线 + 「结束」项（琥珀色，`CalendarX` 图标），仅对仍在排期的长期重复任务、且非已完成/取消时显示；点击复用同一个确认框（"结束…吗？今天起不再排期，历史记录和打卡月历都会保留"）。`DayPage`/`App.tsx` 的 `actions` 补 `onEnd` 透传。
  4. **今日页顶部常驻显示真实当天日期**：新增 `今天是 {今天日期}` 固定行（`text-xs text-muted`），恒用 `todayKey()`，不随翻页变化。浏览非今天日期时，主标题从 `text-ink` 换成 `text-primary` 并加"浏览中"徽章（`bg-mint text-primary`，标签配色遵循 style.md 标签铁律），回到今天恢复原样。新视觉规则已补进 `style.md` §7。
  5. 测试 +2（regression 28/29：清空 startTime 时遗留 time 字段一并清除、create/update 后 time 恒镜像 startTime），临时还原镜像逻辑验证测试确实会炸。93 例全绿，tsc 通过。UI 改动（结束菜单项、时间清除按钮、今日头部）无自动化组件测试覆盖（项目无 React 组件测试基础设施），走真实浏览器复现验证。
  6. 真实验证（本地模式，模拟修复前"time 与 startTime 分裂"的脏数据状态）：①造任务写入分裂的 `time`/`startTime`，今日页确认显示旧时间→编辑表单点"清除，不设置时间"→保存→今日页确认旧时间消失、`startTime`/`time` 本地库双双为空；②造长期 dailyRecurring 任务，今日页"···"菜单确认「结束」出现在"取消本次"之下、"删除任务"之上，点击后确认框文案正确，确认后 `recurrence.endDate` 设为昨天、`deletedAt` 仍为 null、任务从今日页消失；③翻页到明天，顶部"今天是 7月20日"不变，主标题变绿色并带"浏览中"徽章，回到今天后恢复。手机 375px / 平板 768px 布局确认正常（时间清除按钮全宽、头部换行不破版）。
- 记入技术债（仅文档，不改代码）：**任务级 `actualMinutes` 不按天区分存储**——`Task.actualMinutes` 是任务本体单一字段（occurrence 表无 `actual_minutes` 列），recurring 任务在还没做的新一天今日页会显示历史某次计时的旧值（用户实测"公文计算"多天显示同一个"实7m"）。属数据模型问题，计划并入"计时器独立页面重新设计"那一轮一并解决，不单独修补。已记入 PROJECT_GUIDE §13 与 ARCHITECTURE_RULES §4（含届时的占用天存储/schema 迁移/字段映射注意事项）。
- 任务管理页给长期重复任务加独立「结束」按钮（与删除分开）：
  1. **需求背景**：用户想"停止未来排期但保留历史"，此前只有"删除"（软删本体→任务从今日页排期消失、且因 `statsEligible` 过滤 `isActiveTask` 连打卡月历卡片一起不显示，误以为历史没了，实际 occurrence 从未被删）。「结束」提供正确语义。
  2. **数据层**：`taskRepository.endRecurring(id, today?)` 把 `recurrence.endDate` 设为结束当天的前一天（当天起 `scheduleOccursOn` 不再命中），走 `update` 入口自动继承 §3.2 的 `task.endDate` 镜像与云端上传；`cloudRepository.endRecurring` 包装同步。本体不软删、历史 occurrence 完整保留、打卡月历卡片继续显示（本体仍 `isActiveTask`）。
  3. **UI**：`TaskManagementPage` 每行「编辑」与「删除」之间新增琥珀色 `CalendarX`「结束」按钮，仅对仍在排期的长期重复任务显示（`canEndRecurring`：timeType=recurring 且 schedulePattern∈{dailyRecurring,weeklyRecurring} 且无 endDate 或 endDate≥今天）；已完成/取消行不显示。删除按钮维持原样（软删）。App 新增 `endTask` 动作走 `getRepository().endRecurring`，云端失败挂黄标提示。
  4. 测试 +2（regression 26/27：endDate 设昨天+镜像+本体不删+今天起不排期+历史 occurrence 保留；非重复任务调用抛错）。顺带修复既有 flaky 用例 23（同分组同 defaultSortOrder + 同毫秒 createdAt 导致 chinese 相对顺序非确定，改为先显式 reorder 确定 chinese 顺序再验 math 拖拽隔离，语义不变）。91 例连跑 3 次全绿，tsc 通过。
  5. 真实云端验证：造临时每日重复打卡任务（起点 07-16、07-19 有 done occurrence）→ 今日页可见 → 任务管理页点「结束」→ 今日页/明日不再出现、`recurrence.endDate`+本体 `end_date` 均=07-19（本地+云端一致）、`deleted_at` 为 null、打卡月历卡片仍在且 07-19 仍 done、今天格子由 missed 正确转 off。验证后临时任务已软删清理（其 07-19 orphan occurrence 因 occurrence 表无 deleted_at 残留于云端，任务已软删故各视图不可见，属既有技术债不单独物理清理）。

## 2026-07-19

- 修复计时"停止后 1-2 秒实际用时消失"（云端模式特有，本地模式不触发）：
  1. **根因不是覆盖，是云端下载漏了一个字段映射**：[cloudRead.ts](src/lib/cloudRead.ts) 的 `rowToTask()` 把云端行转回本地 Task 对象时，逐字段核对发现漏了 `actualMinutes`（任务级）——上传方向 `taskToRow` 正确写 `actual_minutes` 列，下载方向却没读回来。停止计时后本地写入、云端 upsert 都正确，但 upsert 触发的 Realtime 自我回声在 ~2 秒后拉取云端数据，`rowToTask` 转换时把这个字段丢了，这份"缺字段"的对象通过 LWW 检查（updatedAt 不算旧）覆盖本地缓存，本地显示因此消失——云端数据全程正确，只是本地缓存被反复读丢。只要还在云端模式，任何一次页面刷新/Realtime 事件/3 分钟定时兜底拉取都会重演，不是偶发。修复：`rowToTask` 补上 `actualMinutes: row.actual_minutes ?? undefined`，紧跟 `estimatedMinutes` 那行。
  2. **回归测试**：新增 `cloudFieldParity.test.ts`，导出 `taskToRow` 供测试，构造覆盖全部任务级字段的 Task 对象，逐字段做"上传→云端行→下载"往返断言（43 个字段用例）。临时还原漏映射验证测试确实会炸（`actualMinutes` 断言失败），修复后全绿，确认测试真的在防这个回归而非摆设。顺带核对了 taskToRow/rowToTask 全部字段，除 `actualMinutes` 外没有发现其他单向漏映射；发现 `month` 字段（monthGoal 任务用）上传下载都没映射且云端 schema 没有对应列——这是"整体未接入云端"而非"单向漏映射"，性质不同，记入 PROJECT_GUIDE §13 待办，本次不修。
  3. 89 例全绿（新增 43），tsc 通过。真实云端模式复现验证：开计时器→停止→每 500ms 轮询本地库持续 9.5 秒，`actualMinutes` 全程保持为 1（此前约 2 秒消失），云端 REST 接口直查确认一致，UI 显示"实1m"正常。
  4. 诊断过程中一度误锁定到错误任务的按钮（同类选择器问题上次也遇到过），核实后确认未误写真实生产数据；用于验证的测试任务均已软删除清理。
- 计时器回归修复（长期存在的老 bug，非近期改动引入，用法撞上才暴露）：
  1. **暂停后继续从 0 重算**：根因 [TimerContext.tsx](src/context/TimerContext.tsx) 的"继续"按钮一直复用 `start()`（全新开始逻辑），无条件把 `accumulated` 清零。抽出纯状态转换逻辑到新文件 `src/context/timerStore.ts`（`startStore`/`pauseStore`/`resumeStore`/`calcElapsed`），新增 `resume()`——只重开 `startedAt`、保留 `accumulated`，`TimerControls` 的"继续"按钮改调它。
  2. **计时/手填实际用时后点整体完成，用时消失**：根因 [taskRepository.ts](src/data/taskRepository.ts) 的 `setDisplayStatus` 已经查询了最新的 `before`（DB 现状）却没用上，写 `checklistItems` 时用的是调用方传入的旧 `task` 快照——若小项刚计时/手填保存了 `actualMinutes`，紧接着点任务整体"标记为完成"，这份旧快照会把刚存的值覆盖掉。改为用 `before?.checklistItems` 兜底。
  3. 回归测试 +6：`timerStore.test.ts` 新增 3 例（暂停继续保留 accumulated、连续多次暂停继续累加、全新开始 accumulated 恒为 0，纯函数测试不依赖 React）；`regression.test.ts` 新增 2 例（24：旧快照调 setDisplayStatus 不覆盖刚存的 actualMinutes；25：手动输入用时不触发完成动作也能正确保存读出）。46 例全绿，tsc 通过。
  4. 真实浏览器复现验证（本地模式，与诊断时同一操作序列）：暂停 10 秒→继续，`accumulated` 保留 10 不清零；小项计时 2 秒→立即点整体完成，`actualMinutes` 保留、`status=done`；手动填 33 分钟→正确显示"实33m"。三个症状均确认消失。
- 今日页任务级拖拽 + iPad 计时器 bug 修复：
  1. **今日页学科分组内逐条任务可拖拽**（`DayPage.tsx` 新增 `SortableTaskList`，与任务管理页共用 `getRepository().reorderTasks`）：拖拽作用域是今日页的学科合并粒度（语文/数学/英语/其他，`taskSubjectGroup`），允许跨 `mainCategory`（如把"课外"语文任务拖到"学校作业"语文任务前面）——这与任务管理页按 `mainCategory→subCategory` 分别显示但共用同一个 `sortOrder` 字段是一致的，任务管理页每个子分组内排序不受影响（子集排序不受其他任务 sortOrder 取值影响）。带具体时间的任务始终按时间置顶，不参与拖拽、不显示手柄。
  2. 相应把 `taskSort` 的跨分组排序键从"按 mainCategory:subCategory 现算默认序"改为"按今日页学科合并粒度现算默认序"（`subjectRank`，基于 `taskSubjectGroup`）——旧键粒度比今日页的显示粒度更细，会导致任务管理页写的 sortOrder 被这里的粗粒度默认序压回原位，今日页的跨 mainCategory 拖拽因此不生效。存量数据验证：现有 baked sortOrder 在各学科桶内本来就单调递增，此改动不引发任何未拖拽任务的可见重排。回归测试相应更新（22 改为验证"可跨 mainCategory 拖到前面"，新增 23 验证"学科分组之间互不干扰"），41 例全绿。
  3. **修复 iPad 计时器 bug**：计时中的任务小项直接勾选完成（不点计时器自己的"完成计时"按钮）时，正在跑的计时器从未被停止/保存，实际用时静默丢失，同时计时器孤儿运行在 localStorage 里。根因：`TaskItem.tsx` 的 `handleStatusChange`（任务级"标记为完成"）有"先停计时再完成"防线，但 `handleChecklistToggle`（小项勾选）没有这层防线。修复：`handleChecklistToggle` 补齐同款防线，仅在这个小项自己正在计时时才停止+保存。真实复现验证：本地模式建任务→小项计时→直接勾选完成，修复前 `actualMinutes` 缺失且计时器孤儿运行，修复后 `actualMinutes` 正确写入、计时器正常清除。此路径无自动化组件测试覆盖（项目目前只有数据层 Vitest 用例，无 React 组件测试基础设施），仅手动复现验证。
- 任务管理页子分组内拖拽排序，与今日页共用 sortOrder：
  1. **排序语义收口**：`taskSort` 改两级——跨分类按分类默认序（`defaultSortOrder` 现算，不依赖存量字段），同分类内按 `sortOrder`（拖拽写 0..n-1），createdAt 兜底。sortOrder 从此只承担组内手动顺序，不再兼任跨分类排序（否则拖拽写小值会把整组提前）。存量数据行为零变化。
  2. 数据层新增 `reorderTasks(ids)`（taskRepository + cloudRepository 包装）：按数组序写 sortOrder 并刷新 updatedAt（R5 防 LWW 回滚），云端逐条 upsert、失败 notifySyncError。
  3. 任务管理页 UI：待办区每个二级分类子分组内任务行可拖拽（HTML5 DnD，同今日页分组拖拽机制，GripVertical 手柄），仅同子分组内互拖，子分组显示顺序与今日页组内规则一致；单任务子分组与已完成区不可拖。拖完走 `getRepository().reorderTasks` 即时同步云端并刷新今日页。
  4. 今日页组内顺序跟随（无时间任务）；带具体时间的任务仍按时间优先排列，不受拖拽影响。
  5. 测试 +5：reorder 写值与 updatedAt 刷新、今日页顺序跟随、跨分类默认序不受拖拽影响（regression 20-22）；云端 upsert 行集合与未登录不上传（cloudReorder.test，Supabase mock）。40 例全绿，tsc 通过。真实验证：预览环境拖拽「公文计算」到组首 → 本地 sortOrder/云端 upsert/今日页顺序三处确认；手机 375 / 平板 768 布局与手柄正常。iPad 真机触屏手感待家里实测（与今日页分组拖拽同一机制，系统级长按拖动）。
- 收尾「阅读」16baeb12 不一致 + endDate 镜像联动落地：
  1. `sanitizeTaskWrite` 新增写入联动：`timeType=recurring` 且 `schedulePattern` 为 dailyRecurring/weeklyRecurring 时，`task.endDate` 强制镜像 `recurrence.endDate`（含清空）——该模式下排期只读 recurrence，本体 endDate 无独立消费者，是纯死数据。create/update 单点覆盖（cloudRepository 是包装层自动继承）。回归测试新增 2 例（18 镜像含清空、19 dateRangeDaily 不受影响），35 例全绿，tsc 通过。PROJECT_GUIDE §13 该项记为已实现。
  2. 16baeb12"阅读"`task.endDate` 06-25→07-31：通过今日页编辑保存走真实 update 路径，由新镜像逻辑自动对齐，云端同步确认。到期（07-31）后会真的停止排期，属预期行为，需继续时手动延长。
  3. **打卡起点修正取消**：排查发现全部 6 个打卡项目的 `streakStartDate` 是今天由家长在另一设备手动统一设为 2026-07-02（含新启用的分数表/公文计算/FCE/钢琴练习），经用户确认属有意为之，"阅读改回 06-26"不再执行，07-02 为最终意图。统计页确认六张月历渲染正常（起点前灰、起点后按完成着色）。
  4. 全库只读扫描（dailyRecurring/weeklyRecurring 范围）：4b8110e8/16baeb12 类"两字段都有值且不同"的不一致已清零；余 3 条陈旧 `task.endDate`（钢琴练习 06-21 / FCE听写 06-22 / 公文计算 06-30，recurrence 均为长期无终点）对排期零影响，下次保存自动被镜像清洗，不手工处理。
- 处置「暑假作业-趣味练习题1页」重复任务（07-18 只读排查的后续）：①`4b8110e8` 的 `recurrence.endDate` 由 07-04 改为与 `task.endDate` 一致的 08-20，恢复正常排期（原有 17 条 occurrence、4 条完成记录不变）；②软删重建品 `62bf9f02`、`774aa7b3`，历史数据保留在 `4b8110e8` 上。均通过真实 UI（任务管理页编辑/删除）走 repository 写入路径完成，本地+云端同步确认无失败请求。今日页确认 `4b8110e8` 正常出现，任务管理页确认排期显示"每日重复｜07-03 至 08-20"。
- 只读扫描全库 `recurrence.endDate` 与 `task.endDate` 不一致的活跃任务：发现 1 条新增待确认——`16baeb12`（"阅读"，`recurrence.endDate=07-31` 但 `task.endDate=06-25`），本次未处理，等待确认。其余出现的字段差异均为 `recurrence.endDate` 为空（长期/无结束日）的正常形态，不算不一致。
- npm test 33 例全绿，tsc 通过。

## 2026-07-18

- 打卡起点可编辑：「管理打卡项目」弹窗里，已勾选项目旁显示「打卡起点 YYYY-MM-DD」，点击弹出日期选择器可手动改早/改晚，不允许晚于今天，改动即时生效并刷新月历。新增 `setHabitStartDate(taskId, date, today?)`，`HabitCandidate` 补充 `streakStartDate` 字段（仅已勾选项目非空）。TASK_08 文档 §3/§7 同步。测试新增 4 例（候选字段、改早/改晚生效、未来日拒绝、未勾选任务拒绝），33 例全绿。真实验证：改起点后本地+云端同步确认，手机/平板双尺寸弹窗滚动正常。
- 只读排查同名重复任务「暑假作业-趣味练习题1页」：库中实际是 **3 条活跃 + 1 条已软删**（非预期的"两条"）。①`4b8110e8`（created 07-02，recurring/dailyRecurring，**recurrence.endDate=07-04 但 task.endDate=08-20，排期规则与任务字段不一致**，17 条 occurrence、4 条完成）——有真实历史数据但因排期规则过期实际已停止生成新排期；②`62bf9f02`（created 07-17，timeType=dateRange 却带 schedulePattern=singleDate，当天创建当天标记完成，无 occurrence 行）；③`774aa7b3`（created 07-18 今天，recurring/dateRangeDaily，1 条 occurrence 已完成，配置最规范）；④`b5a5ddbb`（created 07-17，1 分钟后即被软删，已是历史，无需处理）。诊断：用户可能因①的排期规则过期导致任务在"今日"视图消失，误以为任务丢失而重建，重建时 timeType 选择不一致（dateRange vs recurring）又再次重建。处置建议见本次会话报告，未执行删除，等待确认。

- 打卡收尾三件事：
  1. 存量起点回填（走 repository.update 同步云端，本地+云端双核对）：16baeb12"阅读"→ 2026-06-26、58054fec"五年级课内课外背诵"→ 2026-07-02。效果：阅读 6/26 前、背诵 7/1 全部转灰（历史欠账豁免）；阅读 7/1 的红点保留——它在起点之后、当天排期未完成，属真实漏卡非欠账。
  2. 休息日语义改为"免罚而非不计"：完成判定优先于休息日——休息日做完了判 done 并计入连续，没做才是 off（不算漏卡、连续穿过）。改 getHabitCalendars 判定顺序与 computeItemStreak，TASK_08 文档 §4/§6 与数据层注释同步，新增测试 4b（休息日完成→done+连续 4；休息日未完成→off 穿过），30 例全绿。
  3. style.md rose 功能色条目修正：删去已废弃的"单项格子红叉"描述，改为仅月历漏卡圆点与图例。
- 统计页打卡重构 · 三步完成总记录（规划内重构，便于回溯）：
  最终形态 = **习惯打卡：若干项目各自一张月历、各自独立计连续**，入口只在统计页「管理打卡项目」；起点规则（勾选当天为 streakStartDate、起点前不计漏卡、取消保留、重勾更新）；月历三态 done/missed/off；休息日灰显穿过。总连续/复活卡/徽章/每日覆盖/周完成率/学科对比整体废弃（口径混乱、真实使用不需要）。
  - 第 1 步数据层：新三函数 + 物理删除废弃口径（commit 8e7c56b）；
  - 第 2 步 UI 重写：HabitSection 按项目月历卡，删 StreakPanel 与表单勾选（commit b8fc648）；
  - 第 3 步文档归位：TASK_08_stats.md 重写为最终规格、PROJECT_GUIDE §3/§10/§13 同步现状（本条）。
- 统计页打卡重构（规划内 · 第 2 步 UI 整体重写）：统计页三块——打卡区 / 课程节数统计 / 更多设置。
  1. 新增 `HabitSection.tsx`：顶部「打卡」+「管理打卡项目」「休息日」两入口；每个打卡项目一张月历卡（分类兜底显示名 + 🔥当前连续 + 月份切换 + 周一起始月历网格，绿=完成/红=漏卡/灰=off，图例三种）；所有卡片共享同一当前月份，切月同步。空状态提示"还没有打卡项目，勾选几个每天要做的任务吧"。管理弹窗用 getHabitCandidates + setHabitEnabled 即时生效；休息日弹窗用 getRestDays + toggleRestDay，休息日在月历显示为灰。
  2. `statsRepository` 的 getHabitCandidates/getHabitCalendars 标题改用 taskShortName（分类兜底显示名），顺带修好空标题任务（如游泳课）显示为"(无标题)"的问题。
  3. 物理删除：StreakPanel.tsx（含旧总连续/复活卡/徽章/总月历/7天格子/调整今日打卡项/周完成率/学科对比占位）。任务表单移除"计入打卡"勾选框（打卡项目入口只在统计页）。
  4. 真实验证：勾选钢琴练习→月历卡即时出现；切月三卡同步到 6 月；标记 07-15 休息日→该日月历转灰（missed→off）且连续穿过；取消钢琴练习→卡消失。手机 375px / 平板 768px 布局完好。测试用生产数据已复原（回到原 2 项、休息日清空）。npm test 29 例全绿，tsc 通过。
- 统计页打卡重构（规划内 · 第 1 步数据层）：目标形态冻结为「打卡 = 若干项目各自一张月历」。
  1. 新增 `getHabitCandidates()`（活跃重复类任务 + 是否已勾选）、`setHabitEnabled(taskId, enabled)`（走 getRepository().update 同步云端）、`getHabitCalendars(month)`（各勾选项目该月逐日 done/missed/off + 单项 currentStreak）。
  2. 物理删除废弃功能：getStreakData、复活卡全套（applyReviveCard/发卡/accrueReviveCards）、每日覆盖（getDailyCheckItems/setDailyCheckOverride）、getWeekCompletionRate、getSubjectComparison、getPerItemStreaks 及其专用辅助；appSettingsRepository 的复活卡/覆盖读写与类型一并删除（app_settings 云端历史数据不清理、代码不再读写）。保留 getRestDays/toggleRestDay。
  3. `taskRepository.update` 调整：取消勾选"计入打卡"时保留 streakStartDate（历史月历可回看），仅勾选/重勾时写为当天。
  4. 统计页 UI 由下一轮整体重写；本轮 StreakPanel 降为占位、WeekStatsPanel 空组件，仅保编译与页面不崩。
  5. 测试重写：删除废弃功能用例，新增 getHabitCandidates/setHabitEnabled/getHabitCalendars（起点前 off、漏卡 missed、休息日 off、未来 off、跨月切换、单项连续、隔日排期穿过），保留 occurrence completedAt 写入与 toggleRestDay。用例总数 45→29（下降为预期），tsc 通过。
  - 存量待确认（本轮未执行）：① 2 条已勾 enableStreak 但无 streakStartDate 的任务待回填起点；② 空标题游泳课任务 6e02cf39 待定处置。详见本次会话报告。
- 跨设备同步健壮性修复（根因：Realtime 断连不重连 + 无定时兜底 + create 上传失败静默）：
  1. Realtime 断连自动重订阅（`realtimeSync.ts`）：CHANNEL_ERROR/TIMED_OUT/CLOSED 不再只 console.warn，改为指数退避重订阅（2/4/8/16→30s 封顶，持续重试）；重订阅前刷新 JWT、拆除旧频道防泄漏，用频道世代（epoch）作废陈旧回调避免 CLOSED 触发重连风暴；重订阅成功照旧补一次全量拉取。
  2. 定时兜底拉取：每 3 分钟触发一次 refreshFromCloud（共用现有 10 秒节流器，与 Realtime/前台事件不叠加），页面不可见时跳过、恢复可见由 visibilitychange 即时拉。
  3. create/update 上传失败纳入黄标：`create`/`update` 改为返回 `{ task, synced }`（本地模式恒 true），App.saveTask 检查 synced——成功才提示"已添加/已更新"，失败则 markUnsynced 挂黄标（复用打钩失败的重试入口），不再无条件误报"已添加"。
  - 数据层返回签名变更连带：taskRepository/cloudRepository 的 create/update 返回 TaskWriteResult；测试中捕获返回值处做纯解构适配（`const t =` → `const { task: t } =`），断言零改动，45 例全绿。
  - 真实验证：① 拦截 tasks 上传制造失败 → 新建任务挂黄标+失败提示，恢复网络点重试 → 清标且云端确认收到；② 强制断开 realtime socket 期间往云端插任务 → 退避重订阅后自动补拉恢复（日志见"订阅异常…安排重订阅"），重连后新插入经 realtime 即时送达证稳态干净；③ 页面前台不动、远端插入 → 经 realtime/兜底拉取自动出现，无需手动刷新。tsc 通过。
- 打卡"历史欠账"修复——新增打卡生效起点：
  1. Task 新增 `streakStartDate`（本地日 YYYY-MM-DD）：update/create 里 enableStreak 从关到开自动写当天、从开到关自动清除，用户不手填、表单不暴露。
  2. 应做日判定统一在 requiredItemsFor 入口截断：早于该任务 streakStartDate 的日期一律非应做（off 穿过，不算漏卡不算打卡），总打卡/单项连续/每日打卡项/补卡校验全部生效；无起点的存量任务暂不截断，待确认后修复。
  3. 云端加列 `streak_start_date`（date），三条映射链路补齐；迁移脚本 `docs/supabase-migration-streak-start.sql`（需在 Supabase SQL Editor 执行，勾选/取消"计入打卡"的上传依赖它）。
  4. 测试 45（7/1 创建 7/18 勾选 → 之前 17 天全 off、起点后正常判定、总打卡无历史漏卡）、46（勾选写起点/取消清除/重勾更新/新建即勾选），现有 43 例未改动，共 45 例全绿。
  5. 存量扫描：2 个真实任务缺起点（无标题 16baeb12、五年级课内课外背诵 58054fec），兜底方案待确认后执行。
- 统计页打卡体验重构：
  1. 数据层新增 `getPerItemStreaks()`：每个 enableStreak 活跃任务的单项连续天数 + 最近 7 个自然日状态（done/missed/off）。应做日与总打卡同源（requiredItemsFor，含当日手动覆盖），休息日跳过、总打卡复活卡补卡日对所有项视同完成、非应做日穿过不断、今天未完成不算断。测试 42-44（单项正确、断卡互不影响、隔日排期穿过），现有 40 例未改动，共 43 例全绿。
  2. 统计页重组为两个区：打卡区（分组容器 border-mint bg-mint/40：总连续卡片 + 我的打卡项目七日格子列表 + 打卡月历 + 徽章）与"任务统计"区（周完成率、学科对比、课程节数统计，样式不变）。
  3. 总卡片文案修正：无打卡项目显示"还没有打卡项目，去任务里勾选「计入打卡」"；有项目按三态显示（今日打卡完成 / 还差 N 项 / 今日无需打卡）。
  4. 月历漏卡日红色标出（missedDays，rose 系，style.md §功能色已补规则）；新增「调整今日打卡项」弹窗（getDailyCheckItems/setDailyCheckOverride，可临时增减今天的打卡项）。
  5. 真实验证：造计算/听写/钢琴三个每日打卡任务，完成 2 个 → 单项各 🔥1/钢琴 0、总打卡"还差 N 项"、月历今日红圈；经调整弹窗移出其他项后完成第 3 个 → 总打卡 +1、"今日打卡完成"、今日转绿；被移出项的当天格子正确转灰。手机/平板双尺寸无破版，测试数据已清理复原。
- 打卡判定改为三态"应做全清"制（数据层）：
  1. 打卡日 = 当天所有应做打卡项全部完成。应做项 = 当天排期到的 enableStreak 任务（occurrence 类 scheduleOccursOn、非 occurrence 类日期字段落当天；单日/整体 cancelled 剔除）；应做为 0 = "无需打卡"，与休息日同等被连续性跳过。完成归因沿用 toLocalDateKey（非 occurrence 类完成日 ≤ 当天视为满足；occurrence 类看当天行 status=done）。
  2. 新增每日打卡项手动覆盖：app_settings `stats_daily_overrides`（整包 jsonb，{日期: {added, removed}}，无键即走默认；选整包因覆盖低频、整存整取复用现有泛型、免范围查询）。新函数 `getDailyCheckItems(date)`（应做项+完成状态+source，UI 勾选数据源）、`setDailyCheckOverride(date, {added, removed})`（去重、added/removed 交集互抵、两空删键）。
  3. `applyReviveCard` 补卡对象收紧为真实漏卡日（已打卡/无需打卡均拒绝不耗卡）；StreakData 新增 missedDays 供补卡候选；顺手修复上轮 bug——applyReviveCard 保存时丢失 grantedMilestones 会导致重复发卡。
  4. 取消勾选完成音效：移除 App 调用与设置开关，删除 `lib/completionSound.ts`。
  5. 测试 40 例全绿。旧用例调整 3 处并注明理由：21（打卡日语义从"完成归因日"改"应做全清"，排期与归因对齐，UTC+8 边界保护不变）、23/34（无排期日不再可补卡，补卡对象改为造出的真实漏卡日）；新增 35-38（部分完成不打卡/全清打卡、空日穿透、覆盖 removed/added 双向、空日+休息日混合且休息日优先于漏卡）。
- TASK_08 统计功能 UI 层：
  1. 统计页新增 `StreakPanel`（打卡卡片+鼓励语分档、打卡月历三色标记可切月、本周完成率进度条、学科对比条形图复用 MAIN_CATEGORY_META 色板、六档坚持徽章），数据全部来自 statsRepository，UI 不做聚合。
  2. 复活卡流程：断卡且 3 天内有可补日期时出现申请入口，确认框显示补卡日期与余额，家长长按 2 秒确认后调 applyReviveCard，错误 message 直接 toast。
  3. 发卡逻辑加在 statsRepository（非 UI）：连续每满 7 天自动 +1 张、持有上限 2，grantedMilestones 里程碑记账保证幂等（测试 32-34）。
  4. 任务表单"更多设置"新增"计入打卡"勾选（enableStreak）。
  5. 完成音效：`lib/completionSound.ts` Web Audio 合成双音，在用户手势内（await 前）触发以适配 iPad Safari 自动播放限制；统计页更多设置加开关，默认开。
  6. 顺手补数据层缺口：create 直接以 done 新建时补齐 completedAt（与 update 同规则，测试 17b）。
  - npm test 36 例全绿；浏览器真实验证：造打卡任务验证连续数/月历、休息日跳过、复活卡长按补卡全流程、手机/桌面双尺寸布局，测试数据已清理并恢复设置原值。
- TASK_08 统计功能数据层（本轮不做 UI）：
  1. 新建 `statsRepository.ts`：getStreakData（连续打卡/历史最长/日历数据）、getWeekCompletionRate、getSubjectComparison、applyReviveCard、getRestDays/toggleRestDay。严守 R1 权威源直读（不用 getTasksForDate 展示口径），join 前过 isActiveTask，日期归因全走 toLocalDateKey。
  2. Task 新增 `enableStreak` 字段（独立云端列 enable_streak，见 `docs/supabase-migration-stats.sql`；迁移前前端不写该列，同步安全）。
  3. occurrence 行新增 `completedAt`：setOccurrence/toggleChecklistItem 转 done 写入、退出 done 清除，云端上传/下载/拉取三条链路补齐 completed_at 映射（该列 schema 本就存在，此前恒写 null）。
  4. 休息日（stats_rest_days）与复活卡（stats_revive_cards）存 app_settings，appSettingsRepository 抽出通用 loadJsonSetting/saveJsonSetting。
  5. 新增测试 13 例（编号 19-31）：跨月连续、休息日跳过、复活卡（时限内/外/余额/重复/休息日/已打卡）、UTC+8 午夜归因（本体+occurrence 双路径）、cancelled 双层剔除、软删不计、rate=null 语义、学科聚合、occurrence completedAt 写入路径、休息日切换。npm test 32 例全绿。
  - 表单勾选项、复活卡审批流、发卡逻辑列入 PROJECT_GUIDE 第 13 节下一轮 UI 清单。

## 2026-07-17

- 清洗②类脏数据（status=done 但 completedAt 空）9 条，通过页面运行中的真实 `getRepository()`（云端模式，逐条 `update()`）写入，不绕过 R1/sanitizeTaskWrite/LWW 防线：
  1. 6 条活跃 + 1 条软删（e8aafc23）singleDate 任务：因 updatedAt 已被一次无关批量操作污染成 96/97 条相同时间戳、不可作为完成时间代理，改用各自 `date` 字段（本地正午）补 completedAt。
  2. fa839e8c「FCE精讲」（recurring/occurrence 类，已软删）：body status=done 本身违反 R1，未套用通用补 completedAt 规则，改为按 R1 把 status 修回 todo，completedAt 保持空。
  3. e86f8615（已软删，①类：status=todo 但 completedAt 有值）：超出原计划的②类范围，一并清空 completedAt 使其与 status 一致。
  - 复查：本地 IndexedDB 和云端 Supabase 双扫，①②两类均归零（云端 97 条任务，本地/云端一致）。
- 代码审查修复 4 项（P0-1/P0-2/P1-7/P1-8）：
  1. `taskRepository.update` 联动维护 completedAt：status 改 done 补 completedAt=now，从 done 退出清除，堵住"done 无 completedAt / todo 带残留 completedAt"两类脏数据源。
  2. `copyToDate` 重置名单补全 completedAt、actualMinutes（含小项级），并改为过 sanitizeTaskWrite 落库，消除裸写入口。
  3. 新增 `toLocalDateKey`（utils/date.ts）：timestamp→本地日期键统一入口；替换 2 处 UTC 截断（taskRepository dateRange 完成日截断、StatsPage 备份文件名）。cloudUpload/cloudRepository 的 toDateOrNull 是 date 字段防御清洗，不属 timestamp 截断，未动。
  4. `syncParentCompletion` 开头加 isOccurrenceSchedule(parent) 早退（R1 防线）。
  - 新增回归用例 16-18（update completedAt 双向、copyToDate 重置、toLocalDateKey UTC+8 边界），npm test 19 例全绿。
  - 其余审查遗留 P1×4、P2×2 已记入 PROJECT_GUIDE 第 13 节待办（含文件行号）。
- 建立数据层回归测试（Vitest + fake-indexeddb，云端交互全 mock，不碰真实 Supabase）：
  1. 15 个用例锁住 6.5 节铁律：R1 权威源三例、R2 occurrence patch、R3 展示字段白名单清洗、R4 overdue 派生态、R5 LWW 合并两例 + remove 软删级联 + allocateTask 重排软删、R6 dateRange 整体语义、checklist 联动两例、父子任务联动，以及 cloudUpload occurrence 上传过滤（A 类违规行不上传，变异验证：注释过滤逻辑测试即红）。
  2. `cloudRepository.ts` 导出 lwwMerge 供测试；`package.json` 新增 `npm test`（vitest run）。
  3. PROJECT_GUIDE 开工必读新增硬性门槛：提交前必须 `npm test` 通过，不允许删用例放行。
- 物理删除遗留问题处置（occurrence 表无 deleted_at 列，物理删除不跨设备传播）：
  1. 上传防线：`cloudUpload.ts` 上传 occurrence 行时跳过 A 类违规行（挂在非 occurrence 类任务或已软删任务名下），防止本地脏残留复活到云端，跳过条数在上传结果中展示。
  2. 维护面板新增「对账清理本地缓存」（`cloudCleanup.ts` + `CloudLoginPanel.tsx`）：按云端 occurrence 全量 id 对账，删除本地多出的行；只动本地，执行前弹确认框显示条数；最近 10 分钟内更新的行跳过防误删（可能是尚未同步的新写入）。
  3. `PROJECT_GUIDE.md`：6.5 节补注"删除一律软删对 occurrence 表暂无法执行，维护性物理删除须先经用户确认"；新增第 13 节待办清单，记录 deleted_at 列缺失 / 墓碑机制的技术债。
  - 真实验证：本地造违规 occurrence 行 → 点上传，云端确认未上传（跳过 1 条）；点对账清理，确认框显示 1 条、删除后本地恢复 108 条与云端一致；10 分钟窗口内的新行确认被跳过不删。
- 月历修复：dateRange 任务完成后，月历仍显示完整日期区间（今日页保持"完成日之后不再出现"）。修复"泰国旅游在月计划只显示一天"。`taskRepository.ts` 的 getTasksForDate 对 forCalendar 放开 completedAt 截断。
- A 类脏数据清洗（云端 Supabase + 本地 IndexedDB 同步执行，扫描确认归零）：
  1. 奥数作业（9d1cf897）、大增课后作业 6/20-6/26（ee333bde）：本体置 done（completedAt 取最后一次完成时间），删除名下共 13 条违规 occurrence。
  2. 二轮扫描再清 18 条：已软删任务（FCE精讲、FCE听力单词听写等）的孤儿 occurrence 10 条；dateRange/singleDate 任务名下违规 occurrence 8 条。其中大增课后作业 6/27-7/3（b284c860）有 7/3 完成记录且周期已过，本体一并置 done。
  3. 清洗后扫描结果：云端与本地均为 tasks 95 / occurrences 108，A1（非 occurrence 类任务名下的 occurrence）= 0，A2（occurrence 类任务本体状态违规）= 0。

## 2026-07-05

- （补记）完成状态数据层三处根因修复：写入端 R1/R2/R3 防线（sanitizeTaskWrite 白名单清洗、occurrence patch 语义、展示字段不落库）。
- （补记）云端拉取加 LWW 保护（R5）：`cloudRepository.ts` 新增 lwwMerge，自动同步路径按 updatedAt 比较，防止本地未同步的完成状态被云端旧值回滚；手动"从云端下载"仍为强制覆盖。
- （补记）allocateTask 重排子任务改为软删除（R5）：`taskRepository.ts` 写 deletedAt 代替物理删除，云端同步软删标记，防止旧子任务复活。
- （补记）checklist 保存后重算任务完成状态。
- （补记）对齐 dateRange 整体任务语义（R6）："一件事，在这段日期内做完"，状态在本体，不产生 occurrence。

## 2026-07-04

- （补记）取消周计划，打印/备份页改造为统计页。
- （补记）子任务全部完成时父任务自动完成；事项/上课任务默认在月计划中显示。
- （补记）完成状态写入加即时重试与持续可见的未同步标记；重复类任务接上 rolloverMode 的 carryOver 顺延逻辑。
- （补记）恢复偏好时让 recurrence 频率跟随 schedulePattern。

## 2026-07-03

- Fable 5代码审查修复：按代码审查清单修复 8 项已知问题。
  1. 批量删除绕过云端同步：`TaskManagementPage.tsx` 的批量删除改为走 `getRepository().batchRemove`。
  2. 删除父任务时子任务未同步云端：`cloudRepository.ts` 的 `remove`/`batchRemove` 补充级联子任务的 upsert（写入 `deleted_at`）。
  3. checklist 更新先删后插有丢数据风险：`cloudRepository.ts` 改为按 id upsert + id 差集删除旧项。
  4. 完成任务时孤儿计时器：`TaskItem.tsx` 勾选完成前自动 stop 正在运行的计时器并保存实际用时。
  5. enableTimer 默认值不统一：`TaskItem.tsx`/`TaskForm.tsx` 统一为 `enableTimer === true`（未设置=默认关）。
  6. 云端写失败静默吞掉：`cloudRepository.ts` 三处及 `appSettingsRepository.ts` 的 upsert 改为调用 `notifySyncError` 提示用户。
  7. 维护工具缺字段：`cloudUpload.ts`/`cloudDownload.ts`/`cloudRead.ts` 补齐 `enableTimer`、`actual_minutes`、checklist 的 `estimated_minutes`/`actual_minutes`。
  8. 今日页死代码：`DayPage.tsx` 删除未使用的 `weekSummary`/`monthSummary` state 及 `getWeekOverview`/`getMonthOverview` 调用。
  - 涉及文件：`src/pages/TaskManagementPage.tsx`、`src/data/cloudRepository.ts`、`src/components/TaskItem.tsx`、`src/components/TaskForm.tsx`、`src/data/appSettingsRepository.ts`、`src/lib/cloudUpload.ts`、`src/lib/cloudDownload.ts`、`src/lib/cloudRead.ts`、`src/pages/DayPage.tsx`。

## 2026-06-24

- 新增 iPad 主屏幕图标与 PWA manifest 配置，方便通过 Safari 添加到主屏幕作为“小步计划”入口。

- Supabase Step 6：实现云端优先正式同步模式。新增 `src/data/cloudRepository.ts`（云端读写 + 本地缓存）和 `src/data/repositoryProvider.ts`（按登录状态选择数据源）。修改 `App.tsx` 在启动时初始化云同步并自动拉取最新数据；新增任务/编辑/删除/完成/checklist/occurrence/planPeriods 均写入 Supabase。未登录时降级到 IndexedDB 本地模式。在顶栏展示"云端同步/本地模式"状态标签，在云同步面板展示当前数据模式说明。
- 云端工具诊断：新增“检查本地/云端差异”功能，读取本地 IndexedDB 和 Supabase 的任务列表对比并显示多出项目的详细信息（包含删除状态、标题等），不对任何数据进行增删改，辅助安全排查云同步中多出的本地残留任务。
- Supabase Step 5：新增从云端下载数据到本地。在 `src/lib/cloudDownload.ts` 中实现按 `family_id` 读取 Supabase 数据并安全合并（bulkPut）到本地 IndexedDB 中，包括 `tasks`、`task_checklist_items`、`task_occurrence_statuses`、`plan_periods`。在云同步面板新增了下载按钮和进度/结果展示。
- Supabase Step 4：新增云端读取预览。在 `src/lib/cloudRead.ts` 中实现按 `family_id` 读取 `tasks`、`task_checklist_items`、`task_occurrence_statuses`、`plan_periods`。在云同步面板提供读取结果预览，对比本地与云端数据量，并展示最近 5 条任务作为数据完整性抽查。本轮不切换正式页面数据源。
- 修复 Supabase 上传 activity_logs 报错（permission denied）：Step 3 第一阶段上传暂时跳过 activity_logs，避免追加型日志表因 upsert 触发 update 权限需求；核心任务、清单小项、单次状态和假期阶段仍正常上传。
- 修复 Supabase 上传 tasks 失败（not-null constraint）：为本地旧数据补齐必填字段的默认兜底值（如 `calendar_visibility` 默认 "show"，`title` 默认 ""，`status` 默认 "todo" 等），避免因旧数据字段缺失导致插入失败。
- 修复 Supabase 上传失败：新增 date 和 timestamp 字段清洗，过滤掉空字符串 `""`，避免 PostgreSQL 报错。对于无效的必填日期自动跳过并统计。
- 优化云同步面板：上传按钮始终可见，在未登录时明确显示"请先登录"，避免依赖 hover，按钮使用高对比度颜色并增加禁用状态。
- Supabase Step 3：新增 `src/lib/cloudUpload.ts`，实现本地 IndexedDB → Supabase 单向上传（tasks、task_checklist_items、task_occurrence_statuses、plan_periods、activity_logs），使用分批 upsert，支持重复上传不重复生成记录；云同步面板新增"上传本地数据到云端"按钮及上传统计/错误反馈。
- 云同步面板默认隐藏完整 family_id，仅作为高级调试信息展示。
- Supabase schema 补充 authenticated 角色的表权限 GRANT，避免前端插入 families/profiles 时 permission denied。
- 修复 Supabase family/profile 初始化卡死问题：避免 insert family 后使用 `.select().single()` 触发 RLS 拦截，改为在前端生成 `familyId` (使用 `crypto.randomUUID()`) 并直接写入。增加错误捕获与页面提示。
- 接入 Supabase 前端最小闭环（Step 2）：新增 Supabase client（`src/lib/supabase.ts`）、邮箱+密码登录/退出（`src/lib/cloudAuth.ts`）、family/profile 自动初始化和云同步状态面板（`src/components/CloudLoginPanel.tsx`）；任务数据仍保持 IndexedDB 本地模式。
- 修复 Supabase SQL 执行顺序：将 get_my_family_id() 移动到 profiles 表创建之后，避免首次执行时 public.profiles does not exist。
- 修复 Supabase SQL 草案的首个家庭账号初始化问题：调整 families/profiles RLS，避免 get_my_family_id 初始化死锁，补充 search_path 和必要索引。
- 新增 Supabase 同步第一阶段 SQL 草案与实施说明：包含 families、profiles、tasks、task_checklist_items、task_occurrence_statuses、plan_periods、activity_logs、app_settings 表及基础 RLS 策略（`docs/supabase-schema.sql`、`docs/supabase-sync-implementation-plan.md`）。
- 修复 recurring 任务假期自动归属逻辑：每周/每日重复任务若有明确结束日期且完整落入同一假期，自动绑定该假期；长期重复任务仍不自动归属。
- 新增任务表单根据日期自动推断假期归属：单日、指定日期列表、完整日期范围落入同一假期时自动绑定假期，跨阶段或长期任务保留手动选择。
- 修复课程类任务误进入 weeklyQuota 月统计分支，FCE 精讲本月计划按自然月实际课程次数统计。

- 新增修改：
  1. 统一周计划和月历页面的顶部导航样式与今日页的横向白色圆角导航条一致。
  2. 调整本周和本月计划中每个分组的项目排序，已完成项目排序到下方。
  3. 任务管理页面默认进入“当前阶段”。
  4. 修复本月计划统计口径以自然月边界统计，解决 FCE精讲等课程统计多算一节的问题。
- 新增修改：
  1. 调整新建任务时“课外 -> 其他”分类下，“阅读”内容类型在下拉框中排在“其他”前面。
  2. 调整今日清单中任务备注的显示位置为大标题后方（微弱样式行内显示）。
  3. 将“阅读”内容类型任务纳入本周和本月计划统计口径中，并分类在“其他”栏下；本月计划新增“听写”任务显示。
- 修改 1：今日清单及已完成区域备注直接显示（"备注：..."），不再折叠在"查看备注"里；顺延/延期信息保留独立显示。
- 修改 2：课外·其他的内容类型中新增"阅读"；仅在二级类型为"其他"时显示该选项；标题可选；显示不重复"阅读 - 阅读"。
- 修改 3：本周计划汇总只显示上课类任务和多日/日期范围大作业，排除阅读、钢琴练习、事项、单日普通作业。
- 修改 4：复制到日期弹窗默认日期改为当前任务日期的第二天（若无则明天）。

## 2026-06-22

- 新增项目规则文档、当前状态文档、Codex 使用说明文档，用于减少后续 Codex 提示词长度。
