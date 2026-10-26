// Minimal in-memory stand-in for Supabase Auth (GoTrue), PostgREST and Storage (bucket of 0005), used only by e2e tests.
// It speaks the same HTTP API that @supabase/supabase-js and @supabase/ssr use, so the app
// runs its real PKCE magic-link flow: /otp -> email link -> /auth/callback?code -> /token?grant_type=pkce.
import http from "node:http";
import crypto from "node:crypto";

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
  let journalWriteFailuresLeft = 0; // next N journal writes fail with 500 (server trouble)
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
      journalRows.set(`${user.id}:${table}:${data.id}`, { user_id: user.id, table, id: data.id, data, updated_at: new Date(journalClock).toISOString() });
      return send(200, { ok: true });
    }
    if (path === "/__test/journal-write-delay") {
      journalWriteDelayMs = Number(url.searchParams.get("ms") || 0);
      return send(200, { journalWriteDelayMs });
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
    if (path.startsWith("/rest/v1/journal_")) {
      cloudRequests.journal++;
      const table = path.slice("/rest/v1/".length);
      const user = userFromAuthHeader(req);
      if (!user) return send(401, { code: "PGRST301", message: "JWT required" });
      if (req.method === "GET") {
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
          .map(({ id, data, updated_at }) => ({ id, data, updated_at }));
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
        for (const r of rows) {
          const data = r.data || {};
          if (Object.keys(r).some((k) => !["id", "data", "device_id"].includes(k))) return send(403, { code: "42501", message: "permission denied for column" });
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
          journalRows.set(key, { user_id: user.id, table, id: r.id, data: r.data, updated_at: new Date(journalClock).toISOString() });
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
    if (path.startsWith("/storage/v1/")) {
      // no UPDATE rule (a file is never replaced); removal is the cleanup of 0005-C
      return send(400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
    }

    if (path === "/rest/v1/rpc/is_nickname_available") {
      const body = await readBody(req);
      const lower = String(body.nick || "").toLowerCase();
      const taken = takenNicknames.has(lower) || [...profiles.values()].some((p) => p.nickname && p.nickname.toLowerCase() === lower);
      return send(200, !taken);
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
