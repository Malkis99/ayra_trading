import { describe, it, expect } from "vitest";
import { cloudNoticeState, signOutWarningState, type CloudNoticeInput } from "./account-notice";
import { getDictionary } from "@/lib/i18n";

const on: CloudNoticeInput = { cloudActive: true, initialNeeded: false, pending: 0, conflicts: 0 };

describe("Settings texts by the cloud state (T7b-4f)", () => {
  it("flag off or guest → null: the old «stored on this device» texts stay", () => {
    expect(cloudNoticeState({ ...on, cloudActive: false, pending: 3 })).toBeNull();
    expect(signOutWarningState({ ...on, cloudActive: false })).toBeNull();
  });

  it("flag on: synced / pending / conflict / not uploaded; the most urgent wins", () => {
    expect(cloudNoticeState(on)).toBe("synced");
    expect(cloudNoticeState({ ...on, pending: 1 })).toBe("pending");
    expect(cloudNoticeState({ ...on, pending: 1, conflicts: 1 })).toBe("conflict");
    expect(cloudNoticeState({ ...on, initialNeeded: true, pending: 1 })).toBe("notUploaded");
  });

  it("sign-out warning: records waiting for a choice count as not in the cloud", () => {
    expect(signOutWarningState(on)).toBe("synced");
    expect(signOutWarningState({ ...on, conflicts: 2 })).toBe("pending");
    expect(signOutWarningState({ ...on, initialNeeded: true })).toBe("notUploaded");
  });

  it("every state has a text in RU and EN", () => {
    for (const lang of ["ru", "en"] as const) {
      const d = getDictionary(lang);
      for (const s of ["synced", "pending", "conflict", "notUploaded"] as const) expect(d.account.cloudNotice[s]).toBeTruthy();
      for (const s of ["synced", "pending", "notUploaded"] as const) expect(d.deviceData.signOutDeleteWarningCloud[s]).toBeTruthy();
    }
    expect(getDictionary("ru").account.cloudNotice.synced).toBe("Журнал сохраняется в облако");
  });
});
