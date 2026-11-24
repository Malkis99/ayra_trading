import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { AppStorage, GUEST_SPACE_ID } from "@/lib/storage";

/**
 * Q4.7-Б1 (found with the other-device deletion test): a sign-out that comes while the switch INTO the account is still
 * flushing the previous space. The second switch must not overtake the first one: otherwise the account space is set
 * last and marked ready while the app is a guest — «isSpaceReady» never becomes true and the page stays a skeleton.
 */
const A = "00000000-0000-0000-0000-0000000000a1";
const fake = vi.hoisted(() => ({ stored: null as unknown, listener: null as null | ((event: string, session: unknown) => void) }));

vi.mock("@/lib/supabase/config", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/config")>()), isE2EMockEnabled: () => false }));
vi.mock("@/lib/supabase/browser", () => {
  const profiles = { select: () => profiles, eq: () => profiles, maybeSingle: async () => ({ data: null, error: null, status: 200 }) };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: fake.stored } }),
      getUser: () => new Promise(() => {}), // the load-time check never answers here
      refreshSession: () => new Promise(() => {}),
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

function Probe() {
  const { authState, isSpaceReady } = useAuth();
  return <div data-testid="probe">{`${authState}|${isSpaceReady ? "ready" : "not-ready"}`}</div>;
}

describe("Q4.7-Б1 space switches keep their order", () => {
  afterEach(() => cleanup());

  it("signed out while the switch into the account is still flushing: ends as a ready guest space", async () => {
    localStorage.clear();
    AppStorage.setUserId(null);
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
    fake.stored = {
      access_token: `${b64({ alg: "HS256" })}.${b64({ sub: A, iat: Math.floor(Date.now() / 1000) })}.sig`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: A, email: "a1@example.com", user_metadata: {}, app_metadata: {} },
    };
    // the flush of the guest space (the first switch: guest → account) is held until released
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let holding = true;
    const unregister = AppStorage.registerFlushHandler(async (space) => {
      if (holding && space === GUEST_SPACE_ID) await held;
    });
    render(<AppProvider><AuthProvider><Probe /></AuthProvider></AppProvider>);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("authenticated|not-ready"));
    // the auth server answered «no such user»: signed out while the first switch still waits
    act(() => fake.listener?.("SIGNED_OUT", null));
    holding = false;
    await act(async () => { release(); await held; });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("guest|ready"));
    expect(AppStorage.getActiveSpaceId()).toBe(GUEST_SPACE_ID);
    unregister();
  });
});
