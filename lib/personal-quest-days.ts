/**
 * QH-8.3: the days of a personal quest — the real Journal check of data-confirmed days and the 30-day calendar.
 *
 * A data-confirmed («app») day is never stored as a fact and never trusted from the game state: on every read it is found
 * again in the saved Journal by the Quest Hub mission checks (`candidateSources`, lib/missions.ts) — the same rules that
 * pay missions: a real record made (or, for a day plan, confirmed) on that game day in the account's time zone, the
 * person's own text over the minimum, not imported, not a copy of an earlier text or result. Only the checks of the
 * run's category count (PQCategory.appChecks). A key that the Journal does not confirm for that day confirms nothing.
 * While the Journal is not read (or a cloud copy is still loading) nothing is decided: the days wait for the check.
 *
 * One record confirms at most one personal quest (В-24) — across all runs, not only within one: every run's day is
 * given a record by one shared, deterministic distribution (allocateAppMarks) over all runs that were running that day.
 * A record may still also count for a Quest Hub mission (QH-6.6 keeps its own ledger).
 *
 * A completed run (QH-8.4) is never counted again: its saved result keeps the marks it was completed with, and their
 * records stay reserved for it — later changes in the Journal change neither its result nor what other quests get.
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

/** The game day an abandoned run stopped (null while it runs). */
export const stoppedOnOf = (run: PQRun, timezone?: string) => (run.status === "abandoned" && run.abandonedAt ? dayKeyInZone(new Date(run.abandonedAt), timezone) : null);

/**
 * The order in which runs keep a record they both could use (В-24): a running (or finished) run before an abandoned one
 * (an abandoned run never pays, so it only keeps records no other quest needs), then the run started earlier, then the
 * one created earlier, then by id — stable, whatever order the cards are shown in or the runs are read.
 */
export function runPriority(a: PQRun, b: PQRun): number {
  const ab = (r: PQRun) => (r.status === "abandoned" ? 1 : 0);
  return ab(a) - ab(b) || a.startDay.localeCompare(b.startDay) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);
}

export interface PQAllocation {
  /** The data-confirmed marks of each run (by run id), oldest first. */
  marks: Map<string, PQMark[]>;
  /** Days on which a run had a fitting record that another quest keeps: run id → day → the run that keeps it. */
  takenBy: Map<string, Map<string, string>>;
}

/**
 * Gives every data-confirmed run its days from the Journal, all runs together (В-24): a record confirms at most one
 * personal quest on its day; two different records of a day can confirm two quests. For each day, among the runs
 * running then (start…end, until today or the day an abandoned run stopped), the records are matched so that as many
 * runs as possible are confirmed; on a tie the run with the higher priority (runPriority) keeps the record, and each run
 * takes its earliest fitting record. The result depends only on the Journal and the runs — not on any order of calls —
 * and is computed again on every read, so a record deleted or changed takes its confirmation away everywhere at once.
 */
