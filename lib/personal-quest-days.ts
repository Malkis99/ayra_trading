/**
 * QH-8.3: the days of a personal quest — the real Journal check of data-confirmed days and the 30-day calendar.
 *
 * A data-confirmed («app») day is never stored as a fact and never trusted from the game state: on every read it is found
 * again in the saved Journal by the Quest Hub mission checks (`candidateSources`, lib/missions.ts) — the same rules that
 * pay missions: a real record made (or, for a day plan, confirmed) on that game day in the account's time zone, the
 * person's own text over the minimum, not imported, not a copy of an earlier text or result. Only the checks of the
 * run's category count (PQCategory.appChecks), and one record confirms one day of a run. A key that the Journal does not
 * confirm for that day confirms nothing. While the Journal is not read (or a cloud copy is still loading) nothing is
 * decided: the days wait for the check.
 *
 * Self-reported days are the marks saved in the run (markSelfDay): today only, once a day. Nothing here gives anything.
 */

import { candidateSources, isMissionId, type MissionData, type MissionId } from "./missions";
import { addDaysToKey, dayKeyInZone } from "./day-key";
import { PQ_PERIOD_DAYS, categoryOf, confirmedDays, endDayOf, type PQMark, type PQNote, type PQRecordCheck, type PQRun } from "./personal-quests";

type Sources = (id: MissionId, data: MissionData, day: string) => string[];

const checksOf = (run: Pick<PQRun, "category">): MissionId[] => (categoryOf(run.category)?.appChecks ?? []).filter(isMissionId);

/**
 * The real record check (PQRecordCheck): the mark's key is one of the records the Journal confirms, for the mark's day,
 * by one of the category's checks. Anything else — an invented key, a record of another day, an imported or copied
 * note, a record of another kind — confirms nothing.
 */
export function journalRecordCheck(data: MissionData, sources: Sources = candidateSources): PQRecordCheck {
  return (mark, run) => !!mark.sourceKey && checksOf(run).some((id) => sources(id, data, mark.day).includes(mark.sourceKey!));
}

/** When the record behind a key was saved (for the history), when it can be told. */
function recordTime(key: string, data: MissionData): string {
  const [kind, id] = key.split(":");
  if (kind === "note") return data.notes.find((n) => n.id === id)?.createdAt ?? "";
  if (kind === "trade") return data.trades.find((t) => t.id === id)?.reviewedAt ?? "";
  if (kind === "plan") {
    const p = data.plans.find((x) => x.date === id && !x.deletedAt);
    return p?.review?.completedAt || p?.prepConfirmedAt || p?.firstSavedAt || p?.createdAt || "";
  }
  return "";
}

/**
 * The data-confirmed days of a run up to `until` (today, or the day it was abandoned), found in the Journal: for each
 * day of the period the first record of the category's checks not used by an earlier day of this run.
 */
export function appMarks(run: PQRun, data: MissionData, until: string, sources: Sources = candidateSources): PQMark[] {
  if (run.verification !== "app") return [];
  const last = until < endDayOf(run) ? until : endDayOf(run);
  const used = new Set<string>();
  const out: PQMark[] = [];
  for (let day = run.startDay; day <= last; day = addDaysToKey(day, 1)) {
    for (const id of checksOf(run)) {
      const key = sources(id, data, day).find((k) => !used.has(k));
      if (!key) continue;
      used.add(key);
      out.push({ day, savedOn: day, at: recordTime(key, data), source: "app", sourceKey: key, check: id });
      break;
    }
  }
  return out;
}

export type PQDayState = "confirmed" | "missed" | "today" | "future" | "pending" | "closed";

export interface PQDayView {
  day: string;
  /** 1…30 */
  n: number;
  state: PQDayState;
  mark?: PQMark;
  note?: PQNote;
}

export interface PQJourney {
  days: PQDayView[];
  /** Confirmed days (self marks, or Journal records passing the check). */
  confirmed: number;
  /** Past days of the period with no confirmation (never a penalty). */
  missed: number;
  /** The marks that count, oldest first (the history). */
  marks: PQMark[];
  /** The Journal is not read yet: data-confirmed days wait for the check. */
  pending: boolean;
}

/**
 * The 30 days of a run on `today`: confirmed, missed, today, future — or, for a data-confirmed run while the Journal is
 * not read (`data` null), «waiting for the check». Days after an abandoned run stopped are «closed».
 */
export function journeyOf(run: PQRun, today: string, data: MissionData | null, timezone?: string, sources: Sources = candidateSources): PQJourney {
  const stoppedOn = run.status === "abandoned" && run.abandonedAt ? dayKeyInZone(new Date(run.abandonedAt), timezone) : null;
  const until = stoppedOn && stoppedOn < today ? stoppedOn : today;
  const pending = run.verification === "app" && !data;
  let marks: PQMark[];
  let confirmed = 0;
  if (run.verification === "app") {
    marks = data ? appMarks(run, data, until, sources) : [];
    confirmed = data ? confirmedDays({ ...run, marks }, journalRecordCheck(data, sources)) : 0;
  } else {
    marks = run.marks.filter((m) => m.source === "self" && m.savedOn === m.day && m.day <= until);
    confirmed = confirmedDays({ ...run, marks }, () => false);
  }
  const byDay = new Map(marks.map((m) => [m.day, m]));
  const notes = new Map((run.notes ?? []).map((n) => [n.day, n]));
  let missed = 0;
  const days: PQDayView[] = Array.from({ length: PQ_PERIOD_DAYS }, (_, i) => {
    const day = addDaysToKey(run.startDay, i);
    const mark = byDay.get(day);
    let state: PQDayState;
    if (stoppedOn && day > stoppedOn) state = "closed";
    else if (mark) state = "confirmed";
    else if (day > today) state = "future";
    else if (pending) state = "pending";
    else if (day === today && !stoppedOn) state = "today";
    else {
      state = "missed";
      missed++;
    }
    return { day, n: i + 1, state, ...(mark ? { mark } : {}), ...(notes.get(day) ? { note: notes.get(day) } : {}) };
  });
  return { days, confirmed, missed, marks, pending };
}
