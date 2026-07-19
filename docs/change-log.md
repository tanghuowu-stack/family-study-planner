# 项目变更记录

此文件只记录简短变更摘要。以后每次完成项目修改后，在顶部日期下追加一条记录，不需要复制完整需求或实现细节。

## 2026-07-19

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
