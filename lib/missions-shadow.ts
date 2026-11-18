/**
 * Q4.2 — server mission validation in SHADOW mode (docs/q4-2-mission-shadow.md).
 *
 * The server repeats the QH-6.6 mission check (lib/missions.ts, the same rules) on the user's CLOUD journal and compares
 * its answer with what the app decided. Pure: no network, no storage, no economy. Nothing here — and nothing that calls
 * it — gives or takes XP, Coins, levels, achievements, chronicle events or ledger rows.
 *
 * A shadow answer is never a payment authorisation: until the server keeps the game day itself (Q4.3: the day set, the
 * accepted missions, the claims of the day, what is already paid), it cannot know whether the mission was assigned and
 * still open. Every result says so (`payout: "not_authorized"`, `unverified`).
 */
import { addDaysToKey, dayKeyInZone } from "./day-key";
import { MISSION_IDS, candidateSources, explainMission, isMissionId, type MissionData, type MissionId, type MissionReason } from "./missions";
import type { Note, Trade, TradingPlan } from "./journal/types";

/** The cloud tables a mission can be confirmed from (the same as game_mission_sources of 0014). */
export type ShadowTable = "journal_day_plans" | "journal_notes" | "journal_trades";
export const SHADOW_TABLES: readonly ShadowTable[] = ["journal_day_plans", "journal_notes", "journal_trades"];

/** One cloud row as the server reads it (columns of 0004; `updated_at` is set by the server on every write). */
export interface CloudRow {
  id: string;
  data: Record<string, unknown>;
  /** Server time of the last write. */
  updated_at: string;
  /** Filled by the 0004 trigger from data.updatedAt; the version the 0014 award compares. */
  client_updated_at: string;
  deleted_at: string | null;
}

export interface CloudJournal {
  plans: CloudRow[];
  notes: CloudRow[];
  trades: CloudRow[];
}

/** What the app decided for one mission (sent by the app; never trusted, only compared). */
export interface ClientDecision {
  id: MissionId;
  /** The app's game day. */
  day: string;
  /** The app counted the mission as done (paid now or before). */
  done: boolean;
  /** The record the app used, e.g. `note:n_1`, `plan:2026-11-18:prep`. */
  source?: string;
  /** Why the app refused (a MissionReason or a VerifyFailure reason). */
  reason?: string;
}

export interface ShadowRequest {
  missions: ClientDecision[];
}

/** How the server identifies the record it checked (the evidence a Q4.3 award would pass to game_apply_reward). */
export interface ShadowEvidence {
  table: ShadowTable;
  id: string;
  /** client_updated_at — the version 0014 compares. */
  version: string;
  /** Fingerprint of the record's content (algorithm in `fpAlgo`). */
  fp: string;
}

/** What the server cannot confirm without its own game day (Q4.3: the day is kept by migration 0015 for accounts on the
 * server economy; until an account has an open server day, all five stay unconfirmed). */
export const UNVERIFIED_WITHOUT_DAY_STATE = ["daySet", "accepted", "dayClaims", "paidToday", "dayStarted"] as const;
export type Unverified = (typeof UNVERIFIED_WITHOUT_DAY_STATE)[number];

/** The account's own server day as game_my_day() returns it (0015; read with the person's session). */
export interface ServerDayView {
  current_day: string | null;
  day: {
    game_day: string;
    status: "open" | "closed";
    mode: string;
    core: string[];
    accepted: Record<string, string>;
    carried?: Record<string, string>;
  } | null;
  /** Missions paid on the current day (from the ledger). */
  paid: string[];
  /** Source keys already used by missions on the current day (table:id:part). */
  claims: string[];
}

/** What the server day says about one mission (only when the account has an open server day for the server's day). */
export interface ServerDayCheck {
  assigned: boolean;
  accepted: boolean;
  paid: boolean;
  dayFull: boolean;
  /** The record the server would use already paid another mission today. */
  sourceUsed: boolean;
}

