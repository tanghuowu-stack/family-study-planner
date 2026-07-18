/**
 * StreakPanel（占位）
 *
 * 2026-07-18 打卡数据层重构：旧的总连续/复活卡/徽章/每日覆盖/周完成率/学科对比
 * 已废弃删除。统计页 UI（打卡项目各自一张月历 + 管理打卡项目 + 休息日）由下一轮
 * 整体重写，本轮仅保留占位以保证编译与页面不崩。
 */
export function StreakPanel() {
  return (
    <section className="mt-5 rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      <p className="text-sm text-muted">打卡月历正在重构，稍后回来看看～</p>
    </section>
  );
}

/** 周完成率/学科对比已废弃，占位空组件待下一轮移除 */
export function WeekStatsPanel() {
  return null;
}
