/** 家长设备判断（docs/TASK_09_points.md §7）：只看 maxTouchPoints，不看 User-Agent */
import { describe, expect, it } from "vitest";
import { isTouchDevice } from "../device";

describe("家长设备判断", () => {
  it("Mac（maxTouchPoints = 0）不是触摸设备 → 有家长功能", () => {
    expect(isTouchDevice({ maxTouchPoints: 0 })).toBe(false);
  });
  it("iPad（即使 Safari 把自己标识成 Mac，maxTouchPoints = 5）、手机是触摸设备 → 没有家长功能", () => {
    expect(isTouchDevice({ maxTouchPoints: 5 })).toBe(true);
    expect(isTouchDevice({ maxTouchPoints: 1 })).toBe(true);
  });
  it("拿不到 navigator 时按非触摸处理", () => {
    expect(isTouchDevice(undefined)).toBe(false);
    expect(isTouchDevice({})).toBe(false);
  });
});
