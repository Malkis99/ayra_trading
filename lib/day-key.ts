/**
 * The game day: a calendar date (YYYY-MM-DD) in the account's time zone (docs/quests-2.0-plan.md, 4.2).
 * Home, Profile and Quests take "today" from here, so they always agree.
 */

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  if (!formatters.has(timeZone)) {
    try {
      formatters.set(timeZone, new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }));
    } catch {
      formatters.set(timeZone, null); // unknown zone id
    }
  }
  return formatters.get(timeZone) ?? null;
}

/** Calendar date of this device's clock (the fallback when the zone is missing or unknown). */
export function deviceDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Calendar date of `date` in the IANA time zone (device date if the zone is empty or unknown). */
export function dayKeyInZone(date: Date, timeZone?: string | null): string {
  const f = timeZone ? formatterFor(timeZone) : null;
  if (!f) return deviceDayKey(date);
  const parts = f.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The day `n` days after `key` (n may be negative). */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Monday of the week that contains `key`. */
export function mondayOfKey(key: string): string {
  return addDaysToKey(key, -weekdayOfKey(key));
}