/** Problems the server finds on its own (beyond the app's rules). */
export type ServerFlag =
  | "dayDiffers" // the app's game day is not the server's
  | "sourceNotConfirmed" // the app's record does not confirm the mission on the server
  | "sourceUnknownForm" // the app's source key is not one this mission can use
  | "stampAfterServerWrite" // the record says it was made later than the server received it (a record «from the future»)
  | "duplicateSource" // the app used one record for two missions in this request
  | "newerSchema" // a record written by a newer app version was left out
  | "badRecord" // a cloud row the server could not read was left out
  | "notAssigned" // the server day does not offer it now (another mode, or rest)
  | "notAccepted" // the server day has no acceptance for it
  | "alreadyPaid" // the server ledger already paid it today
  | "dayFull" // three missions already paid today on the server
  | "sourceUsed" // the record already paid another mission today on the server
  | "dayNotOpen"; // the account has a server day, but not for the server's day yet

export type Comparison =
  | "agree_done" // both: confirmed
  | "agree_not_done" // both: not confirmed
  | "client_only" // the app counted it, the server does not confirm it
  | "server_only" // the server would confirm it, the app did not count it
  | "source_differs"; // both confirmed, with different records

export interface ShadowMissionResult {
  id: MissionId;
  client: { day: string; done: boolean; source?: string; reason?: string };
  server: {
    confirmed: boolean;
    /** Every record that would confirm it today (record ids only, never their text). */
    sources: string[];
    reason?: MissionReason;
    evidence?: ShadowEvidence;
    /** The server day's answer (absent while the account has no open server day for this day). */
    day?: ServerDayCheck;
    flags: ServerFlag[];
  };
  comparison: Comparison;
  payout: "not_authorized";
  unverified: Unverified[];
}

export interface ShadowResult {
  mode: "shadow";
  authorizedForPayout: false;
  serverDay: string;
  timezone: string;
  /** The account zone was missing or unknown: the server counted the day in UTC (as game_day_for would not). */
  timezoneFallback: boolean;
  results: ShadowMissionResult[];
  unverified: Unverified[];
  fpAlgo: string;
  /** Rows left out of the check (newer schema, unreadable) — counts only. */
  skipped: { newerSchema: number; badRecord: number };
}

export type ParseResult = { ok: true; request: ShadowRequest } | { ok: false; error: "bad_request" };

/** At most one request per mission (10). */
export const SHADOW_MAX_MISSIONS = MISSION_IDS.length;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_RE = /^(note|trade|plan):[A-Za-z0-9_.:-]{1,120}$/;
const REASON_RE = /^[A-Za-z]{1,40}$/;

/** Strict reading of the request body: unknown fields, wrong types or too many missions — refused as a whole. */
export function parseShadowRequest(body: unknown): ParseResult {
  const bad = { ok: false, error: "bad_request" } as const;
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== "missions")) return bad;
  if (!Array.isArray(b.missions) || b.missions.length === 0 || b.missions.length > SHADOW_MAX_MISSIONS) return bad;
  const seen = new Set<string>();
  const missions: ClientDecision[] = [];
  for (const m of b.missions) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return bad;
    const x = m as Record<string, unknown>;
    if (Object.keys(x).some((k) => !["id", "day", "done", "source", "reason"].includes(k))) return bad;
    if (typeof x.id !== "string" || !isMissionId(x.id) || seen.has(x.id)) return bad;
    if (typeof x.day !== "string" || !DAY_RE.test(x.day) || Number.isNaN(Date.parse(`${x.day}T00:00:00Z`))) return bad;
    if (typeof x.done !== "boolean") return bad;
    if (x.source !== undefined && (typeof x.source !== "string" || !SOURCE_RE.test(x.source))) return bad;
    if (x.reason !== undefined && (typeof x.reason !== "string" || !REASON_RE.test(x.reason))) return bad;
    seen.add(x.id);
    missions.push({ id: x.id, day: x.day, done: x.done, ...(x.source ? { source: x.source as string } : {}), ...(x.reason ? { reason: x.reason as string } : {}) });
  }
  return { ok: true, request: { missions } };
}

