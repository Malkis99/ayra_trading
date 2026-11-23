import { customFocusId, focusFieldRevision, focusUuid, FocusDataError, type FocusEntry } from "./market-focus";
import { sessionReminder, type FocusCatalog } from "./focus-catalog";
import { customSessionCycles, customSessionWindow, isCivilCycle } from "./custom-session-time";

export type CustomSessionToken = { space: string; instrument: string; id: string; cycle: string; itemRevision: number; fieldRevision: number };
export type CustomSessionAlert = { kind: "session"; at: number; token: number; custom: CustomSessionToken };
type Receipts = { version: 1; seen: Record<string, string> } & Record<string, unknown>;
export function customReceipts(entry: FocusEntry): Receipts {
  const value = entry.customSessionReceipts;
  if (value === undefined) return { version: 1, seen: {} };
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) throw new FocusDataError("unsupported");
  const raw = value as Receipts;
  if (!raw.seen || typeof raw.seen !== "object" || Array.isArray(raw.seen) || !Object.entries(raw.seen).every(([id,day]) => focusUuid(id) && isCivilCycle(day))) throw new FocusDataError("invalid");
  return raw;
}
export function customAlertCurrent(entry: FocusEntry, catalog: FocusCatalog, token: CustomSessionToken) {
  const item = catalog.items.find(item => item.id === token.id);
  return catalog.version === 2 && entry.spaceId === token.space && entry.instrumentId === token.instrument && customFocusId(entry,"session") === token.id && focusFieldRevision(entry,"session") === token.fieldRevision
    && !!item && item.kind === "session" && !item.deleted && item.revision === token.itemRevision && !!item.session && sessionReminder(item.session).enabled;
}
export function dueCustomSession(entry: FocusEntry, catalog: FocusCatalog, now: number, grace: number): CustomSessionAlert[] {
  if (catalog.version !== 2) return [];
  const id = customFocusId(entry,"session"), item = catalog.items.find(item => item.id === id);
  if (!id || !item || item.deleted || item.kind !== "session" || !item.session) return [];
  const reminder = sessionReminder(item.session);
  if (!reminder.enabled || !reminder.days.length) return [];
  const seen = customReceipts(entry).seen[id];
  const selection = selectionAfter(entry,id);
  return customSessionCycles(now,item.session.zone).flatMap(day => {
    if (seen && day <= seen) return [];
    const window = customSessionWindow(item.session!,day);
    if (!window || !reminder.days.includes(window.weekday)) return [];
    const at = window.start - reminder.lead * 60_000;
    // A configuration change is never itself an event; no catch-up after enable/edit.
    if (at <= Math.max(reminder.armedAt,selection) || at > now || now - at >= grace) return [];
    return [{ kind: "session" as const, at, token: window.start, custom: { space:entry.spaceId, instrument:entry.instrumentId, id, cycle: day, itemRevision: item.revision, fieldRevision: focusFieldRevision(entry,"session") } }];
  });
}
function selectionAfter(entry: FocusEntry, id: string): number {
  const raw = entry.customSessionSelection;
  if (raw === undefined) return 0; // Existing selection: its new schedule still requires explicit opt-in.
  if (!raw || typeof raw !== "object" || !("version" in raw) || raw.version !== 1) throw new FocusDataError("unsupported");
  const value = raw as Record<string,unknown>;
  if (!Number.isSafeInteger(value.armedAt) || Number(value.armedAt) < 0) throw new FocusDataError("invalid");
  return value.id === id && value.fieldRevision === focusFieldRevision(entry,"session") ? Number(value.armedAt) : Infinity;
}
export function armCustomSelection(before: FocusEntry, after: FocusEntry, now: number): FocusEntry {
  const raw = before.customSessionSelection;
  if (raw !== undefined && (!raw || typeof raw !== "object" || !("version" in raw) || raw.version !== 1)) throw new FocusDataError("unsupported");
  return { ...after, customSessionSelection: { ...raw as object | undefined, version:1, id:customFocusId(after,"session"), fieldRevision:focusFieldRevision(after,"session"), armedAt:now } };
}
export function recordCustomClaim(entry: FocusEntry, token: CustomSessionToken): FocusEntry {
  const old = customReceipts(entry);
  return { ...entry, customSessionReceipts: { ...old, seen: { ...old.seen, [token.id]: token.cycle } } };
}
