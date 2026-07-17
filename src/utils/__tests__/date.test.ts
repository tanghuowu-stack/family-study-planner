/**
 * toLocalDateKey 时区边界回归（2026-07-17 审查修复 P1-7）：
 * timestamp 转日期键必须按本地时区，不能 slice(0,10) 按 UTC 截断。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
import { describe, expect, it } from "vitest";
import { toLocalDateKey } from "../date";

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
