import { describe, expect, it } from "vitest";
import { AuthGeneration, sessionIdentity, tokenSessionId } from "./auth-generation";

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const token = (claims: Record<string, unknown>) => `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
const s = (id: string, sid: string | null) => ({ access_token: token(sid ? { sub: id, session_id: sid } : { sub: id }), user: { id } });

describe("Q4.5-1 auth generation", () => {
  it("reads session_id from the access token; a token without it or an unreadable one gives null", () => {
    expect(tokenSessionId(token({ session_id: "5e55-1" }))).toBe("5e55-1");
    expect(tokenSessionId(token({ sub: "a" }))).toBeNull();
    expect(tokenSessionId("not-a-jwt")).toBeNull();
    expect(tokenSessionId("a.%%%.c")).toBeNull();
    expect(tokenSessionId(null)).toBeNull();
  });

  it("identity is the account plus the session id; no session is null", () => {
    expect(sessionIdentity(s("a", "s1"))).toBe("a:s1");
    expect(sessionIdentity(s("a", null))).toBe("a:");
    expect(sessionIdentity(null)).toBeNull();
  });

  it("the same session (refreshed token) keeps the generation; a sign-out, another account or a new session ends it", () => {
    const g = new AuthGeneration();
    const first = g.observe(s("a", "s1"));
    expect(g.observe(s("a", "s1"))).toBe(first);
    expect(g.isCurrent(first)).toBe(true);
    const other = g.observe(s("b", "s9"));
    expect(g.isCurrent(first)).toBe(false);
    const again = g.observe(s("b", "s10"));
    expect(g.isCurrent(other)).toBe(false);
    g.observe(null);
    expect(g.isCurrent(again)).toBe(false);
    const signedOut = g.observe(null); // repeated sign-out notices do not move it further
    expect(g.isCurrent(signedOut)).toBe(true);
  });

  it("without session ids, sign-out then sign-in of the same account is still a new generation", () => {
    const g = new AuthGeneration();
    const first = g.observe(s("a", null));
    g.observe(null);
    g.observe(s("a", null));
    expect(g.isCurrent(first)).toBe(false);
  });
});
