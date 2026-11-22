// Minimal in-memory stand-in for Supabase Auth (GoTrue), PostgREST and Storage (bucket of 0005), used only by e2e tests.
// It speaks the same HTTP API that @supabase/supabase-js and @supabase/ssr use, so the app
// runs its real PKCE magic-link flow: /otp -> email link -> /auth/callback?code -> /token?grant_type=pkce.
import http from "node:http";
import crypto from "node:crypto";
import { metadataWrite } from "./watchlist-meta.mjs";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function makeJwt(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 })
  );
  const sig = crypto.createHmac("sha256", "fake-e2e-secret").update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export function createFakeSupabase() {
  const usersByEmail = new Map();
  const profiles = new Map();
  const pendingCodes = new Map(); // code -> { email, challenge, method }
  const lastLinkByEmail = new Map();
  const tokens = new Map(); // access/refresh token -> user id
  const passwords = new Map(); // user id -> password (the real server keeps only a hash)
  const logouts = []; // scope of every /logout call ("global" when none given)
  const emailCodes = new Map(); // email -> { token, type: "signup" | "recovery" } — the 6-digit code of the last letter
  const lastCodeByEmail = new Map();
  let emailLimit = null; // "limit" | "soon": the next letters are refused like Supabase does (429)
  const sessionsByUser = new Map(); // user id -> Set of refresh tokens (for logout scope=others)
  const refreshOf = new Map(); // access token -> its refresh token
  const takenNicknames = new Set(["taken_nick", "admin"]);
  let createProfileRows = true; // false = handle_new_user trigger absent (new users get no profiles row)
  let profilesTableMissing = false; // true = migration 0001 not applied (PostgREST 404 PGRST205)
  let profileFailuresLeft = 0; // next N profile reads fail with 500 (flaky network / cold database)
  const cloudRequests = { userFeatures: 0, journal: 0 }; // T7b-3: the cloud journal must stay silent while the flag is off
  // Migration 0004 stand-in: cloud_sync flag per user and the journal tables (same rules as the server)
  const cloudFlags = new Map(); // user id -> boolean
  const journalRows = new Map(); // `${userId}:${table}:${id}` -> { user_id, table, id, data, updated_at }
  let journalReadFailuresLeft = 0; // next N journal reads fail with 500 (the cloud journal is unavailable)
  const myDays = new Map(); // user id -> game_my_day() payload (0015 server day)
  // 0014–0016 stand-in for the day API routes: off = «migrations not applied» (as on the real Supabase today)
  let economyInstalled = false;
  const economies = new Map(); // user id -> { state, game_sync, opening_mode, day }
  const economyCalls = []; // { fn, user, args } — what the routes asked (never a time or a day)
  const SERVICE_KEY = "fake-service-key";
  const FAKE_MODE_MISSIONS = { trading: ["q_bias", "q_riskcheck", "q_reflect"], study: ["m_observation", "m_backtest", "m_lesson"], recovery: ["m_day_state", "m_mistake", "m_plan_tomorrow"] };
  let journalWriteFailuresLeft = 0; // next N journal writes fail with 500 (server trouble)
  // Migration 0009 stand-in: the shared calendar events (everyone reads rows that are not hidden; tests fill them)
  let marketEvents = [];
  let marketEventsFail = false;
  let marketNews = [];
  let marketTableMissing = false; // the Market table of 0008 is not in the project (migration not applied)
  let journalWriteDelayMs = 0; // every journal write waits this long (slow network: lets a test cancel mid-upload)
  let journalClock = Date.now();
  const JOURNAL_ID_KEY = { journal_day_plans: "date", journal_week_plans: "weekStartDate" };
  // Migration 0005 stand-in: private bucket journal-attachments with the same rules as the server
  const BUCKET = "journal-attachments";
  const IMAGE_TYPES = ["image/webp", "image/png", "image/jpeg"];
  const FILE_LIMIT = 5 * 1024 * 1024;
  let attachmentQuota = 200 * 1024 * 1024; // journal_limits.attachment_quota_bytes (the owner can lower it)
  const storageFiles = new Map(); // path -> { bytes: Buffer, mime, created_at }
  const signTokens = new Map(); // token -> { path, expires }
  const storageLog = []; // "upload:<path>" | "sign:<path>" | "download:<path>" | "delete:<path>"
  let storageDelayMs = 0; // every upload waits this long (lets a test see the progress and press «Stop»)
  // 0005 rule for removing a file: when the server first saw its screenshot row deleted (server time, like
  // journal_attachments.deleted_server_at). Key `${userId}:${attachmentId}`.
  const attachmentDeletedAt = new Map();
  const DAY = 24 * 3600 * 1000;
  const trackDeletion = (userId, data) => {
    const key = `${userId}:${data.id}`;
    if (!data.deletedAt) attachmentDeletedAt.delete(key);
    else if (!attachmentDeletedAt.has(key)) attachmentDeletedAt.set(key, Date.now());
  };
  const liveAttachmentBytes = (userId, exceptId) =>
    [...journalRows.values()]
      .filter((r) => r.user_id === userId && r.table === "journal_attachments" && !r.data.deletedAt && r.id !== exceptId)
      .reduce((s, r) => s + Number(r.data.bytes || 0), 0);
  // Space taken in the folder: every file except those of deleted screenshots (0005, journal_attachment_space_ok)
  const usedInFolder = (userId) =>
    [...storageFiles.entries()]
      .filter(([p]) => p.startsWith(`${userId}/`))
      .filter(([p]) => {
        const id = p.slice(userId.length + 1).replace(/\.(webp|png|jpg)$/, "");
        const row = journalRows.get(`${userId}:journal_attachments:${id}`);
        return !(row && row.data.deletedAt);
      })
      .reduce((s, [, f]) => s + f.bytes.length, 0);

  function getOrCreateUser(email) {
    let user = usersByEmail.get(email);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        aud: "authenticated",
        role: "authenticated",
        email,
        email_confirmed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
      };
      usersByEmail.set(email, user);
      // Mirrors the handle_new_user trigger: an empty profile row without nickname.
      const now = new Date().toISOString();
      if (createProfileRows) profiles.set(user.id, {
        id: user.id,
        nickname: null,
        locale: "ru",
        timezone: "UTC",
        age_group: null,
        minor_mode: false,
        consent_at: null,
        consent_version: null,
        created_at: now,
        updated_at: now,
      });
    }
    return user;
  }

  function issueSession(user) {
    const access_token = makeJwt(user);
    const refresh_token = b64url(crypto.randomBytes(16));
    tokens.set(access_token, user.id);
    tokens.set(refresh_token, user.id);
    if (!sessionsByUser.has(user.id)) sessionsByUser.set(user.id, new Set());
    sessionsByUser.get(user.id).add(refresh_token);
    refreshOf.set(access_token, refresh_token);
    return { access_token, refresh_token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  }

  function userFromAuthHeader(req) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const id = tokens.get(token);
    return id ? [...usersByEmail.values()].find((u) => u.id === id) : null;
  }

  const readRaw = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

  const readBody = (req) =>
    new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, body, extraHeaders = {}) => {
      res.writeHead(status, {
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] || "*",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
        "Access-Control-Expose-Headers": "*",
        "Content-Type": "application/json",
        ...extraHeaders,
      });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (req.method === "OPTIONS") return send(204);

    const path = url.pathname;

    // ---- test control endpoints ----
    if (path === "/__test/last-link") {
      const link = lastLinkByEmail.get(url.searchParams.get("email"));
      return link ? send(200, { link }) : send(404, { error: "no link" });
    }
    if (path === "/__test/profiles-config") {
      if (url.searchParams.has("rows")) createProfileRows = url.searchParams.get("rows") !== "0";
      if (url.searchParams.has("table")) profilesTableMissing = url.searchParams.get("table") === "0";
      return send(200, { createProfileRows, profilesTableMissing });
    }
    if (path === "/__test/fail-profile-reads") {
      profileFailuresLeft = Number(url.searchParams.get("count") || 0);
      return send(200, { profileFailuresLeft });
    }
    if (path === "/__test/cloud-requests") {
      if (url.searchParams.has("reset")) Object.assign(cloudRequests, { userFeatures: 0, journal: 0 });
      return send(200, cloudRequests);
    }
    // tests put the calendar's rows (replacing all) or make reads fail
    if (path === "/__test/market-events" && req.method === "POST") {
      marketEvents = await readBody(req);
      return send(200, { count: marketEvents.length });
    }
    if (path === "/__test/market-news" && req.method === "POST") {
      marketNews = await readBody(req);
      return send(200, { count: marketNews.length });
    }
    if (path === "/__test/market-events-fail") {
      marketEventsFail = url.searchParams.get("on") === "1";
      return send(200, { fail: marketEventsFail });
    }
    if (path === "/__test/market-table") {
      marketTableMissing = url.searchParams.get("present") === "0";
      return send(200, { present: !marketTableMissing });
    }
    if (path === "/__test/cloud-flag") {
      const user = usersByEmail.get(url.searchParams.get("email"));
      if (!user) return send(404, { error: "no user" });
      cloudFlags.set(user.id, url.searchParams.get("on") === "1");
      return send(200, { userId: user.id, cloud_sync: cloudFlags.get(user.id) });
    }
    // Another device writes a journal row (POST body = the record's data), newer than anything on the test device
    if (path === "/__test/cloud-put" && req.method === "POST") {
      const user = usersByEmail.get(url.searchParams.get("email"));
      const table = url.searchParams.get("table");
      if (!user || !table) return send(404, { error: "no user/table" });
      const data = await readBody(req);
      journalClock = Math.max(journalClock + 1, Date.now());
      const putKey = `${user.id}:${table}:${data.id}`;
      // 0016 stand-in: the first server trace never changes
      journalRows.set(putKey, { user_id: user.id, table, id: data.id, data, updated_at: new Date(journalClock).toISOString(), first_seen_at: journalRows.get(putKey)?.first_seen_at || new Date(journalClock).toISOString() });
      if (table === "journal_attachments") trackDeletion(user.id, data);
      return send(200, { ok: true });
    }
    if (path === "/__test/journal-write-delay") {
      journalWriteDelayMs = Number(url.searchParams.get("ms") || 0);
      return send(200, { journalWriteDelayMs });
    }
    // 0014–0016 stand-in controls: installed or not; an account's state, flag and opening mode; what the routes asked
    if (path === "/__test/economy-installed") {
      economyInstalled = url.searchParams.get("on") === "1";
      return send(200, { economyInstalled });
    }
    if (path === "/__test/economy") {
      const user = usersByEmail.get(url.searchParams.get("email"));
      if (!user) return send(404, { error: "no user" });
      const old = economies.get(user.id) || {};
      economies.set(user.id, { ...old, state: url.searchParams.get("state") || old.state || "local", game_sync: url.searchParams.get("sync") === "1", opening_mode: url.searchParams.get("mode") || old.opening_mode });
      return send(200, { ok: true, userId: user.id });
    }
    if (path === "/__test/economy-calls") {
      if (url.searchParams.get("reset")) economyCalls.length = 0;
      return send(200, [...economyCalls]);
    }
    // 0015 stand-in: the account's server day as game_my_day() returns it (POST body; empty body = no server day)
    if (path === "/__test/my-day" && req.method === "POST") {
      const user = usersByEmail.get(url.searchParams.get("email"));
      if (!user) return send(404, { error: "no user" });
      const body = await readBody(req);
      if (body && Object.keys(body).length) myDays.set(user.id, body);
      else myDays.delete(user.id);
      return send(200, { ok: true });
    }
    if (path === "/__test/fail-journal-reads") {
      journalReadFailuresLeft = Number(url.searchParams.get("count") || 0);
      return send(200, { journalReadFailuresLeft });
    }
    if (path === "/__test/fail-journal-writes") {
      journalWriteFailuresLeft = Number(url.searchParams.get("count") || 0);
      return send(200, { journalWriteFailuresLeft });
    }
    if (path === "/__test/cloud-rows") {
      const user = usersByEmail.get(url.searchParams.get("email"));
      const rows = user ? [...journalRows.values()].filter((r) => r.user_id === user.id) : [];
      return send(200, rows.map(({ table, id, data, updated_at }) => ({ table, id, data, updated_at })));
    }
    if (path === "/__test/storage-delay") {
      storageDelayMs = Number(url.searchParams.get("ms") || 0);
      return send(200, { storageDelayMs });
    }
    if (path === "/__test/storage-age") {
      // a file uploaded `hours` ago (the 24-hour rule for files without a row)
      const user = usersByEmail.get(url.searchParams.get("email"));
      const file = user && storageFiles.get(`${user.id}/${url.searchParams.get("name")}`);
      if (!file) return send(404, { error: "no file" });
      file.created_at = new Date(Date.now() - Number(url.searchParams.get("hours")) * 3600 * 1000).toISOString();
      return send(200, { created_at: file.created_at });
    }
    if (path === "/__test/attachment-deleted-days") {
      // the screenshot row was deleted `days` ago by server time (the 30-day rule)
      const user = usersByEmail.get(url.searchParams.get("email"));
      if (!user) return send(404, { error: "no user" });
      attachmentDeletedAt.set(`${user.id}:${url.searchParams.get("id")}`, Date.now() - Number(url.searchParams.get("days")) * DAY);
      return send(200, { ok: true });
    }
    if (path === "/__test/attachment-quota") {
      attachmentQuota = Number(url.searchParams.get("bytes") || 200 * 1024 * 1024);
      return send(200, { attachmentQuota });
    }
    if (path === "/__test/storage") {
      // files in the bucket (path, size, type) and the calls made — what the tests look at
      const user = usersByEmail.get(url.searchParams.get("email"));
      const files = [...storageFiles.entries()]
        .filter(([p]) => !user || p.startsWith(`${user.id}/`))
        .map(([p, f]) => ({ path: p, size: f.bytes.length, mime: f.mime }));
      if (url.searchParams.has("reset-log")) storageLog.length = 0;
      return send(200, { files, log: [...storageLog] });
    }
    if (path === "/__test/storage-put" && req.method === "POST") {
      // another device uploads a file (raw body), as the owner's script or a second browser would
      const user = usersByEmail.get(url.searchParams.get("email"));
      if (!user) return send(404, { error: "no user" });
      const bytes = await readRaw(req);
      storageFiles.set(`${user.id}/${url.searchParams.get("name")}`, { bytes, mime: req.headers["content-type"] || "image/webp", created_at: new Date().toISOString() });
      return send(200, { ok: true });
    }
    if (path === "/__test/profile") {
      const user = usersByEmail.get(url.searchParams.get("email"));
      return send(200, user ? profiles.get(user.id) : null);
    }

    // ---- GoTrue ----
    if (path === "/auth/v1/otp" && req.method === "POST") {
      const body = await readBody(req);
      const user = getOrCreateUser(body.email);
      const code = crypto.randomUUID();
      pendingCodes.set(code, { email: user.email, challenge: body.code_challenge, method: body.code_challenge_method });
      const redirectTo = url.searchParams.get("redirect_to") || "http://localhost:3001/auth/callback";
      const link = new URL(redirectTo);
      link.searchParams.set("code", code);
      lastLinkByEmail.set(user.email, link.toString());
      return send(200, {});
    }
    // Letter with a link (PKCE code) and a 6-digit code, like the Supabase templates with {{ .Token }}
    const sendLetter = (user, type, body, redirectTo) => {
      const token = String(crypto.randomInt(100000, 1000000));
      emailCodes.set(user.email, { token, type });
      lastCodeByEmail.set(user.email, token);
      const code = crypto.randomUUID();
      pendingCodes.set(code, { email: user.email, challenge: body.code_challenge, method: body.code_challenge_method });
      const link = new URL(redirectTo || "http://localhost:3001/auth/callback");
      link.searchParams.set("code", code);
      lastLinkByEmail.set(user.email, link.toString());
    };
    if (path === "/__test/email-limit") {
      emailLimit = url.searchParams.get("mode") || null;
      return send(200, { emailLimit });
    }
    const letterRefused = () =>
      emailLimit === "soon"
        ? send(429, { code: "over_email_send_rate_limit", msg: "For security purposes, you can only request this after 42 seconds." })
        : send(429, { code: "over_email_send_rate_limit", msg: "email rate limit exceeded" });
    if (emailLimit && ["/auth/v1/signup", "/auth/v1/resend", "/auth/v1/recover"].includes(path) && req.method === "POST") {
      return letterRefused();
    }
    if (path === "/auth/v1/signup" && req.method === "POST") {
      const body = await readBody(req);
      const existing = usersByEmail.get(body.email);
      if (existing && existing.email_confirmed_at) {
        // Supabase with «Confirm email» on: no letter, an obfuscated user, nothing tells the e-mail is taken
        return send(200, { id: crypto.randomUUID(), aud: "authenticated", role: "", email: body.email, identities: [], user_metadata: {}, app_metadata: {} });
      }
      const user = existing ?? getOrCreateUser(body.email);
      user.email_confirmed_at = null;
      if (typeof body.password === "string") passwords.set(user.id, body.password);
      if (body.data && typeof body.data === "object") user.user_metadata = { ...user.user_metadata, ...body.data };
      sendLetter(user, "signup", body, url.searchParams.get("redirect_to"));
      return send(200, { ...user, identities: [{ provider: "email" }] });
    }
    if (path === "/auth/v1/resend" && req.method === "POST") {
      const body = await readBody(req);
      const user = usersByEmail.get(body.email);
      if (user && !user.email_confirmed_at) sendLetter(user, "signup", body, url.searchParams.get("redirect_to"));
      return send(200, {});
    }
    if (path === "/auth/v1/recover" && req.method === "POST") {
      const body = await readBody(req);
      const user = usersByEmail.get(body.email);
      if (user) sendLetter(user, "recovery", body, url.searchParams.get("redirect_to"));
      return send(200, {}); // the same answer for an unknown e-mail
    }
    if (path === "/auth/v1/verify" && req.method === "POST") {
      const body = await readBody(req);
      const pending = emailCodes.get(body.email);
      const typeOk = pending && (body.type === pending.type || (body.type === "email" && pending.type === "signup"));
      if (!pending || pending.token !== body.token || !typeOk) {
        return send(403, { code: "otp_expired", error_code: "otp_expired", msg: "Token has expired or is invalid" });
      }
      emailCodes.delete(body.email);
      const user = usersByEmail.get(body.email);
      user.email_confirmed_at = new Date().toISOString();
      return send(200, issueSession(user));
    }
    if (path === "/__test/last-code") {
      return send(200, { code: lastCodeByEmail.get(url.searchParams.get("email")) ?? null });
    }
    if (path === "/__test/app-role") {
      // stands in for the owner's SQL on auth.users.raw_app_meta_data (only the server can change app_metadata)
      const user = usersByEmail.get(url.searchParams.get("email"));
      const role = url.searchParams.get("role");
      if (user) {
        const { ayra_role: _old, ...rest } = user.app_metadata || {};
        user.app_metadata = role ? { ...rest, ayra_role: role } : rest;
      }
      return send(200, { app_metadata: user?.app_metadata ?? null });
    }
    if (path === "/__test/app-economy") {
      // Q4.5-1: stands in for the server's mark (Q4.5-2 SQL on raw_app_meta_data.ayra_economy); the session sees it after
      // a sign-in, a token refresh or a user read (/auth/v1/user), like the real auth server
      const user = usersByEmail.get(url.searchParams.get("email"));
      const state = url.searchParams.get("state");
      if (user) {
        const { ayra_economy: _old, ...rest } = user.app_metadata || {};
        user.app_metadata = state ? { ...rest, ayra_economy: state } : rest;
      }
      return send(200, { app_metadata: user?.app_metadata ?? null });
    }
    if (path === "/__test/clear-password") {
      // stands in for an account made by the e-mail code before passwords existed
      const user = usersByEmail.get(url.searchParams.get("email"));
      if (user) {
        passwords.delete(user.id);
        const { has_password: _drop, ...rest } = user.user_metadata || {};
        user.user_metadata = rest;
      }
      return send(200, {});
    }
    if (path === "/__test/sessions") {
      // live refresh tokens of the user = signed-in devices (the real server revokes them the same way)
      const user = usersByEmail.get(url.searchParams.get("email"));
      const live = user ? [...(sessionsByUser.get(user.id) || [])].filter((rt) => tokens.has(rt)).length : 0;
      return send(200, { live });
    }
    if (path === "/auth/v1/token" && req.method === "POST") {
      const body = await readBody(req);
      const grant = url.searchParams.get("grant_type");
      if (grant === "pkce") {
        const pending = pendingCodes.get(body.auth_code);
        if (!pending) return send(400, { error: "invalid_grant", error_description: "Invalid auth code" });
        const expected =
          pending.method === "plain"
            ? body.code_verifier
            : crypto.createHash("sha256").update(body.code_verifier || "").digest("base64url");
        if (expected !== pending.challenge) {
          return send(400, { error: "invalid_grant", error_description: "code challenge does not match previously saved code verifier" });
        }
        pendingCodes.delete(body.auth_code);
        const linkUser = usersByEmail.get(pending.email);
        if (!linkUser.email_confirmed_at) linkUser.email_confirmed_at = new Date().toISOString();
        emailCodes.delete(pending.email);
        return send(200, issueSession(linkUser));
      }
      if (grant === "password") {
        const user = usersByEmail.get(body.email);
        if (!user || passwords.get(user.id) !== body.password) {
          return send(400, { code: "invalid_credentials", error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
        }
        if (!user.email_confirmed_at) return send(400, { code: "email_not_confirmed", msg: "Email not confirmed" });
        return send(200, issueSession(user));
      }
      if (grant === "refresh_token") {
        const id = tokens.get(body.refresh_token);
        const user = id && [...usersByEmail.values()].find((u) => u.id === id);
        return user ? send(200, issueSession(user)) : send(400, { error: "invalid_grant" });
      }
      return send(400, { error: "unsupported_grant_type" });
    }
    if (path === "/auth/v1/user" && req.method === "PUT") {
      const user = userFromAuthHeader(req);
      if (!user) return send(401, { error: "not authenticated" });
      const body = await readBody(req);
      if (typeof body.password === "string") {
        if (body.password.length < 8) return send(422, { code: "weak_password", msg: "Password should be at least 8 characters." });
        if (passwords.get(user.id) === body.password) {
          return send(422, { code: "same_password", msg: "New password should be different from the old password." });
        }
        passwords.set(user.id, body.password);
      }
      if (body.data && typeof body.data === "object") user.user_metadata = { ...user.user_metadata, ...body.data };
      return send(200, user);
    }
    if (path === "/__test/password") {
      const user = usersByEmail.get(url.searchParams.get("email"));
      return send(200, { hasPassword: Boolean(user && passwords.has(user.id)), metadata: user?.user_metadata ?? null });
    }
    if (path === "/auth/v1/user") {
      const user = userFromAuthHeader(req);
      return user ? send(200, user) : send(401, { error: "not authenticated" });
    }
    if (path === "/auth/v1/logout") {
      const scope = url.searchParams.get("scope") || "global";
      logouts.push(scope);
      const access = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const userId = tokens.get(access);
      if (userId && scope === "others") {
        // keep the caller's own session, end every other refresh token of this user
        const all = [...(sessionsByUser.get(userId) || [])];
        const keep = refreshOf.get(access);
        for (const rt of all) if (rt !== keep) tokens.delete(rt);
        sessionsByUser.set(userId, new Set([keep]));
      }
      return send(204);
    }
    if (path === "/__test/logouts") {
      if (url.searchParams.get("reset")) logouts.length = 0;
      return send(200, [...logouts]);
    }

    // ---- PostgREST ----
    if (path === "/rest/v1/profiles" && profilesTableMissing) {
      return send(404, { code: "PGRST205", message: "Could not find the table 'public.profiles' in the schema cache" });
    }
    if (path === "/rest/v1/profiles") {
      const user = userFromAuthHeader(req);
      const idFilter = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      const row = user && idFilter === user.id ? profiles.get(user.id) : null;
      if (req.method === "GET") {
        if (profileFailuresLeft > 0) {
          profileFailuresLeft--;
          return send(500, { code: "XX000", message: "fake transient failure" });
        }
        const wantsObject = (req.headers.accept || "").includes("vnd.pgrst.object");
        if (wantsObject) return row ? send(200, row) : send(406, { code: "PGRST116", message: "0 rows" });
        return send(200, row ? [row] : []);
      }
      if (req.method === "PATCH") {
        const wantsRows = (req.headers.prefer || "").includes("return=representation");
        if (!row) return wantsRows ? send(200, []) : send(204);
        const body = await readBody(req);
        if (body.nickname) {
          const lower = String(body.nickname).toLowerCase();
          const clash = [...profiles.values()].some((p) => p.id !== row.id && p.nickname && p.nickname.toLowerCase() === lower);
          if (clash || takenNicknames.has(lower)) return send(409, { code: "23505", message: "duplicate key" });
        }
        Object.assign(row, body, { updated_at: new Date().toISOString() });
        return wantsRows ? send(200, [row]) : send(204);
      }
    }
    // Migration 0004: no user_features row = cloud sync off (as for every account today); RLS = own row only
    if (path === "/rest/v1/user_features") {
      cloudRequests.userFeatures++;
      const user = userFromAuthHeader(req);
      const idFilter = (url.searchParams.get("user_id") || "").replace(/^eq\./, "");
      const rows = user && idFilter === user.id && cloudFlags.has(user.id) ? [{ cloud_sync: cloudFlags.get(user.id) }] : [];
      const wantsObject = (req.headers.accept || "").includes("vnd.pgrst.object");
      if (wantsObject) return rows.length ? send(200, rows[0]) : send(406, { code: "PGRST116", message: "0 rows" });
      return send(200, rows);
    }
    // 0009: read-only for the site, like PostgREST: starts_at=gte.X&starts_at=lt.Y, ordered by time
    if (path === "/rest/v1/market_events" && req.method === "GET") {
      if (marketEventsFail) return send(500, { code: "XX000", message: "fake failure" });
      const bounds = url.searchParams.getAll("starts_at");
      const gte = bounds.find((b) => b.startsWith("gte."))?.slice(4);
      const lt = bounds.find((b) => b.startsWith("lt."))?.slice(3);
      const rows = marketEvents
        .filter((r) => !r.hidden)
        .filter((r) => (!gte || Date.parse(r.starts_at) >= Date.parse(gte)) && (!lt || Date.parse(r.starts_at) < Date.parse(lt)))
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
      return send(200, rows);
    }
    // 0009: official news, read-only; published_at=gte.X, newest first, limit
    if (path === "/rest/v1/market_news" && req.method === "GET") {
      if (marketEventsFail) return send(500, { code: "XX000", message: "fake failure" });
      const gte = (url.searchParams.get("published_at") || "").replace(/^gte\./, "");
      const limit = Number(url.searchParams.get("limit") || 1000);
      const rows = marketNews
        .filter((r) => !r.hidden && (!gte || Date.parse(r.published_at) >= Date.parse(gte)))
        .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
        .slice(0, limit);
      return send(200, rows);
    }
    // the journal tables (0004, 0005) and the Market data (0008) share the same rules here
    // like PostgREST when 0008 is not applied
    if (path === "/rest/v1/market_user_data" && marketTableMissing) {
      return send(404, { code: "PGRST205", message: "Could not find the table 'public.market_user_data' in the schema cache" });
    }
    if (path.startsWith("/rest/v1/journal_") || path === "/rest/v1/market_user_data") {
      cloudRequests.journal++;
      const table = path.slice("/rest/v1/".length);
      const user = userFromAuthHeader(req);
      if (!user) return send(401, { code: "PGRST301", message: "JWT required" });
      const metaKey = `${user.id}:market_user_data:watchlist_meta`;
      const metadataResponse = (data, status = 200) => send(status, req.headers.accept?.includes("object+json") ? data : data ? [data] : []);
      const saveMetadata = (data, expected) => {
        if (!cloudFlags.get(user.id)) return send(403, { code: "42501", message: "metadata RLS denied" });
        const old = journalRows.get(metaKey), now = new Date().toISOString();
        const result = metadataWrite(old?.data, data, expected, now);
        if (result.error) return send(result.error === "23505" ? 409 : 400, { code: result.error, message: "metadata write refused" });
        if (!result.data) return metadataResponse(null);
        journalRows.set(metaKey, { user_id: user.id, table: "market_user_data", id: "watchlist_meta", data: result.data, updated_at: now, first_seen_at: old?.first_seen_at || now });
        return metadataResponse({ data: result.data });
      };
      if (table === "market_user_data" && url.searchParams.get("id") === "eq.watchlist_meta") {
        if (url.searchParams.get("user_id") !== `eq.${user.id}`) return metadataResponse(null);
        if (req.method === "GET") return send(200, journalRows.has(metaKey) ? [{ data: journalRows.get(metaKey).data }] : []);
        if (req.method === "PATCH") {
          const revision = url.searchParams.get("data->>revision");
          if (!revision?.startsWith("eq.")) return send(400, { code: "P0001", message: "metadata CAS filter required" });
          return saveMetadata((await readBody(req)).data, revision.slice(3));
        }
      }
      if (req.method === "GET") {
        if (journalReadFailuresLeft > 0) {
          journalReadFailuresLeft--;
          return send(500, { code: "XX000", message: "fake transient failure" });
        }
        const since = (url.searchParams.get("updated_at") || "").replace(/^gt\./, "");
        const offset = Number(url.searchParams.get("offset") || 0);
        const limit = Number(url.searchParams.get("limit") || 1000);
        // id=in.(a,b) or in.("a","b") — rows read by id after a refused send
        const inIds = /^in\.\((.*)\)$/.exec(url.searchParams.get("id") || "");
        const ids = inIds ? new Set(inIds[1].split(",").map((x) => x.replace(/^"|"$/g, ""))) : null;
        const rows = [...journalRows.values()]
          .filter((r) => r.user_id === user.id && r.table === table && (!since || r.updated_at > since) && (!ids || ids.has(r.id)))
          .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id))
          .slice(offset, offset + limit)
          // columns the 0004 trigger fills from data (read by the Q4.2 shadow route; the app ignores them)
          .map(({ id, data, updated_at }) => ({ id, data, updated_at, client_updated_at: data.updatedAt || data.createdAt || null, deleted_at: data.deletedAt || null }));
        return send(200, rows);
      }
      if (req.method === "POST") {
        if (!cloudFlags.get(user.id)) return send(403, { code: "42501", message: "new row violates row-level security policy" });
        if (journalWriteDelayMs > 0) await new Promise((r) => setTimeout(r, journalWriteDelayMs));
        if (journalWriteFailuresLeft > 0) {
          journalWriteFailuresLeft--;
          return send(500, { code: "XX000", message: "fake transient failure" });
        }
        const body = await readBody(req);
        const rows = Array.isArray(body) ? body : [body];
        if (table === "market_user_data" && rows.some(r => r.id === "watchlist_meta")) {
          if (rows.length !== 1 || rows[0].user_id !== user.id || Object.keys(rows[0]).some(k => !["user_id", "id", "data"].includes(k))) return send(403, { code: "42501", message: "metadata owner/columns denied" });
          return saveMetadata(rows[0].data, undefined);
        }
        for (const r of rows) {
          const data = r.data || {};
          // 0008 grants user_id for Market writes. An explicitly bound owner still must match the JWT (RLS).
          const columns = table === "market_user_data" ? ["id", "data", "device_id", "user_id"] : ["id", "data", "device_id"];
          if (Object.keys(r).some((k) => !columns.includes(k))) return send(403, { code: "42501", message: "permission denied for column" });
          if (table === "market_user_data" && r.user_id !== undefined && r.user_id !== user.id) return send(403, { code: "42501", message: "new row violates row-level security policy" });
          if (data[JOURNAL_ID_KEY[table] || "id"] !== r.id) return send(400, { code: "P0001", message: "journal_row_id_mismatch" });
          const changedAt = Date.parse(data.updatedAt || data.createdAt || "");
          if (Number.isNaN(changedAt)) return send(400, { code: "P0001", message: "journal_row_missing_updated_at" });
          if (changedAt > Date.now() + 5 * 60 * 1000) return send(400, { code: "P0001", message: "journal_row_from_future" });
          if (JSON.stringify(data).length > 256 * 1024) return send(400, { code: "23514", message: "data check" });
          if (["xp", "coins", "xpAwarded", "coinsAwarded", "reward", "rewards"].some((k) => k in data)) return send(400, { code: "23514", message: "data check" });
          if (table === "journal_attachments") {
            // 0005 trigger: type, size, 200 MB of live screenshots
            if (!IMAGE_TYPES.includes(data.mime)) return send(400, { code: "P0001", message: "journal_attachment_bad_type" });
            if (!(Number(data.bytes) > 0 && Number(data.bytes) <= FILE_LIMIT)) return send(400, { code: "P0001", message: "journal_attachment_too_big" });
            if (!data.deletedAt && liveAttachmentBytes(user.id, r.id) + Number(data.bytes) > attachmentQuota) {
              return send(400, { code: "P0001", message: "journal_attachment_quota_exceeded" });
            }
          }
        }
        const written = [];
        for (const r of rows) {
          const key = `${user.id}:${table}:${r.id}`;
          const old = journalRows.get(key);
          const changedAt = Date.parse(r.data.updatedAt || r.data.createdAt);
          if (old && changedAt < Date.parse(old.data.updatedAt || old.data.createdAt)) continue; // last-write-wins: not returned
          journalClock = Math.max(journalClock + 1, Date.now());
          journalRows.set(key, { user_id: user.id, table, id: r.id, data: r.data, updated_at: new Date(journalClock).toISOString(), first_seen_at: old?.first_seen_at || new Date(journalClock).toISOString() });
          if (table === "journal_attachments") trackDeletion(user.id, r.data);
          written.push({ id: r.id });
        }
        return (req.headers.prefer || "").includes("return=representation") ? send(201, written) : send(201);
      }
      return send(403, { code: "42501", message: "permission denied" });
    }
    // ---- Storage (bucket of 0005). Errors look like the real server's: HTTP 400 with statusCode in the body ----
    if (path.startsWith(`/storage/v1/object/sign/${BUCKET}/`) && req.method === "GET") {
      const objectPath = decodeURIComponent(path.slice(`/storage/v1/object/sign/${BUCKET}/`.length));
      const t = signTokens.get(url.searchParams.get("token"));
      if (!t || t.path !== objectPath || t.expires < Date.now()) return send(400, { statusCode: "400", error: "InvalidJWT", message: "jwt expired" });
      const file = storageFiles.get(objectPath);
      if (!file) return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      storageLog.push(`download:${objectPath}`);
      res.writeHead(200, { "Access-Control-Allow-Origin": req.headers.origin || "*", "Content-Type": file.mime });
      return res.end(file.bytes);
    }
    if (path.startsWith(`/storage/v1/object/sign/${BUCKET}/`) && req.method === "POST") {
      const user = userFromAuthHeader(req);
      const objectPath = decodeURIComponent(path.slice(`/storage/v1/object/sign/${BUCKET}/`.length));
      const body = await readBody(req);
      // SELECT rule: own folder only
      if (!user || !objectPath.startsWith(`${user.id}/`) || !storageFiles.has(objectPath)) {
        return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      }
      const token = crypto.randomUUID();
      signTokens.set(token, { path: objectPath, expires: Date.now() + Number(body.expiresIn || 60) * 1000 });
      storageLog.push(`sign:${objectPath}`);
      return send(200, { signedURL: `/object/sign/${BUCKET}/${objectPath}?token=${token}` });
    }
    if (path.startsWith(`/storage/v1/object/${BUCKET}/`) && req.method === "POST") {
      const user = userFromAuthHeader(req);
      const objectPath = decodeURIComponent(path.slice(`/storage/v1/object/${BUCKET}/`.length));
      const mime = String(req.headers["content-type"] || "").split(";")[0];
      const bytes = await readRaw(req);
      if (storageDelayMs > 0) await new Promise((r) => setTimeout(r, storageDelayMs));
      storageLog.push(`upload:${objectPath}`);
      if (!user) return send(400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      // bucket limits first (checked by the Storage server before the file is taken)
      if (!IMAGE_TYPES.includes(mime)) return send(400, { statusCode: "415", error: "invalid_mime_type", message: `mime type ${mime} is not supported` });
      if (bytes.length > FILE_LIMIT) return send(400, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
      // INSERT rule: own folder, a plain name, the cloud flag, the 200 MB limit
      const ok =
        new RegExp(`^${user.id}/[A-Za-z0-9_-]{1,64}\\.(webp|png|jpg)$`).test(objectPath) &&
        cloudFlags.get(user.id) === true &&
        usedInFolder(user.id) + bytes.length <= attachmentQuota;
      if (!ok) return send(400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      if (storageFiles.has(objectPath)) return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      storageFiles.set(objectPath, { bytes, mime, created_at: new Date().toISOString() });
      return send(200, { Key: `${BUCKET}/${objectPath}`, Id: crypto.randomUUID() });
    }
    if (path === `/storage/v1/object/list/${BUCKET}` && req.method === "POST") {
      // SELECT rule: own folder only
      const user = userFromAuthHeader(req);
      const body = await readBody(req);
      const prefix = String(body.prefix || "").replace(/\/$/, "");
      if (!user || prefix !== user.id) return send(200, []);
      const offset = Number(body.offset || 0);
      const limit = Number(body.limit || 100);
      const items = [...storageFiles.entries()]
        .filter(([p]) => p.startsWith(`${user.id}/`))
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(offset, offset + limit)
        .map(([p, f]) => ({ name: p.slice(user.id.length + 1), id: p, created_at: f.created_at, updated_at: f.created_at, metadata: { size: f.bytes.length, mimetype: f.mime } }));
      return send(200, items);
    }
    if (path === `/storage/v1/object/${BUCKET}` && req.method === "DELETE") {
      // DELETE rule of 0005: own folder; the row deleted 30+ days ago (server time), or no row and the file 24+ hours old.
      // Refused files are simply not removed (the real server answers the same way).
      const user = userFromAuthHeader(req);
      const body = await readBody(req);
      const removed = [];
      for (const p of Array.isArray(body.prefixes) ? body.prefixes : []) {
        const file = storageFiles.get(p);
        if (!user || !file || !p.startsWith(`${user.id}/`)) continue;
        const id = p.slice(user.id.length + 1).replace(/\.(webp|png|jpg)$/, "");
        const row = journalRows.get(`${user.id}:journal_attachments:${id}`);
        const deletedAt = attachmentDeletedAt.get(`${user.id}:${id}`);
        const allowed = row
          ? Boolean(row.data.deletedAt) && deletedAt !== undefined && deletedAt <= Date.now() - 30 * DAY
          : Date.parse(file.created_at) <= Date.now() - DAY;
        if (!allowed) continue;
        storageFiles.delete(p);
        storageLog.push(`delete:${p}`);
        removed.push({ name: p });
      }
      return send(200, removed);
    }
    if (path.startsWith("/storage/v1/")) {
      // no UPDATE rule (a file is never replaced)
      return send(400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
    }

    if (path === "/rest/v1/rpc/is_nickname_available") {
      const body = await readBody(req);
      const lower = String(body.nick || "").toLowerCase();
      const taken = takenNicknames.has(lower) || [...profiles.values()].some((p) => p.nickname && p.nickname.toLowerCase() === lower);
      return send(200, !taken);
    }
    // 0015 game_my_day(): the caller's own server day (tests set it with /__test/my-day; none = null, as without 0015)
    // ---- 0014–0016 stand-in for the server day API routes (service key only). Not installed unless a test says so
    // (/__test/economy-installed): then every game_* function answers like a missing function, as on the real Supabase.
    if (path.startsWith("/rest/v1/rpc/game_") && path !== "/rest/v1/rpc/game_my_day") {
      const fn = path.slice("/rest/v1/rpc/".length);
      if ((req.headers.authorization || "") !== `Bearer ${SERVICE_KEY}`) return send(401, { code: "42501", message: "permission denied for function " + fn });
      if (!economyInstalled) return send(404, { code: "PGRST202", message: `Could not find the function public.${fn} in the schema cache` });
      const body = await readBody(req);
      const econ = economies.get(body.p_user) || { state: "local", game_sync: false };
      economyCalls.push({ fn, user: body.p_user, args: Object.keys(body).filter((k) => k !== "p_user") });
      const refuse = (message) => send(400, { code: "P0001", message });
      const today = new Date().toISOString().slice(0, 10);
      const statusOf = () => {
        if (econ.state !== "cloud_active") return { state: econ.state, game_sync: econ.game_sync, day: null };
        if (!econ.day) return { state: econ.state, game_sync: econ.game_sync, game_day: today, day: null, opening_mode: econ.opening_mode || "trading", trading_days: econ.trading_days || [0, 1, 2, 3, 4, 5, 6] };
        return { state: econ.state, game_sync: econ.game_sync, game_day: econ.day.game_day, day: econ.day, replacements_left: 2 - econ.day.replacements.length, day_full: econ.day.paid.length >= 3,
          missions: econ.day.core.map((m) => ({ id: m, assigned: econ.day.mode !== "rest", accepted: m in econ.day.accepted, paid: econ.day.paid.includes(m), passed: econ.day.passed.includes(m) })) };
      };
      const day = () => econ.day;
      if (fn === "game_day_status") return send(200, statusOf());
      if (econ.state !== "cloud_active") return refuse("game_account_not_active");
      if (fn === "game_day_today") return send(200, today);
      if (fn === "game_day_open") {
        if (!econ.day) {
          const mode = econ.opening_mode || "trading";
          econ.day = { game_day: today, status: "open", mode, mode_before_rest: null, study_first: "m_observation", core: [...FAKE_MODE_MISSIONS[mode]], carried: {}, accepted: {}, passed: [], bonus: body.p_bonus || [], replacements: [], paid: [] };
          economies.set(body.p_user, econ);
        }
        return send(200, { ...econ.day, opened: true });
      }
      if (!day()) return refuse("game_day_not_open");
      if (fn === "game_day_accept") {
        if (day().mode === "rest") return refuse("game_day_rest");
        if (!day().core.includes(body.p_mission)) return refuse("game_mission_not_assigned");
        if (!(body.p_mission in day().accepted)) day().accepted[body.p_mission] = new Date().toISOString();
        return send(200, { mission: body.p_mission, accepted_at: day().accepted[body.p_mission] });
      }
      if (fn === "game_day_pass") {
        if (!day().core.includes(body.p_mission)) return refuse("game_mission_not_assigned");
        if (!day().passed.includes(body.p_mission)) day().passed.push(body.p_mission);
        return send(200, day());
      }
      if (fn === "game_day_set_mode") {
        const m = body.p_mode;
        if (m === "rest") { day().mode_before_rest = day().mode; day().mode = "rest"; }
        else { day().mode = m; day().mode_before_rest = null; day().core = [...FAKE_MODE_MISSIONS[m]]; if (body.p_bonus) day().bonus = body.p_bonus; }
        return send(200, day());
      }
      if (fn === "game_day_replace") {
        if (day().replacements.length >= 2) return refuse("game_replacement_limit");
        if (!day().bonus.includes(body.p_from)) return refuse("game_not_offered");
        day().bonus = day().bonus.map((b) => (b === body.p_from ? body.p_to : b));
        day().replacements.push({ from: body.p_from, to: body.p_to, at: new Date().toISOString() });
        return send(200, day());
      }
      if (fn === "game_set_trading_days") { econ.trading_days_next = body.p_days; return send(200, { next: body.p_days }); }
      if (fn === "game_journal_for_check") {
        const rows = (table) => [...journalRows.values()].filter((r) => r.user_id === body.p_user && r.table === table).map((r) => ({
          id: r.id, data: r.data, updated_at: r.updated_at, client_updated_at: r.data.updatedAt || r.data.createdAt, deleted_at: r.data.deletedAt || null,
          first_seen_at: r.first_seen_at || null, fp: crypto.createHash("md5").update(JSON.stringify(r.data)).digest("hex") }));
        const notes = rows("journal_notes");
        const trades = rows("journal_trades");
        return send(200, { notes, trades, plans: rows("journal_day_plans"), rows: notes.length + trades.length });
      }
      // the mission award kind is disabled (0014, never switched on): the database refuses every award
      if (fn === "game_apply_reward") return refuse("game_kind_disabled");
      return send(404, { code: "PGRST202", message: `Could not find the function public.${fn}` });
    }
    if (path === "/rest/v1/rpc/game_my_day") {
      const user = userFromAuthHeader(req);
      return send(200, user ? myDays.get(user.id) ?? null : null);
    }
    if (path.startsWith("/rest/v1/rpc/")) return send(200, null);

    return send(404, { error: `fake-supabase: unhandled ${req.method} ${path}` });
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("server.mjs")) {
  const port = Number(process.env.FAKE_SUPABASE_PORT || 54329);
  createFakeSupabase().listen(port, () => console.log(`[fake-supabase] listening on ${port}`));
}
