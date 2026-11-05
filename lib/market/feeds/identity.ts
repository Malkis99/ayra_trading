import type { EventRow, ScheduleMeta } from "./types";

/** Dates belong to the schedule, not to the identity. JSON encoding avoids delimiter collisions. */
export function identity(source: string, country: string, code: string, period: string | null, stage: string | null, uid?: string | null): string | null {
  if (!uid && (!period || !stage)) return null;
  return JSON.stringify([source, country, code, uid ? "uid" : "period", uid || period, stage]);
}

export function previousPeriod(period: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return new Date(Date.parse(period) - 7 * 86_400_000).toISOString().slice(0, 10);
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (month) { const d = new Date(Date.UTC(+month[1], +month[2] - 2, 1)); return d.toISOString().slice(0, 7); }
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period);
  return quarter ? `${+quarter[1] - (+quarter[2] === 1 ? 1 : 0)}-Q${+quarter[2] === 1 ? 4 : +quarter[2] - 1}` : null;
}

export function beaPeriod(title: string): string | null {
  const q = /(?:Q([1-4])\s+(\d{4})|([1-4])(?:st|nd|rd|th)?\s+Quarter(?:\s+and\s+Year)?\s+(\d{4}))/i.exec(title);
  if (q) return `${q[2] || q[4]}-Q${q[1] || q[3]}`;
  const names = "January February March April May June July August September October November December".split(" ");
  const m = new RegExp(`\\b(${names.join("|")})(?:\\s+and\\s+Annual)?\\s+(\\d{4})`, "i").exec(title);
  return m ? `${m[2]}-${String(names.findIndex((n) => n.toLowerCase() === m[1].toLowerCase()) + 1).padStart(2, "0")}` : null;
}

export function beaStage(title: string): string {
  return /advance estimate/i.test(title) ? "advance" : /second estimate/i.test(title) ? "second" : /third estimate/i.test(title) ? "third" : /preliminary/i.test(title) ? "preliminary" : /revised|revision/i.test(title) ? "revision" : "regular";
}

/** Authoritative version only; retrieval time/DTSTAMP is not proof that content is newer. */
export function newerSchedule(next: ScheduleMeta, old: ScheduleMeta): boolean {
  if (next.sequence !== undefined && old.sequence !== undefined && next.sequence !== old.sequence) return next.sequence > old.sequence;
  return !!next.modified && !!old.modified && Date.parse(next.modified) > Date.parse(old.modified);
}

export function scheduleIdentity(row: EventRow, period: string | null, stage: string, uid?: string | null, meta: ScheduleMeta = {}): EventRow {
  return { ...row, identity_key: identity(row.source, row.country, row.code || row.title, period, stage, uid), source_uid: uid || null, reference_period: period, release_stage: stage, schedule_meta: meta };
}

/** A feed may contain several versions. Input order is not a version. */
export function latestSchedules(rows: EventRow[]): EventRow[] {
  const found = new Map<string, EventRow>();
  for (const row of rows) {
    const key = row.identity_key || row.id;
    const old = found.get(key);
    if (!old || newerSchedule(row.schedule_meta || {}, old.schedule_meta || {})) found.set(key, row);
    else if (!newerSchedule(old.schedule_meta || {}, row.schedule_meta || {}) && (row.starts_at !== old.starts_at || row.schedule_meta?.cancelled !== old.schedule_meta?.cancelled)) throw new Error("calendar conflict: inconsistent schedule version");
  }
  return Array.from(found.values());
}
