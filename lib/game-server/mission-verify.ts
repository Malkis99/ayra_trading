/**
 * Q4.4 — the server mission check behind POST /api/game/missions/verify (docs/q4-4-server-day-api.md, section 5).
 *
 * The full chain a paying award will use: the server day (open, the mission assigned for its mode, accepted, not paid,
 * the day not full, game_sync on) → the Journal rows as Postgres has them (version = client_updated_at, fingerprint =
 * md5(data::text), the first server trace) → the app's mission rules (lib/missions.ts) on the SERVER's day → the
 * server-only checks (the record's day stamp not later than the server's write; the record first reached the server
 * on that day, or was saved there that day) → game_apply_reward with exactly that version and fingerprint, which
 * re-checks them under a row lock.
 *
 * PAYOUTS STAY OFF: the route calls the award only when AYRA_SERVER_MISSION_PAYOUTS=1 (never set), and even then the
 * database refuses while the «mission» award kind is disabled (0014). Until then the answer is
 * `{ paid: false, reason: "payout_disabled" }` after a full check.
 */
import { JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS } from "@/lib/journal/cloud/config";
import { CURRENT_JOURNAL_SCHEMA_VERSION } from "@/lib/journal/repository";
import { dayKeyInZone } from "@/lib/day-key";
import { candidateSources, explainMission, isMissionId, type MissionId } from "@/lib/missions";
import { dayStamp, serverZone, sourceRow, toMissionData, type CloudJournal, type CloudRow, type ShadowTable } from "@/lib/missions-shadow";
import { gate, readJson, refusalOf, reply, sessionGate, type ApiHttp, type DayApiDeps } from "./day-api";

export const missionPayoutsEnabled = () => process.env.AYRA_SERVER_MISSION_PAYOUTS === "1";
export const VERIFY_MAX_ROWS = 5000;

/** A Journal row as game_journal_for_check returns it (0016). */
export interface CheckRow extends CloudRow {
  fp: string;
  first_seen_at: string | null;
}
interface CheckJournal {
  notes: CheckRow[];
  trades: CheckRow[];
  plans: CheckRow[];
  rows: number;
}
interface ServerDayStatus {
  state: string;
  game_sync: boolean;
  game_day?: string;
  day: null | { game_day: string; mode: string; core: string[]; accepted: Record<string, string>; paid: string[]; timezone: string };
  day_full?: boolean;
}

/**
 * The server trace of a record (0016 first_seen_at): a record that makes the day by being CREATED (a note, a plan made
 * that day, tomorrow's plan) must have first reached the server on that day; one that makes it by being UPDATED (a trade
 * review, a day review, a plan confirmed that day) must have been saved there that day. Rows from before 0016 (no
 * trace) never count.
 */
export function traceOk(source: string, row: CheckRow, zone: string, day: string): boolean {
  if (!row.first_seen_at) return false;
  const seenDay = dayKeyInZone(new Date(row.first_seen_at), zone);
  const savedDay = dayKeyInZone(new Date(row.updated_at), zone);
  if (source.startsWith("note:") || source.endsWith(":made")) return seenDay === day;
  if (source.endsWith(":prep") || source.endsWith(":risk")) {
    const made = typeof row.data.firstSavedAt === "string" ? row.data.firstSavedAt : row.data.createdAt;
    const madeToday = typeof made === "string" && dayKeyInZone(new Date(made), zone) === day;
    return madeToday ? seenDay === day : savedDay === day;
  }
  return savedDay === day; // trade review, day review
}

export interface VerifyDeps extends DayApiDeps {
  payoutsEnabled: boolean;
}

