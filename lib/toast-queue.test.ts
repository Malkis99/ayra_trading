import { describe, it, expect } from "vitest";
import { pushToast, shiftToast, toastDuration, MAX_RISK, TOAST_MS, type ToastItem } from "./toast-queue";

let n = 0;
const risk = (message: string): ToastItem => ({ id: ++n, message, level: "risk" });
const info = (message: string, actionLabel?: string): ToastItem => ({ id: ++n, message, level: "info", actionLabel });
const texts = (q: ToastItem[]) => q.map((t) => t.message);
const push = (...items: ToastItem[]) => items.reduce(pushToast, [] as ToastItem[]);

describe("one toast slot with a risk priority", () => {
  it("the original bug: a reward right after a limit warning no longer replaces it; it waits", () => {
    const q = push(risk("Дневной лимит использован на 80%"), info("Впервые: сделка! +20 Coins, +20 XP"));
    expect(texts(q)).toEqual(["Дневной лимит использован на 80%", "Впервые: сделка! +20 Coins, +20 XP"]);
    // the warning goes (time or «close»): the reward comes up
    expect(texts(shiftToast(q, q[0].id))).toEqual(["Впервые: сделка! +20 Coins, +20 XP"]);
  });

  it("a warning interrupts an ordinary message, which comes back after it", () => {
    const q = push(info("Сделка сохранена"), risk("Лимит дня достигнут"));
    expect(texts(q)).toEqual(["Лимит дня достигнут", "Сделка сохранена"]);
  });

  it("ordinary messages behave as before: the newest replaces the one on screen", () => {
    expect(texts(push(info("a"), info("b")))).toEqual(["b"]);
  });

  it("only the newest ordinary message waits behind a warning (no growing queue)", () => {
    const q = push(risk("r"), info("a"), info("b"), info("c"));
    expect(texts(q)).toEqual(["r", "c"]);
  });

  it("several warnings in a short time are all shown in order; the same text never twice", () => {
    const q = push(risk("Дневной лимит использован на 80%"), risk("Общая просадка использована на 80%"), risk("Дневной лимит использован на 80%"));
    expect(texts(q)).toEqual(["Дневной лимит использован на 80%", "Общая просадка использована на 80%"]);
  });

  it(`at most ${MAX_RISK} warnings; the one on screen is never dropped`, () => {
    const q = push(risk("r1"), risk("r2"), risk("r3"), risk("r4"), risk("r5"));
    expect(q).toHaveLength(MAX_RISK);
    expect(texts(q)).toEqual(["r1", "r4", "r5"]);
  });

  it("closing works only for the message on screen (a late timer of an old one changes nothing)", () => {
    const q = push(risk("r"), info("a"));
    expect(shiftToast(q, q[1].id)).toBe(q);
  });

  it("a warning stays long enough to read; ordinary times are unchanged", () => {
    expect(toastDuration(risk("r"))).toBe(TOAST_MS.risk);
    expect(TOAST_MS.risk).toBeGreaterThanOrEqual(6000);
    expect(toastDuration(info("a"))).toBe(2200);
    expect(toastDuration(info("a", "Отменить"))).toBe(8000);
  });
});
