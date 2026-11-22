import { describe, expect, it } from "vitest";
import { sessionTokenOf } from "./session-token";
import { verifiedSessionUser } from "./session-user";

const A = "00000000-0000-0000-0000-00000000000a";
const SID = "5e55e55e-0000-4000-8000-00000000000a";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;

describe("Q4.5-2 the claims read from a verified access token", () => {
  it("reads sub, session_id, iat and the economy mark", () => {
    expect(sessionTokenOf(jwt({ sub: A, session_id: SID, iat: 1_763_600_000, app_metadata: { provider: "email", ayra_economy: "migration_pending" } }))).toEqual({
      sub: A, sessionId: SID, iat: 1_763_600_000, claim: "migration_pending",
    });
  });

  it("no mark is null (an account never moved); an unknown mark is null, never a stage", () => {
    expect(sessionTokenOf(jwt({ sub: A, session_id: SID, iat: 1, app_metadata: { provider: "email" } })).claim).toBeNull();
    expect(sessionTokenOf(jwt({ sub: A, app_metadata: { ayra_economy: "admin" } })).claim).toBeNull();
    expect(sessionTokenOf(jwt({ sub: A, app_metadata: "cloud_active" })).claim).toBeNull();
  });

  it("a session id that is not a UUID and a bad iat are dropped (the database then calls the session stale)", () => {
    const t = sessionTokenOf(jwt({ sub: A, session_id: "x'; DROP TABLE auth.sessions; --", iat: "1763600000" }));
    expect(t.sessionId).toBeNull();
    expect(t.iat).toBeNull();
    expect(sessionTokenOf(jwt({ sub: A, iat: -5 })).iat).toBeNull();
    expect(sessionTokenOf(jwt({ sub: A, iat: 1.5 })).iat).toBeNull();
  });

  it("not a token: nothing read", () => {
    for (const t of [null, undefined, "", "abc", "a.%%%.c", "a.bm90IGpzb24.c"]) expect(sessionTokenOf(t)).toEqual({ sub: null, sessionId: null, iat: null, claim: null });
  });
});

describe("Q4.5-2 the economy request's user", () => {
  const client = (token: string | null, verified: { id: string } | null, seen: string[] = []) => ({
    auth: {
      getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
      getUser: async (j?: string) => {
        seen.push(j ?? "<none>");
        return { data: { user: verified }, error: verified ? null : new Error("invalid JWT") };
      },
    },
  });

  it("the auth server verifies exactly the session's token; its claims come with the user", async () => {
    const token = jwt({ sub: A, session_id: SID, iat: 7, app_metadata: { ayra_economy: "cloud_active" } });
    const seen: string[] = [];
    expect(await verifiedSessionUser(client(token, { id: A }, seen))).toEqual({ id: A, token: { sub: A, sessionId: SID, iat: 7, claim: "cloud_active" } });
    expect(seen).toEqual([token]);
  });

  it("no session, or a token the auth server refuses: no user (the claims are never trusted on their own)", async () => {
    expect(await verifiedSessionUser(client(null, { id: A }))).toBeNull();
    expect(await verifiedSessionUser(client(jwt({ sub: A, session_id: SID, iat: 7 }), null))).toBeNull();
  });
});
