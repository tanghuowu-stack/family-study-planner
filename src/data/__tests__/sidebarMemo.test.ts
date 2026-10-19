import { beforeEach, describe, expect, it } from "vitest";
import {
  latestSidebarMemoSetting,
  loadSidebarMemo,
  normalizeSidebarMemoSetting,
  saveSidebarMemo,
} from "../appSettingsRepository";

const memory = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
};

beforeEach(() => memory.clear());

describe("sidebar memo settings", () => {
  it("saves, reloads, and clears the memo in local mode", async () => {
    await saveSidebarMemo("明天带英语课本");
    expect(await loadSidebarMemo()).toBe("明天带英语课本");
    await saveSidebarMemo("");
    expect(await loadSidebarMemo()).toBe("");
  });

  it("keeps a newer local edit when an older cloud value arrives", () => {
    const local = { text: "正在输入的新内容", updatedAt: "2026-10-19T10:00:00.000Z" };
    const remote = { text: "云端旧内容", updatedAt: "2026-10-19T09:59:00.000Z" };
    expect(latestSidebarMemoSetting(local, remote)).toEqual(local);
    expect(latestSidebarMemoSetting(remote, local)).toEqual(local);
  });

  it("accepts a legacy plain-string value without showing an error", () => {
    expect(normalizeSidebarMemoSetting("旧备忘录")).toEqual({ text: "旧备忘录", updatedAt: "" });
    expect(normalizeSidebarMemoSetting(null)).toEqual({ text: "", updatedAt: "" });
  });
});
