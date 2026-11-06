import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "@/lib/context";
import { LOCALE_CHOICE_EVENT, readLocaleSync } from "@/lib/profile-timezone";

const state = vi.hoisted(() => ({
  auth: { user: { id: "mock-locale-user" } as { id: string } | null, isSpaceReady: true },
  journal: { cloudActive: true, syncMode: "auto", cloudStatus: { lastSyncAt: undefined as string | undefined } },
  get: vi.fn(), patch: vi.fn(), updateTimezone: vi.fn(),
}));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/game-context", () => ({ useGame: () => ({ gameState: { profile: { timezone: "UTC" } }, isLoaded: true, updateTimezone: state.updateTimezone }) }));
vi.mock("@/lib/journal/context", () => ({ useJournal: () => state.journal }));
vi.mock("@/lib/journal/cloud/sync-state", () => ({ readSyncState: () => ({}) }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => ({ from: () => ({
  select: () => ({ eq: () => ({ maybeSingle: () => state.get() }) }),
  update: (value: unknown) => ({ eq: () => state.patch(value) }),
}) }) }));
import { ProfileTimezoneSync } from "./ProfileTimezoneSync";

const id = "mock-locale-user";
const response = (locale = "ru") => ({ data: { timezone: "UTC", locale, updated_at: "2026-11-06T10:00:00Z" }, error: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function Controls() {
  const { lang, setLanguage } = useApp();
  return <><output data-testid="lang">{lang}</output><button onClick={() => setLanguage("en")}>EN</button><button onClick={() => setLanguage("ru")}>RU</button><button onClick={() => setLanguage("en", "cloud")}>Restore EN</button><ProfileTimezoneSync /></>;
}
const tree = () => <AppProvider><Controls /></AppProvider>;
function exchange(view: ReturnType<typeof render>, at: string) {
  state.journal.cloudStatus.lastSyncAt = at;
  view.rerender(tree());
}
async function baseline(view: ReturnType<typeof render>) {
  exchange(view, "initial");
  await waitFor(() => expect(readLocaleSync(id).synced).toBe("ru"));
}
beforeEach(() => {
  localStorage.clear();
  state.auth.user = { id };
  state.journal.cloudActive = true;
  state.journal.syncMode = "auto";
  state.journal.cloudStatus.lastSyncAt = undefined;
  state.get.mockReset().mockResolvedValue(response());
  state.patch.mockReset().mockResolvedValue({ error: null });
  state.updateTimezone.mockClear();
});
afterEach(cleanup);

describe("profile locale synchronisation", () => {
  it("records default cloud RU before the first choice; RU → EN → RU sends exactly two PATCHes", async () => {
    const view = render(tree());
    await baseline(view);
    expect(localStorage.getItem("ayra_lang")).toBeNull();
    fireEvent.click(screen.getByText("EN"));
    await waitFor(() => expect(readLocaleSync(id)).toMatchObject({ synced: "en", dirty: false }));
    state.get.mockResolvedValue(response("en"));
    fireEvent.click(screen.getByText("RU"));
    await waitFor(() => expect(readLocaleSync(id)).toMatchObject({ synced: "ru", dirty: false }));
    expect(state.patch.mock.calls).toEqual([[{ locale: "en" }], [{ locale: "ru" }]]);
    view.rerender(tree());
    await act(async () => {});
    expect(state.get).toHaveBeenCalledTimes(3);
    expect(state.updateTimezone).not.toHaveBeenCalled();
  });

  it("captures a first explicit choice without any baseline", async () => {
    render(tree());
    fireEvent.click(screen.getByText("EN"));
    await waitFor(() => expect(readLocaleSync(id)).toMatchObject({ synced: "en", dirty: false }));
    expect(state.patch).toHaveBeenCalledWith({ locale: "en" });
  });

  it("coalesces rapid changes during GET, including returning to RU", async () => {
    const get = deferred<ReturnType<typeof response>>();
    state.get.mockReturnValue(get.promise);
    render(tree());
    fireEvent.click(screen.getByText("EN"));
    fireEvent.click(screen.getByText("RU"));
    await act(async () => get.resolve(response()));
    expect(readLocaleSync(id)).toMatchObject({ synced: "ru", dirty: false });
    expect(state.patch).not.toHaveBeenCalled();
    expect(state.get).toHaveBeenCalledTimes(1);
  });

  it("a stale PATCH cannot clear or apply over a newer choice; auto sends the last choice once", async () => {
    const view = render(tree());
    await baseline(view);
    const patch = deferred<{ error: null }>();
    state.patch.mockImplementationOnce(() => patch.promise);
    fireEvent.click(screen.getByText("EN"));
    await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("RU"));
    state.get.mockResolvedValue(response("en"));
    await act(async () => patch.resolve({ error: null }));
    await waitFor(() => expect(readLocaleSync(id)).toMatchObject({ synced: "ru", dirty: false }));
    expect(screen.getByTestId("lang").textContent).toBe("ru");
    expect(state.patch.mock.calls).toEqual([[{ locale: "en" }], [{ locale: "ru" }]]);
  });

  it.each(["read", "write"])("%s failure preserves pending intent through remount and does not loop", async (failure) => {
    const view = render(tree());
    await baseline(view);
    if (failure === "read") state.get.mockRejectedValueOnce(new Error("offline"));
    else state.patch.mockResolvedValueOnce({ error: { message: "offline" } });
    fireEvent.click(screen.getByText("EN"));
    await act(async () => {});
    expect(readLocaleSync(id)).toMatchObject({ synced: "ru", pending: "en", dirty: true });
    expect(screen.getByTestId("lang").textContent).toBe("en");
    view.rerender(tree());
    await act(async () => {});
    expect(state.get).toHaveBeenCalledTimes(2);
    view.unmount();
    render(tree());
    await waitFor(() => expect(readLocaleSync(id)).toMatchObject({ synced: "en", dirty: false }));
    expect(screen.getByTestId("lang").textContent).toBe("en");
  });

  it("a delayed language render after failed PATCH does not retry the same intent", async () => {
    const view = render(tree());
    await baseline(view);
    state.patch.mockResolvedValueOnce({ error: { message: "offline" } });
    // Separate the immediate choice event from its later language render.
    await act(async () => { window.dispatchEvent(new CustomEvent(LOCALE_CHOICE_EVENT, { detail: "en" })); });
    expect(state.patch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Restore EN"));
    await act(async () => {});
    expect(state.patch).toHaveBeenCalledTimes(1);
    expect(readLocaleSync(id)).toMatchObject({ pending: "en", dirty: true });
  });

  it("manual mode waits for each explicit exchange, including a change during PATCH", async () => {
    state.journal.syncMode = "manual";
    const view = render(tree());
    fireEvent.click(screen.getByText("EN"));
    expect(state.get).not.toHaveBeenCalled();
    const patch = deferred<{ error: null }>();
    state.patch.mockReturnValueOnce(patch.promise);
    exchange(view, "manual-1");
    await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("RU"));
    await act(async () => patch.resolve({ error: null }));
    expect(readLocaleSync(id)).toMatchObject({ synced: "en", pending: "ru", dirty: true });
    expect(state.get).toHaveBeenCalledTimes(1);
    state.get.mockResolvedValue(response("en"));
    exchange(view, "manual-2");
    await waitFor(() => expect(readLocaleSync(id)).toMatchObject({ synced: "ru", dirty: false }));
    expect(state.patch).toHaveBeenCalledTimes(2);
  });

  it("manual GET does not authorise a choice made after Synchronise", async () => {
    state.journal.syncMode = "manual";
    const view = render(tree());
    const get = deferred<ReturnType<typeof response>>();
    state.get.mockReturnValueOnce(get.promise);
    exchange(view, "manual");
    fireEvent.click(screen.getByText("EN"));
    await act(async () => get.resolve(response()));
    expect(state.patch).not.toHaveBeenCalled();
    expect(readLocaleSync(id)).toMatchObject({ pending: "en", dirty: true });
    expect(screen.getByTestId("lang").textContent).toBe("en");
  });

  it("cloud language is applied without echo PATCH and survives remount/relogin", async () => {
    state.get.mockResolvedValue(response("en"));
    const view = render(tree());
    exchange(view, "initial");
    await waitFor(() => expect(screen.getByTestId("lang").textContent).toBe("en"));
    expect(readLocaleSync(id)).toMatchObject({ synced: "en", dirty: false });
    view.unmount();
    const next = render(tree());
    expect(screen.getByTestId("lang").textContent).toBe("en");
    state.auth.user = null;
    next.rerender(tree());
    state.auth.user = { id };
    exchange(next, "relogin");
    await act(async () => {});
    expect(state.patch).not.toHaveBeenCalled();
  });

  it("ignores a response after logout", async () => {
    const get = deferred<ReturnType<typeof response>>();
    state.get.mockReturnValueOnce(get.promise);
    const view = render(tree());
    exchange(view, "initial");
    state.auth.user = null;
    view.rerender(tree());
    await act(async () => get.resolve(response("en")));
    expect(screen.getByTestId("lang").textContent).toBe("ru");
    expect(readLocaleSync(id).synced).toBeNull();
    expect(state.patch).not.toHaveBeenCalled();
  });

  it("relogin during an old GET retries pending intent in the new session", async () => {
    const get = deferred<ReturnType<typeof response>>();
    state.get.mockReturnValueOnce(get.promise);
    const view = render(tree());
    fireEvent.click(screen.getByText("EN"));
    state.auth.user = null;
    view.rerender(tree());
    state.auth.user = { id };
    view.rerender(tree());
    await act(async () => get.resolve(response("ru")));
    await waitFor(() => expect(readLocaleSync(id)).toMatchObject({ synced: "en", dirty: false }));
    expect(state.get).toHaveBeenCalledTimes(2);
    expect(state.patch.mock.calls).toEqual([[{ locale: "en" }]]);
    expect(screen.getByTestId("lang").textContent).toBe("en");
  });
});
