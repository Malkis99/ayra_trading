/**
 * Q4.7-Б1 — deleting one's own account, files included (docs/q4-7-b1-account-deletion-storage.md).
 *
 *   GET  /api/account/delete   — the state of the person's own deletion (none / requested / files_listed / files_deleted)
 *   POST /api/account/delete   { confirm, action: "send_code" } — a one-time code to the account's e-mail (0024)
 *   POST /api/account/delete   { confirm, password? | code? } — starts or continues it, until the account is gone
 *
 * The person is the verified session's user only (never an id from the request). Every POST needs the typed confirmation
 * and a proof made now that it is them (P5 remediation: a recent sign-in is not one — the token's `amr` cannot tell a
 * password-recovery link from a magic link): their password, checked by the auth server, or a one-time e-mail code — the
 * database opens a challenge for this account and this deletion (expiry, tries, one use), the auth server sends the code
 * and later checks it, and the account it belongs to must be this one. Then, with the service key and the database's
 * steps (0023): the request (no more journal writes or uploads), the other devices signed out, the server's file list,
 * removal through the Storage API until nothing is left, the database's check, the auth user deleted (every row goes
 * with it). Any failure answers «retry» with what is left; nothing is called done before the auth user is deleted.
 */
import type { RateLimiter } from "@/lib/game-server/rate-limit";

/** A one-time e-mail code as the auth server makes them (its length is a project setting: 6–10 digits). */
export const CODE_RE = /^[0-9]{6,10}$/;
/** What the person types to confirm (either language). */
export const DELETE_PHRASES = ["УДАЛИТЬ", "DELETE"] as const;
/** At most this many rounds of «list → remove» per request (each removes up to a page of 1000 files). */
export const MAX_ROUNDS = 25;
export const DELETION_RATE = { limit: 10, windowMs: 60_000 };

export interface DeletionUser {
  id: string;
  email: string | null;
}

export type DeletionState = null | "requested" | "files_listed" | "files_deleted";

export interface DeletionStatus {
  state: DeletionState;
  listed?: number;
  gone?: number;
  attempts?: number;
  lastError?: string | null;
}

export interface DeletionDeps {
  enabled: boolean;
  getUser(): Promise<DeletionUser | null>;
  /** the auth server checks the password (no session is kept from it) */
  verifyPassword(email: string, password: string): Promise<boolean>;
  /** the auth server sends a one-time code to this e-mail (never creates an account) */
  sendCode(email: string): Promise<{ error: null | "rate_limited" | "failed" }>;
  /** the auth server checks the code for this e-mail: the account it belongs to (no session is kept), or null */
  verifyCode(email: string, code: string): Promise<{ userId: string } | null>;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  /** the Storage API with the service key: removes these names of the bucket; answers the names it removed */
  removeFiles(bucket: string, names: string[]): Promise<{ removed: string[]; error: string | null }>;
  /** ends the person's sessions on every other device (this one ends with the account) */
  signOutOthers(): Promise<{ error: string | null }>;
  deleteAuthUser(id: string): Promise<{ error: string | null; notFound?: boolean }>;
  limiter: RateLimiter;
  now(): number;
}

export interface DeletionResult {
  status: number;
  body: Record<string, unknown>;
}

export { accountDeletionEnabled } from "./flag";

const errorCode = (message: string | undefined) => (message?.match(/account_deletion_[a-z_]+/)?.[0] ?? null);

async function status(deps: DeletionDeps, userId: string): Promise<DeletionStatus | null> {
  const { data, error } = await deps.rpc("account_deletion_status", { p_user: userId });
  if (error || !data || typeof data !== "object") return null;
  return data as DeletionStatus;
}

const refuse = (error: string, extra: Record<string, unknown> = {}): DeletionResult => ({ status: 403, body: { error, ...extra } });
const CHALLENGE_REFUSAL: Record<string, string> = { none: "code_required", expired: "code_expired", used: "code_used", too_many: "code_too_many" };

/**
 * A proof made now that it is the person, or the refusal. Fails closed: anything unexpected (a database or auth server
 * error, an answer of another shape, another account) is a refusal, never a pass.
 */
async function proveItIsThem(deps: DeletionDeps, user: DeletionUser, body: { password?: unknown; code?: unknown }): Promise<DeletionResult | null> {
  if (typeof body.password === "string" && body.password.length > 0) {
    if (!user.email || !(await deps.verifyPassword(user.email, body.password))) return refuse("wrong_password");
    return null;
  }
  if (typeof body.code === "string" && body.code.trim().length > 0) {
    const code = body.code.trim();
    if (!user.email || !CODE_RE.test(code)) return refuse("code_invalid");
    // the try is counted before the auth server sees the code (a wrong code spends it)
    const t = await deps.rpc("account_deletion_challenge_try", { p_user: user.id });
    const tr = t.data as { ok?: unknown; reason?: unknown } | null;
    if (t.error || !tr || typeof tr !== "object") return { status: 503, body: { error: "unavailable" } };
    if (tr.ok !== true) return refuse(CHALLENGE_REFUSAL[String(tr.reason)] ?? "code_required");
    const v = await deps.verifyCode(user.email, code);
    if (!v || v.userId !== user.id) return refuse("code_invalid");
    // spent once: a second use (or one racing this) gets FALSE
    const used = await deps.rpc("account_deletion_challenge_use", { p_user: user.id });
    if (used.error || used.data !== true) return refuse("code_used");
    return null;
  }
  return refuse("reauth_required", { methods: ["password", "code"] });
}

