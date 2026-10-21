import type { Account, JournalPreferences, JournalUnit, TradeSession } from "./types";

/**
 * Journal settings of the account (docs/journal-setup-plan.md): default unit, main account, default session.
 * Kept in the journal document next to primaryPropAccountId and synced in the same cloud row (`journal_settings`),
 * «newer wins», no dialog. Nothing set = the app behaves as before (last used account, last unit switch, no session).
 */
export const JOURNAL_UNITS: readonly JournalUnit[] = ["R", "money", "percent"];
const SESSIONS: readonly TradeSession[] = ["asia", "london", "newyork", "overlap", "other"];

/** Only known values survive (data from the cloud or an old device may carry anything). */
export function sanitizePreferences(raw: unknown): JournalPreferences | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: JournalPreferences = {};
  if (JOURNAL_UNITS.includes(r.defaultUnit as JournalUnit)) out.defaultUnit = r.defaultUnit as JournalUnit;
  if (typeof r.mainAccountId === "string" && r.mainAccountId) out.mainAccountId = r.mainAccountId;
  if (SESSIONS.includes(r.defaultSession as TradeSession)) out.defaultSession = r.defaultSession as TradeSession;
  return Object.keys(out).length ? out : undefined;
}

/** Account picked in a new trade and in the import wizard: the main account if it is still active, else the last used, else the first. */
export function defaultAccountId(prefs: JournalPreferences | undefined, lastUsedId: string | null | undefined, activeAccounts: Pick<Account, "id">[]): string {
  const active = (id: string | null | undefined) => Boolean(id && activeAccounts.some((a) => a.id === id));
  if (active(prefs?.mainAccountId)) return prefs!.mainAccountId!;
  if (active(lastUsedId)) return lastUsedId!;
  return activeAccounts[0]?.id ?? "";
}

/** Unit the Journal opens with: the default from settings, else the last switch on this device, else R. */
export function initialUnit(prefs: JournalPreferences | undefined, lastSwitch: string | null | undefined): JournalUnit {
  if (prefs?.defaultUnit) return prefs.defaultUnit;
  return JOURNAL_UNITS.includes(lastSwitch as JournalUnit) ? (lastSwitch as JournalUnit) : "R";
}
