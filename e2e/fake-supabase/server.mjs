// Minimal in-memory stand-in for Supabase Auth (GoTrue) and PostgREST, used only by e2e tests.
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
  const takenNicknames = new Set(["taken_nick", "admin"]);
  let createProfileRows = true; // false = handle_new_user trigger absent (new users get no profiles row)
  let profilesTableMissing = false; // true = migration 0001 not applied (PostgREST 404 PGRST205)
  let profileFailuresLeft = 0; // next N profile reads fail with 500 (flaky network / cold database)

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
    return { access_token, refresh_token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  }

  function userFromAuthHeader(req) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const id = tokens.get(token);
    return id ? [...usersByEmail.values()].find((u) => u.id === id) : null;
  }

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
        return send(200, issueSession(usersByEmail.get(pending.email)));
      }
      if (grant === "refresh_token") {
        const id = tokens.get(body.refresh_token);
        const user = id && [...usersByEmail.values()].find((u) => u.id === id);
        return user ? send(200, issueSession(user)) : send(400, { error: "invalid_grant" });
      }
      return send(400, { error: "unsupported_grant_type" });
    }
    if (path === "/auth/v1/user") {
      const user = userFromAuthHeader(req);
      return user ? send(200, user) : send(401, { error: "not authenticated" });
    }
    if (path === "/auth/v1/logout") return send(204);

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