/** The account zone if the runtime knows it; otherwise UTC (and the result says so). */
export function serverZone(timezone: string | null | undefined): { zone: string; fallback: boolean } {
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
      return { zone: timezone, fallback: false };
    } catch {
      /* unknown zone id */
    }
  }
  return { zone: "UTC", fallback: true };
}

/** The server's game day: server time in the account zone (what game_day_for of 0014 computes). */
export const serverGameDay = (now: Date, zone: string) => dayKeyInZone(now, zone);

/** The tables and ids a source key names (a plan part names the plan row of its date). */
export function sourceRow(source: string): { table: ShadowTable; id: string } | null {
  const [kind, id] = source.split(":");
  if (!id) return null;
  if (kind === "note") return { table: "journal_notes", id };
  if (kind === "trade") return { table: "journal_trades", id };
  if (kind === "plan") return { table: "journal_day_plans", id };
  return null;
}

/** The source forms a mission can use (as candidateSources builds them; the same pairs as game_mission_sources). */
function sourceFits(id: MissionId, source: string, day: string): boolean {
  const tomorrow = addDaysToKey(day, 1);
  switch (id) {
    case "q_bias":
      return source === `plan:${day}:prep`;
    case "q_riskcheck":
      return source === `plan:${day}:risk`;
    case "q_reflect":
      return source === `plan:${day}:review` || /^note:[^:]+$/.test(source);
    case "m_day_state":
      return source === `plan:${day}:review`;
    case "m_plan_tomorrow":
      return source === `plan:${tomorrow}:made`;
    case "m_trade_review":
      return /^trade:[^:]+:review$/.test(source);
    default:
      return /^note:[^:]+$/.test(source);
  }
}

const iso = (v: unknown): number | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);

/**
 * The time that puts a record on the day (what the rule reads): a note's creation, a trade's review, a plan's first
 * save / confirmation / review. The server compares it with its own write time: a record cannot have been made later than
 * the server first held this version of it.
 */
function dayStamp(source: string, rec: Record<string, unknown>, zone: string, day: string): number | null {
  if (source.startsWith("note:")) return iso(rec.createdAt);
  if (source.startsWith("trade:")) return iso(rec.reviewedAt);
  if (source.endsWith(":review")) return iso((rec.review as Record<string, unknown> | undefined)?.completedAt);
  // prep / risk / made: the stamp that is on the day (made that day, or confirmed that day)
  const stamps = [iso(rec.firstSavedAt) ?? iso(rec.createdAt), iso(rec.prepConfirmedAt)].filter((t): t is number => t !== null);
  const onDay = stamps.filter((t) => dayKeyInZone(new Date(t), zone) === day || source.endsWith(":made"));
  return onDay.length ? Math.max(...onDay) : stamps.length ? Math.max(...stamps) : null;
}

export interface ShadowInput {
  now: Date;
  timezone: string | null | undefined;
  journal: CloudJournal;
  request: ShadowRequest;
  /** Fingerprint of a record's data (server: sha256 of canonical JSON). */
  fingerprint: (data: Record<string, unknown>) => string;
  fpAlgo: string;
  /** The highest journal schema the server understands (lib/journal/repository CURRENT_JOURNAL_SCHEMA_VERSION). */
  schemaVersion: number;
  /** Clock skew the 0004 trigger allows (5 min). */
  skewMs: number;
  /** The account's server day (0015), or null/absent when there is none (local accounts, 0015 not applied). */
  serverDay?: ServerDayView | null;
}