export function allocateAppMarks(runs: readonly PQRun[], data: MissionData, today: string, timezone?: string, sources: Sources = candidateSources): PQAllocation {
  const all = runs.filter((r) => r.verification === "app");
  const marks = new Map<string, PQMark[]>(all.map((r) => [r.id, []]));
  const takenBy = new Map<string, Map<string, string>>(all.map((r) => [r.id, new Map()]));
  const used = new Set<string>();
  // completed runs keep the marks they were completed with; their records are taken
  for (const r of all) {
    if (r.status !== "completed" || !r.result) continue;
    marks.set(r.id, r.result.marks);
    for (const m of r.result.marks) if (m.sourceKey) used.add(m.sourceKey);
  }
  const appRuns = all.filter((r) => !(r.status === "completed" && r.result)).sort(runPriority);
  if (appRuns.length === 0) return { marks, takenBy };
  const lastOf = new Map(appRuns.map((r) => {
    const stop = stoppedOnOf(r, timezone);
    const until = stop && stop < today ? stop : today;
    return [r.id, until < endDayOf(r) ? until : endDayOf(r)];
  }));
  const first = appRuns.reduce((m, r) => (r.startDay < m ? r.startDay : m), appRuns[0].startDay);
  const last = Array.from(lastOf.values()).reduce((m, d) => (d > m ? d : m), first);
  for (let day = first; day <= last; day = addDaysToKey(day, 1)) {
    const live = appRuns.filter((r) => r.startDay <= day && day <= lastOf.get(r.id)!);
    if (live.length === 0) continue;
    // each run's fitting records of the day, in the category's check order (one record may fit several checks)
    const options = live.map((r) => {
      const seen = new Set<string>();
      const out: Array<{ key: string; check: string }> = [];
      for (const id of checksOf(r)) for (const key of sources(id, data, day)) if (!used.has(key) && !seen.has(key)) (seen.add(key), out.push({ key, check: id }));
      return out;
    });
    // the best matching: most runs confirmed; on a tie the earlier choices of the higher-priority runs (search order)
    let best: Array<number> = live.map(() => -1);
    let bestCount = 0;
    const pick: number[] = [];
    const taken = new Set<string>();
    const search = (i: number, count: number) => {
      if (count + (live.length - i) <= bestCount) return;
      if (i === live.length) {
        if (count > bestCount) (bestCount = count), (best = [...pick]);
        return;
      }
      options[i].forEach((o, k) => {
        if (taken.has(o.key)) return;
        taken.add(o.key);
        pick[i] = k;
        search(i + 1, count + 1);
        taken.delete(o.key);
      });
      pick[i] = -1;
      search(i + 1, count);
    };
    search(0, 0);
    live.forEach((r, i) => {
      const k = best[i];
      if (k >= 0) {
        const o = options[i][k];
        used.add(o.key);
        marks.get(r.id)!.push({ day, savedOn: day, at: recordTime(o.key, data), source: "app", sourceKey: o.key, check: o.check });
      } else if (options[i].length > 0) {
        // it had a fitting record, kept by another quest that day
        const holder = live.find((x, j) => j !== i && best[j] >= 0 && options[i].some((o) => o.key === options[j][best[j]].key));
        if (holder) takenBy.get(r.id)!.set(day, holder.id);
      }
    });
  }
  return { marks, takenBy };
}

/** The data-confirmed days of one run among all runs (В-24): what allocateAppMarks gives it. */
export function appMarks(run: PQRun, data: MissionData, until: string, sources: Sources = candidateSources, runs: readonly PQRun[] = [run], timezone?: string): PQMark[] {
  if (run.verification !== "app") return [];
  return allocateAppMarks(runs.some((r) => r.id === run.id) ? runs : [...runs, run], data, until, timezone, sources).marks.get(run.id) ?? [];
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
  /** Days whose fitting record another personal quest keeps (В-24): day → that run's id. */
  takenBy: Map<string, string>;
}

/**
 * The 30 days of a run on `today`: confirmed, missed, today, future — or, for a data-confirmed run while the Journal is
 * not read (`data` null), «waiting for the check». Days after an abandoned run stopped are «closed».
 */
export function journeyOf(
  run: PQRun,
  today: string,
  data: MissionData | null,
  timezone?: string,
  sources: Sources = candidateSources,
  allocation?: PQAllocation
): PQJourney {
  const stoppedOn = stoppedOnOf(run, timezone);
  const until = stoppedOn && stoppedOn < today ? stoppedOn : today;
  const pending = run.verification === "app" && !data && !(run.status === "completed" && run.result);
  let marks: PQMark[];
  let confirmed = 0;
  let takenBy = new Map<string, string>();
  if (run.status === "completed" && run.result) {
    // the saved result, never counted again (QH-8.4)
    marks = run.result.marks;
    confirmed = run.result.days;
  } else if (run.verification === "app") {
    const a = data ? allocation ?? allocateAppMarks([run], data, today, timezone, sources) : null;
    marks = a?.marks.get(run.id) ?? [];
    takenBy = a?.takenBy.get(run.id) ?? takenBy;
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
  return { days, confirmed, missed, marks, pending, takenBy };
}

/** Every run's journey on `today`, the Journal's records shared out once among all of them (В-24). */
export function journeysOf(runs: readonly PQRun[], today: string, data: MissionData | null, timezone?: string, sources: Sources = candidateSources): Map<string, PQJourney> {
  const allocation = data ? allocateAppMarks(runs, data, today, timezone, sources) : undefined;
  return new Map(runs.map((r) => [r.id, journeyOf(r, today, data, timezone, sources, allocation)]));
}
