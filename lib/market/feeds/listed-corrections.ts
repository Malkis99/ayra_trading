import type { EventRow } from "./types";
import { isCpiCode } from "./cpi";

export interface ListedCorrection { starts_at?: string; cancelled?: boolean; sequence: number; official_url: string }
/** Reviewed official corrections only. Keep the original ID/reference period; never move a weekly anchor. */
export const LISTED_CORRECTIONS: Readonly<Record<string, ListedCorrection>> = {};

export function applyListedCorrections(rows: EventRow[], corrections = LISTED_CORRECTIONS): EventRow[] {
  return rows.map((row) => {
    const correction = corrections[row.id] || (isCpiCode(row.code) ? corrections[row.id.replace(`:${row.code}:`, ":us_cpi:")] : undefined);
    if (!correction) return row;
    if (!Number.isInteger(correction.sequence) || correction.sequence < 1 || !correction.official_url.startsWith("https://") || (correction.starts_at && !Number.isFinite(Date.parse(correction.starts_at)))) throw new Error("invalid reviewed schedule correction");
    return { ...row, starts_at: correction.starts_at || row.starts_at,
      schedule_meta: { ...row.schedule_meta, sequence: correction.sequence, ...(correction.cancelled === undefined ? {} : { cancelled: correction.cancelled }) } };
  });
}
