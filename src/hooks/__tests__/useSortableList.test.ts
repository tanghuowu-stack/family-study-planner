/**
 * 拖拽排序的落点与让位计算（useSortableList 的纯函数部分）。
 * 交互本身（指针、动画）没有组件测试基础设施，靠浏览器实测。
 */
import { describe, expect, it } from "vitest";
import { overIndexFor, shiftFor } from "../useSortableList";

// 三行，高 50/80/50，上下紧挨着
const rects = [{ top: 0, height: 50 }, { top: 50, height: 80 }, { top: 130, height: 50 }];

describe("overIndexFor：被拖那一项的中心越过哪几项的中线，就落在第几位", () => {
  it("没动或动得少，留在原位", () => {
    expect(overIndexFor(rects, 0, 0)).toBe(0);
    expect(overIndexFor(rects, 0, 60)).toBe(0); // 中心 85，还没过第二行中线 90
  });
  it("往下拖过第二行中线到第二位，过第三行中线到最后", () => {
    expect(overIndexFor(rects, 0, 70)).toBe(1);
    expect(overIndexFor(rects, 0, 140)).toBe(2);
  });
  it("往上拖：最后一项拖到最前", () => {
    expect(overIndexFor(rects, 2, -50)).toBe(2); // 中心 105，还没过第二行中线 90
    expect(overIndexFor(rects, 2, -70)).toBe(1);
    expect(overIndexFor(rects, 2, -150)).toBe(0);
  });
});

describe("shiftFor：其余各项让出被拖那一项的高度", () => {
  it("往下拖：经过的项上移", () => {
    expect([0, 1, 2].map((i) => shiftFor(i, 0, 2, 50))).toEqual([0, -50, -50]);
  });
  it("往上拖：经过的项下移，没经过的不动", () => {
    expect([0, 1, 2].map((i) => shiftFor(i, 2, 1, 50))).toEqual([0, 50, 0]);
  });
  it("留在原位：都不动", () => {
    expect([0, 1, 2].map((i) => shiftFor(i, 1, 1, 80))).toEqual([0, 0, 0]);
  });
});
