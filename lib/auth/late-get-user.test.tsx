import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * Q4.5-1: the load-time answer of the auth server (Q4.5-2: a token refresh — the mark lives only in tokens issued by the
 * Custom Access Token Hook) is applied by AuthProvider only while the session it was started for is still the current one. The answer is held back here and released after a sign-out, another account's sign-in, or a new
 * sign-in of the same account — it must then change neither the user flags nor the session's economy reading.
 */

// «economy» is what the hook would put in the next token (never in the user's app_metadata)
type FakeUser = { id: string; email: string; user_metadata: Record<string, unknown>; app_metadata: Record<string, unknown>; economy?: string };
type FakeSession = { access_token: string; expires_at: number; user: FakeUser; session_id?: string | null };
type AuthCallback = (event: string, session: FakeSession | null) => void;

const A = "00000000-0000-0000-0000-0000000000a1";
const B = "00000000-0000-0000-0000-0000000000b2";

const fake = vi.hoisted(() => ({
  stored: null as unknown,
  pendingGetUser: null as null | ((u: unknown) => void),
  startedFor: null as null | string, // the session id the load-time refresh was started for
  listener: null as null | ((event: string, session: unknown) => void),
  issued: (() => null) as (u: never) => unknown,
  verified: [] as string[],
  refreshes: 0,
}));

vi.mock("@/lib/supabase/config", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/config")>()), isE2EMockEnabled: () => false }));
vi.mock("@/lib/supabase/browser", () => {
  const profiles = { select: () => profiles, eq: () => profiles, maybeSingle: async () => ({ data: null, error: null, status: 200 }) };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: fake.stored } }),
      // a young token is only verified (getUser with it): counted, answered at once
      getUser: async (jwt?: string) => { fake.verified.push(jwt ?? "<none>"); return { data: { user: (fake.stored as { user?: unknown } | null)?.user ?? null }, error: null }; },
      // the load-time refresh of an old token is held; released with the user the auth server holds now (and a token for that session)
      refreshSession: () => new Promise((resolve) => {
        fake.refreshes += 1;
        fake.startedFor = (fake.stored as { session_id?: string } | null)?.session_id ?? null;
        fake.pendingGetUser = (u) => resolve({ data: { session: fake.issued(u as never), user: u }, error: null });
      }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        fake.listener = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: async () => ({ error: null }),
    },
    from: () => profiles,
  };
  return { createSupabaseBrowserClient: () => client, createSupabaseCheckClient: () => null };
});

import { AppProvider } from "@/lib/context";
import { AuthProvider, useAuth } from "@/lib/auth/auth-context";

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
// as the auth server issues it: the hook's top-level «ayra_economy» claim
const token = (sub: string, sessionId: string | null, economy?: string) =>
  `${b64({ alg: "HS256" })}.${b64({ sub, ...(sessionId ? { session_id: sessionId } : {}), ...(economy ? { ayra_economy: economy } : {}) })}.sig`;
const NOW_S = Math.floor(Date.now() / 1000);

function user(id: string, flags: { owner?: boolean; password?: boolean; economy?: string } = {}): FakeUser {
  return {
    id,
    email: `${id.slice(-2)}@example.com`,
    user_metadata: flags.password ? { has_password: true } : {},
    app_metadata: { ...(flags.owner ? { ayra_role: "owner" } : {}) },
    ...(flags.economy ? { economy: flags.economy } : {}),
  };
}
const session = (u: FakeUser, sessionId: string | null, expiresIn = 3600): FakeSession =>
  ({ access_token: token(u.id, sessionId, u.economy), expires_at: NOW_S + expiresIn, user: u, session_id: sessionId } as FakeSession);
// the token the held refresh brings: same session (a refresh keeps it), the state as the hook reads it now
fake.issued = (u: FakeUser) => ({ access_token: token(u.id, fake.startedFor, u.economy), expires_at: NOW_S + 3600, user: u });

function Probe() {
  const { user: u, sessionEconomy: e } = useAuth();
  return (
    <div>
      <div data-testid="user">{u ? `${u.id.slice(-2)} owner=${u.isOwner} password=${u.hasPassword}` : "none"}</div>
      <div data-testid="economy">{e ? `${e.userId.slice(-2)} ${e.claim ?? "-"} ${e.source}` : "none"}</div>
    </div>
  );
}

