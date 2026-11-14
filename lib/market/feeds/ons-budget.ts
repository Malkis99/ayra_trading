import type { EventResult, EventRow } from "./types";

export type OnsRequestKind = "schedule" | "move" | "fact";

export interface OnsBudget {
  daily(token?: string, ready?: boolean): Promise<string | null>;
  due(now: number): Promise<EventRow[]>;
  reserve(kind: OnsRequestKind, target: string, daily?: string | null, expectedStart?: string): Promise<string | null>;
  charge(token: string): Promise<boolean>;
  finish(token: string, result?: EventResult, pause?: string): Promise<void>;
}

export async function withOnsSlot<T extends string | EventResult>(
  budget: OnsBudget, kind: OnsRequestKind, target: string, daily: string | null | undefined,
  get: () => Promise<T>, pause: (error: unknown, now: number) => string | undefined, expectedStart?: string,
): Promise<T | null> {
  const token = await budget.reserve(kind, target, daily, expectedStart);
  if (!token) return null;
  const start = performance.now();
  if (!await budget.charge(token)) return null;
  // A delayed or ambiguous acknowledgment must never authorize a new dispatch.
  if (performance.now() - start >= 5_000) {
    await budget.finish(token);
    return null;
  }
  let value: T;
  try {
    value = await get();
  } catch (error) {
    await budget.finish(token, undefined, pause(error, Date.now()));
    throw error;
  }
  await budget.finish(token, typeof value === "string" ? undefined : value);
  return value;
}