export async function handleAccountDeletion(req: Request, deps: DeletionDeps): Promise<DeletionResult> {
  if (!deps.enabled) return { status: 404, body: { error: "not_found" } };
  const user = await deps.getUser();
  if (!user) return { status: 401, body: { error: "not_signed_in" } };
  if (!deps.limiter.take(user.id, deps.now()).ok) return { status: 429, body: { error: "rate_limited" } };

  if (req.method === "GET") {
    const st = await status(deps, user.id);
    if (!st) return { status: 503, body: { error: "unavailable" } };
    return { status: 200, body: { ...st } };
  }
  if (req.method !== "POST") return { status: 405, body: { error: "method_not_allowed" } };

  let body: { confirm?: unknown; password?: unknown; code?: unknown; action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return { status: 400, body: { error: "bad_request" } };
  }
  // the typed confirmation, every time (also when continuing an unfinished deletion)
  if (typeof body.confirm !== "string" || !(DELETE_PHRASES as readonly string[]).includes(body.confirm.trim())) {
    return { status: 400, body: { error: "confirm_required" } };
  }
  // a one-time code to the account's e-mail: a new challenge first (the database limits how often), then the letter
  if (body.action === "send_code") {
    if (!user.email) return refuse("code_unavailable");
    const issued = await deps.rpc("account_deletion_challenge_issue", { p_user: user.id });
    if (issued.error) {
      const code = errorCode(issued.error.message);
      return code === "account_deletion_challenge_too_soon" ? { status: 429, body: { error: "code_too_soon" } } : { status: 503, body: { error: "unavailable" } };
    }
    const sent = await deps.sendCode(user.email);
    if (sent.error === "rate_limited") return { status: 429, body: { error: "code_too_soon" } };
    if (sent.error) return { status: 503, body: { error: "code_not_sent" } };
    const info = (issued.data && typeof issued.data === "object" ? issued.data : {}) as { expiresInSec?: number; maxTries?: number };
    return { status: 200, body: { challenge: "sent", expiresInSec: info.expiresInSec ?? null, maxTries: info.maxTries ?? null } };
  }
  if (body.action !== undefined) return { status: 400, body: { error: "bad_request" } };

  // it is really them, every time (also when continuing an unfinished deletion)
  const refused = await proveItIsThem(deps, user, body);
  if (refused) return refused;

  const fail = async (code: string, http = 503): Promise<DeletionResult> => {
    await deps.rpc("account_deletion_failed", { p_user: user.id, p_code: code });
    const st = await status(deps, user.id);
    return { status: http, body: { error: code, retry: true, ...(st ?? {}) } };
  };

  // 1. the request: from now on no journal write and no upload for this account
  const begun = await deps.rpc("account_deletion_begin", { p_user: user.id });
  if (begun.error) {
    const code = errorCode(begun.error.message);
    return { status: code === "account_deletion_no_user" ? 410 : 503, body: { error: code ?? "unavailable", retry: code !== "account_deletion_no_user" } };
  }
  // 2. the other devices signed out (their tokens can no longer reach the economy; journal and uploads are closed already)
  if ((await deps.signOutOthers()).error) return fail("sign_out_failed");

  // 3. the server's list → the Storage API removes → the list again (the database checks Storage itself)
  let left = -1;
  let stalledAt = -1; // the count when a round removed nothing (another request may have removed them meanwhile)
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const m = await deps.rpc("account_deletion_manifest", { p_user: user.id });
    if (m.error) {
      const code = errorCode(m.error.message);
      // the request is gone only with the account (no cancel): another request of the person finished it
      if (code === "account_deletion_not_requested") return { status: 200, body: { state: "deleted" } };
      // a file in the folder the account did not upload: stopped for the owner (nothing is deleted or skipped)
      return code === "account_deletion_foreign_object" ? fail("foreign_object", 409) : fail("manifest_failed");
    }
    const manifest = m.data as { pending: Array<{ bucket: string; name: string }>; pendingCount: number };
    left = manifest.pendingCount;
    if (left === 0) break;
    // a round removed nothing and the list did not shrink since: Storage refuses them — stop (never an endless loop)
    if (stalledAt !== -1 && left >= stalledAt) return fail("storage_error");
    stalledAt = -1;
    const byBucket = new Map<string, string[]>();
    for (const p of manifest.pending) byBucket.set(p.bucket, [...(byBucket.get(p.bucket) || []), p.name]);
    let removed = 0;
    for (const [bucket, names] of byBucket) {
      const out = await deps.removeFiles(bucket, names);
      removed += out.removed.length;
      if (out.error) return fail("storage_error");
    }
    if (removed === 0) stalledAt = left;
  }
  if (left !== 0) return fail("files_left");

  // 4. the database's own check (no file of the account left anywhere), then the auth user and every row with it
  const ready = await deps.rpc("account_deletion_ready", { p_user: user.id });
  if (ready.error && errorCode(ready.error.message) === "account_deletion_not_requested") return { status: 200, body: { state: "deleted" } };
  if (ready.error) return fail(errorCode(ready.error.message) === "account_deletion_files_left" ? "files_left" : "ready_failed");
  const del = await deps.deleteAuthUser(user.id);
  if (del.error && !del.notFound) return fail("auth_delete_failed");
  return { status: 200, body: { state: "deleted" } };
}
