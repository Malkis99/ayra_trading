/**
 * One place where the game state is read, changed and written on this device (docs/quests-2.0-plan.md, 4.1).
 *
 * Every change runs on the freshest saved state (not on a possibly stale copy kept by this tab) and is written at once,
 * with a growing `rev` and a unique `commitId`. A change counts only when it was saved: if the write fails (no storage,
 * refused, no room, the user's space changed), nothing is reported as given and this tab keeps the last saved state.
 *
 * Changes that give rewards also run under a lock shared by all tabs of the site (Web Locks): inside it the condition
 * («already done today?») is checked on fresh data, so two tabs cannot both give it. The browser copies saved values
 * between tabs asynchronously, so a tab that takes the lock right after another one may still read an older value for a
 * moment. A small commit log in the browser database (transactional for all tabs, lib/storage/game-rev-counter.ts)
 * keeps the latest commit. The lock holder waits until the saved value is that commit (or a newer one). If after the
 * wait it still shows anything older — a late copy, or an old save without a commit id — the change is cancelled
 * (nothing written, nothing given) rather than written over a newer state; a waiting time is never taken as proof that
 * the older value is meant. The next page load writes a fresh commit, so a cancelled action works again after it.
 *
 * Limits (honest, until the server economy Q4): without Web Locks the check-and-write is one synchronous step, not a
 * lock; changes made outside the lock (journal actions, Home, wardrobe) are one synchronous step too; other browsers,
 * private windows and devices have their own storage; editing the saved value by hand is not prevented.
 */

export interface Revisioned {
  rev?: number;
  commitId?: string;
}

/** The latest commit written into a space. */
export interface CommitLog {
  rev: number;
  id: string;
}

export interface GameStoreDeps<S extends Revisioned> {
  /** Saved raw value of the active space (null if none, not readable or another space is active). */
  read(): string | null;
  /** Writes the raw value into the active space (false if it could not be written). */
  write(raw: string): boolean;
  /** Turns saved JSON into a state (migrations). */
  parse(raw: string): S;
  /** Web Locks (or a test double); absent → the synchronous path only. */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Commit log (browser database, or a test double); absent → no waiting. */
  commits?: {
    get(): Promise<CommitLog | null>;
    /** Records a commit that was written (it becomes the latest). */
    record(rev: number, id: string): Promise<void>;
  };
  sleep?: (ms: number) => Promise<void>;
  newId?: () => string;
}

/** How long a lock holder waits for the saved value to become the latest commit (technical, not a game rule). */
export const SETTLE_TRIES = 50;
export const SETTLE_STEP_MS = 10;

export function revOf(s: Revisioned | null | undefined): number {
  return typeof s?.rev === "number" && Number.isFinite(s.rev) ? s.rev : 0;
}

export interface Change<S, R> {
  state: S;
  result: R;
}

/** The outcome of a change: `saved` false means nothing was written and nothing may be reported as given. */
export type Applied<S, R> = { saved: true; state: S; result: R } | { saved: false; state: S; reason: "writeFailed" | "staleCopy" };

