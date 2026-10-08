import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  detectMimeTypeFromMagicBytes,
  calculateTargetDimensions,
  checkImageLimits,
  calculateBufferSha256,
} from "./image-processor";
import { IndexedDBAttachmentRepository } from "./indexeddb-repository";
import { INITIAL_GAME_STATE, recordScreenshotAdded } from "@/lib/game";

describe("Attachment Image Processor & Magic Bytes", () => {
  it("detects PNG magic bytes correctly", () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(detectMimeTypeFromMagicBytes(pngHeader.buffer)).toBe("image/png");
  });

  it("detects JPEG magic bytes correctly", () => {
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(detectMimeTypeFromMagicBytes(jpegHeader.buffer)).toBe("image/jpeg");
  });

  it("detects WEBP magic bytes correctly", () => {
    const webpHeader = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x42, 0x50, // WEBP
    ]);
    // 0x57 = W, 0x41 = A -> wait: W E B P is 0x57 0x45 0x42 0x50
    const correctWebp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x10, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectMimeTypeFromMagicBytes(correctWebp.buffer)).toBe("image/webp");
  });

  it("rejects SVG files disguised as PNG/JPEG", () => {
    const svgContent = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect(detectMimeTypeFromMagicBytes(svgContent.buffer)).toBeNull();
  });

  it("rejects empty or truncated buffers", () => {
    expect(detectMimeTypeFromMagicBytes(new ArrayBuffer(0))).toBeNull();
    expect(detectMimeTypeFromMagicBytes(new ArrayBuffer(4))).toBeNull();
  });

  it("calculates downscaling target dimensions accurately", () => {
    // 2400 x 1200 downscaled to max side 1600
    const scaled1600 = calculateTargetDimensions(2400, 1200, 1600);
    expect(scaled1600).toEqual({ width: 1600, height: 800 });

    // 1000 x 500 (<= 1600) remains unchanged
    const scaledSmall = calculateTargetDimensions(1000, 500, 1600);
    expect(scaledSmall).toEqual({ width: 1000, height: 500 });

    // 1200 x 2400 downscaled to thumbnail 320
    const thumb = calculateTargetDimensions(1200, 2400, 320);
    expect(thumb).toEqual({ width: 160, height: 320 });
  });

  it("enforces file size and megapixel limits", () => {
    // Empty
    expect(checkImageLimits(0).ok).toBe(false);

    // Over 10MB
    expect(checkImageLimits(11 * 1024 * 1024).ok).toBe(false);

    // Valid size <= 10MB
    expect(checkImageLimits(2 * 1024 * 1024).ok).toBe(true);

    // Over 40MP (e.g., 8000 x 6000 = 48MP)
    expect(checkImageLimits(1024 * 1024, 8000, 6000).ok).toBe(false);

    // Valid MP (e.g., 4000 x 3000 = 12MP)
    expect(checkImageLimits(1024 * 1024, 4000, 3000).ok).toBe(true);
  });

  it("calculates SHA-256 hash string", async () => {
    const data = new TextEncoder().encode("ayra_test_image_bytes");
    const hash = await calculateBufferSha256(data.buffer);
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });
});