/** The mission check (and, only when payouts are on, the award). */
export async function handleMissionVerify(req: Request, deps: VerifyDeps): Promise<ApiHttp> {
  const g = await gate(req, deps, false);
  if ("refused" in g) return g.refused;
  const json = await readJson(req, 512);
  if (!json.ok) return json.http;
  const b = json.body as Record<string, unknown>;
  if (!b || typeof b !== "object" || Object.keys(b).some((k) => k !== "mission") || typeof b.mission !== "string" || !isMissionId(b.mission)) {
    return reply(400, { error: "bad_request" });
  }
  const mission = b.mission as MissionId;
  const user = g.user.id;
  try {
    // 0. Q4.5-2: a session older than the account's state (or ended) gets nothing, not even the check
    const stale = await sessionGate(deps, g.user);
    if (stale) return stale;

    // 1. the server day
    const st = await deps.rpc("game_day_status", { p_user: user });
    if (st.error) {
      const r = refusalOf(st.error);
      return reply(r.status, { error: r.reason });
    }
    const s = st.data as ServerDayStatus;
    if (s.state !== "cloud_active") return reply(409, { error: "account_not_active" });
    if (!s.day || !s.game_day) return reply(409, { error: "day_not_open" });
    const day = s.day;
    if (day.mode === "rest" || !day.core.includes(mission)) return reply(409, { error: "mission_not_assigned" });
    if (!Object.prototype.hasOwnProperty.call(day.accepted || {}, mission)) return reply(409, { error: "mission_not_accepted" });
    if ((day.paid || []).includes(mission)) return reply(409, { error: "mission_paid" });
    if (s.day_full) return reply(409, { error: "day_cap" });
    if (!s.game_sync) return reply(409, { error: "sync_paused" });

    // 2. the Journal rows as Postgres has them
    const j = await deps.rpc("game_journal_for_check", { p_user: user, p_day: s.game_day });
    if (j.error) {
      const r = refusalOf(j.error);
      return reply(r.status, { error: r.reason });
    }
    const jr = j.data as CheckJournal;
    if (!jr || jr.rows > VERIFY_MAX_ROWS) return reply(422, { error: "journal_too_large" });
    const zone = serverZone(day.timezone).zone;
    const journal: CloudJournal = { notes: jr.notes || [], trades: jr.trades || [], plans: jr.plans || [] };
    const skipped = { newerSchema: 0, badRecord: 0 };
    const { data, index } = toMissionData(journal, zone, CURRENT_JOURNAL_SCHEMA_VERSION, skipped);
    const rowOf = (source: string): CheckRow | null => {
      const at = sourceRow(source);
      return at ? ((index.get(`${at.table}:${at.id}`) as CheckRow | undefined) ?? null) : null;
    };

    // 3. the app's rules on the server's day, then the server-only checks
    const ruleSources = candidateSources(mission, data, s.game_day);
    const sources = ruleSources.filter((src) => {
      const row = rowOf(src);
      if (!row) return false;
      const stamp = dayStamp(src, row.data, zone, s.game_day!);
      return stamp !== null && stamp <= Date.parse(row.updated_at) + JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS && traceOk(src, row, zone, s.game_day!);
    });
    if (sources.length === 0) {
      const why = ruleSources.length > 0 ? "not_seen_by_server" : explainMission(mission, data, s.game_day)?.reason ?? "not_confirmed";
      return reply(200, { paid: false, confirmed: false, reason: why });
    }

    // 4. payouts off: the check is complete, nothing is paid
    if (!deps.payoutsEnabled) return reply(200, { paid: false, confirmed: true, reason: "payout_disabled" });

    // 5. the award: exactly the version and fingerprint Postgres gave; it re-checks them under a row lock
    for (const src of sources) {
      const at = sourceRow(src)!;
      const row = rowOf(src)!;
      const evidence = [{ table: at.table as ShadowTable, id: at.id, version: row.client_updated_at, fp: row.fp }];
      // only through the session-checked award (0018): the database re-checks the session with the account row held
      const t = g.user.token;
      const a = await deps.rpc("game_apply_reward_for_session", {
        p_user: user, p_session: t.sessionId, p_iat: t.iat, p_claim: t.claim, p_kind: "mission", p_item: mission, p_evidence: evidence,
      });
      if (!a.error) return reply(200, { paid: true, confirmed: true, result: a.data as Record<string, unknown> });
      const r = refusalOf(a.error);
      if (r.reason === "source_used") continue; // that record paid another mission today: try the next one
      if (r.reason === "kind_disabled") return reply(200, { paid: false, confirmed: true, reason: "payout_disabled" });
      return reply(r.status, { error: r.reason });
    }
    return reply(409, { error: "source_used" });
  } catch {
    return reply(503, { error: "server_error" });
  }
}