function defaultId(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The log after a commit: the last write becomes the latest, whatever its rev (after the data was cleared the rev starts
 * again). A record that arrives late with an older commit is harmless: the saved value is then newer and passes.
 */
export function withCommit(_log: CommitLog | null, rev: number, id: string): CommitLog {
  return { rev, id };
}

export class GameStore<S extends Revisioned> {
  /** The raw value this tab last read or wrote: a different saved value means another tab (or code) wrote it. */
  private lastRaw: string | null = null;
  /**
   * The latest state this store saved or took. A caller's copy may lag behind it (for example the next change waiting
   * for the lock runs before the caller has stored the result of the previous one), so it is used when it is newer.
   */
  private lastState: S | null = null;

  constructor(private deps: GameStoreDeps<S>) {}

  /** Remember what was loaded, so the next change can tell whether someone else wrote since. */
  noteLoaded(raw: string | null, state?: S) {
    this.lastRaw = raw;
    if (state && (!this.lastState || revOf(state) >= revOf(this.lastState))) this.lastState = state;
  }

  /** The freshest of the caller's copy, what this store last saved, and the saved value. */
  freshest(memory: S): S {
    const known = this.lastState && revOf(this.lastState) > revOf(memory) ? this.lastState : memory;
    const raw = this.safeRead();
    if (raw == null || raw === this.lastRaw) return known;
    let saved: S;
    try {
      saved = this.deps.parse(raw);
    } catch {
      return known;
    }
    // newer, or the same rev written by someone else (an older version of the app has no rev): the saved value wins
    if (revOf(saved) >= revOf(known)) {
      this.lastRaw = raw;
      this.lastState = saved;
      return saved;
    }
    return known; // older than what this tab knows: a copy that has not caught up yet
  }

  /** Check, change and write in one synchronous step (no awaiting between reading and writing). */
  applySync<R>(memory: S, fn: (fresh: S) => Change<S, R>): Applied<S, R> {
    return this.applyOnce(memory, fn, true);
  }

  private applyOnce<R>(memory: S, fn: (fresh: S) => Change<S, R>, recordNow: boolean): Applied<S, R> {
    const fresh = this.freshest(memory);
    const out = fn(fresh);
    if (out.state === fresh) return { saved: true, state: fresh, result: out.result }; // nothing changed: nothing to write
    const id = (this.deps.newId ?? defaultId)();
    const next = { ...out.state, rev: Math.max(revOf(fresh), revOf(memory)) + 1, commitId: id } as S;
    const raw = JSON.stringify(next);
    let written = false;
    try {
      written = this.deps.write(raw);
    } catch {
      written = false;
    }
    if (!written) return { saved: false, state: fresh, reason: "writeFailed" }; // nothing given, the saved state stays
    this.lastRaw = raw;
    this.lastState = next;
    // outside the lock the log is updated in the background (the lock path awaits it below)
    if (recordNow) this.deps.commits?.record(revOf(next), id).catch(() => undefined);
    return { saved: true, state: next, result: out.result };
  }

  /** The same under the lock shared by all tabs (falls back to `applySync` without Web Locks). */
  async applyLocked<R>(getMemory: () => S, fn: (fresh: S) => Change<S, R>): Promise<Applied<S, R>> {
    const { lock, commits } = this.deps;
    if (!lock) return this.applySync(getMemory(), fn);
    return lock(async () => {
      if (commits && !(await this.settle(commits))) return { saved: false, state: getMemory(), reason: "staleCopy" } as Applied<S, R>;
      const before = getMemory();
      const out = this.applyOnce(before, fn, false);
      if (commits && out.saved && out.state.commitId && out.state !== before) {
        await commits.record(revOf(out.state), out.state.commitId).catch(() => undefined);
      }
      return out;
    });
  }

  private safeRead(): string | null {
    try {
      return this.deps.read();
    } catch {
      return null;
    }
  }

  /**
   * Waits until the saved value is the latest commit (or newer). true → safe to change. false → after the wait it is
   * still older: do not write over the newer state (a timeout never means the older value is meant).
   */
  private async settle(commits: NonNullable<GameStoreDeps<S>["commits"]>): Promise<boolean> {
    let log: CommitLog | null = null;
    try {
      log = await commits.get();
    } catch {
      return true; // no log available: the synchronous check-and-write still applies
    }
    if (!log) return true;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let i = 0; i < SETTLE_TRIES; i++) {
      const raw = this.safeRead();
      if (raw == null) return true; // nothing saved (or another space): nothing older can be written over a newer state
      let saved: S;
      try {
        saved = this.deps.parse(raw);
      } catch {
        return true;
      }
      if (saved.commitId === log.id || revOf(saved) > log.rev) return true; // the latest commit (or newer)
      await sleep(SETTLE_STEP_MS); // older: the newer copy may still be on its way
    }
    return false;
  }
}

/* ------------------------------------------------------------------ browser adapters */

/** Web Locks for one space, or undefined when the browser has none. */
export function browserLock(name: string): GameStoreDeps<Revisioned>["lock"] {
  if (typeof navigator === "undefined" || !("locks" in navigator) || !navigator.locks?.request) return undefined;
  return <T,>(fn: () => Promise<T>) => navigator.locks.request(name, { mode: "exclusive" }, fn) as Promise<T>;
}
