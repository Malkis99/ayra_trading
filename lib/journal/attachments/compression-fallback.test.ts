import { describe, it, expect, vi } from "vitest";
import { CLOUD_FILE_MAX_BYTES, FALLBACK_MAX_DIMENSION, FALLBACK_QUALITY, processScreenshot, type ProcessedImageResult } from "./image-processor";

const result = (bytes: number): ProcessedImageResult => ({
  originalBlob: new Blob(["x"]),
  previewBlob: new Blob(["p"]),
  mime: "image/webp",
  width: 1600,
  height: 900,
  bytes,
  hash: "h",
});

describe("screenshot compression with the cloud limit (0005)", () => {
  it("usual result within 5 MB: taken as is, no second try", async () => {
    const process = vi.fn(async () => result(300_000));
    expect((await processScreenshot(new Blob(["f"]), process)).bytes).toBe(300_000);
    expect(process).toHaveBeenCalledTimes(1);
  });

  it("over 5 MB: second try at 1280 px, quality 0.7", async () => {
    const process = vi.fn(async (_f: Blob, o?: { maxDimension?: number }) => result(o?.maxDimension ? 2_000_000 : CLOUD_FILE_MAX_BYTES + 1));
    expect((await processScreenshot(new Blob(["f"]), process)).bytes).toBe(2_000_000);
    expect(process).toHaveBeenLastCalledWith(expect.anything(), { maxDimension: FALLBACK_MAX_DIMENSION, quality: FALLBACK_QUALITY });
  });

  it("still over 5 MB after the second try: refused with a clear reason, nothing added", async () => {
    const process = vi.fn(async () => result(CLOUD_FILE_MAX_BYTES + 1));
    await expect(processScreenshot(new Blob(["f"]), process)).rejects.toThrow("TOO_BIG_AFTER_COMPRESSION");
    expect(process).toHaveBeenCalledTimes(2);
  });
});
