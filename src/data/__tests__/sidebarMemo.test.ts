import { beforeEach, describe, expect, it } from "vitest";
import {
  latestSidebarMemoSetting,
  loadSidebarMemo,
  normalizeSidebarMemoSetting,
  saveSidebarMemo,
  archiveSidebarMemo,
  deleteSidebarMemoHistory,
  loadSidebarMemoState,
  restoreSidebarMemo,
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
    const local = { text: "正在输入的新内容", updatedAt: "2026-10-19T10:00:00.000Z", history: [] };
    const remote = { text: "云端旧内容", updatedAt: "2026-10-19T09:59:00.000Z", history: [] };
    expect(latestSidebarMemoSetting(local, remote)).toEqual(local);
    expect(latestSidebarMemoSetting(remote, local)).toEqual(local);
  });

  it("accepts a legacy plain-string value without showing an error", () => {
    expect(normalizeSidebarMemoSetting("旧备忘录")).toEqual({ text: "旧备忘录", updatedAt: "", history: [] });
    expect(normalizeSidebarMemoSetting(null)).toEqual({ text: "", updatedAt: "", history: [] });
  });

  it("archives the full multiline content with a completion time and clears the current memo", async () => {
    await saveSidebarMemo("课本\n画笔");
    const state = await archiveSidebarMemo("课本\n画笔");
    expect(state.text).toBe("");
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({ text: "课本\n画笔" });
    expect(Date.parse(state.history[0].completedAt)).toBeGreaterThan(0);
    expect(state.history[0].id).toBeTruthy();
    expect(await loadSidebarMemoState()).toEqual(state);
  });

  it("retains exactly the newest 50 records after a 51st completion", async () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({ id: `old-${i}`, text: `历史 ${i}`, completedAt: new Date(Date.UTC(2025, 0, i + 1)).toISOString() }));
    memory.set("app_settings:sidebar_memo", JSON.stringify({ text: "新备忘", updatedAt: "2025-03-01T00:00:00.000Z", history: entries }));
    const state = await archiveSidebarMemo("新备忘");
    expect(state.history).toHaveLength(50);
    expect(state.history[0].text).toBe("新备忘");
    expect(state.history.some((entry) => entry.id === "old-0")).toBe(false);
    expect(state.history.some((entry) => entry.id === "old-49")).toBe(true);
  });

  it("keeps completed history through later autosaves and clearing the current draft", async () => {
    const archived = await archiveSidebarMemo("已完成");
    await saveSidebarMemo("下一条");
    await saveSidebarMemo("");
    expect((await loadSidebarMemoState()).history).toEqual(archived.history);
  });

  it("restores to an empty memo and removes the restored record from history", async () => {
    const archived = await archiveSidebarMemo("还要带水杯");
    const restored = await restoreSidebarMemo(archived.history[0].id);
    expect(restored.text).toBe("还要带水杯");
    expect(restored.history).toEqual([]);
    expect(await loadSidebarMemo()).toBe("还要带水杯");
  });

  it("appends restored text without overwriting an existing memo", async () => {
    const archived = await archiveSidebarMemo("带画笔\n带颜料");
    await saveSidebarMemo("已有：英语课本");
    const restored = await restoreSidebarMemo(archived.history[0].id);
    expect(restored.text).toBe("已有：英语课本\n\n带画笔\n带颜料");
  });

  it("permanently removes only the selected history record and preserves the current text", async () => {
    const first = await archiveSidebarMemo("第一条");
    const second = await archiveSidebarMemo("第二条");
    await saveSidebarMemo("当前内容");
    const state = await deleteSidebarMemoHistory(first.history[0].id);
    expect(state.text).toBe("当前内容");
    expect(state.history).toEqual([second.history[0]]);
    await expect(restoreSidebarMemo(first.history[0].id)).rejects.toThrow("已被恢复或删除");
    await saveSidebarMemo("删除失败后仍可继续输入");
    expect(await loadSidebarMemo()).toBe("删除失败后仍可继续输入");
  });

  it("serializes overlapping completion and autosave without dropping history", async () => {
    await Promise.all([archiveSidebarMemo("一"), archiveSidebarMemo("二"), saveSidebarMemo("三")]);
    const state = await loadSidebarMemoState();
    expect(state.history.map((entry) => entry.text)).toEqual(["二", "一"]);
    expect(state.text).toBe("三");
  });

  it("does not create a history entry for blank content", async () => {
    await archiveSidebarMemo(" \n ");
    expect((await loadSidebarMemoState()).history).toEqual([]);
  });

  it("ignores malformed history entries and deduplicates ids", () => {
    const valid = { id: "valid", text: "课本", completedAt: "2026-10-20T10:00:00.000Z" };
    expect(normalizeSidebarMemoSetting({ text: "草稿", history: [null, {}, valid, valid, { ...valid, id: "bad-date", completedAt: "invalid" }] }).history).toEqual([valid]);
  });
});