/** The source key the 0014 award writes for a record of a mission (table:id:part, game_mission_sources). */
export function claimKeyOf(source: string): string | null {
  const parts = source.split(":");
  if (parts[0] === "note" && parts.length === 2) return `journal_notes:${parts[1]}:`;
  if (parts[0] === "trade" && parts.length === 3) return `journal_trades:${parts[1]}:${parts[2]}`;
  if (parts[0] === "plan" && parts.length === 3) return `journal_day_plans:${parts[1]}:${parts[2]}`;
  return null;
}

/** Cloud rows → the app's MissionData (deleted rows included, as the app reads them; tombstones from `deleted_at`). */
function toMissionData(journal: CloudJournal, zone: string, schemaVersion: number, skipped: ShadowResult["skipped"]) {
  const index = new Map<string, CloudRow>();
  const read = <T>(table: ShadowTable, rows: CloudRow[]): T[] => {
    const out: T[] = [];
    for (const r of rows) {
      const d = r?.data;
      if (!r || typeof r.id !== "string" || !d || typeof d !== "object" || Array.isArray(d) || typeof r.updated_at !== "string") {
        skipped.badRecord++;
        continue;
      }
      if (typeof d.schemaVersion === "number" && d.schemaVersion > schemaVersion) {
        skipped.newerSchema++;
        continue;
      }
      const rec: Record<string, unknown> = { ...d };
      // the server's tombstone wins over a record that claims to be live
      if (r.deleted_at && !rec.deletedAt) rec.deletedAt = r.deleted_at;
      index.set(`${table}:${r.id}`, r);
      out.push(rec as T);
    }
    return out;
  };
  const data: MissionData = {
    plans: read<TradingPlan>("journal_day_plans", journal.plans),
    notes: read<Note>("journal_notes", journal.notes),
    trades: read<Trade>("journal_trades", journal.trades),
    timezone: zone,
  };
  return { data, index };
}

function compare(clientDone: boolean, serverConfirmed: boolean, clientSource: string | undefined, serverSources: string[]): Comparison {
  if (clientDone && serverConfirmed) return !clientSource || serverSources.includes(clientSource) ? "agree_done" : "source_differs";
  if (!clientDone && !serverConfirmed) return "agree_not_done";
  return clientDone ? "client_only" : "server_only";
}

