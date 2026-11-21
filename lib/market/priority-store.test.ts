import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { BrowserPriorityStore } from "@/lib/storage/watchlist-priorities";
import { PriorityQueue } from "./priority-queue";
const A = "00000000-0000-4000-8000-000000001711", B = "00000000-0000-4000-8000-000000001712";
describe("account-scoped IndexedDB outbox", () => {
  it("persists across instances, atomically appends from two tabs and isolates accounts", async () => {
    const one = new BrowserPriorityStore(), two = new BrowserPriorityStore();
    await one.update(A, r => ({ ...r, enabled: true, checked: true }));
    const remote = { currentUserId: async () => A, isSyncEnabled: async () => true, read: async () => null, create: async () => null, replace: async () => null };
    let n = 0;const uuid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
    const first = new PriorityQueue(A, remote, one, () => A, () => false, uuid), second = new PriorityQueue(A, remote, two, () => A, () => false, uuid);
    await Promise.all([first.enqueue("eurusd", true), second.enqueue("gold", true)]);
    const saved = await new BrowserPriorityStore().read(A);
    expect(saved.queue).toHaveLength(2);expect(new Set(saved.queue.map(q => q.operation.instrument))).toEqual(new Set(["eurusd", "gold"]));
    expect((await one.read(B)).queue).toEqual([]);
    await expect(one.read("")).rejects.toThrow();
  });
});
