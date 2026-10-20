import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  remote: null as unknown,
  fail: false,
  upserts: [] as Array<{ family_id: string; key: string; value: unknown }>,
  select: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("../repositoryProvider", () => ({ isCloudMode: () => true }));
vi.mock("../cloudRepository", () => ({ cloudRepository: { getFamilyId: () => "family-test" }, notifySyncError: mock.notify }));
vi.mock("../../lib/supabase", () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => mock.select() }) }) }),
    upsert: async (row: { family_id: string; key: string; value: unknown }) => {
      mock.upserts.push(structuredClone(row));
      if (mock.fail) return { error: new Error("offline") };
      mock.remote = structuredClone(row.value);
      return { error: null };
    },
  }) },
}));

import { archiveSidebarMemo, deleteSidebarMemoHistory, loadSidebarMemoState, restoreSidebarMemo, saveSidebarMemo } from "../appSettingsRepository";

const memory = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
};

beforeEach(() => {
  memory.clear();
  mock.remote = null;
  mock.fail = false;
  mock.upserts = [];
  mock.notify.mockClear();
  mock.select.mockReset().mockImplementation(async () => ({ data: mock.remote ? { value: structuredClone(mock.remote) } : null, error: null }));
});

describe("memo cloud synchronization", () => {
  it("archives and clears in one family-scoped jsonb write, then loads on another device", async () => {
    const archived = await archiveSidebarMemo("带科学课本");
    expect(mock.upserts).toHaveLength(1);
    expect(mock.upserts[0]).toMatchObject({ family_id: "family-test", key: "sidebar_memo", value: { text: "", history: [{ text: "带科学课本" }] } });
    memory.clear(); // 第二台设备没有本地缓存。
    expect(await loadSidebarMemoState()).toEqual(archived);
    await restoreSidebarMemo(archived.history[0].id);
    memory.clear();
    expect(await loadSidebarMemoState()).toMatchObject({ text: "带科学课本", history: [] });
  });

  it("synchronizes permanent deletion and does not revive it from an older cloud snapshot", async () => {
    const archived = await archiveSidebarMemo("待删除的历史");
    const removed = await deleteSidebarMemoHistory(archived.history[0].id);
    expect(removed.history).toEqual([]);
    memory.clear();
    expect((await loadSidebarMemoState()).history).toEqual([]);
    mock.remote = archived;
    expect((await loadSidebarMemoState()).history).toEqual([]);
  });

  it("does not overwrite a newer cache when an in-flight cloud read resolves late", async () => {
    const old = { text: "旧内容", history: [], updatedAt: "2026-10-20T08:00:00.000Z" };
    memory.set("app_settings:sidebar_memo", JSON.stringify(old));
    let finish!: (result: unknown) => void;
    mock.select.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = loadSidebarMemoState();
    const newer = { text: "正在输入的新内容", history: [], updatedAt: "2026-10-20T08:01:00.000Z" };
    memory.set("app_settings:sidebar_memo", JSON.stringify(newer));
    finish({ data: { value: old }, error: null });
    expect(await pending).toEqual(newer);
    expect(JSON.parse(memory.get("app_settings:sidebar_memo")!)).toEqual(newer);
  });

  it("reports cloud failure while keeping the archived text safe in the local cache", async () => {
    mock.fail = true;
    const archived = await archiveSidebarMemo("断网时也不能丢失");
    expect(mock.notify).toHaveBeenCalledWith("备忘录云端同步失败", expect.any(Error));
    expect(JSON.parse(memory.get("app_settings:sidebar_memo")!).history).toEqual(archived.history);
    mock.fail = false;
    await saveSidebarMemo("新草稿");
    memory.clear();
    expect((await loadSidebarMemoState()).history).toEqual(archived.history);
  });
});
