import { Temporal } from "@js-temporal/polyfill";

export const DEFAULT_SESSION_DAYS = [1, 2, 3, 4, 5];
export type SessionReminder = { version: 1; days: number[]; enabled: boolean; lead: number; armedAt: number } & Record<string, unknown>;
export type CivilSession = { start: string; end: string; zone: string };
export const defaultSessionReminder = (): SessionReminder => ({ version: 1, days: [...DEFAULT_SESSION_DAYS], enabled: false, lead: 5, armedAt: 0 });
export function isCivilCycle(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
  try { return Temporal.PlainDate.from(value).toString() === value; } catch { return false; }
}
/** earlier chooses the first fold instant; round-trip rejects a gap instead of shifting its clock. */
export function civilInstant(day: string, time: string, zone: string): number | null {
  const civil = Temporal.PlainDateTime.from(`${day}T${time}`);
  const zoned = civil.toZonedDateTime(zone, { disambiguation: "earlier" });
  return zoned.toPlainDateTime().equals(civil) ? zoned.epochMilliseconds : null;
}
export function customSessionWindow(session: CivilSession, day: string) {
  const date = Temporal.PlainDate.from(day), endDay = session.end < session.start ? date.add({ days: 1 }) : date;
  const start = civilInstant(day, session.start, session.zone), end = civilInstant(endDay.toString(), session.end, session.zone);
  return start === null || end === null || end <= start ? null : { start, end, cycle: day, weekday: date.dayOfWeek };
}
/** Adjacent local dates cover a reminder before midnight and the <60s grace after midnight. */
export function customSessionCycles(now: number, zone: string) {
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate();
  return [-1, 0, 1].map(days => today.add({ days }).toString());
}
