import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * Q4.5-2: a server answer is applied only to the account and scope its request was made for — the REAL handler
 * (GameProvider: the immediate session_stale listener and the later handling of the result). The status request of
 * the loaded account is held, the device switches (A → B, A → guest, sign-out → sign-in of A), then the answer for A
 * arrives: nothing may change for what is loaded now, nor be written into any other space.
 */

vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => null, createSupabaseCheckClient: () => null }));

import { AppProvider } from "@/lib/context";
import { GameProvider, useGame } from "@/lib/game-context";
import { AppStorage } from "@/lib/storage";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { answerBelongs, requestScopeOf, type RequestScope } from "@/lib/economy-scope";

const A = "00000000-0000-0000-0000-0000000005ca";
const B = "00000000-0000-0000-0000-0000000005cb";

type Held = { path: string; resolve: (status: number, body: Record<string, unknown>) => void };
let held: Held[] = [];

function Probe() {
  const { economy, isLoaded } = useGame() as ReturnType<typeof useGame> & { isLoaded?: boolean };
  return <div data-testid="mode">{isLoaded === false ? "loading" : economy.mode}</div>;
}

const sticky = (user: string | null) => localStorage.getItem(`ayra:${user ?? "guest"}:ayra_economy_mode`);
const mode = () => screen.getByTestId("mode").textContent;
/** The game switches spaces the way the app does (sign-out → guest, sign-in → account). */
const switchTo = (user: string | null) =>
  act(async () => {
    const from = AppStorage.getActiveSpaceId();
    AppStorage.setUserId(user);
    spaceTabChannel.notifyLocal(from, AppStorage.getActiveSpaceId());
    await new Promise((r) => setTimeout(r, 30));
  });
const answer = (i: number, status: number, body: Record<string, unknown>) =>
  act(async () => {
    held[i].resolve(status, body);
    await new Promise((r) => setTimeout(r, 30));
  });

function mount() {
  render(
    <AppProvider initialLang="ru">
      <GameProvider>
        <Probe />
      </GameProvider>
    </AppProvider>
  );
}
const statusRequests = () => held.filter((h) => h.path.endsWith("/api/game/day/status"));

beforeEach(() => {
  localStorage.clear();
  held = [];
  process.env.NEXT_PUBLIC_AYRA_SERVER_ECONOMY = "1";
  vi.stubGlobal(
    "fetch",
    (path: string) =>
      new Promise<Response>((resolve) => {
        held.push({ path, resolve: (status, body) => resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) });
      })
  );
  AppStorage.setUserId(A);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_AYRA_SERVER_ECONOMY;
  AppStorage.setUserId(null);
});

