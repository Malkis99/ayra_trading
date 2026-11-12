/**
 * One place where the game state is read, changed and written on this device (docs/quests-2.0-plan.md, 4.1).
 *
 * Every change runs on the freshest saved state (not on a possibly stale copy kept by this tab) and is written at once,
 * with a growing `rev`. Changes that give rewards can also run under a lock shared by all tabs of the site (Web Locks):
 * inside it the condition («already done today?») is checked on fresh data, so two tabs cannot both give it.
 *
 * The browser copies saved values between tabs asynchronously, so a tab that takes the lock right after another one
 * may still read the old value for a moment. A tiny counter in the browser database (transactional for all tabs,
 * lib/storage/game-rev-counter.ts) keeps the last `rev` written under the lock; the next holder waits briefly until
 * the saved value shows at least that `rev`.
 *
 * Limits (honest, until the server economy Q4): without Web Locks the check-and-write is one synchronous step, not a
 * lock; other browsers, private windows and devices have their own storage; editing the saved value by hand is not
 * prevented.
 */

export interface Revisioned {
  rev?: number;
}

export interface GameStoreDeps<S extends Revisioned> {
  /** Saved raw value of the active space (null if none or not readable). */
  read(): string | null;
  /** Writes the raw value into the active space (false if it could not be written). */
  write(raw: string): boolean;
  /** Turns saved JSON into a state (migrations). */
  parse(raw: string): S;
  /** Web Locks (or a test double); absent → the synchronous path only. */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Last `rev` written under the lock (browser database, or a test double); absent → no waiting. */
  counter?: {
    get(): Promise<number | null>;
    /** Moves the counter forward only. */
    put(rev: number): Promise<void>;
    /** Sets it to this value (the saved state was replaced on purpose, for example the space was cleared). */
    reset(rev: number): Promise<void>;
  };
  sleep?: (ms: number) => Promise<void>;
}

/** How long a lock holder waits for the saved value to show the `rev` the previous holder wrote (technical, not a game rule). */
export const SETTLE_TRIES = 50;
export const SETTLE_STEP_MS = 10;

export function revOf(s: Revisioned | null | undefined): number {
  return typeof s?.rev === "number" && Number.isFinite(s.rev) ? s.rev : 0;
}

export interface Change<S, R> {
  state: S;
  result: R;
}

export class GameStore<S extends Revisioned> {
  /** The raw value this tab last read or wrote: a different saved value means another tab (or code) wrote it. */
  private lastRaw: string | null = null;
  /**
   * The latest state this store wrote or took. A caller's copy may lag behind it (for example the next change waiting
   * for the lock runs before the caller has stored the result of the previous one), so it is never used as the base.
   */
  private lastState: S | null = null;

  constructor(private deps: GameStoreDeps<S>) {}

  /** Remember what was loaded, so the next change can tell whether someone else wrote since. */
  noteLoaded(raw: string | null, state?: S) {
    this.lastRaw = raw;
    if (state && (!this.lastState || revOf(state) >= revOf(this.lastState))) this.lastState = state;
  }

  /** The freshest of the caller's copy, what this store last wrote, and the saved value. */
  freshest(memory: S): S {
    const known = this.lastState && revOf(this.lastState) > revOf(memory) ? this.lastState : memory;
    const raw = this.deps.read();
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
  applySync<R>(memory: S, fn: (fresh: S) => Change<S, R>): Change<S, R> {
    const fresh = this.freshest(memory);
    const out = fn(fresh);
    if (out.state === fresh) return out; // nothing changed: nothing to write
    const next = { ...out.state, rev: Math.max(revOf(fresh), revOf(memory)) + 1 } as S;
    const raw = JSON.stringify(next);
    this.lastState = next; // even if the write failed: this tab goes on from its newest state
    if (this.deps.write(raw)) this.lastRaw = raw;
    // a write made without the lock still moves the counter, so a later lock holder waits for it
    this.deps.counter?.put(revOf(next)).catch(() => undefined);
    return { state: next, result: out.result };
  }

  /** The same under the lock shared by all tabs (falls back to `applySync` without Web Locks). */
  async applyLocked<R>(getMemory: () => S, fn: (fresh: S) => Change<S, R>): Promise<Change<S, R>> {
    const { lock, counter } = this.deps;
    if (!lock) return this.applySync(getMemory(), fn);
    return lock(async () => {
      if (counter) await this.settle(counter);
      const out = this.applySync(getMemory(), fn);
      if (counter && out.state !== getMemory()) await counter.put(revOf(out.state)).catch(() => undefined);
      return out;
    });
  }

  /** Waits until the saved value shows the rev of the previous lock holder (or gives up: someone wrote an older value on purpose). */
  private async settle(counter: NonNullable<GameStoreDeps<S>["counter"]>) {
    let target: number | null = null;
    try {
      target = await counter.get();
    } catch {
      return;
    }
    if (target == null) return;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let seen = 0;
    for (let i = 0; i < SETTLE_TRIES; i++) {
      const raw = this.deps.read();
      if (raw == null) return;
      try {
        seen = revOf(this.deps.parse(raw));
      } catch {
        return;
      }
      if (seen >= target) return;
      await sleep(SETTLE_STEP_MS);
    }
    // the saved value stays older: it was replaced on purpose (cleared space, restored copy) — follow it from now on
    await counter.reset(seen).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ browser adapters */

/** Web Locks for one space, or undefined when the browser has none. */
export function browserLock(name: string): GameStoreDeps<Revisioned>["lock"] {
  if (typeof navigator === "undefined" || !("locks" in navigator) || !navigator.locks?.request) return undefined;
  return <T,>(fn: () => Promise<T>) => navigator.locks.request(name, { mode: "exclusive" }, fn) as Promise<T>;
}
