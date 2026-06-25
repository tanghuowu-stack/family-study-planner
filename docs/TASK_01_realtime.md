# TASK_01 · 实时自动同步（Supabase Realtime）

> **推荐模型：Opus**（涉及数据流改造、并发与边界处理，一次做对省返工）
> **前置依赖：无**（可立即开始，是最优先任务）
> **先读**：`PROJECT_GUIDE.md`，再读本卡。

---

## 目标

把当前的"刷新级同步"升级为"自动同步"：
- Mac 改动后，iPad 在打开状态下**自动**收到更新，无需手动刷新。
- iPad PWA 从后台回到前台时，**自动**拉取最新数据。
- 登录后**立即**进入云端模式，不需要关 App 再开。

---

## 现状（不要重复造轮子）

已完成：登录、family/profile 初始化、云端读写（增删改、勾选、小项、单次状态、假期）、cloud-first repository。当前同步靠手动刷新或重开。`cloudRepository` 已有从云端拉取数据的能力（确认现有方法名，如 `refreshFromCloud()` 之类，按实际代码为准）。

---

## 要做的事

### 1. Supabase 后台配置
- 到 Database → Replication，把这 4 张表加入 realtime publication：
  `tasks`、`task_checklist_items`、`task_occurrence_statuses`、`plan_periods`。
- 确认 RLS 不会挡住 realtime 推送（Realtime 同样受 RLS 约束，登录用户只应收到自己 family_id 的变更）。

### 2. 前端订阅
- 登录进入云端模式后，建立一个 Realtime channel，用 `postgres_changes` 监听上述 4 张表的 `INSERT` / `UPDATE` / `DELETE`。
- 收到事件后，触发本地数据刷新（调用 cloudRepository 现有的拉取方法）+ 页面重渲染。**优先做最简单可靠的"收到事件→拉一次最新数据"，不要一上来就做按 payload 增量 patch**（增量 patch 容易和软删除、单次状态的组装逻辑冲突）。

### 3. iPad PWA 回前台自动拉取
- 监听 `visibilitychange`（变为 visible 时）、`focus`、`online` 事件，自动拉取最新云端数据。
- 这是对 Realtime 的兜底：PWA 在后台时 WebSocket 可能已断，回前台必须主动拉一次。

### 4. 防抖与去重（重要）
- **防抖合并**：500–1000ms 内的多次事件合并成一次刷新，避免批量改动时疯狂重渲染。
- **前台刷新节流**：10 秒内不重复因前台/focus 触发整页刷新。
- **断线重连**：WebSocket 断开重连后，必须先做一次全量拉取（补回断线期间错过的变更），不能只依赖后续推送。
- **避免自己改的回声**：本地乐观更新后，自己的变更也会通过 Realtime 推回来。确保"收到事件→拉云端数据"是幂等的（重复拉同样数据不出问题），这样即使收到自己的回声也无害。

---

## 不要做

- 不要新增首页"刷新按钮"作为日常入口（打印备份页的维护按钮保留即可）。
- 不要在这个任务里做多设备实时冲突合并（家庭场景同改同一条概率极低）。若必须有规则，用"最后写入时间为准"，复用现有 updated_at，不要新建复杂合并逻辑。
- 不要动 UI 布局。

---

## 验收标准

1. Mac 新增/改/删任务，iPad 在打开状态下 1–2 秒内自动出现变化，**没点任何按钮**。
2. iPad 勾选完成，Mac 打开状态下自动看到。
3. iPad PWA 切后台一会儿再回前台，自动显示最新数据。
4. 断网再恢复后，数据能自动对齐云端，不丢变更。
5. 批量改动时不会疯狂闪烁（防抖生效）。
6. 控制台无重复订阅、无内存泄漏（组件卸载时正确 `removeChannel` / `unsubscribe`）。

---

## 给 Claude Code 的开场提示（复制即可）

```
读 PROJECT_GUIDE.md 和 TASK_01_realtime.md。
先查看 cloudRepository.ts 和 App.tsx 里现有的云端拉取方法和登录后初始化流程，
告诉我你打算在哪里建立 Realtime 订阅、怎么接防抖，再动手。
先实现"收到事件→拉一次最新数据"的最简版本，不要做增量 patch。
```
