import { createHash } from "node:crypto";

/**
 * Fingerprint of a journal record's content for the shadow check (Q4.2): sha256 of the record as JSON with every
 * object's keys sorted. Server-only (node:crypto).
 *
 * It is NOT the 0014 award's fingerprint (`md5(data::text)`, computed by Postgres): until Q4.3 the shadow check only
 * compares its own two reads. A paying award must take version and fingerprint from Postgres itself (Q4.3 condition).
 */
export const SHADOW_FP_ALGO = "sha256-sorted-json-v1";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonical(v))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== "function")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function recordFingerprint(data: Record<string, unknown>): string {
  return createHash("sha256").update(canonical(data)).digest("hex");
}
