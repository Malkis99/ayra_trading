import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  }),
}));
vi.mock("@/lib/journal/attachments/image-processor", () => ({ processImageFile: vi.fn() }));
vi.mock("@/lib/context", () => {
  const app = () => ({ dict: getDictionary("ru"), lang: "ru", showToast: vi.fn() });
  return { useApp: app, useOptionalApp: app };
});
vi.mock("@/lib/game-context", () => ({ useGame: () => ({ gameState: {}, setGameState: vi.fn() }) }));

import { AttachmentManager } from "./AttachmentManager";

const CAPTION = "Скриншот хранится на другом устройстве";

beforeEach(() => {
  local.attachments = [];
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
