import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { AppProvider } from "@/lib/context";
import { AppStorage } from "@/lib/storage";

// Q4.7-Б1: on another device the sign-out of a deleted account can be shown BEFORE the account is marked deleted
// (supabase-js signs out by itself when a refresh fails). The offer to erase the copy must still appear — in either order.
const state = vi.hoisted(() => ({ auth: { authState: "authenticated" as string } }));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => state.auth }));
import { DeletedAccountNotice } from "./DeletedAccountNotice";

const A = "00000000-0000-0000-0000-0000000000aa";
const view = () => (
  <AppProvider>
    <DeletedAccountNotice />
  </AppProvider>
);

describe("Q4.7-Б1 the offer to erase a deleted account's copy", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(A);
    AppStorage.setItem("ayra_demo_v1", "{}", A);
    state.auth = { authState: "authenticated" };
  });
  afterEach(() => cleanup());

  it("signed out first, marked deleted afterwards: the offer still appears; erasing removes the copy", async () => {
    const r = render(view());
    AppStorage.setUserId(null);
    state.auth = { authState: "guest" };
    r.rerender(view());
    expect(screen.queryByTestId("deleted-account-notice")).toBeNull();
    act(() => AppStorage.markAccountDeleted(A));
    expect(await screen.findByTestId("deleted-account-notice")).toBeTruthy();
    fireEvent.click(screen.getByTestId("deleted-account-erase"));
    await waitFor(() => expect(screen.queryByTestId("deleted-account-notice")).toBeNull());
    expect(Object.keys(localStorage).filter((k) => k.startsWith(`ayra:${A}:`))).toEqual([]);
  });

  it("marked deleted first, signed out afterwards: the offer appears once the account is no longer open", async () => {
    const r = render(view());
    act(() => AppStorage.markAccountDeleted(A));
    expect(screen.queryByTestId("deleted-account-notice")).toBeNull();
    AppStorage.setUserId(null);
    state.auth = { authState: "guest" };
    r.rerender(view());
    expect(await screen.findByTestId("deleted-account-notice")).toBeTruthy();
  });

  it("the page changes while erasing: a notice shown meanwhile disappears once the copy is gone", async () => {
    AppStorage.setUserId(null);
    state.auth = { authState: "guest" };
    AppStorage.markAccountDeleted(A);
    const first = render(view());
    const second = render(view());
    expect(await within(first.container).findByTestId("deleted-account-notice")).toBeTruthy();
    expect(await within(second.container).findByTestId("deleted-account-notice")).toBeTruthy();
    fireEvent.click(within(first.container).getByTestId("deleted-account-erase"));
    await waitFor(() => expect(screen.queryAllByTestId("deleted-account-notice")).toHaveLength(0));
  });

  it("another tab marks it: heard through the storage event", async () => {
    AppStorage.setUserId(null);
    state.auth = { authState: "guest" };
    render(view());
    localStorage.setItem("ayra_deleted_accounts", JSON.stringify([A]));
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "ayra_deleted_accounts" })); });
    expect(await screen.findByTestId("deleted-account-notice")).toBeTruthy();
  });
});
