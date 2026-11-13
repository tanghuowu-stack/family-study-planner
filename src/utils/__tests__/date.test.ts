/**
 * toLocalDateKey 时区边界回归（2026-07-17 审查修复 P1-7）：
 * timestamp 转日期键必须按本地时区，不能 slice(0,10) 按 UTC 截断。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
import { describe, expect, it } from "vitest";
import { RETURN_TO_TODAY_AFTER_HIDDEN_MS, relativeDayLabel, shouldReturnToToday, toLocalDateKey } from "../date";

describe("toLocalDateKey（本地时区 UTC+8）", () => {
  it("18. UTC 前一天 16:30（本地当天 0:30）应归本地当天，而非 UTC 截断的前一天", () => {
    expect(toLocalDateKey("2026-07-16T16:30:00.000Z")).toBe("2026-07-17");
    expect("2026-07-16T16:30:00.000Z".slice(0, 10)).toBe("2026-07-16");
  });

  it("同日午间时间戳归当天，跨日边界 15:59/16:00 分界正确", () => {
    expect(toLocalDateKey("2026-07-17T04:00:00.000Z")).toBe("2026-07-17");
    expect(toLocalDateKey("2026-07-17T15:59:59.000Z")).toBe("2026-07-17");
    expect(toLocalDateKey("2026-07-17T16:00:00.000Z")).toBe("2026-07-18");
  });
});

describe("relativeDayLabel（今日页「不是今天」提示条的口语日期）", () => {
  it("今天 / 昨天 / 明天 / 前天 / 后天", () => {
    expect(relativeDayLabel("2026-11-13", "2026-11-13")).toBe("今天");
    expect(relativeDayLabel("2026-11-12", "2026-11-13")).toBe("昨天");
    expect(relativeDayLabel("2026-11-14", "2026-11-13")).toBe("明天");
    expect(relativeDayLabel("2026-11-11", "2026-11-13")).toBe("前天");
    expect(relativeDayLabel("2026-11-15", "2026-11-13")).toBe("后天");
  });

  it("更远的日期按天数，跨月跨年按日历天计算", () => {
    expect(relativeDayLabel("2026-11-06", "2026-11-13")).toBe("7 天前");
    expect(relativeDayLabel("2026-12-01", "2026-11-13")).toBe("18 天后");
    expect(relativeDayLabel("2026-12-31", "2027-01-01")).toBe("昨天");
  });
});

describe("shouldReturnToToday（今日页自动回到今天）", () => {
  it("跨了零点必须回今天，哪怕页面一直在前台", () => {
    expect(shouldReturnToToday("2026-11-12", "2026-11-13", 0)).toBe(true);
  });

  it("同一天内短暂离开不打断：家长翻到明天排作业、切走几分钟再回来仍停在明天", () => {
    expect(shouldReturnToToday("2026-11-13", "2026-11-13", 0)).toBe(false);
    expect(shouldReturnToToday("2026-11-13", "2026-11-13", RETURN_TO_TODAY_AFTER_HIDDEN_MS - 1)).toBe(false);
  });

  it("同一天内在后台放满阈值再回来，回今天", () => {
    expect(shouldReturnToToday("2026-11-13", "2026-11-13", RETURN_TO_TODAY_AFTER_HIDDEN_MS)).toBe(true);
  });
});
