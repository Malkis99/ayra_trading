import { describe, it, expect } from "vitest";
import { GameStore, SETTLE_TRIES, revOf, withCommit, type CommitLog, type GameStoreDeps } from "./game-store";

type S = { rev?: number; commitId?: string; xp: number; done: Record<string, boolean>; skin?: string };

/**
 * A browser stand-in: one saved value per space, a real mutex (Web Locks), the commit log (IndexedDB), and tabs whose
 * view of the saved value may arrive late (localStorage is copied between tabs asynchronously).
 */
function makeBrowser(initial: S | null = { rev: 1, xp: 0, done: {} }) {
  const spaces: Record<string, string | null> = { a: initial ? JSON.stringify(initial) : null, b: null };
  let active = "a";
  const logs: Record<string, CommitLog | null> = { a: null, b: null };
  let queue: Promise<unknown> = Promise.resolve();
  const lock = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    spaces,
    logs,
    get active() {
      return active;
    },
    switchTo(space: string) {
      active = space;
    },
    saved(space = "a") {
      return spaces[space] ? (JSON.parse(spaces[space]!) as S) : null;
    },
    lock,
  };
}

type Browser = ReturnType<typeof makeBrowser>;

interface TabOpts {
  lock?: boolean;
  log?: boolean;
  space?: string;
  /** write() result: "ok", "false" (refused / quota) or "throw" (storage unavailable) */
  write?: () => "ok" | "false" | "throw";
}

/** A tab bound to one space. `lagFrom(prev, n)`: its next n reads still see `prev` (the copy has not arrived yet). */
function makeTab(b: Browser, opts: TabOpts = {}) {
  const space = opts.space ?? "a";
  let stale: string | null = null;
  let lagLeft = 0;
  let ids = 0;
  const deps: GameStoreDeps<S> = {
    read: () => {
      if (b.active !== space) return null;
      if (lagLeft > 0) {
        lagLeft--;
        return stale;
      }
      return b.spaces[space];
    },
    write: (raw) => {
      const mode = opts.write?.() ?? "ok";
      if (mode === "throw") throw new Error("SecurityError: storage is not available");
      if (mode === "false" || b.active !== space) return false;
      b.spaces[space] = raw;
      return true;
    },
    parse: (raw) => JSON.parse(raw) as S,
    lock: opts.lock === false ? undefined : b.lock,
    commits:
      opts.log === false
        ? undefined
        : {
            get: async () => b.logs[space],
            record: async (rev, id) => {
              b.logs[space] = withCommit(b.logs[space], rev, id);
            },
          },
    sleep: async () => undefined,
    newId: () => `${space}-${Math.random().toString(36).slice(2)}-${++ids}`,
  };
  const store = new GameStore<S>(deps);
  let memory: S = b.saved(space) ?? { rev: 0, xp: 0, done: {} };
  store.noteLoaded(b.spaces[space]);
  const reward = (quest: string) => (fresh: S) =>
    fresh.done[quest] ? { state: fresh, result: false } : { state: { ...fresh, xp: fresh.xp + 30, done: { ...fresh.done, [quest]: true } }, result: true };
  return {
    store,
    get memory() {
      return memory;
    },
    lagFrom(prev: string | null, n: number) {
      stale = prev;
      lagLeft = n;
    },
    /** A reward under the lock; returns true only when it was given and saved. */
    complete: async (quest: string) => {
      const out = await store.applyLocked(() => memory, reward(quest));
      memory = out.state;
      return out.saved ? out.result : false;
    },
    completeSync: (quest: string) => {
      const out = store.applySync(memory, reward(quest));
      memory = out.state;
      return out.saved ? out.result : false;
    },
    /** An ordinary change (no reward), outside the lock — like the wardrobe or a journal action. */
    changeSkin: (skin: string) => {
      const out = store.applySync(memory, (fresh) => ({ state: { ...fresh, skin }, result: true }));
      memory = out.state;
      return out.saved;
    },
  };
}