/** The shadow check of every mission in the request. Same input → same answer (two tabs, repeats). */
export function shadowValidate(input: ShadowInput): ShadowResult {
  const { zone, fallback } = serverZone(input.timezone);
  // the game day never goes back: the server day's cursor wins over an earlier date in the zone (0015 game_day_now)
  const zoneDay = serverGameDay(input.now, zone);
  const cursor = input.serverDay?.current_day ?? null;
  const day = cursor && cursor > zoneDay ? cursor : zoneDay;
  const sd = input.serverDay?.day && input.serverDay.day.game_day === day && input.serverDay.day.status === "open" ? input.serverDay : null;
  const hasServerDay = !!input.serverDay?.day;
  const skipped = { newerSchema: 0, badRecord: 0 };
  const { data, index } = toMissionData(input.journal, zone, input.schemaVersion, skipped);
  const unverified: Unverified[] = sd ? [] : [...UNVERIFIED_WITHOUT_DAY_STATE];

  // a record the app used for two missions of this request
  const bySource = new Map<string, number>();
  for (const m of input.request.missions) if (m.done && m.source) bySource.set(m.source, (bySource.get(m.source) || 0) + 1);

  const stampOk = (source: string): boolean => {
    const at = sourceRow(source);
    const row = at && index.get(`${at.table}:${at.id}`);
    if (!row) return false;
    const stamp = dayStamp(source, row.data, zone, day);
    const wrote = Date.parse(row.updated_at);
    return stamp !== null && !Number.isNaN(wrote) && stamp <= wrote + input.skewMs;
  };

  const results: ShadowMissionResult[] = input.request.missions.map((m) => {
    const flags: ServerFlag[] = [];
    if (m.day !== day) flags.push("dayDiffers");
    if (m.done && m.source && (bySource.get(m.source) || 0) > 1) flags.push("duplicateSource");
    // the app's rules on the cloud copy, for the SERVER's day
    const ruleSources = candidateSources(m.id, data, day);
    // server-only: the record's day stamp must not be later than the server's write of it
    const sources = ruleSources.filter(stampOk);
    if (sources.length < ruleSources.length && (!m.source || ruleSources.includes(m.source))) flags.push("stampAfterServerWrite");
    let reason: MissionReason | undefined;
    if (ruleSources.length === 0) reason = explainMission(m.id, data, day)?.reason;
    if (m.done && m.source) {
      if (!sourceFits(m.id, m.source, day)) flags.push("sourceUnknownForm");
      else if (!sources.includes(m.source)) flags.push("sourceNotConfirmed");
    }
    if (skipped.newerSchema) flags.push("newerSchema");
    if (skipped.badRecord) flags.push("badRecord");
    // the server day (0015): was it offered and accepted, is it paid, is the day full, is the record taken
    let dayCheck: ServerDayCheck | undefined;
    if (sd) {
      const d = sd.day!;
      const paid = sd.paid.includes(m.id);
      const pickKey = (m.source && claimKeyOf(m.source)) || (sources[0] && claimKeyOf(sources[0])) || null;
      dayCheck = {
        assigned: d.mode !== "rest" && d.core.includes(m.id),
        accepted: Object.prototype.hasOwnProperty.call(d.accepted || {}, m.id),
        paid,
        dayFull: sd.paid.length >= 3,
        sourceUsed: !paid && !!pickKey && sd.claims.includes(pickKey),
      };
      if (!dayCheck.assigned) flags.push("notAssigned");
      if (!dayCheck.accepted && !paid) flags.push("notAccepted");
      if (paid) flags.push("alreadyPaid");
      if (dayCheck.dayFull && !paid) flags.push("dayFull");
      if (dayCheck.sourceUsed) flags.push("sourceUsed");
    } else if (hasServerDay) {
      flags.push("dayNotOpen");
    }
    const confirmed = sources.length > 0;
    // the evidence a Q4.3 award would name: the app's record when the server confirms it, else the server's first one
    const pick = m.source && sources.includes(m.source) ? m.source : sources[0];
    let evidence: ShadowEvidence | undefined;
    if (pick) {
      const at = sourceRow(pick)!;
      const row = index.get(`${at.table}:${at.id}`)!;
      evidence = { table: at.table, id: at.id, version: row.client_updated_at, fp: input.fingerprint(row.data) };
    }
    return {
      id: m.id,
      client: { day: m.day, done: m.done, ...(m.source ? { source: m.source } : {}), ...(m.reason ? { reason: m.reason } : {}) },
      server: { confirmed, sources, ...(reason ? { reason } : {}), ...(evidence ? { evidence } : {}), ...(dayCheck ? { day: dayCheck } : {}), flags },
      comparison: compare(m.done, confirmed, m.source, sources),
      payout: "not_authorized",
      unverified,
    };
  });

  return { mode: "shadow", authorizedForPayout: false, serverDay: day, timezone: zone, timezoneFallback: fallback, results, unverified, fpAlgo: input.fpAlgo, skipped };
}

/** The evidence rows of a result (re-read after the check to see whether anything changed meanwhile). */
export function evidenceOf(result: ShadowResult): ShadowEvidence[] {
  return result.results.flatMap((r) => (r.server.evidence ? [r.server.evidence] : []));
}

/**
 * The evidence still names the same version and content (re-read after the check). A changed or deleted record makes
 * the whole answer stale: the caller answers `evidence_changed` and the app may ask again.
 */
export function evidenceStable(before: ShadowEvidence[], after: Map<string, CloudRow>, fingerprint: (d: Record<string, unknown>) => string): boolean {
  return before.every((e) => {
    const row = after.get(`${e.table}:${e.id}`);
    return !!row && !row.deleted_at && row.client_updated_at === e.version && fingerprint(row.data) === e.fp;
  });
}
