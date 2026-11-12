import { describe, it, expect } from "vitest";
import { GameStore, revOf, SETTLE_TRIES, type GameStoreDeps } from "./game-store";

type S = { rev?: number; xp: number; done: Record<string, boolean> };

/** A browser stand-in: one saved value, tabs that may see it late, a real mutex and a counter. */
function makeBrowser() {
  let saved: string | null = JSON.stringify({ rev: 1, xp: 0, done: {} });
  let counter: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const lock = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    get saved() {
      return saved;
    },
    set saved(v: string | null) {
      saved = v;
    },
    counter: {
      get: async () => counter,
      put: async (rev: number) => {
        counter = Math.max(counter ?? 0, rev);
      },
      reset: async (rev: number) => {
        counter = rev;
      },
      peek: () => counter,
    },
    lock,
  };
}

/** A tab: its own copy, and a view of the saved value that may lag `lagReads` reads behind a write. */
function makeTab(browser: ReturnType<typeof makeBrowser>, opts: { lock?: boolean; lagReads?: number } = {}) {
  let stale: string | null = null;
  let lagLeft = 0;
  const deps: GameStoreDeps<S> = {
    read: () => {
      if (lagLeft > 0 && stale != null) {
        lagLeft--;
        return stale;
      }
      return browser.saved;
    },
    write: (raw) => {
      browser.saved = raw;
      return true;
    },
    parse: (raw) => JSON.parse(raw) as S,
    lock: opts.lock === false ? undefined : browser.lock,
    counter: browser.counter,
    sleep: async () => undefined,
  };
  const store = new GameStore<S>(deps);
  let memory: S = JSON.parse(browser.saved!);
  store.noteLoaded(browser.saved);
  return {
    store,
    get memory() {
      return memory;
    },
    /** Next reads see the value saved before the latest write, for `n` reads (localStorage copy not arrived yet). */
    lagFrom(prev: string | null, n: number) {
      stale = prev;
      lagLeft = n;
    },
    complete: async (quest: string) => {
      const out = await store.applyLocked(
        () => memory,
        (fresh) => (fresh.done[quest] ? { state: fresh, result: false } : { state: { ...fresh, xp: fresh.xp + 30, done: { ...fresh.done, [quest]: true } }, result: true })
      );
      memory = out.state;
      return out.result;
    },
    completeSync: (quest: string) => {
      const out = store.applySync(memory, (fresh) =>
        fresh.done[quest] ? { state: fresh, result: false } : { state: { ...fresh, xp: fresh.xp + 30, done: { ...fresh.done, [quest]: true } }, result: true }
      );
      memory = out.state;
      return out.result;
    },
  };
}

const savedXp = (b: ReturnType<typeof makeBrowser>) => (JSON.parse(b.saved!) as S).xp;

describe("game store: one reward per quest across tabs", () => {
  it("a double click and a repeated request give the reward once", async () => {
    const b = makeBrowser();
    const tab = makeTab(b);
    const [a, c] = await Promise.all([tab.complete("q_walk"), tab.complete("q_walk")]);
    expect([a, c].filter(Boolean)).toHaveLength(1);
    expect(savedXp(b)).toBe(30);
    expect(await tab.complete("q_walk")).toBe(false);
    expect(savedXp(b)).toBe(30);
  });

  it("two and three tabs completing the same quest at the same moment give it once", async () => {
    const b = makeBrowser();
    const tabs = [makeTab(b), makeTab(b), makeTab(b)];
    const results = await Promise.all(tabs.map((t) => t.complete("q_walk")));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(savedXp(b)).toBe(30);
  });

  it("a tab opened before the reward does not overwrite it later", async () => {
    const b = makeBrowser();
    const early = makeTab(b);
    const other = makeTab(b);
    await other.complete("q_walk");
    // the early tab still holds xp 0 in memory, then completes another quest
    expect(early.memory.xp).toBe(0);
    await early.complete("q_read");
    const s = JSON.parse(b.saved!) as S;
    expect(s.xp).toBe(60);
    expect(s.done).toEqual({ q_walk: true, q_read: true });
  });

  it("waits for the saved value of the previous lock holder when it reaches this tab late", async () => {
    const b = makeBrowser();
    const first = makeTab(b);
    const late = makeTab(b);
    const before = b.saved;
    await first.complete("q_walk");
    // the late tab sees the old value for a few reads (the copy between tabs has not arrived yet)
    late.lagFrom(before, 3);
    expect(await late.complete("q_walk")).toBe(false);
    expect(savedXp(b)).toBe(30);
  });

  it("without Web Locks the check-and-write is one synchronous step: sequential tabs still give it once", () => {
    const b = makeBrowser();
    const t1 = makeTab(b, { lock: false });
    const t2 = makeTab(b, { lock: false });
    expect(t1.completeSync("q_walk")).toBe(true);
    expect(t2.completeSync("q_walk")).toBe(false);
    expect(savedXp(b)).toBe(30);
  });

  it("follows a value replaced on purpose (cleared space) instead of waiting every time", async () => {
    const b = makeBrowser();
    const tab = makeTab(b);
    await tab.complete("q_a");
    await tab.complete("q_b");
    expect(b.counter.peek()).toBe(3);
    // the space is cleared and a fresh state is written by other code
    b.saved = JSON.stringify({ rev: 0, xp: 0, done: {} });
    const fresh = makeTab(b);
    expect(await fresh.complete("q_a")).toBe(true);
    // after giving up once the counter follows the saved value
    expect(b.counter.peek()).toBe(1);
    expect(SETTLE_TRIES).toBeGreaterThan(0);
  });

  it("revOf treats a missing rev as 0", () => {
    expect(revOf({})).toBe(0);
    expect(revOf({ rev: 7 })).toBe(7);
    expect(revOf(null)).toBe(0);
  });
});