describe("game store: a change counts only when it was saved", () => {
  for (const [name, mode] of [
    ["the write is refused (quota, guard)", "false"],
    ["storage is unavailable (throws)", "throw"],
  ] as const) {
    it(`${name}: no reward is reported, the saved progress stays, a later save gives it once`, async () => {
      const b = makeBrowser({ rev: 3, xp: 120, done: { q_old: true } });
      let failing = true;
      const tab = makeTab(b, { write: () => (failing ? mode : "ok") });
      expect(await tab.complete("q_walk")).toBe(false);
      expect(tab.completeSync("q_walk")).toBe(false);
      expect(b.saved()).toEqual({ rev: 3, xp: 120, done: { q_old: true } });
      expect(tab.memory.xp).toBe(120); // the screen keeps the saved state, not an unsaved reward
      failing = false;
      expect(await tab.complete("q_walk")).toBe(true);
      expect(await tab.complete("q_walk")).toBe(false);
      expect(b.saved()!.xp).toBe(150);
      expect(b.saved()!.done).toEqual({ q_old: true, q_walk: true });
    });
  }

  it("the user's space changes during the action: nothing is written into either space, nothing is reported", async () => {
    const b = makeBrowser({ rev: 2, xp: 60, done: {} });
    b.spaces.b = JSON.stringify({ rev: 9, xp: 999, done: {} });
    const tab = makeTab(b);
    b.switchTo("b"); // e.g. sign-in finished in another tab
    expect(await tab.complete("q_walk")).toBe(false);
    expect(b.saved("a")).toEqual({ rev: 2, xp: 60, done: {} });
    expect(b.saved("b")).toEqual({ rev: 9, xp: 999, done: {} });
  });
});

