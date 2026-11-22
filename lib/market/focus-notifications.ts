import { FocusDataError, type FocusEntry, type FocusPatch } from "./market-focus";
import { occurrences, sessionDefs, type SessionSettings } from "./sessions";

/** Local delivery only. UTC instants are derived from the existing AYRA session calendar. */
export type FocusAlertKind = "completion" | "session" | "reminder";
export interface FocusAlerts {
  version: 1; revision: number; completion: boolean; session: boolean; lead: number;
  enabledAt: number; reminder: number | null;
  completionEvent: { at: number; revision: number } | null;
  seenCompletion: number; seenSession: number; seenReminder: number;
}
export type FocusAlert = { kind: FocusAlertKind; at: number; token: number };
export const ALERT_GRACE = 60_000;
const instant = (value: number) => Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
export function alertsOf(entry: FocusEntry): FocusAlerts {
  const raw = entry.localAlerts;
  if (raw === undefined) return { version: 1, revision: 0, completion: false, session: false, lead: 5, enabledAt: 0, reminder: null, completionEvent: null, seenCompletion: 0, seenSession: 0, seenReminder: 0 };
  if (!raw || typeof raw !== "object") throw new FocusDataError("invalid");
  const v = raw as FocusAlerts;
  if (v.version !== 1) throw new FocusDataError("unsupported");
  if (![v.revision, v.enabledAt, v.seenCompletion, v.seenSession, v.seenReminder].every(n => Number.isSafeInteger(n) && n >= 0)
    || typeof v.completion !== "boolean" || typeof v.session !== "boolean" || ![0, 5, 15].includes(v.lead)
    || !instant(v.enabledAt) || !instant(v.seenSession) || !instant(v.seenReminder)
    || !(v.reminder === null || instant(v.reminder) && v.reminder > 0)
    || !(v.completionEvent === null || !!v.completionEvent && typeof v.completionEvent === "object" && instant(v.completionEvent.at) && Number.isSafeInteger(v.completionEvent.revision) && v.completionEvent.revision > 0)) throw new FocusDataError("invalid");
  return v;
}
export const allChecked = (entry: FocusEntry) => entry.checklist.items.length > 0 && entry.checklist.items.every(item => item.checked);
export function recordCompletion(before: FocusEntry, after: FocusEntry, patch: FocusPatch, now: number): FocusEntry {
  // Opaque future alert metadata must not prevent ordinary Focus edits.
  let alerts: FocusAlerts; try { alerts = alertsOf(before); } catch { return after; }
  if (!("check" in patch) || !patch.value || !alerts.completion || allChecked(before) || !allChecked(after)) {
    return ("check" in patch && !patch.value || "add" in patch || "remove" in patch) ? { ...after, localAlerts: { ...alerts, completionEvent: null } } : after;
  }
  return { ...after, localAlerts: { ...alerts, completionEvent: { at: now, revision: before.revision + 1 } } };
}
export function dueAlerts(entry: FocusEntry, now: number, hours?: SessionSettings): FocusAlert[] {
  const a = alertsOf(entry), out: FocusAlert[] = [];
  const recent = (at: number) => at >= a.enabledAt && at <= now && now - at < ALERT_GRACE;
  if (a.completion && allChecked(entry) && a.completionEvent && a.completionEvent.revision > a.seenCompletion && recent(a.completionEvent.at)) out.push({ kind: "completion", at: a.completionEvent.at, token: a.completionEvent.revision });
  if (a.reminder && a.reminder > a.seenReminder && recent(a.reminder)) out.push({ kind: "reminder", at: a.reminder, token: a.reminder });
  if (a.session && (entry.session === "london" || entry.session === "newYork")) {
    const def = sessionDefs(hours)[entry.session === "london" ? "london" : "newyork"];
    for (const o of occurrences(def, now, 1)) {
      const at = o.start - a.lead * 60_000;
      if (o.start > a.seenSession && recent(at)) out.push({ kind: "session", at, token: o.start });
    }
  }
  return out;
}
export function claimAlert(entry: FocusEntry, candidate: FocusAlert, now: number, hours?: SessionSettings): FocusEntry | null {
  if (!dueAlerts(entry, now, hours).some(a => a.kind === candidate.kind && a.token === candidate.token)) return null;
  const a = alertsOf(entry);
  return { ...entry, localAlerts: { ...a, [candidate.kind === "completion" ? "seenCompletion" : candidate.kind === "session" ? "seenSession" : "seenReminder"]: candidate.token } };
}
