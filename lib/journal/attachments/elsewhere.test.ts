import { describe, it, expect } from "vitest";
import { notOnDevice, screenshotsElsewhere, type CloudAttachmentStore } from "./elsewhere";

const cloudWith = (ids: string[]): CloudAttachmentStore => ({ has: async (asked) => new Set(asked.filter((id) => ids.includes(id))) });

describe("screenshots stored on another device (T7b-4f)", () => {
  it("ids the trade lists but this device lacks", () => {
    expect(notOnDevice(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
    expect(notOnDevice(["a", "a"], [])).toEqual(["a"]);
    expect(notOnDevice(undefined, ["b"])).toEqual([]);
  });

  it("file only on another device → caption; until 0005 there is no cloud store", async () => {
    expect(await screenshotsElsewhere(["a"], [])).toEqual(["a"]);
  });

  it("file in the cloud store → no caption (it disappears by itself after 0005)", async () => {
    expect(await screenshotsElsewhere(["a"], [], cloudWith(["a"]))).toEqual([]);
    expect(await screenshotsElsewhere(["a", "b"], [], cloudWith(["a"]))).toEqual(["b"]);
  });

  it("file on this device → no caption, the cloud is not asked", async () => {
    let asked = false;
    const store: CloudAttachmentStore = { has: async () => ((asked = true), new Set()) };
    expect(await screenshotsElsewhere(["a"], ["a"], store)).toEqual([]);
    expect(asked).toBe(false);
  });

  it("cloud store unreachable → caption stays (the file is still not here)", async () => {
    const broken: CloudAttachmentStore = { has: async () => Promise.reject(new Error("offline")) };
    expect(await screenshotsElsewhere(["a"], [], broken)).toEqual(["a"]);
  });
});
