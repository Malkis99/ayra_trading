import { AppStorage } from "@/lib/storage";
import type { Follow, ProfileLike, SocialCounts, SocialRepository, SocialResult } from "./types";

const SOCIAL_STORAGE_KEY = "ayra_social_v1";

interface SocialStorageData {
  schemaVersion: 1;
  follows: Follow[];
  likes: ProfileLike[];
}

const EMPTY: SocialStorageData = { schemaVersion: 1, follows: [], likes: [] };

/** Local implementation (AppStorage, current space). Starts empty: counts are 0 until real events exist. */
export class LocalSocialRepository implements SocialRepository {
  constructor(private key = SOCIAL_STORAGE_KEY) {}

  private load(): SocialStorageData {
    if (typeof window === "undefined") return EMPTY;
    try {
      const raw = AppStorage.getItem(this.key);
      if (!raw) return EMPTY;
      const data = JSON.parse(raw) as Partial<SocialStorageData>;
      return {
        schemaVersion: 1,
        follows: Array.isArray(data.follows) ? data.follows : [],
        likes: Array.isArray(data.likes) ? data.likes : [],
      };
    } catch {
      return EMPTY;
    }
  }

  private save(data: SocialStorageData) {
    if (typeof window === "undefined") return;
    AppStorage.setItem(this.key, JSON.stringify(data));
  }

  async getCounts(profileId: string): Promise<SocialCounts> {
    const d = this.load();
    return {
      followers: d.follows.filter((f) => f.followeeId === profileId && f.followerId !== profileId).length,
      following: d.follows.filter((f) => f.followerId === profileId && f.followeeId !== profileId).length,
      likes: d.likes.filter((l) => l.profileId === profileId && l.userId !== profileId).length,
    };
  }

  async listFollowers(profileId: string): Promise<Follow[]> {
    return this.load().follows.filter((f) => f.followeeId === profileId && f.followerId !== profileId);
  }

  async listFollowing(profileId: string): Promise<Follow[]> {
    return this.load().follows.filter((f) => f.followerId === profileId && f.followeeId !== profileId);
  }

  async follow(followerId: string, followeeId: string): Promise<SocialResult> {
    if (followerId === followeeId) return { ok: false, error: "self" };
    const d = this.load();
    if (d.follows.some((f) => f.followerId === followerId && f.followeeId === followeeId)) return { ok: false, error: "duplicate" };
    this.save({ ...d, follows: [...d.follows, { followerId, followeeId, createdAt: new Date().toISOString() }] });
    return { ok: true };
  }

  async unfollow(followerId: string, followeeId: string): Promise<void> {
    const d = this.load();
    this.save({ ...d, follows: d.follows.filter((f) => !(f.followerId === followerId && f.followeeId === followeeId)) });
  }

  async likeProfile(userId: string, profileId: string): Promise<SocialResult> {
    if (userId === profileId) return { ok: false, error: "self" };
    const d = this.load();
    if (d.likes.some((l) => l.userId === userId && l.profileId === profileId)) return { ok: false, error: "duplicate" };
    this.save({ ...d, likes: [...d.likes, { userId, profileId, createdAt: new Date().toISOString() }] });
    return { ok: true };
  }

  async unlikeProfile(userId: string, profileId: string): Promise<void> {
    const d = this.load();
    this.save({ ...d, likes: d.likes.filter((l) => !(l.userId === userId && l.profileId === profileId)) });
  }
}

export const defaultSocialRepository: SocialRepository = new LocalSocialRepository();

/** Id of the profile in the current space: the account id, or "local" for a guest on this device. */
export function localProfileId(userId: string | null | undefined): string {
  return userId || "local";
}

/**
 * Who may see a profile's social counters: the owner always; others only when the profile is public.
 * Pack 15.3 has no extra rule for counters in the 16–17 mode (its message limits apply once messages exist).
 */
export function canSeeSocialCounts(viewerId: string | null | undefined, ownerId: string, visibility: "public" | "hidden" | undefined): boolean {
  if (viewerId && viewerId === ownerId) return true;
  return (visibility ?? "public") === "public";
}

/** Compact counter: "1 085", "24,1 тыс." / "24.1K" (Intl.NumberFormat). */
export function formatSocialCount(n: number, lang: string): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  if (n < 10000) return new Intl.NumberFormat(locale).format(n);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
