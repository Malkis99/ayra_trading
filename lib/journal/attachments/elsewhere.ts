/**
 * Screenshots of a synced trade that are not on this device.
 *
 * The trade record (synced) lists its screenshot ids; the files themselves stay in the browser where they were
 * added (cloud screenshots are a later step, 0005). A trade from another device can therefore reference files this
 * device does not have. The caption «stored on another device» is shown only for ids found neither here nor in the
 * cloud store, so it disappears by itself once 0005 puts the files into the cloud.
 */

/** Which screenshot ids the cloud store holds. Until 0005 there is no cloud store: nothing is there. */
export interface CloudAttachmentStore {
  has(ids: string[]): Promise<Set<string>>;
}

export const noCloudAttachments: CloudAttachmentStore = {
  has: async () => new Set<string>(),
};

/** Ids the trade lists that are absent on this device. */
export function notOnDevice(expectedIds: readonly string[] | undefined, localIds: readonly string[]): string[] {
  const here = new Set(localIds);
  return [...new Set(expectedIds || [])].filter((id) => !here.has(id));
}

/** Ids absent both on this device and in the cloud store: these get the «stored on another device» caption. */
export async function screenshotsElsewhere(
  expectedIds: readonly string[] | undefined,
  localIds: readonly string[],
  store: CloudAttachmentStore = noCloudAttachments
): Promise<string[]> {
  const missing = notOnDevice(expectedIds, localIds);
  if (missing.length === 0) return [];
  let inCloud = new Set<string>();
  try {
    inCloud = await store.has(missing);
  } catch {
    // Cloud store unreachable: the files are still not here, keep the caption.
  }
  return missing.filter((id) => !inCloud.has(id));
}