describe("game store: one reward per quest across tabs", () => {
  it("a double click and a repeated request give the reward once", async () => {
    const b = makeBrowser();
    const tab = makeTab(b);
    const [x, y] = await Promise.all([tab.complete("q_walk"), tab.complete("q_walk")]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    expect(await tab.complete("q_walk")).toBe(false);
    expect(b.saved()!.xp).toBe(30);
  });

  it("two and three tabs completing the same quest at the same moment give it once", async () => {
    const b = makeBrowser();
    const results = await Promise.all([makeTab(b), makeTab(b), makeTab(b)].map((t) => t.complete("q_walk")));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(b.saved()!.xp).toBe(30);
  });

  it("a tab opened before the reward does not overwrite it later", async () => {
    const b = makeBrowser();
    const early = makeTab(b);
    await makeTab(b).complete("q_walk");
    expect(early.memory.xp).toBe(0);
    await early.complete("q_read");
    expect(b.saved()).toMatchObject({ xp: 60, done: { q_walk: true, q_read: true } });
  });
});

describe("game store: an older state never overwrites a newer one", () => {
  it("slow sync between tabs: a late copy shorter than the wait — the change waits and builds on the newer state", async () => {
    const b = makeBrowser();
    const first = makeTab(b);
    const late = makeTab(b);
    const before = b.spaces.a;
    await first.complete("q_walk");
    late.lagFrom(before, 3);
    expect(await late.complete("q_walk")).toBe(false); // already given
    expect(await late.complete("q_read")).toBe(true);
    expect(b.saved()).toMatchObject({ xp: 60, done: { q_walk: true, q_read: true } });
  });

  it("slow sync longer than the wait: the change is cancelled, the newer state stays, the log is not reset", async () => {
    const b = makeBrowser();
    const first = makeTab(b);
    const late = makeTab(b);
    const before = b.spaces.a;
    await first.complete("q_walk");
    const newer = b.spaces.a;
    const logBefore = b.logs.a;
    late.lagFrom(before, SETTLE_TRIES + 5); // the copy is still old after the whole wait
    expect(await late.complete("q_read")).toBe(false);
    expect(b.spaces.a).toBe(newer);
    expect(b.logs.a).toEqual(logBefore); // not moved back
    // when the copy arrives, the same action works and nothing is lost
    late.lagFrom(null, 0);
    expect(await late.complete("q_read")).toBe(true);
    expect(b.saved()).toMatchObject({ xp: 60, done: { q_walk: true, q_read: true } });
  });

  it("a reward and an ordinary change in two tabs: both are kept, the reward is given once", async () => {
    const b = makeBrowser();
    const rewardTab = makeTab(b);
    const otherTab = makeTab(b);
    const before = b.spaces.a;
    await rewardTab.complete("q_walk");
    // the other tab opened before the reward changes the wardrobe without the lock: it builds on the saved reward
    void before;
    expect(otherTab.changeSkin("skin_dark")).toBe(true);
    expect(b.saved()).toMatchObject({ xp: 30, done: { q_walk: true }, skin: "skin_dark" });
    // a reward after the ordinary change keeps both
    expect(await rewardTab.complete("q_read")).toBe(true);
    expect(b.saved()).toMatchObject({ xp: 60, done: { q_walk: true, q_read: true }, skin: "skin_dark" });
  });

  it("switching spaces: a tab of space A never writes into B, and A's newer state is not overwritten when it comes back", async () => {
    const b = makeBrowser();
    const tabA = makeTab(b, { space: "a" });
    await tabA.complete("q_walk");
    b.switchTo("b");
    b.spaces.b = JSON.stringify({ rev: 1, xp: 0, done: {} });
    const tabB = makeTab(b, { space: "b" });
    expect(await tabB.complete("q_walk")).toBe(true);
    expect(await tabA.complete("q_read")).toBe(false); // A is not active: nothing written anywhere
    expect(b.saved("b")).toMatchObject({ xp: 30, done: { q_walk: true } });
    b.switchTo("a");
    expect(await tabA.complete("q_read")).toBe(true);
    expect(b.saved("a")).toMatchObject({ xp: 60, done: { q_walk: true, q_read: true } });
    expect(b.saved("b")).toMatchObject({ xp: 30 });
  });

  it("a reload during the change (written, not yet in the log): the next change still works and keeps it", async () => {
    const b = makeBrowser();
    const tab = makeTab(b);
    await tab.complete("q_a");
    // simulate a page closed right after writing: the saved value has a commit the log does not know
    const s = b.saved()!;
    b.spaces.a = JSON.stringify({ ...s, rev: s.rev! + 1, commitId: "closed-before-logging", xp: s.xp + 30, done: { ...s.done, q_b: true } });
    const reopened = makeTab(b);
    expect(await reopened.complete("q_b")).toBe(false); // already given before the reload
    expect(await reopened.complete("q_c")).toBe(true);
    expect(b.saved()).toMatchObject({ xp: 90, done: { q_a: true, q_b: true, q_c: true } });
  });

  it("an old save without a commit id arriving late is never taken as meant: the reward is not given twice", async () => {
    const b = makeBrowser(); // the saved value comes from before this version: no commit id
    const first = makeTab(b);
    const late = makeTab(b);
    const before = b.spaces.a;
    await first.complete("q_walk");
    late.lagFrom(before, SETTLE_TRIES + 5);
    expect(await late.complete("q_walk")).toBe(false);
    expect(b.saved()).toMatchObject({ xp: 30, done: { q_walk: true } });
  });

  it("a value written by other code (older app version, restored profile) is not overwritten blindly; the next load unblocks", async () => {
    const b = makeBrowser();
    const tab = makeTab(b);
    await tab.complete("q_a");
    await tab.complete("q_b");
    b.spaces.a = JSON.stringify({ xp: 500, done: {} }); // no rev, no commit id
    const reopened = makeTab(b);
    expect(await reopened.complete("q_a")).toBe(false); // cancelled: it may be a late copy
    expect(b.saved()).toEqual({ xp: 500, done: {} }); // untouched
    // the page load writes the loaded state as a fresh commit (lib/game-context.tsx), after that it works
    expect(reopened.changeSkin("skin_default")).toBe(true);
    await Promise.resolve();
    expect(await reopened.complete("q_a")).toBe(true);
    expect(b.saved()).toMatchObject({ xp: 530, done: { q_a: true } });
  });

  it("cleared data: the rev starts again, nothing waits forever", async () => {
    const b = makeBrowser();
    const tab = makeTab(b);
    for (const q of ["q_a", "q_b", "q_c"]) await tab.complete(q);
    expect(b.logs.a!.rev).toBe(4);
    b.spaces.a = null; // the space was cleared
    const reopened = makeTab(b);
    expect(reopened.changeSkin("skin_default")).toBe(true); // first write after the load: rev 1
    await Promise.resolve();
    expect(b.logs.a!.rev).toBe(1);
    expect(await reopened.complete("q_a")).toBe(true);
    expect(b.saved()).toMatchObject({ xp: 30, done: { q_a: true } });
  });

  it("without Web Locks the check-and-write is one synchronous step: tabs one after another give it once", () => {
    const b = makeBrowser();
    const t1 = makeTab(b, { lock: false });
    const t2 = makeTab(b, { lock: false });
    expect(t1.completeSync("q_walk")).toBe(true);
    expect(t2.completeSync("q_walk")).toBe(false);
    expect(b.saved()!.xp).toBe(30);
  });
});

describe("commit log", () => {
  it("the last write becomes the latest, whatever its rev", () => {
    let log: CommitLog | null = null;
    log = withCommit(log, 5, "c5");
    log = withCommit(log, 1, "after-clear");
    expect(log).toEqual({ rev: 1, id: "after-clear" });
  });

  it("revOf treats a missing rev as 0", () => {
    expect(revOf({})).toBe(0);
    expect(revOf({ rev: 7 })).toBe(7);
    expect(revOf(null)).toBe(0);
  });
});