describe("Q4.5-2 a late server answer never changes another account (GameProvider, real handler)", () => {
  it("5. the answer for the account still loaded: session_stale's state is learned (immediately and kept)", async () => {
    mount();
    await waitFor(() => expect(statusRequests()).toHaveLength(1));
    await answer(0, 401, { error: "session_stale", state: "migration_pending", reason: "mark_changed", account: A });
    await waitFor(() => expect(mode()).toBe("migration_pending"));
    expect(sticky(A)).toBe("migration_pending");
  });

  it("1. A → B while A's request travels: A's late session_stale changes nothing for B (nor anything else)", async () => {
    mount();
    await waitFor(() => expect(statusRequests()).toHaveLength(1));
    await switchTo(B);
    await answer(0, 401, { error: "session_stale", state: "cloud_active", reason: "mark_changed", account: A });
    expect(mode()).toBe("local");
    expect(sticky(B)).toBeNull();
    expect(sticky(A)).toBeNull(); // not even written into A's space from B's screen
  });

  it("1b. A → B: a late SUCCESSFUL status for A (cloud_active) is not applied to B either", async () => {
    mount();
    await waitFor(() => expect(statusRequests()).toHaveLength(1));
    await switchTo(B);
    await answer(0, 200, { status: { state: "cloud_active", game_sync: false, day: null }, account: A });
    expect(mode()).toBe("local");
    expect(sticky(B)).toBeNull();
  });

  it("2. A → guest while A's request travels: nothing for the guest", async () => {
    mount();
    await waitFor(() => expect(statusRequests()).toHaveLength(1));
    await switchTo(null);
    await answer(0, 401, { error: "session_stale", state: "migration_pending", account: A });
    expect(mode()).toBe("local");
    expect(sticky(null)).toBeNull();
    expect(sticky(A)).toBeNull();
  });

  it("3. sign-out → sign-in of A again (a new session): the old session's late answer changes nothing", async () => {
    mount();
    await waitFor(() => expect(statusRequests()).toHaveLength(1));
    await switchTo(null);
    await switchTo(A);
    await answer(0, 401, { error: "session_stale", state: "cloud_active", account: A });
    expect(mode()).toBe("local");
    expect(sticky(A)).toBeNull();
  });

  it("4. two requests of different generations: the old one (A) is dropped, the current one (B) is applied to B", async () => {
    mount();
    await waitFor(() => expect(statusRequests()).toHaveLength(1));
    await switchTo(B);
    await waitFor(() => expect(statusRequests()).toHaveLength(2)); // B's own status request
    // B's answer first, then A's late one (the order a network can give)
    await answer(1, 401, { error: "session_stale", state: "migration_scheduled", account: B });
    await waitFor(() => expect(mode()).toBe("migration_scheduled"));
    await answer(0, 401, { error: "session_stale", state: "cloud_active", account: A });
    expect(mode()).toBe("migration_scheduled");
    expect(sticky(B)).toBe("migration_scheduled");
    expect(sticky(A)).toBeNull();
  });

  it("an answer naming another account than the one asked for (cookies switched in another tab) is never applied", async () => {
    mount();
    await waitFor(() => expect(statusRequests()).toHaveLength(1));
    await answer(0, 401, { error: "session_stale", state: "cloud_active", account: B });
    expect(mode()).toBe("local");
    expect(sticky(A)).toBeNull();
    expect(sticky(B)).toBeNull();
  });

  it("an answer that names no account (an old server) is never applied", async () => {
    mount();
    await waitFor(() => expect(statusRequests()).toHaveLength(1));
    await answer(0, 401, { error: "session_stale", state: "cloud_active" });
    expect(mode()).toBe("local");
    expect(sticky(A)).toBeNull();
  });
});

describe("Q4.5-2 the scope rule itself", () => {
  const now = { activeSpace: `account:${A}`, loadedSpace: `account:${A}`, spaceGeneration: 3, authGeneration: 7 };
  const scope = requestScopeOf(now) as RequestScope;

  it("a request is made only in an account space that is loaded and active", () => {
    expect(scope).toEqual({ space: `account:${A}`, account: A, spaceGeneration: 3, authGeneration: 7 });
    expect(requestScopeOf({ ...now, loadedSpace: "guest", activeSpace: "guest" })).toBeNull();
    expect(requestScopeOf({ ...now, activeSpace: `account:${B}` })).toBeNull();
  });

  it("belongs only with the same account named by the server and nothing of the scope changed", () => {
    expect(answerBelongs(scope, A, now)).toBe(true);
    expect(answerBelongs(scope, B, now)).toBe(false);
    expect(answerBelongs(scope, undefined, now)).toBe(false);
    expect(answerBelongs(null, A, now)).toBe(false);
    expect(answerBelongs(scope, A, { ...now, activeSpace: `account:${B}` })).toBe(false);
    expect(answerBelongs(scope, A, { ...now, loadedSpace: "guest" })).toBe(false);
    expect(answerBelongs(scope, A, { ...now, spaceGeneration: 4 })).toBe(false);
    expect(answerBelongs(scope, A, { ...now, authGeneration: 8 })).toBe(false); // a new session of the same account
  });
});