describe("Screenshot Anti-farm & XP Logic", () => {
  let state = INITIAL_GAME_STATE;

  beforeEach(() => {
    state = { ...INITIAL_GAME_STATE, rewardedScreenshotHashes: [], dailyStats: {} };
  });

  it("awards +10 XP for valid screenshot addition", () => {
    const result = recordScreenshotAdded(state, {
      hash: "hash_111",
      width: 1600,
      height: 900,
      tradeOpenedAt: new Date().toISOString(),
    });

    expect(result.xpAwarded).toBe(10);
    expect(result.state.rewardedScreenshotHashes).toContain("hash_111");
    expect(result.state.achievements["firstScreenshot"]).toBe(true);
    expect(result.newlyUnlocked).toContain("firstScreenshot");
  });

  it("enforces daily cap of 1 screenshot XP per day", () => {
    const res1 = recordScreenshotAdded(state, {
      hash: "hash_1",
      width: 1200,
      height: 800,
    });
    expect(res1.xpAwarded).toBe(10);

    const res2 = recordScreenshotAdded(res1.state, {
      hash: "hash_2",
      width: 1200,
      height: 800,
    });
    expect(res2.xpAwarded).toBe(0); // Daily cap reached
  });

  it("rejects screenshots with min dimension < 300px", () => {
    const res = recordScreenshotAdded(state, {
      hash: "hash_small",
      width: 250,
      height: 800,
    });
    expect(res.xpAwarded).toBe(0);
  });

  it("does not award XP for duplicate SHA-256 hashes", () => {
    const res1 = recordScreenshotAdded(state, {
      hash: "hash_duplicate",
      width: 1200,
      height: 800,
    });
    expect(res1.xpAwarded).toBe(10);

    // Next day (different date) but same hash -> 0 XP!
    const nextDay = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const res2 = recordScreenshotAdded(res1.state, {
      hash: "hash_duplicate",
      width: 1200,
      height: 800,
    }, nextDay);
    expect(res2.xpAwarded).toBe(0);
  });

  it("rejects trades with future dates", () => {
    const futureDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const res = recordScreenshotAdded(state, {
      hash: "hash_future",
      width: 1200,
      height: 800,
      tradeOpenedAt: futureDate,
    });
    expect(res.xpAwarded).toBe(0);
  });
});

describe("IndexedDBAttachmentRepository (fake-indexeddb)", () => {
  let repo: IndexedDBAttachmentRepository;

  beforeEach(() => {
    repo = new IndexedDBAttachmentRepository();
  });

  it("stores, retrieves, updates metadata and deletes attachments", async () => {
    const dummyBlob = new Blob(["dummy_image_data"], { type: "image/webp" });

    const saved = await repo.addAttachment({
      tradeId: "trade_test_1",
      kind: "before",
      width: 1600,
      height: 900,
      bytes: 1234,
      mime: "image/webp",
      hash: "hash_test_123",
      originalBlob: dummyBlob,
      previewBlob: dummyBlob,
      caption: "Test setup",
    });

    expect(saved.id).toBeTruthy();
    expect(saved.caption).toBe("Test setup");

    // Fetch by id
    const fetched = await repo.getAttachment(saved.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.hash).toBe("hash_test_123");

    // Fetch by tradeId
    const byTrade = await repo.getAttachmentsByTradeId("trade_test_1");
    expect(byTrade.length).toBe(1);

    // Update metadata
    const updated = await repo.updateMetadata(saved.id, { caption: "Updated caption" });
    expect(updated?.caption).toBe("Updated caption");

    // Delete single
    const deleted = await repo.deleteAttachment(saved.id);
    expect(deleted).toBe(true);

    const checkDeleted = await repo.getAttachment(saved.id);
    expect(checkDeleted).toBeNull();
  });

  it("cleans up orphan attachments older than 24 hours", async () => {
    const dummyBlob = new Blob(["data"], { type: "image/webp" });

    // Old orphan attachment (created 30 hours ago)
    const oldDate = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    await repo.addAttachment({
      id: "orphan_old",
      tradeId: "trade_deleted",
      kind: "other",
      width: 800,
      height: 600,
      bytes: 500,
      mime: "image/webp",
      hash: "orphan_hash_1",
      originalBlob: dummyBlob,
      previewBlob: dummyBlob,
      createdAt: oldDate,
    });

    // Recent orphan attachment (created 1 hour ago)
    await repo.addAttachment({
      id: "orphan_recent",
      tradeId: "trade_deleted",
      kind: "other",
      width: 800,
      height: 600,
      bytes: 500,
      mime: "image/webp",
      hash: "orphan_hash_2",
      originalBlob: dummyBlob,
      previewBlob: dummyBlob,
      createdAt: new Date().toISOString(),
    });

    // Valid trade IDs set does NOT include 'trade_deleted'
    const validTradeIds = new Set(["trade_active_1"]);
    const deletedCount = await repo.cleanupOrphans(validTradeIds);

    expect(deletedCount).toBe(1); // Only old orphan deleted!
    expect(await repo.getAttachment("orphan_old")).toBeNull();
    expect(await repo.getAttachment("orphan_recent")).not.toBeNull();
  });
});
