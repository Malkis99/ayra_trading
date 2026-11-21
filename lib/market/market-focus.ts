import type { InstrumentId } from "./instruments";

export const FOCUS_FIELDS = {
  direction: ["bullish", "bearish", "neutral"],
  poi: ["fvg", "orderBlock", "liquidity"],
  mss: ["waiting", "bullish", "bearish", "notConfirmed"],
  session: ["london", "newYork", "none"],
} as const;
export const FOCUS_CHECKS = ["poiReached", "liquiditySweep", "displacement", "mssCisd", "retracementTest", "reaction"] as const;
export type FocusField = keyof typeof FOCUS_FIELDS;
export type FocusCheck = typeof FOCUS_CHECKS[number];
export type FocusValues = { [K in FocusField]: typeof FOCUS_FIELDS[K][number] | null };
export type FocusPatch = { [K in FocusField]: { field: K; value: FocusValues[K] } }[FocusField] | { check: FocusCheck; value: boolean };
export type FocusEntry = FocusValues & {
  version: 1; spaceId: string; instrumentId: InstrumentId; revision: number;
  checklist: Record<FocusCheck, boolean> & Record<string, unknown>;
} & Record<string, unknown>;
export class FocusDataError extends Error {
  constructor(readonly kind: "invalid" | "unsupported" | "storage") { super(`market_focus_${kind}`); }
}
export const emptyFocus = (spaceId: string, instrumentId: InstrumentId): FocusEntry => ({
  version: 1, spaceId, instrumentId, revision: 0, direction: null, poi: null, mss: null, session: null,
  checklist: { poiReached: false, liquiditySweep: false, displacement: false, mssCisd: false, retracementTest: false, reaction: false },
});
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function parseFocus(raw: unknown, spaceId: string, id: InstrumentId): FocusEntry {
  if (raw === undefined) return emptyFocus(spaceId, id);
  if (object(raw) && typeof raw.version === "number" && raw.version > 1) throw new FocusDataError("unsupported");
  if (!object(raw) || raw.version !== 1 || raw.spaceId !== spaceId || raw.instrumentId !== id || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1
    || !object(raw.checklist) || !FOCUS_CHECKS.every(k => typeof (raw.checklist as Record<string, unknown>)[k] === "boolean")
    || !Object.entries(FOCUS_FIELDS).every(([k, values]) => raw[k] === null || (values as readonly unknown[]).includes(raw[k]))) throw new FocusDataError("invalid");
  return raw as FocusEntry;
}
export function patchFocus(entry: FocusEntry, patch: FocusPatch): FocusEntry {
  if ("check" in patch) {
    if (!FOCUS_CHECKS.includes(patch.check) || typeof patch.value !== "boolean") throw new FocusDataError("invalid");
    return { ...entry, checklist: { ...entry.checklist, [patch.check]: patch.value } };
  }
  if (!Object.prototype.hasOwnProperty.call(FOCUS_FIELDS, patch.field) || (patch.value !== null && !(FOCUS_FIELDS[patch.field] as readonly unknown[]).includes(patch.value))) throw new FocusDataError("invalid");
  return { ...entry, [patch.field]: patch.value };
}
export function clearedFocus(entry: FocusEntry): FocusEntry {
  const blank = emptyFocus(entry.spaceId, entry.instrumentId);
  return { ...entry, direction: null, poi: null, mss: null, session: null, checklist: { ...entry.checklist, ...blank.checklist } };
}
export const hasFocus = (entry: FocusEntry) => Object.keys(FOCUS_FIELDS).some(k => entry[k] !== null) || FOCUS_CHECKS.some(k => entry.checklist[k]);
