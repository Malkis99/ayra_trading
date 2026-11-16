/**
 * The one toast slot with a priority (RISK-NOTIFICATION-FIX).
 * A trading-risk warning (a prop limit) is never replaced by an ordinary message such as a reward:
 * - a risk warning takes the slot at once; an ordinary message it interrupts waits and comes back after it;
 * - an ordinary message that arrives while a warning is shown waits for it;
 * - only the latest ordinary message waits (a newer one replaces an older waiting one, as before);
 * - warnings wait in order, the same text never twice, at most MAX_RISK of them.
 * Nothing here changes what is earned or computed: it only decides which text is on screen.
 */

export type ToastLevel = "info" | "risk";

export type ToastItem = {
  id: number;
  message: string;
  level: ToastLevel;
  actionLabel?: string | null;
  onAction?: (() => void) | null;
};

export const MAX_RISK = 3;
/** How long a message stays: a warning long enough to read, an ordinary one as before. */
export const TOAST_MS = { risk: 7000, action: 8000, info: 2200 } as const;

export function toastDuration(item: ToastItem): number {
  if (item.level === "risk") return TOAST_MS.risk;
  return item.actionLabel ? TOAST_MS.action : TOAST_MS.info;
}

/** The queue after a new message: queue[0] is on screen. */
export function pushToast(queue: ToastItem[], item: ToastItem): ToastItem[] {
  const risks = queue.filter((q) => q.level === "risk");
  const infos = queue.filter((q) => q.level !== "risk");
  if (item.level === "risk") {
    if (risks.some((r) => r.message === item.message)) return queue; // the same warning is already on screen or waiting
    const all = [...risks, item];
    // over the limit: the warning on screen stays, the oldest waiting one gives way
    const nextRisks = all.length > MAX_RISK ? [all[0], ...all.slice(-(MAX_RISK - 1))] : all;
    // the ordinary message on screen (if any) waits behind the warnings
    return [...nextRisks, ...infos.slice(-1)];
  }
  // an ordinary message: replaces any other ordinary one (on screen or waiting), never a warning
  return [...risks, item];
}

/** The queue after the message on screen is closed (its time ran out or the person closed it). */
export function shiftToast(queue: ToastItem[], id: number): ToastItem[] {
  return queue[0]?.id === id ? queue.slice(1) : queue;
}