async function load(initial: FakeSession) {
  fake.stored = initial;
  render(
    <AppProvider initialLang="ru">
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </AppProvider>
  );
  await waitFor(() => expect(fake.pendingGetUser).not.toBeNull()); // getSession applied, the refresh started and held
  await waitFor(() => expect(screen.getByTestId("user").textContent).toBe(`${initial.user.id.slice(-2)} owner=false password=false`));
}
const emit = (event: string, s: FakeSession | null) => act(() => { fake.stored = s; fake.listener?.(event, s); });
const releaseGetUser = (u: FakeUser) => act(async () => { fake.pendingGetUser?.(u); await new Promise((r) => setTimeout(r, 20)); });
const shown = () => ({ user: screen.getByTestId("user").textContent, economy: screen.getByTestId("economy").textContent });

beforeEach(() => {
  localStorage.clear();
  fake.stored = null;
  fake.pendingGetUser = null;
  fake.startedFor = null;
  fake.verified = [];
  fake.refreshes = 0;
  fake.listener = null;
});
afterEach(() => cleanup());

describe("Q4.5-1 a late getUser answer is applied only to the session it was started for (AuthProvider)", () => {
  it("baseline: the answer for the current session updates the flags and the economy reading", async () => {
    await load(session(user(A), "s1"));
    await releaseGetUser(user(A, { owner: true, password: true, economy: "migration_pending" }));
    await waitFor(() => expect(shown()).toEqual({ user: "a1 owner=true password=true", economy: "a1 migration_pending verified" }));
  });

  it("events in the usual order (INITIAL_SESSION, TOKEN_REFRESHED of the same session) do not drop the answer", async () => {
    const a = user(A);
    await load(session(a, "s1"));
    await emit("INITIAL_SESSION", session(a, "s1"));
    await emit("TOKEN_REFRESHED", session(a, "s1", 7200));
    await releaseGetUser(user(A, { owner: true, economy: "migration_pending" }));
    await waitFor(() => expect(shown()).toEqual({ user: "a1 owner=true password=false", economy: "a1 migration_pending verified" }));
  });

  it("after a sign-out the late answer changes nothing", async () => {
    await load(session(user(A), "s1"));
    await emit("SIGNED_OUT", null);
    await releaseGetUser(user(A, { owner: true, password: true, economy: "cloud_active" }));
    expect(shown()).toEqual({ user: "none", economy: "none" });
  });

  it("after another account signed in, A's late answer leaves B as it is", async () => {
    await load(session(user(A), "s1"));
    await emit("SIGNED_IN", session(user(B), "s9"));
    await waitFor(() => expect(shown().user).toBe("b2 owner=false password=false"));
    await releaseGetUser(user(A, { owner: true, password: true, economy: "cloud_active" }));
    expect(shown()).toEqual({ user: "b2 owner=false password=false", economy: "b2 - verified" });
  });

  it("sign-out, then the same account signs in with a new session: the old session's answer changes nothing", async () => {
    await load(session(user(A), "s1"));
    await emit("SIGNED_OUT", null);
    await emit("SIGNED_IN", session(user(A), "s2"));
    await waitFor(() => expect(shown().user).toBe("a1 owner=false password=false"));
    await releaseGetUser(user(A, { owner: true, password: true, economy: "cloud_active" }));
    expect(shown()).toEqual({ user: "a1 owner=false password=false", economy: "a1 - verified" });
  });

  it("a new session of the same account without a seen sign-out (another tab signed in again) is also a new sign-in", async () => {
    await load(session(user(A), "s1"));
    await emit("SIGNED_IN", session(user(A), "s2"));
    await releaseGetUser(user(A, { owner: true, economy: "cloud_active" }));
    expect(shown()).toEqual({ user: "a1 owner=false password=false", economy: "a1 - verified" });
  });

  it("tokens without a session id (the e2e fake): sign-out then sign-in of the same account still ends the old answer", async () => {
    await load(session(user(A), null));
    await emit("SIGNED_OUT", null);
    await emit("SIGNED_IN", session(user(A), null));
    await waitFor(() => expect(shown().user).toBe("a1 owner=false password=false"));
    await releaseGetUser(user(A, { owner: true, economy: "cloud_active" }));
    expect(shown()).toEqual({ user: "a1 owner=false password=false", economy: "a1 - verified" });
  });

  it("Q4.5-2: a young token is verified as it is (getUser with exactly it), never refreshed at load; its mark is read", async () => {
    const youngToken = `${b64({ alg: "HS256" })}.${b64({ sub: A, session_id: "s1", iat: NOW_S - 5, ayra_economy: "migration_pending" })}.sig`;
    const young = { access_token: youngToken, expires_at: NOW_S + 3600, user: user(A), session_id: "s1" } as FakeSession;
    fake.stored = young;
    render(<AppProvider initialLang="ru"><AuthProvider><Probe /></AuthProvider></AppProvider>);
    await waitFor(() => expect(shown().economy).toBe("a1 migration_pending verified"));
    expect(fake.verified).toEqual([young.access_token]);
    expect(fake.refreshes).toBe(0);
  });
});

