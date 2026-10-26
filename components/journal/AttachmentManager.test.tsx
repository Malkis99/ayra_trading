import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { getDictionary } from "@/lib/i18n";
import type { CloudAttachmentStore } from "@/lib/journal/attachments/elsewhere";

const local = { attachments: [] as { id: string; kind?: string; previewBlob?: Blob }[] };
const shot = (id: string) => ({ id, kind: "before", previewBlob: new Blob(["x"]) });
vi.mock("@/lib/journal/attachments/hooks", () => ({
  useAttachments: () => ({
    attachments: local.attachments,
    loading: false,
    error: null,
    addAttachment: vi.fn(),
    updateMetadata: vi.fn(),
    deleteAttachment: vi.fn(),
    forget: vi.fn(),
    reload: vi.fn(),
  }),
}));
vi.mock("@/lib/journal/attachments/image-processor", () => ({ processScreenshot: vi.fn() }));
const toast = vi.fn();
vi.mock("@/lib/context", () => {
  const app = () => ({ dict: getDictionary("ru"), lang: "ru", showToast: toast });
  return { useApp: app, useOptionalApp: app };
});
// The journal of 0005: where each screenshot is (cloud journal), auto / manual
const journal = {
  syncMode: "auto" as "auto" | "manual",
  cloudActive: true,
  states: {} as Record<string, "inCloud" | "downloading" | "noSpace" | "none">,
  downloadAttachment: vi.fn(async () => true),
};
const noneDeleted = new Set<string>();
vi.mock("@/lib/journal/context", () => ({
  useJournal: () => ({
    syncMode: journal.syncMode,
    cloudActive: journal.cloudActive,
    attachmentCloudState: (id: string) => journal.states[id] ?? "none",
    downloadAttachment: journal.downloadAttachment,
    attachmentFilesVersion: 0,
    deletedAttachmentIds: noneDeleted,
    saveAttachmentRecord: vi.fn(),
    updateAttachmentRecord: vi.fn(),
    deleteAttachmentRecord: vi.fn(() => true),
    restoreAttachmentRecord: vi.fn(),
  }),
}));
vi.mock("@/lib/game-context", () => ({ useGame: () => ({ gameState: {}, setGameState: vi.fn() }) }));

import { AttachmentManager } from "./AttachmentManager";

const CAPTION = "Скриншот хранится на другом устройстве";

beforeEach(() => {
  local.attachments = [];
  journal.syncMode = "auto";
  journal.cloudActive = true;
  journal.states = {};
  journal.downloadAttachment.mockClear();
  toast.mockClear();
  Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: () => {} });
});

describe("screenshot caption «stored on another device» (T7b-4f)", () => {
  it("trade from another device lists a screenshot this device lacks → caption", async () => {
    render(<AttachmentManager tradeId="tr_1" expectedIds={["att_a"]} />);
    expect((await screen.findByTestId("screenshots-elsewhere")).textContent).toContain(CAPTION);
  });

  it("the file is in the cloud store → no caption (disappears by itself after 0005)", async () => {
    const inCloud: CloudAttachmentStore = { has: async (ids) => new Set(ids) };
    render(<AttachmentManager tradeId="tr_1" expectedIds={["att_a"]} cloudStore={inCloud} />);
    await waitFor(() => expect(screen.queryByTestId("screenshots-elsewhere")).toBeNull());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("screenshots-elsewhere")).toBeNull();
  });

  it("the file is on this device → no caption", async () => {
    local.attachments = [shot("att_a")];
    render(<AttachmentManager tradeId="tr_1" expectedIds={["att_a"]} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  it("several missing → count in the caption", async () => {
    render(<AttachmentManager tradeId="tr_1" expectedIds={["att_a", "att_b"]} />);
    expect((await screen.findByTestId("screenshots-elsewhere")).textContent).toContain("Скриншоты хранятся на другом устройстве: 2");
  });

  it("editing the trade here keeps the ids of screenshots from another device in the record", async () => {
    local.attachments = [shot("att_here")];
    const onChanged = vi.fn();
    render(<AttachmentManager tradeId="tr_1" expectedIds={["att_here", "att_a"]} onAttachmentsChanged={onChanged} />);
    await waitFor(() => expect(onChanged).toHaveBeenLastCalledWith(["att_here", "att_a"]));
  });
});

describe("screenshots in the cloud (0005)", () => {
  it("automatic: a screenshot whose file is in the cloud downloads by itself when the trade is opened", async () => {
    journal.states = { att_a: "inCloud" };
    render(<AttachmentManager tradeId="tr_1" expectedIds={["att_a"]} />);
    await waitFor(() => expect(journal.downloadAttachment).toHaveBeenCalledWith("att_a"));
    expect(screen.queryByTestId("screenshots-elsewhere")).toBeNull();
    expect(screen.queryByTestId("screenshots-in-cloud")).toBeNull();
  });

  it("while downloading: «Загружается из облака…», no «stored on another device»", async () => {
    journal.states = { att_a: "downloading" };
    render(<AttachmentManager tradeId="tr_1" expectedIds={["att_a"]} />);
    expect((await screen.findByTestId("screenshots-downloading")).textContent).toContain("Загружается из облака");
    expect(screen.queryByTestId("screenshots-elsewhere")).toBeNull();
  });

  it("manual: «Скриншот в облаке» and «Загрузить»; nothing downloads by itself", async () => {
    journal.syncMode = "manual";
    journal.states = { att_a: "inCloud" };
    render(<AttachmentManager tradeId="tr_1" expectedIds={["att_a"]} />);
    expect((await screen.findByTestId("screenshots-in-cloud")).textContent).toContain("Скриншот в облаке");
    await new Promise((r) => setTimeout(r, 0));
    expect(journal.downloadAttachment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("screenshots-download"));
    await waitFor(() => expect(journal.downloadAttachment).toHaveBeenCalledWith("att_a", { byUser: true }));
  });

  it("no space in the cloud: the trade says the screenshot stays on this device", async () => {
    local.attachments = [shot("att_here")];
    journal.states = { att_here: "noSpace" };
    render(<AttachmentManager tradeId="tr_1" expectedIds={["att_here"]} />);
    expect((await screen.findByTestId("screenshots-no-space")).textContent).toContain("в облаке нет места");
  });

  it("not yet in the cloud (row not uploaded by the other device): the old caption stays", async () => {
    journal.states = { att_a: "none" };
    render(<AttachmentManager tradeId="tr_1" expectedIds={["att_a"]} />);
    expect((await screen.findByTestId("screenshots-elsewhere")).textContent).toContain(CAPTION);
  });
});
