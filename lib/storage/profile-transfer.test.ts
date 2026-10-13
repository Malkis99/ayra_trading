import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { AppStorage } from "./index";
import { IndexedDBAttachmentRepository } from "./indexeddb-repository";
import {
  summarizeSpace,
  shouldOfferProfileSelect,
  copyGuestToAccount,
  listGuestDataKeys,
  setProfileChoice,
  getProfileChoice,
  exportGuestData,
  deleteGuestData,
  deleteAccountDeviceData,
} from "./profile-transfer";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { resolvePostLoginRoute } from "@/lib/auth/routing";

const USER = "33333333-3333-3333-3333-333333333333";

function seedGuest() {
  localStorage.setItem(
    "ayra_demo_v1",
    JSON.stringify({ name: "GuestZed", level: 4, xp: 10, onboarding: { status: "done" } })
  );
  localStorage.setItem("ayra_journal_v1", JSON.stringify({ trades: [{ id: "t1" }, { id: "t2" }], accounts: [] }));
}

describe("profile-transfer (C1)", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(null);
  });

  it("treats a fresh default state as empty and real progress as data", () => {
    localStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "TraderOne", level: 1, xp: 0, onboarding: { status: "none" } }));
    expect(summarizeSpace(null).hasData).toBe(false);

    seedGuest();
    const summary = summarizeSpace(null);
    expect(summary).toMatchObject({ hasData: true, nickname: "GuestZed", level: 4, tradesCount: 2 });
  });

  it("offers the choice only for an empty account without nickname or prior decision", () => {
    seedGuest();
    expect(shouldOfferProfileSelect(USER, null)).toBe(true);
    expect(shouldOfferProfileSelect(USER, "CloudNick")).toBe(false);

    setProfileChoice(USER, "fresh");
    expect(getProfileChoice(USER)).toBe("fresh");
    expect(shouldOfferProfileSelect(USER, null)).toBe(false);
  });

  it("does not offer the choice when the account space already has data", () => {
    seedGuest();
    AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "AccNick", level: 2, onboarding: { status: "done" } }), USER);
    expect(shouldOfferProfileSelect(USER, null)).toBe(false);
  });

  it("does not offer the choice when the guest space is empty", () => {
    expect(shouldOfferProfileSelect(USER, null)).toBe(false);
  });

  it("lists only AYRA guest data keys (no device keys, schema tag, or foreign keys)", () => {
    seedGuest();
    localStorage.setItem("ayra_lang", "en");
    localStorage.setItem("sb-project-auth-token", "secret");
    localStorage.setItem(`ayra:${USER}:ayra_demo_v1`, "{}");
    expect(listGuestDataKeys().sort()).toEqual(["ayra_demo_v1", "ayra_journal_v1"]);
  });

  it("refuses to copy unless the account is the active space", async () => {
    seedGuest();
    await expect(copyGuestToAccount(USER)).rejects.toThrow();
  });

  it("copies guest data and attachments into the account, keeps guest intact, reloads providers", async () => {
    seedGuest();
    const guestRepo = new IndexedDBAttachmentRepository(null);
    const blob = new Blob(["x"], { type: "image/png" });
    await guestRepo.addAttachment({
      id: "att_c1",
      tradeId: "t1",
      kind: "before",
      width: 1,
      height: 1,
      bytes: 1,
      mime: "image/png",
      hash: "h",
      originalBlob: blob,
      previewBlob: blob,
    });

    AppStorage.setUserId(USER);
    const notify = vi.spyOn(spaceTabChannel, "notifyLocal");
    const result = await copyGuestToAccount(USER);

    expect(result).toMatchObject({ copiedKeys: 2, copiedAttachments: 1, failedAttachments: 0 });
    expect(JSON.parse(AppStorage.getItem("ayra_demo_v1", USER)!).name).toBe("GuestZed");
    expect(JSON.parse(localStorage.getItem("ayra_demo_v1")!).name).toBe("GuestZed");
    expect(await new IndexedDBAttachmentRepository(USER).getAttachment("att_c1")).not.toBeNull();
    expect(await guestRepo.getAttachment("att_c1")).not.toBeNull();
    expect(notify).toHaveBeenCalledWith(`account:${USER}`, `account:${USER}`);
    notify.mockRestore();
  });

  it("routes to /profile-select (keeping next) when offered, before onboarding rules", async () => {
    const res = await resolvePostLoginRoute({
      user: { id: USER, email: "a@example.com" },
      profile: null,
      rawNextParam: "/journal",
      guestState: null,
      offerProfileSelect: true,
    });
    expect(res).toEqual({ destination: "/profile-select?next=%2Fjournal", source: "profile_select" });
  });

  it("copies with the cloud nickname taking precedence over the guest name", async () => {
    seedGuest();
    AppStorage.setUserId(USER);
    await copyGuestToAccount(USER, { nickname: "CloudNick" });
    expect(JSON.parse(AppStorage.getItem("ayra_demo_v1", USER)!).name).toBe("CloudNick");
    expect(JSON.parse(localStorage.getItem("ayra_demo_v1")!).name).toBe("GuestZed");
  });

  it("exports guest data as JSON without device keys or account data", async () => {
    seedGuest();
    localStorage.setItem("ayra_lang", "en");
    AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "Acc" }), USER);
    const exported = await exportGuestData();
    expect(exported.kind).toBe("guest-device-data");
    expect(Object.keys(exported.data).sort()).toEqual(["ayra_demo_v1", "ayra_journal_v1"]);
    expect((exported.data.ayra_demo_v1 as any).name).toBe("GuestZed");
  });

  it("deletes guest data only while an account is active and keeps account data", async () => {
    seedGuest();
    localStorage.setItem("ayra_lang", "en");
    localStorage.setItem("sb-project-auth-token", "keep");
    AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "Acc" }), USER);

    await expect(deleteGuestData()).rejects.toThrow();

    AppStorage.setUserId(USER);
    const res = await deleteGuestData();
    expect(res.removedKeys).toBe(2);
    expect(localStorage.getItem("ayra_demo_v1")).toBeNull();
    expect(localStorage.getItem("ayra_lang")).toBe("en");
    expect(localStorage.getItem("sb-project-auth-token")).toBe("keep");
    expect(AppStorage.getItem("ayra_demo_v1", USER)).not.toBeNull();
  });

  it("deletes account device data only after sign-out and keeps guest data", async () => {
    seedGuest();
    AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "Acc" }), USER);
    AppStorage.setItem("ayra_journal_v1", "{}", USER);

    AppStorage.setUserId(USER);
    await expect(deleteAccountDeviceData(USER)).rejects.toThrow();

    AppStorage.setUserId(null);
    const res = await deleteAccountDeviceData(USER);
    expect(res.removedKeys).toBe(2);
    expect(AppStorage.getItem("ayra_demo_v1", USER)).toBeNull();
    expect(JSON.parse(localStorage.getItem("ayra_demo_v1")!).name).toBe("GuestZed");
  });
});
